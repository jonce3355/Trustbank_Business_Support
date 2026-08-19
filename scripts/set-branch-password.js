// Создаёт пароль филиала (хэширует его и сохраняет в базу).
//
// Использование (в терминале, из папки проекта):
//   npm run set-password -- <код_филиала> <пароль>
// Пример:
//   npm run set-password -- 00491 MySecret123
//
// Перед запуском в файле .env должен быть заполнен DATABASE_URL.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
  const [code, plainPassword] = process.argv.slice(2);

  if (!code || !plainPassword) {
    console.log('Использование: node scripts/set-branch-password.js <код_филиала> <пароль>');
    console.log('Пример: node scripts/set-branch-password.js 00491 MySecret123');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.log('Ошибка: DATABASE_URL не найден. Проверьте файл .env в папке проекта.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    const branchRes = await pool.query('select id, code, name from branches where code = $1', [code]);
    if (branchRes.rows.length === 0) {
      console.log(`Ошибка: филиал с кодом "${code}" не найден в таблице branches.`);
      console.log('Убедитесь, что вы уже выполнили schema.sql в Supabase SQL Editor.');
      process.exit(1);
    }

    const branch = branchRes.rows[0];
    const hash = await bcrypt.hash(plainPassword, 10);

    await pool.query(
      'insert into branch_passwords (branch_id, password_hash, label) values ($1, $2, $3)',
      [branch.id, hash, `Пароль для ${branch.name}`]
    );

    console.log(`Готово! Пароль создан для филиала ${branch.code} — ${branch.name}.`);
    console.log('Теперь этот пароль можно использовать при регистрации в Employee-боте.');
  } catch (err) {
    console.log('Не удалось создать пароль. Проверьте DATABASE_URL и подключение к интернету.');
    console.log('Подробности ошибки:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
