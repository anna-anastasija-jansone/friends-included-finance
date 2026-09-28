create table if not exists employees (
  id text primary key,
  name text not null,
  role text not null check (role in ('manager', 'sales', 'expense_reporter')),
  telegram_user_id text unique,
  telegram_chat_id text,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  reference text primary key check (reference ~ '^S[0-9]+$'),
  submitted_at timestamptz not null default now(),
  submitted_by text not null references employees(id),
  notification_chat_id text,
  customer text not null,
  project text not null check (project in ('A', 'B')),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  proposed_richard numeric(5,2) not null,
  proposed_anastasia numeric(5,2) not null,
  proposed_jean_claude numeric(5,2) not null,
  approved_richard numeric(5,2),
  approved_anastasia numeric(5,2),
  approved_jean_claude numeric(5,2),
  commission_richard numeric(12,2) not null default 0,
  commission_anastasia numeric(12,2) not null default 0,
  commission_jean_claude numeric(12,2) not null default 0,
  status text not null default 'Pending approval' check (status in ('Pending approval', 'Approved')),
  sync_status text not null default 'Sync pending',
  decision_notification_status text,
  decision_notification_error text,
  updated_at timestamptz not null default now()
);

create table if not exists expenses (
  reference text primary key check (reference ~ '^E[0-9]+$'),
  submitted_at timestamptz not null default now(),
  submitted_by text not null references employees(id),
  notification_chat_id text,
  description text not null,
  category text not null check (category in ('Materials', 'Travel', 'Other')),
  amount numeric(12,2) not null check (amount > 0),
  proposed_allocation text not null check (proposed_allocation in ('A', 'B', 'Company overhead')),
  final_allocation text check (final_allocation in ('A', 'B', 'Company overhead')),
  status text not null check (status in ('Awaiting allocation', 'Allocated')),
  sync_status text not null default 'Sync pending',
  decision_notification_status text,
  decision_notification_error text,
  updated_at timestamptz not null default now()
);

-- Client access is deliberately denied. Vercel uses the service-role key server-side.
alter table employees enable row level security;
alter table sales enable row level security;
alter table expenses enable row level security;
