const bcrypt = require('bcryptjs');
const db = require('../db');
const { employeeApi } = require('../telegram');

function webAppButton(text) {
  return {
    inline_keyboard: [[{ text, web_app: { url: process.env.WEB_APP_URL } }]],
  };
}

// Пароль хранится только как bcrypt-хэш, поэтому его нельзя найти прямым
// SQL-запросом — перебираем активные пароли и сверяем через bcrypt.compare.
async function findActiveBranchPasswordMatch(plainPassword) {
  const rows = (
    await db.query(
      `select bp.* from branch_passwords bp where bp.is_active = true`
    )
  ).rows;
  for (const row of rows) {
    const match = await bcrypt.compare(plainPassword, row.password_hash);
    if (match) return row;
  }
  return null;
}

async function handleUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = (message.text || '').trim();

  const employee = (await db.query('select * from employees where telegram_user_id = $1', [userId])).rows[0];

  if (employee) {
    if (employee.status === 'BLOCKED') {
      await employeeApi.sendMessage(chatId, 'Ваш доступ заблокирован. Обратитесь к администратору.');
      return;
    }
    const branch = (await db.query('select * from branches where id = $1', [employee.branch_id])).rows[0];
    const roleLabel = employee.role === 'SUPER_ADMIN' ? 'Супер-администратор' : 'Сотрудник';
    await employeeApi.sendMessage(
      chatId,
      `${employee.name}\nФилиал: ${branch ? `${branch.code} — ${branch.name}` : '—'}\nРоль: ${roleLabel}\n\nНажмите кнопку, чтобы открыть панель поддержки.`,
      { reply_markup: webAppButton('ОТКРЫТЬ ПОДДЕРЖКУ') }
    );
    return;
  }

  if (text === '/start') {
    await db.query(
      `insert into pending_employee_registrations (telegram_user_id, telegram_chat_id, step, branch_id)
       values ($1, $2, 'AWAITING_PASSWORD', null)
       on conflict (telegram_user_id) do update
         set telegram_chat_id = excluded.telegram_chat_id, step = 'AWAITING_PASSWORD', branch_id = null`,
      [userId, chatId]
    );
    await employeeApi.sendMessage(
      chatId,
      'Добро пожаловать в Trustbank Support (для сотрудников).\n\nВведите пароль сотрудника.'
    );
    return;
  }

  const pending = (
    await db.query('select * from pending_employee_registrations where telegram_user_id = $1', [userId])
  ).rows[0];

  if (!pending) {
    await employeeApi.sendMessage(chatId, 'Пожалуйста, начните с команды /start.');
    return;
  }

  if (pending.step === 'AWAITING_PASSWORD') {
    const match = await findActiveBranchPasswordMatch(text);
    if (!match) {
      await employeeApi.sendMessage(chatId, 'Неверный пароль. Попробуйте снова.');
      return;
    }
    await db.query(
      `update pending_employee_registrations set step = 'AWAITING_NAME', branch_id = $1 where telegram_user_id = $2`,
      [match.branch_id, userId]
    );
    await employeeApi.sendMessage(chatId, 'Пароль принят.\n\nВведите ваше имя и фамилию (например: Иванов Иван).');
    return;
  }

  if (pending.step === 'AWAITING_NAME') {
    const name = text;
    if (!name || name.length < 2) {
      await employeeApi.sendMessage(chatId, 'Пожалуйста, введите имя и фамилию текстом.');
      return;
    }

    const isSuperAdmin = String(userId) === String(process.env.SUPER_ADMIN_TELEGRAM_ID || '').trim();
    const role = isSuperAdmin ? 'SUPER_ADMIN' : 'EMPLOYEE';

    await db.query(
      `insert into employees (telegram_user_id, telegram_chat_id, name, branch_id, role, status)
       values ($1,$2,$3,$4,$5,'ACTIVE')`,
      [userId, chatId, name, pending.branch_id, role]
    );
    await db.query('delete from pending_employee_registrations where telegram_user_id = $1', [userId]);

    const branch = (await db.query('select * from branches where id = $1', [pending.branch_id])).rows[0];

    await employeeApi.sendMessage(
      chatId,
      `Регистрация завершена.\n\nСотрудник: ${name}\nФилиал: ${branch.code} — ${branch.name}${
        isSuperAdmin ? '\nРоль: Супер-администратор' : ''
      }`,
      { reply_markup: webAppButton('ОТКРЫТЬ ПОДДЕРЖКУ') }
    );
    return;
  }
}

module.exports = { handleUpdate };
