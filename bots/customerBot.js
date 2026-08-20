// Логика клиентского Telegram-бота.
//
// Важно: это webhook-обработчик на serverless-платформе — между
// сообщениями процесс не сохраняет память, поэтому весь "прогресс"
// диалога (какой шаг сейчас проходит клиент) хранится в таблице
// customers (поле state), а не в переменных JS.

const db = require('../db');
const { customerApi, employeeApi } = require('../telegram');
const { CATEGORIES } = require('../categories');

function branchKeyboard(branches) {
  return {
    inline_keyboard: branches.map((b) => [{ text: `${b.code} — ${b.name}`, callback_data: `branch:${b.code}` }]),
  };
}

function categoryKeyboard() {
  return {
    inline_keyboard: CATEGORIES.map((c) => [{ text: c, callback_data: `category:${c}` }]),
  };
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

  if (text === '/start') {
    await db.query(
      `insert into customers (telegram_user_id, telegram_chat_id, state, branch_id, pending_category)
       values ($1, $2, 'AWAITING_BRANCH', null, null)
       on conflict (telegram_user_id) do update
         set telegram_chat_id = excluded.telegram_chat_id, state = 'AWAITING_BRANCH', pending_category = null`,
      [userId, chatId]
    );
    const branches = (await db.query(`select * from branches where status = 'ACTIVE' order by name`)).rows;
    await customerApi.sendMessage(
      chatId,
      'Здравствуйте!\n\nДобро пожаловать в службу поддержки Trustbank.\n\nВыберите филиал, в котором вы обслуживаетесь.',
      { reply_markup: branchKeyboard(branches) }
    );
    return;
  }

  const customer = (await db.query('select * from customers where telegram_user_id = $1', [userId])).rows[0];

  if (!customer || !customer.branch_id) {
    await customerApi.sendMessage(chatId, 'Пожалуйста, начните с команды /start и выберите филиал.');
    return;
  }

  const activeTicket = (
    await db.query(
      `select * from tickets where customer_id = $1 and status in ('NEW','IN_PROGRESS','WAITING_FOR_CLIENT')
       order by created_at desc limit 1`,
      [customer.id]
    )
  ).rows[0];

  if (activeTicket) {
    await db.query(
      `insert into messages (ticket_id, sender_type, sender_id, text, telegram_message_id) values ($1,'CUSTOMER',$2,$3,$4)`,
      [activeTicket.id, customer.id, text, message.message_id]
    );
    await db.query(`update tickets set updated_at = now() where id = $1`, [activeTicket.id]);

    if (activeTicket.assigned_employee_id) {
      const emp = (await db.query('select * from employees where id = $1', [activeTicket.assigned_employee_id])).rows[0];
      if (emp) {
        employeeApi
          .sendMessage(emp.telegram_chat_id, `Новое сообщение по обращению #${activeTicket.ticket_number}:\n\n${text}`)
          .catch(() => {});
      }
    }
    return;
  }

  if (customer.state === 'AWAITING_MESSAGE' && customer.pending_category) {
    const ticket = (
      await db.query(
        `insert into tickets (customer_id, branch_id, category, subject, status)
         values ($1,$2,$3,$4,'NEW') returning *`,
        [customer.id, customer.branch_id, customer.pending_category, text.slice(0, 300)]
      )
    ).rows[0];

    await db.query(
      `insert into messages (ticket_id, sender_type, sender_id, text, telegram_message_id) values ($1,'CUSTOMER',$2,$3,$4)`,
      [ticket.id, customer.id, text, message.message_id]
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
          `🔴 Новое обращение #${ticket.ticket_number}\n\nКатегория: ${ticket.category}\n\n${ticket.subject}\n\nОткройте приложение поддержки, чтобы взять обращение в работу.`
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

  if (data.startsWith('branch:')) {
    const code = data.slice('branch:'.length);
    const branch = (await db.query('select * from branches where code = $1', [code])).rows[0];
    if (!branch) {
      await customerApi.answerCallbackQuery(cb.id, 'Филиал не найден');
      return;
    }
    await db.query(`update customers set branch_id = $1, state = 'AWAITING_CATEGORY' where telegram_user_id = $2`, [
      branch.id,
      userId,
    ]);
    await customerApi.answerCallbackQuery(cb.id);
    await customerApi.sendMessage(chatId, `Филиал выбран: ${branch.code} — ${branch.name}\n\nВыберите категорию вашего обращения.`, {
      reply_markup: categoryKeyboard(),
    });
    customerApi.deleteMessage(chatId, cb.message.message_id).catch(() => {});
    return;
  }

  if (data.startsWith('category:')) {
    const category = data.slice('category:'.length);
    const customer = (await db.query('select * from customers where telegram_user_id = $1', [userId])).rows[0];
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
