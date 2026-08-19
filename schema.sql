-- =====================================================================
-- Trustbank Support System — схема базы данных
--
-- КАК ИСПОЛЬЗОВАТЬ:
-- 1. Откройте ваш проект на supabase.com
-- 2. Слева в меню откройте "SQL Editor"
-- 3. Нажмите "New query"
-- 4. Скопируйте ВЕСЬ этот файл и вставьте в редактор
-- 5. Нажмите "Run"
-- Скрипт безопасно перезапускать повторно — он не удалит и не
-- продублирует уже существующие данные.
-- =====================================================================

create extension if not exists pgcrypto;

-- Филиалы
create table if not exists branches (
  id serial primary key,
  code varchar(20) unique not null,
  name text not null,
  status varchar(20) not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

-- Пароли филиалов (только хэши, никогда в чистом виде)
create table if not exists branch_passwords (
  id serial primary key,
  branch_id integer not null references branches(id) on delete cascade,
  password_hash text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_employee_id integer
);

-- Сотрудники
create table if not exists employees (
  id serial primary key,
  telegram_user_id bigint unique not null,
  telegram_chat_id bigint not null,
  name text not null,
  branch_id integer not null references branches(id),
  role varchar(20) not null default 'EMPLOYEE',
  status varchar(20) not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

-- Незавершённая регистрация сотрудника (пароль введён / имя ещё не введено)
create table if not exists pending_employee_registrations (
  telegram_user_id bigint primary key,
  telegram_chat_id bigint not null,
  step varchar(20) not null default 'AWAITING_PASSWORD',
  branch_id integer references branches(id),
  created_at timestamptz not null default now()
);

-- Клиенты
create table if not exists customers (
  id serial primary key,
  telegram_user_id bigint unique not null,
  telegram_chat_id bigint not null,
  branch_id integer references branches(id),
  company_name text,
  state varchar(20) not null default 'AWAITING_BRANCH',
  pending_category text,
  created_at timestamptz not null default now()
);

-- Номера обращений начинаются с 10001
create sequence if not exists ticket_number_seq start 10001;

-- Обращения
create table if not exists tickets (
  id serial primary key,
  ticket_number integer unique not null default nextval('ticket_number_seq'),
  customer_id integer not null references customers(id),
  branch_id integer not null references branches(id),
  assigned_employee_id integer references employees(id),
  category text,
  subject text not null,
  status varchar(20) not null default 'NEW',
  priority varchar(20) not null default 'NORMAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  first_response_seconds integer,
  resolution_seconds integer
);

-- Сообщения
create table if not exists messages (
  id serial primary key,
  ticket_id integer not null references tickets(id) on delete cascade,
  sender_type varchar(20) not null,
  sender_id integer,
  text text,
  telegram_message_id bigint,
  attachment_type text,
  attachment_id text,
  created_at timestamptz not null default now()
);

-- События SLA (для уведомлений о приближающемся нарушении)
create table if not exists sla_events (
  id serial primary key,
  ticket_id integer not null references tickets(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now()
);

-- Журнал действий
create table if not exists audit_logs (
  id serial primary key,
  actor_employee_id integer,
  action text not null,
  entity_type text,
  entity_id integer,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tickets_branch_status on tickets(branch_id, status);
create index if not exists idx_tickets_assigned on tickets(assigned_employee_id);
create index if not exists idx_messages_ticket on messages(ticket_id);
create index if not exists idx_employees_telegram on employees(telegram_user_id);
create index if not exists idx_customers_telegram on customers(telegram_user_id);
create index if not exists idx_branch_passwords_branch on branch_passwords(branch_id);

-- =====================================================================
-- Филиалы Trustbank (можно позже добавлять новые через Web App
-- Супер-администратора)
-- =====================================================================
insert into branches (code, name) values
  ('00491', 'OPERU (Головной офис)'),
  ('11966', 'Toshkent'),
  ('11967', 'Darxon'),
  ('11987', 'Yakkasaroy'),
  ('11971', 'Bektemir'),
  ('11970', 'Rakamli'),
  ('11969', 'Namangan'),
  ('11973', 'Termiz'),
  ('11975', 'Andijon'),
  ('11977', 'Samarkand'),
  ('11976', 'Karshi'),
  ('11974', 'Farg''ona'),
  ('11972', 'Jizzax'),
  ('11968', 'Buxoro')
on conflict (code) do nothing;

-- =====================================================================
-- ВАЖНО: после выполнения этого файла в базе ещё нет ни одного пароля
-- филиала — без него ни один сотрудник (включая вас, будущего
-- Супер-администратора) не сможет зарегистрироваться в Employee-боте.
--
-- Пароль первого филиала нужно создать отдельной командой с вашего
-- компьютера — см. README.md, раздел "Шаг 9: создание первого пароля
-- филиала". Придумывать и вставлять пароль вручную через SQL не нужно,
-- команда сама надёжно его хэширует.
-- =====================================================================
