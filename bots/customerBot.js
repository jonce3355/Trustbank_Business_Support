// Логика клиентского Telegram-бота.
//
// Важно: это webhook-обработчик на serverless-платформе — между
// сообщениями процесс не сохраняет память, поэтому весь "прогресс"
// диалога (какой шаг сейчас проходит клиент) хранится в таблице
// customers (поле state), а не в переменных JS.
//
// Порядок для нового клиента:
//   /start → телефон → ИНН → имя и фамилия → филиал → категория → текст
// Эти данные сохраняются в customers и переиспользуются при каждом
// следующем /start — заново их вводить не нужно. Профиль можно
// посмотреть и изменить в любой момент кнопкой "Мой профиль".

const db = require('../db');
const { customerApi, employeeApi } = require('../telegram');
const { CATEGORIES } = require('../categories');

const PROFILE_BUTTON = { text: '👤 Мой профиль', callback_data: 'profile:view' };

function branchKeyboard(branches) {
  return {
    inline_keyboard: [...branches.map((b) => [{ text: `${b.code} — ${b.name}`, callback_data: `branch:${b.code}` }]), [PROFILE_BUTTON]],
  };
}

function categoryKeyboard() {
  return {
    inline_keyboard: [...CATEGORIES.map((c) => [{ text: c, callback_data: `category:${c}` }]), [PROFILE_BUTTON]],
  };
}

function profileKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Телефон', callback_data: 'profile:edit:phone' }, { text: '✏️ ИНН', callback_data: 'profile:edit:inn' }],
      [{ text: '✏️ Имя и фамилия', callback_data: 'profile:edit:name' }, { text: '✏️ Филиал', callback_data: 'profile:edit:branch' }],
    ],
  };
}

function hasCompletedProfile(customer) {
  return Boolean(customer && customer.full_name && customer.phone && customer.inn);
}

async function getCustomer(userId) {
  return (await db.query('select * from customers where telegram_user_id = $1', [userId])).rows[0];
}

async function getActiveBranches() {
  return (await db.query(`select * from branches where status = 'ACTIVE' order by name`)).rows;
}

async function findActiveTicket(customerId) {
  return (
    await db.query(
      `select * from tickets where customer_id = $1 and status in ('NEW','IN_PROGRESS','WAITING_FOR_CLIENT')
       order by created_at desc limit 1`,
      [customerId]
    )
  ).rows[0];
}

async function sendProfileView(chatId, customer) {
  const branch = customer.branch_id ? (await db.query('select * from branches where id = $1', [customer.branch_id])).rows[0] : null;
  const text = [
    '👤 Ваш профиль',
    '',
    `Имя: ${customer.full_name || '—'}`,
    `Телефон: ${customer.phone || '—'}`,
    `ИНН: ${customer.inn || '—'}`,
    `Филиал: ${branch ? `${branch.code} — ${branch.name}` : '—'}`,
  ].join('\n');
  await customerApi.sendMessage(chatId, text, { reply_markup: profileKeyboard() });
}

async function handleUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    await handleCallback(update.callback_query);
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = (message.text || '').trim();
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const caption = (message.caption || '').trim();
  const photoFileId = hasPhoto ? message.photo[message.photo.length - 1].file_id : null;

  if (!hasPhoto && !text) {
    return;
  }

  if (text === '/start') {
    await db.query(
      `insert into customers (telegram_user_id, telegram_chat_id)
       values ($1, $2)
       on conflict (telegram_user_id) do update set telegram_chat_id = excluded.telegram_chat_id`,
      [userId, chatId]
    );
    const customer = await getCustomer(userId);

    if (!hasCompletedProfile(customer)) {
      await db.query(`update customers set state = 'AWAITING_PHONE' where id = $1`, [customer.id]);
      await customerApi.sendMessage(
        chatId,
        'Здравствуйте!\n\nДобро пожаловать в службу поддержки Trustbank.\n\nДля начала, пожалуйста, укажите номер телефона для связи.'
      );
      return;
    }

    if (!customer.branch_id) {
      await db.query(`update customers set state = 'AWAITING_BRANCH' where id = $1`, [customer.id]);
      await customerApi.sendMessage(chatId, 'Выберите филиал, в котором вы обслуживаетесь.', {
        reply_markup: branchKeyboard(await getActiveBranches()),
      });
      return;
    }

    const activeTicket = await findActiveTicket(customer.id);
    if (activeTicket) {
      await customerApi.sendMessage(
        chatId,
        `У вас уже есть открытое обращение #${activeTicket.ticket_number}. Просто напишите сообщение — оно добавится к этому обращению.`,
        { reply_markup: { inline_keyboard: [[PROFILE_BUTTON]] } }
      );
      return;
    }

    await db.query(`update customers set state = 'AWAITING_CATEGORY' where id = $1`, [customer.id]);
    const branch = (await db.query('select * from branches where id = $1', [customer.branch_id])).rows[0];
    await customerApi.sendMessage(
      chatId,
      `С возвращением, ${customer.full_name}!\n\nФилиал: ${branch ? `${branch.code} — ${branch.name}` : '—'}\n\nВыберите категорию нового обращения.`,
      { reply_markup: categoryKeyboard() }
    );
    return;
  }

  if (text === '/profile') {
    const customer = await getCustomer(userId);
    if (!customer || !hasCompletedProfile(customer)) {
      await customerApi.sendMessage(chatId, 'Сначала завершите регистрацию: отправьте /start.');
      return;
    }
    await sendProfileView(chatId, customer);
    return;
  }

  const customer = await getCustomer(userId);
  if (!customer) {
    await customerApi.sendMessage(chatId, 'Пожалуйста, начните с команды /start.');
    return;
  }

  // --- Редактирование отдельного поля профиля (запущено кнопкой) ---
  if (customer.state === 'EDITING_PHONE') {
    if (text.length < 5) {
      await customerApi.sendMessage(chatId, 'Похоже, номер телефона указан некорректно. Попробуйте ещё раз.');
      return;
    }
    await db.query(`update customers set phone = $1, state = 'READY' where id = $2`, [text, customer.id]);
    await customerApi.sendMessage(chatId, '✅ Телефон обновлён.');
    await sendProfileView(chatId, await getCustomer(userId));
    return;
  }
  if (customer.state === 'EDITING_INN') {
    if (text.length < 3) {
      await customerApi.sendMessage(chatId, 'Похоже, ИНН указан некорректно. Попробуйте ещё раз.');
      return;
    }
    await db.query(`update customers set inn = $1, state = 'READY' where id = $2`, [text, customer.id]);
    await customerApi.sendMessage(chatId, '✅ ИНН обновлён.');
    await sendProfileView(chatId, await getCustomer(userId));
    return;
  }
  if (customer.state === 'EDITING_NAME') {
    if (text.length < 2) {
      await customerApi.sendMessage(chatId, 'Пожалуйста, введите имя и фамилию текстом.');
      return;
    }
    await db.query(`update customers set full_name = $1, state = 'READY' where id = $2`, [text, customer.id]);
    await customerApi.sendMessage(chatId, '✅ Имя обновлено.');
    await sendProfileView(chatId, await getCustomer(userId));
    return;
  }

  // --- Первичный сбор анкеты ---
  if (customer.state === 'AWAITING_PHONE') {
    if (text.length < 5) {
      await customerApi.sendMessage(chatId, 'Пожалуйста, укажите корректный номер телефона.');
      return;
    }
    await db.query(`update customers set phone = $1, state = 'AWAITING_INN' where id = $2`, [text, customer.id]);
    await customerApi.sendMessage(chatId, 'Спасибо! Теперь укажите ИНН вашей организации.');
    return;
  }
  if (customer.state === 'AWAITING_INN') {
    if (text.length < 3) {
      await customerApi.sendMessage(chatId, 'Пожалуйста, укажите корректный ИНН.');
      return;
    }
    await db.query(`update customers set inn = $1, state = 'AWAITING_NAME' where id = $2`, [text, customer.id]);
    await customerApi.sendMessage(chatId, 'Отлично! Теперь укажите ваше имя и фамилию.');
    return;
  }
  if (customer.state === 'AWAITING_NAME') {
    if (text.length < 2) {
      await customerApi.sendMessage(chatId, 'Пожалуйста, введите имя и фамилию текстом.');
      return;
    }
    await db.query(`update customers set full_name = $1, state = 'AWAITING_BRANCH' where id = $2`, [text, customer.id]);
    await customerApi.sendMessage(chatId, `Спасибо, ${text}!\n\nТеперь выберите филиал, в котором вы обслуживаетесь.`, {
      reply_markup: branchKeyboard(await getActiveBranches()),
    });
    return;
  }

  if (!hasCompletedProfile(customer) || !customer.branch_id) {
    await customerApi.sendMessage(chatId, 'Пожалуйста, воспользуйтесь кнопками выше, либо отправьте /start заново.');
    return;
  }

  const activeTicket = await findActiveTicket(customer.id);

  if (activeTicket) {
    await db.query(
      `insert into messages (ticket_id, sender_type, sender_id, text, telegram_message_id, attachment_type, attachment_id)
       values ($1,'CUSTOMER',$2,$3,$4,$5,$6)`,
      [activeTicket.id, customer.id, hasPhoto ? caption || null : text, message.message_id, hasPhoto ? 'photo' : null, photoFileId]
    );
    await db.query(`update tickets set updated_at = now() where id = $1`, [activeTicket.id]);

    if (activeTicket.assigned_employee_id) {
      const emp = (await db.query('select * from employees where id = $1', [activeTicket.assigned_employee_id])).rows[0];
      if (emp) {
        const preview = hasPhoto ? `📷 Фото${caption ? `: ${caption}` : ''}` : text;
        employeeApi
          .sendMessage(
            emp.telegram_chat_id,
            `Новое сообщение по обращению #${activeTicket.ticket_number}\nКлиент: ${customer.full_name} (${customer.phone})\n\n${preview}`
          )
          .catch(() => {});
      }
    }
    return;
  }

  if (customer.state === 'AWAITING_MESSAGE' && customer.pending_category) {
    const subjectSource = hasPhoto ? caption || 'Фото' : text;
    const ticket = (
      await db.query(
        `insert into tickets (customer_id, branch_id, category, subject, status)
         values ($1,$2,$3,$4,'NEW') returning *`,
        [customer.id, customer.branch_id, customer.pending_category, subjectSource.slice(0, 300)]
      )
    ).rows[0];

    await db.query(
      `insert into messages (ticket_id, sender_type, sender_id, text, telegram_message_id, attachment_type, attachment_id)
       values ($1,'CUSTOMER',$2,$3,$4,$5,$6)`,
      [ticket.id, customer.id, hasPhoto ? caption || null : text, message.message_id, hasPhoto ? 'photo' : null, photoFileId]
    );

    await db.query(`update customers set state = 'READY', pending_category = null where id = $1`, [customer.id]);

    await customerApi.sendMessage(
      chatId,
      `Спасибо! Ваше обращение зарегистрировано.\n\nНомер обращения: #${ticket.ticket_number}\n\nСотрудник свяжется с вами в ближайшее время.`
    );

    const branchEmployees = (
      await db.query(`select * from employees where branch_id = $1 and status = 'ACTIVE'`, [customer.branch_id])
    ).rows;
    for (const emp of branchEmployees) {
      employeeApi
        .sendMessage(
          emp.telegram_chat_id,
          `🔴 Новое обращение #${ticket.ticket_number}\n\nКлиент: ${customer.full_name}\nТелефон: ${customer.phone}\nИНН: ${customer.inn}\n\nКатегория: ${ticket.category}\n\n${ticket.subject}\n\nОткройте приложение поддержки, чтобы взять обращение в работу.`
        )
        .catch(() => {});
    }
    return;
  }

  if (customer.state === 'AWAITING_CATEGORY') {
    await customerApi.sendMessage(chatId, 'Пожалуйста, выберите категорию обращения, нажав на одну из кнопок выше.');
    return;
  }

  await customerApi.sendMessage(chatId, 'Пожалуйста, начните с команды /start.');
}

async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const userId = cb.from.id;
  const data = cb.data || '';

  if (data.startsWith('profile:')) {
    const action = data.slice('profile:'.length);
    const customer = await getCustomer(userId);
    await customerApi.answerCallbackQuery(cb.id);
    if (!customer || !hasCompletedProfile(customer)) return;

    if (action === 'view') {
      await sendProfileView(chatId, customer);
      return;
    }
    if (action === 'edit:phone') {
      await db.query(`update customers set state = 'EDITING_PHONE' where id = $1`, [customer.id]);
      await customerApi.sendMessage(chatId, 'Введите новый номер телефона:');
      return;
    }
    if (action === 'edit:inn') {
      await db.query(`update customers set state = 'EDITING_INN' where id = $1`, [customer.id]);
      await customerApi.sendMessage(chatId, 'Введите новый ИНН организации:');
      return;
    }
    if (action === 'edit:name') {
      await db.query(`update customers set state = 'EDITING_NAME' where id = $1`, [customer.id]);
      await customerApi.sendMessage(chatId, 'Введите новое имя и фамилию:');
      return;
    }
    if (action === 'edit:branch') {
      await db.query(`update customers set state = 'EDITING_BRANCH' where id = $1`, [customer.id]);
      await customerApi.sendMessage(chatId, 'Выберите новый филиал:', { reply_markup: branchKeyboard(await getActiveBranches()) });
      return;
    }
    return;
  }

  if (data.startsWith('branch:')) {
    const code = data.slice('branch:'.length);
    const branch = (await db.query('select * from branches where code = $1', [code])).rows[0];
    if (!branch) {
      await customerApi.answerCallbackQuery(cb.id, 'Филиал не найден');
      return;
    }
    const customer = await getCustomer(userId);
    const isEditing = customer && customer.state === 'EDITING_BRANCH';

    await db.query(`update customers set branch_id = $1, state = $2 where telegram_user_id = $3`, [
      branch.id,
      isEditing ? 'READY' : 'AWAITING_CATEGORY',
      userId,
    ]);
    await customerApi.answerCallbackQuery(cb.id);
    customerApi.deleteMessage(chatId, cb.message.message_id).catch(() => {});

    if (isEditing) {
      await customerApi.sendMessage(chatId, `✅ Филиал обновлён: ${branch.code} — ${branch.name}`);
      await sendProfileView(chatId, await getCustomer(userId));
    } else {
      await customerApi.sendMessage(chatId, `Филиал выбран: ${branch.code} — ${branch.name}\n\nВыберите категорию вашего обращения.`, {
        reply_markup: categoryKeyboard(),
      });
    }
    return;
  }

  if (data.startsWith('category:')) {
    const category = data.slice('category:'.length);
    const customer = await getCustomer(userId);
    if (!customer || customer.state !== 'AWAITING_CATEGORY') {
      await customerApi.answerCallbackQuery(cb.id);
      await customerApi.sendMessage(chatId, 'Сначала выберите филиал командой /start.');
      return;
    }
    await db.query(`update customers set state = 'AWAITING_MESSAGE', pending_category = $1 where id = $2`, [category, customer.id]);
    await customerApi.answerCallbackQuery(cb.id);
    await customerApi.sendMessage(chatId, `Категория: ${category}\n\nОпишите вашу проблему одним сообщением.`);
    customerApi.deleteMessage(chatId, cb.message.message_id).catch(() => {});
    return;
  }
}

module.exports = { handleUpdate };
