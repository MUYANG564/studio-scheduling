-- 录音棚排期系统 —— Supabase 建表脚本
-- 在 Supabase 项目的 SQL Editor 里整段粘贴运行即可（public schema）。
-- 说明：所有权限校验都在应用服务端完成，服务端用 service_role 密钥访问数据库。
-- 这里对每张表开启 RLS 且不添加任何策略，等于禁止匿名/公开直接读取数据（service_role 会绕过 RLS）。

create table if not exists public.accounts (
  id uuid primary key,
  username text unique not null,
  password_hash text not null,
  role text not null,
  display_name text not null default '',
  email text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null
);

create table if not exists public.studios (
  id uuid primary key,
  account_id uuid not null,
  name text not null,
  city text not null default '',
  address text not null default '',
  email text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null
);

create table if not exists public.speakers (
  id uuid primary key,
  vendor_account_id uuid not null,
  project_name text not null,
  stage_name text not null,
  email text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null
);

create table if not exists public.slots (
  id uuid primary key,
  studio_id uuid not null,
  date text not null,
  start text not null,
  status text not null,
  booking_id uuid,
  created_at timestamptz not null
);

create table if not exists public.schedule_requests (
  id uuid primary key,
  speaker_id uuid not null,
  vendor_account_id uuid not null,
  desired jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null
);

create table if not exists public.bookings (
  id uuid primary key,
  request_id uuid not null,
  speaker_id uuid not null,
  studio_id uuid not null,
  vendor_account_id uuid not null,
  slots jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null
);

create table if not exists public.appeals (
  id uuid primary key,
  booking_id uuid not null,
  studio_id uuid not null,
  reason text not null,
  status text not null,
  created_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists public.notifications (
  id uuid primary key,
  account_id uuid not null,
  kind text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null
);

-- 常用查询索引
create index if not exists idx_studios_account on public.studios (account_id);
create index if not exists idx_speakers_vendor on public.speakers (vendor_account_id);
create index if not exists idx_slots_studio on public.slots (studio_id);
create index if not exists idx_slots_date_status on public.slots (date, status);
create index if not exists idx_slots_booking on public.slots (booking_id);
create index if not exists idx_requests_vendor on public.schedule_requests (vendor_account_id);
create index if not exists idx_bookings_studio on public.bookings (studio_id);
create index if not exists idx_appeals_booking on public.appeals (booking_id);
create index if not exists idx_notifications_account on public.notifications (account_id);

-- 开启 RLS（不加策略 = 禁止匿名/公开直连访问；service_role 绕过 RLS）
alter table public.accounts enable row level security;
alter table public.studios enable row level security;
alter table public.speakers enable row level security;
alter table public.slots enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.appeals enable row level security;
alter table public.notifications enable row level security;
