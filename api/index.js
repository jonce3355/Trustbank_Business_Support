require('dotenv').config();

const path = require('path');
const express = require('express');
const db = require('../db');
const customerBot = require('../bots/customerBot');
const employeeBot = require('../bots/employeeBot');
const apiRoutes = require('../routes/api');

const app = express();
// Лимит поднят под base64-фото (до 3 МБ файла ≈ 4 МБ в base64 + запас на JSON).
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (req, res) => {
  const result = { status: 'ok', database: 'unknown', customerBot: 'unknown', employeeBot: 'unknown' };

  try {
    await db.query('select 1');
    result.database = 'connected';
  } catch (e) {
    result.database = 'error: проверьте DATABASE_URL';
    result.status = 'degraded';
  }

  try {
    const { customerApi } = require('../telegram');
    const r = await customerApi.getMe();
    result.customerBot = r.ok ? 'connected' : 'error: проверьте CUSTOMER_BOT_TOKEN';
  } catch (e) {
    result.customerBot = 'error: проверьте CUSTOMER_BOT_TOKEN';
  }

  try {
    const { employeeApi } = require('../telegram');
    const r = await employeeApi.getMe();
    result.employeeBot = r.ok ? 'connected' : 'error: проверьте EMPLOYEE_BOT_TOKEN';
  } catch (e) {
    result.employeeBot = 'error: проверьте EMPLOYEE_BOT_TOKEN';
  }

  if (result.database !== 'connected' || result.customerBot !== 'connected' || result.employeeBot !== 'connected') {
    result.status = 'degraded';
  }

  let branchCount = 0;
  try {
    const r = await db.query('select count(*)::int as c from branches');
    branchCount = r.rows[0].c;
  } catch {}
  result.branches = branchCount > 0 ? `${branchCount} configured` : 'no branches configured';

  console.log('[Health]', JSON.stringify(result));
  res.json(result);
});

app.post('/webhook/customer', async (req, res) => {
  try {
    await customerBot.handleUpdate(req.body);
  } catch (e) {
    console.error('[Customer Bot] Ошибка обработки обновления:', e.message);
  }
  res.sendStatus(200);
});

app.post('/webhook/employee', async (req, res) => {
  try {
    await employeeBot.handleUpdate(req.body);
  } catch (e) {
    console.error('[Employee Bot] Ошибка обработки обновления:', e.message);
  }
  res.sendStatus(200);
});

app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Страница не найдена.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server] Необработанная ошибка:', err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[Web Server] Running on port ${port}`);
  });
}

module.exports = app;
