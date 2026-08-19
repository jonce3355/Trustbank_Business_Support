const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL не задан. Проверьте переменные окружения (.env локально или Environment Variables в Vercel).'
      );
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Ошибка соединения в пуле:', err.message);
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

module.exports = { query, getPool };
