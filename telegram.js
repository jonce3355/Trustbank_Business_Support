// Тонкая обёртка над Telegram Bot API. Токены читаются из переменных
// окружения и никогда не логируются и не отдаются во фронтенд.

function makeApi(tokenEnvVar) {
  function getBase() {
    const token = process.env[tokenEnvVar];
    if (!token) {
      throw new Error(`${tokenEnvVar} не задан в переменных окружения.`);
    }
    return `https://api.telegram.org/bot${token}`;
  }

  async function call(method, payload) {
    const base = getBase();
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram/${tokenEnvVar}] ${method} failed: ${data.description}`);
    }
    return data;
  }

  // Загрузка бинарного файла (фото) требует multipart/form-data,
  // а не JSON — поэтому отдельная функция.
  async function sendPhoto(chatId, buffer, filename, mimeType, caption) {
    const base = getBase();
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('photo', new Blob([buffer], { type: mimeType }), filename);
    const res = await fetch(`${base}/sendPhoto`, { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram/${tokenEnvVar}] sendPhoto failed: ${data.description}`);
    }
    return data;
  }

  return {
    sendMessage: (chatId, text, extra = {}) =>
      call('sendMessage', { chat_id: chatId, text, ...extra }),
    sendPhoto,
    getFile: (fileId) => call('getFile', { file_id: fileId }),
    answerCallbackQuery: (callbackQueryId, text) =>
      call('answerCallbackQuery', { callback_query_id: callbackQueryId, text }),
    deleteMessage: (chatId, messageId) => call('deleteMessage', { chat_id: chatId, message_id: messageId }),
    setWebhook: (url) => call('setWebhook', { url }),
    getMe: () => call('getMe', {}),
  };
}

module.exports = {
  customerApi: makeApi('CUSTOMER_BOT_TOKEN'),
  employeeApi: makeApi('EMPLOYEE_BOT_TOKEN'),
};
