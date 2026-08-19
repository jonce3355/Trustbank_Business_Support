// Регистрирует webhook-адреса обоих ботов в Telegram, чтобы сообщения
// от пользователей начали приходить на ваш сервер (на Vercel).
//
// Использование (в терминале, из папки проекта):
//   npm run set-webhooks
//
// Перед запуском в файле .env должны быть заполнены:
//   WEB_APP_URL, CUSTOMER_BOT_TOKEN, EMPLOYEE_BOT_TOKEN

require('dotenv').config();

async function setWebhook(token, url, label) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`✅ ${label}: webhook установлен -> ${url}`);
  } else {
    console.log(`❌ ${label}: ОШИБКА — ${data.description}`);
  }
}

async function main() {
  const base = process.env.WEB_APP_URL;
  if (!base) {
    console.log('Ошибка: WEB_APP_URL не найден в .env (это адрес вашего сайта на Vercel, например https://trustbank-support.vercel.app).');
    process.exit(1);
  }
  if (!process.env.CUSTOMER_BOT_TOKEN || !process.env.EMPLOYEE_BOT_TOKEN) {
    console.log('Ошибка: не найдены CUSTOMER_BOT_TOKEN и/или EMPLOYEE_BOT_TOKEN в .env');
    process.exit(1);
  }

  const cleanBase = base.replace(/\/+$/, '');
  await setWebhook(process.env.CUSTOMER_BOT_TOKEN, `${cleanBase}/webhook/customer`, 'Customer Bot');
  await setWebhook(process.env.EMPLOYEE_BOT_TOKEN, `${cleanBase}/webhook/employee`, 'Employee Bot');
}

main();
