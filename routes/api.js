const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { validateInitData } = require('../auth');
const { customerApi } = require('../telegram');
const { CATEGORIES } = require('../categories');

const router = express.Router();

// Оборачивает async-обработчик, чтобы ошибки уходили в error-middleware,
// а не "зависали" необработанным отклонённым промисом.
function ah(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Backend сам определяет текущего сотрудника через проверенный Telegram
// initData — Web App не может прислать branch_id или role напрямую.
async function requireEmployee(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const user = validateInitData(initData, process.env.EMPLOYEE_BOT_TOKEN);
  if (!user) {
    return res
      .status(401)
      .json({ error: 'Не удалось подтвердить личность через Telegram. Откройте приложение заново через кнопку в боте.' });
  }

  const employee = (await db.query('select * from employees where telegram_user_id = $1', [user.id])).rows[0];
  if (!employee) {
    return res.status(403).json({ error: 'Вы не зарегистрированы как сотрудник. Пройдите регистрацию в Employee-боте.' });
  }
  if (employee.status === 'BLOCKED') {
    return res.status(403).json({ error: 'Ваш доступ заблокирован администратором.' });
  }

  req.employee = employee;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.employee.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Доступ только для супер-администратора.' });
  }
  next();
}

router.use(ah(requireEmployee));

router.get(
  '/me',
  ah(async (req, res) => {
    const branch = (await db.query('select * from branches where id = $1', [req.employee.branch_id])).rows[0];
    res.json({
      id: req.employee.id,
      name: req.employee.name,
      role: req.employee.role,
      branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
      // Пороги SLA нужны фронтенду, чтобы показывать SLA-таймер по
      // каждому тикету не только супер-администратору, но и рядовому
      // сотруднику (эти же числа и так не секретны — уже видны в
      // /admin/sla).
      firstResponseSlaMinutes: Number(process.env.FIRST_RESPONSE_SLA_MINUTES) || 15,
      resolutionSlaMinutes: Number(process.env.RESOLUTION_SLA_MINUTES) || 240,
    });
  })
);

router.get('/categories', (req, res) => res.json(CATEGORIES));

router.get(
  '/tickets',
  ah(async (req, res) => {
    const { filter = 'all', branch_id } = req.query;
    const params = [];
    const conditions = [];

    if (req.employee.role === 'SUPER_ADMIN') {
      if (branch_id) {
        params.push(branch_id);
        conditions.push(`t.branch_id = $${params.length}`);
      }
    } else {
      params.push(req.employee.branch_id);
      conditions.push(`t.branch_id = $${params.length}`);
    }

    if (filter === 'new') conditions.push(`t.status = 'NEW'`);
    else if (filter === 'in_progress') conditions.push(`t.status = 'IN_PROGRESS'`);
    else if (filter === 'waiting') conditions.push(`t.status = 'WAITING_FOR_CLIENT'`);
    else if (filter === 'resolved') conditions.push(`t.status in ('RESOLVED','CLOSED')`);
    else if (filter === 'mine') {
      params.push(req.employee.id);
      conditions.push(`t.assigned_employee_id = $${params.length}`);
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await db.query(
      `select t.*, coalesce(nullif(c.company_name, ''), c.full_name) as company_name,
              c.phone as customer_phone, c.inn as customer_inn, c.telegram_chat_id as customer_chat_id,
              e.name as assigned_employee_name, b.code as branch_code,
              (
                select coalesce(nullif(m.text, ''), case when m.attachment_type = 'photo' then '📷 Фото' else null end)
                from messages m
                where m.ticket_id = t.id
                order by m.created_at desc
                limit 1
              ) as last_message_text
       from tickets t
       join customers c on c.id = t.customer_id
       join branches b on b.id = t.branch_id
       left join employees e on e.id = t.assigned_employee_id
       ${where}
       order by t.updated_at desc
       limit 200`,
      params
    );
    res.json(result.rows);
  })
);

router.get(
  '/tickets/counts',
  ah(async (req, res) => {
    const params = [];
    let where = '';
    if (req.employee.role !== 'SUPER_ADMIN') {
      params.push(req.employee.branch_id);
      where = `where branch_id = $1`;
    }
    const result = await db.query(`select status, count(*)::int as count from tickets ${where} group by status`, params);
    const counts = { NEW: 0, IN_PROGRESS: 0, WAITING_FOR_CLIENT: 0, RESOLVED: 0, CLOSED: 0 };
    for (const row of result.rows) counts[row.status] = row.count;
    res.json(counts);
  })
);

async function loadTicketScoped(req, res, next) {
  const ticket = (
    await db.query(
      `select t.*, coalesce(nullif(c.company_name, ''), c.full_name) as company_name,
              c.phone as customer_phone, c.inn as customer_inn, c.telegram_chat_id as customer_chat_id
       from tickets t join customers c on c.id = t.customer_id where t.id = $1`,
      [req.params.id]
    )
  ).rows[0];
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено.' });
  if (req.employee.role !== 'SUPER_ADMIN' && ticket.branch_id !== req.employee.branch_id) {
    return res.status(403).json({ error: 'Это обращение относится к другому филиалу.' });
  }
  req.ticket = ticket;
  next();
}

router.get(
  '/tickets/:id',
  ah(loadTicketScoped),
  ah(async (req, res) => {
    const messages = (await db.query('select * from messages where ticket_id = $1 order by created_at asc', [req.params.id])).rows;
    res.json({ ticket: req.ticket, messages });
  })
);

router.post(
  '/tickets/:id/claim',
  ah(loadTicketScoped),
  ah(async (req, res) => {
    if (req.ticket.assigned_employee_id) {
      return res.status(409).json({ error: 'Обращение уже взято в работу другим сотрудником.' });
    }
    await db.query(
      `update tickets set assigned_employee_id = $1, status = 'IN_PROGRESS', updated_at = now() where id = $2`,
      [req.employee.id, req.ticket.id]
    );
    await db.query(`insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'TICKET_ASSIGNED','ticket',$2)`, [
      req.employee.id,
      req.ticket.id,
    ]);
    res.json({ ok: true });
  })
);

router.post(
  '/tickets/:id/message',
  ah(loadTicketScoped),
  ah(async (req, res) => {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Сообщение не может быть пустым.' });
    if (req.ticket.status === 'CLOSED') {
      return res.status(400).json({ error: 'Обращение закрыто, отправка сообщений недоступна.' });
    }

    await db.query(`insert into messages (ticket_id, sender_type, sender_id, text) values ($1,'EMPLOYEE',$2,$3)`, [
      req.ticket.id,
      req.employee.id,
      text,
    ]);

    const updates = ['updated_at = now()'];
    if (!req.ticket.first_response_at) {
      updates.push('first_response_at = now()');
      updates.push('first_response_seconds = extract(epoch from (now() - created_at))::int');
    }
    await db.query(`update tickets set ${updates.join(', ')} where id = $1`, [req.ticket.id]);

    await customerApi.sendMessage(req.ticket.customer_chat_id, text);

    await db.query(`insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'MESSAGE_SENT','ticket',$2)`, [
      req.employee.id,
      req.ticket.id,
    ]);

    res.json({ ok: true });
  })
);

const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 МБ — с запасом под лимит тела запроса на Vercel (~4.5 МБ)
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png'];

router.post(
  '/tickets/:id/photo',
  ah(loadTicketScoped),
  ah(async (req, res) => {
    const { image, mimeType, caption } = req.body;
    if (req.ticket.status === 'CLOSED') {
      return res.status(400).json({ error: 'Обращение закрыто, отправка сообщений недоступна.' });
    }
    if (!image || !ALLOWED_PHOTO_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: 'Поддерживаются только файлы JPG и PNG.' });
    }

    const buffer = Buffer.from(image, 'base64');
    if (buffer.length > MAX_PHOTO_BYTES) {
      return res.status(400).json({ error: 'Файл слишком большой (максимум 3 МБ).' });
    }

    const filename = mimeType === 'image/png' ? 'photo.png' : 'photo.jpg';
    const sent = await customerApi.sendPhoto(req.ticket.customer_chat_id, buffer, filename, mimeType, caption || undefined);
    if (!sent.ok || !sent.result || !sent.result.photo || !sent.result.photo.length) {
      return res.status(502).json({ error: 'Не удалось отправить фото клиенту. Попробуйте ещё раз.' });
    }
    const sizes = sent.result.photo;
    const fileId = sizes[sizes.length - 1].file_id;

    await db.query(
      `insert into messages (ticket_id, sender_type, sender_id, text, attachment_type, attachment_id)
       values ($1,'EMPLOYEE',$2,$3,'photo',$4)`,
      [req.ticket.id, req.employee.id, caption || null, fileId]
    );

    const updates = ['updated_at = now()'];
    if (!req.ticket.first_response_at) {
      updates.push('first_response_at = now()');
      updates.push('first_response_seconds = extract(epoch from (now() - created_at))::int');
    }
    await db.query(`update tickets set ${updates.join(', ')} where id = $1`, [req.ticket.id]);

    await db.query(`insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'PHOTO_SENT','ticket',$2)`, [
      req.employee.id,
      req.ticket.id,
    ]);

    res.json({ ok: true });
  })
);

// Отдаёт содержимое фото, храня доступ к нему через ту же проверку
// филиала, что и остальные данные обращения. Токен бота остаётся
// только на сервере — фронтенду отдаются лишь байты изображения.
router.get(
  '/files/:messageId',
  ah(async (req, res) => {
    const message = (
      await db.query(
        `select m.*, t.branch_id from messages m join tickets t on t.id = m.ticket_id where m.id = $1`,
        [req.params.messageId]
      )
    ).rows[0];
    if (!message || message.attachment_type !== 'photo') {
      return res.status(404).json({ error: 'Файл не найден.' });
    }
    if (req.employee.role !== 'SUPER_ADMIN' && message.branch_id !== req.employee.branch_id) {
      return res.status(403).json({ error: 'Доступ запрещён.' });
    }

    const fileInfo = await customerApi.getFile(message.attachment_id);
    if (!fileInfo.ok) {
      return res.status(502).json({ error: 'Не удалось получить файл из Telegram.' });
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${process.env.CUSTOMER_BOT_TOKEN}/${fileInfo.result.file_path}`);
    if (!fileRes.ok) {
      return res.status(502).json({ error: 'Не удалось скачать файл.' });
    }

    res.set('Content-Type', fileRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await fileRes.arrayBuffer()));
  })
);

router.post(
  '/tickets/:id/status',
  ah(loadTicketScoped),
  ah(async (req, res) => {
    const { status } = req.body;
    const allowed = ['IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'CLOSED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус.' });

    const updates = ['status = $1', 'updated_at = now()'];
    if (status === 'RESOLVED' && !req.ticket.resolved_at) {
      updates.push('resolved_at = now()');
      updates.push('resolution_seconds = extract(epoch from (now() - created_at))::int');
    }
    if (status === 'CLOSED' && !req.ticket.closed_at) {
      updates.push('closed_at = now()');
      if (!req.ticket.resolution_seconds) {
        updates.push('resolution_seconds = extract(epoch from (now() - created_at))::int');
      }
    }
    await db.query(`update tickets set ${updates.join(', ')} where id = $2`, [status, req.ticket.id]);
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id, meta) values ($1,'STATUS_CHANGED','ticket',$2,$3)`,
      [req.employee.id, req.ticket.id, JSON.stringify({ status })]
    );

    if (status === 'CLOSED') {
      customerApi
        .sendMessage(
          req.ticket.customer_chat_id,
          `Ваше обращение #${req.ticket.ticket_number} закрыто.\n\nЕсли у вас появится новый вопрос — просто напишите нам, и мы создадим новое обращение.`
        )
        .catch(() => {});
    }

    res.json({ ok: true });
  })
);

// =====================================================================
// SUPER_ADMIN
// =====================================================================
router.use('/admin', requireSuperAdmin);

router.get(
  '/admin/overview',
  ah(async (req, res) => {
    const totals = (
      await db.query(`
      select count(*)::int as total,
        count(*) filter (where status='NEW')::int as new_count,
        count(*) filter (where status='IN_PROGRESS')::int as in_progress_count,
        count(*) filter (where status in ('RESOLVED','CLOSED') and closed_at::date = current_date)::int as resolved_today,
        avg(first_response_seconds) filter (where first_response_seconds is not null) as avg_first_response,
        avg(resolution_seconds) filter (where resolution_seconds is not null) as avg_resolution
      from tickets`)
    ).rows[0];

    const byBranch = (
      await db.query(`
      select b.code, b.name, count(t.id)::int as ticket_count
      from branches b left join tickets t on t.branch_id = b.id
      group by b.id order by b.name`)
    ).rows;

    const byEmployee = (
      await db.query(`
      select e.id, e.name, b.code as branch_code,
        count(t.id)::int as ticket_count,
        avg(t.resolution_seconds) filter (where t.resolution_seconds is not null) as avg_resolution
      from employees e
      join branches b on b.id = e.branch_id
      left join tickets t on t.assigned_employee_id = e.id
      where e.role = 'EMPLOYEE'
      group by e.id, b.code order by ticket_count desc`)
    ).rows;

    res.json({ totals, byBranch, byEmployee });
  })
);

router.get(
  '/admin/branches',
  ah(async (req, res) => {
    res.json((await db.query('select * from branches order by name')).rows);
  })
);

router.post(
  '/admin/branches',
  ah(async (req, res) => {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Укажите код и название филиала.' });
    const inserted = await db.query(`insert into branches (code, name) values ($1,$2) returning *`, [code, name]);
    await db.query(`insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'BRANCH_CREATED','branch',$2)`, [
      req.employee.id,
      inserted.rows[0].id,
    ]);
    res.json(inserted.rows[0]);
  })
);

router.get(
  '/admin/branches/:id/passwords',
  ah(async (req, res) => {
    res.json(
      (
        await db.query(
          `select id, branch_id, label, is_active, created_at from branch_passwords where branch_id = $1 order by created_at desc`,
          [req.params.id]
        )
      ).rows
    );
  })
);

router.post(
  '/admin/branches/:id/passwords',
  ah(async (req, res) => {
    const { password, label } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: 'Пароль слишком короткий (минимум 4 символа).' });
    const hash = await bcrypt.hash(password, 10);
    const inserted = await db.query(
      `insert into branch_passwords (branch_id, password_hash, label, created_by_employee_id)
       values ($1,$2,$3,$4) returning id, branch_id, label, is_active, created_at`,
      [req.params.id, hash, label || null, req.employee.id]
    );
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'BRANCH_PASSWORD_CREATED','branch',$2)`,
      [req.employee.id, req.params.id]
    );
    res.json(inserted.rows[0]);
  })
);

router.post(
  '/admin/passwords/:id/disable',
  ah(async (req, res) => {
    await db.query('update branch_passwords set is_active = false where id = $1', [req.params.id]);
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'BRANCH_PASSWORD_DISABLED','branch_password',$2)`,
      [req.employee.id, req.params.id]
    );
    res.json({ ok: true });
  })
);

router.get(
  '/admin/employees',
  ah(async (req, res) => {
    res.json(
      (
        await db.query(`
        select e.*, b.code as branch_code, b.name as branch_name,
          (select count(*) from tickets t where t.assigned_employee_id = e.id)::int as ticket_count
        from employees e join branches b on b.id = e.branch_id
        order by e.name`)
      ).rows
    );
  })
);

router.get(
  '/admin/employees/:id',
  ah(async (req, res) => {
    const employee = (
      await db.query(
        `select e.*, b.code as branch_code, b.name as branch_name from employees e join branches b on b.id=e.branch_id where e.id = $1`,
        [req.params.id]
      )
    ).rows[0];
    if (!employee) return res.status(404).json({ error: 'Сотрудник не найден.' });

    const stats = (
      await db.query(
        `select count(*)::int as total,
          count(*) filter (where status in ('NEW','IN_PROGRESS','WAITING_FOR_CLIENT'))::int as open_count,
          count(*) filter (where status in ('RESOLVED','CLOSED'))::int as closed_count,
          avg(first_response_seconds) as avg_first_response,
          avg(resolution_seconds) as avg_resolution
        from tickets where assigned_employee_id = $1`,
        [req.params.id]
      )
    ).rows[0];

    res.json({ employee, stats });
  })
);

router.post(
  '/admin/employees/:id/block',
  ah(async (req, res) => {
    await db.query(`update employees set status = 'BLOCKED' where id = $1`, [req.params.id]);
    await db.query(`insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'EMPLOYEE_BLOCKED','employee',$2)`, [
      req.employee.id,
      req.params.id,
    ]);
    res.json({ ok: true });
  })
);

router.post(
  '/admin/employees/:id/unblock',
  ah(async (req, res) => {
    await db.query(`update employees set status = 'ACTIVE' where id = $1`, [req.params.id]);
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id) values ($1,'EMPLOYEE_UNBLOCKED','employee',$2)`,
      [req.employee.id, req.params.id]
    );
    res.json({ ok: true });
  })
);

router.post(
  '/admin/employees/:id/role',
  ah(async (req, res) => {
    const { role } = req.body;
    if (!['EMPLOYEE', 'SUPER_ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль.' });
    }
    if (Number(req.params.id) === req.employee.id) {
      return res.status(400).json({ error: 'Нельзя изменить собственную роль.' });
    }
    await db.query('update employees set role = $1 where id = $2', [role, req.params.id]);
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id, meta) values ($1,'EMPLOYEE_ROLE_CHANGED','employee',$2,$3)`,
      [req.employee.id, req.params.id, JSON.stringify({ role })]
    );
    res.json({ ok: true });
  })
);

router.post(
  '/admin/employees/:id/branch',
  ah(async (req, res) => {
    const { branch_id } = req.body;
    if (!branch_id) return res.status(400).json({ error: 'Укажите branch_id.' });
    await db.query(`update employees set branch_id = $1 where id = $2`, [branch_id, req.params.id]);
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id, meta) values ($1,'EMPLOYEE_BRANCH_CHANGED','employee',$2,$3)`,
      [req.employee.id, req.params.id, JSON.stringify({ branch_id })]
    );
    res.json({ ok: true });
  })
);

router.post(
  '/admin/tickets/:id/assign',
  ah(async (req, res) => {
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'Укажите employee_id.' });
    await db.query(
      `update tickets set assigned_employee_id = $1,
         status = case when status = 'NEW' then 'IN_PROGRESS' else status end,
         updated_at = now()
       where id = $2`,
      [employee_id, req.params.id]
    );
    await db.query(
      `insert into audit_logs (actor_employee_id, action, entity_type, entity_id, meta) values ($1,'TICKET_ASSIGNED','ticket',$2,$3)`,
      [req.employee.id, req.params.id, JSON.stringify({ employee_id })]
    );
    res.json({ ok: true });
  })
);

// Удаляет сообщения старше 30 дней (сами обращения и статистика по ним остаются).
router.post(
  '/admin/messages/cleanup',
  ah(async (req, res) => {
    const result = await db.query(`delete from messages where created_at < now() - interval '30 days'`);
    await db.query(
      `insert into audit_logs (actor_employee_id, action, meta) values ($1,'MESSAGES_CLEANUP',$2)`,
      [req.employee.id, JSON.stringify({ deleted: result.rowCount })]
    );
    res.json({ ok: true, deleted: result.rowCount });
  })
);

router.get(
  '/admin/sla',
  ah(async (req, res) => {
    const firstResponseSla = Number(process.env.FIRST_RESPONSE_SLA_MINUTES) || 15;
    const resolutionSla = Number(process.env.RESOLUTION_SLA_MINUTES) || 240;

    const byBranch = (
      await db.query(
        `select b.code, b.name, count(t.id)::int as total,
           avg(t.first_response_seconds) as avg_first_response,
           avg(t.resolution_seconds) as avg_resolution,
           count(*) filter (
             where (t.first_response_seconds is not null and t.first_response_seconds > $1 * 60)
                or (t.resolution_seconds is not null and t.resolution_seconds > $2 * 60)
           )::int as overdue
         from branches b left join tickets t on t.branch_id = b.id
         group by b.id order by b.name`,
        [firstResponseSla, resolutionSla]
      )
    ).rows;

    const byCategory = (
      await db.query(`
      select coalesce(category, 'Без категории') as category, count(*)::int as total,
        avg(resolution_seconds) as avg_resolution
      from tickets group by category order by total desc`)
    ).rows;

    res.json({ firstResponseSla, resolutionSla, byBranch, byCategory });
  })
);

module.exports = router;
