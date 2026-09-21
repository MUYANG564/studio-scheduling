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
  business_hours jsonb not null default '{"0":{"enabled":true,"start":"08:00","end":"22:00"},"1":{"enabled":true,"start":"08:00","end":"22:00"},"2":{"enabled":true,"start":"08:00","end":"22:00"},"3":{"enabled":true,"start":"08:00","end":"22:00"},"4":{"enabled":true,"start":"08:00","end":"22:00"},"5":{"enabled":true,"start":"08:00","end":"22:00"},"6":{"enabled":true,"start":"08:00","end":"22:00"}}'::jsonb,
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
  status text not null check (status in ('free', 'blocked', 'locked')),
  booking_id uuid,
  created_at timestamptz not null,
  unique (studio_id, date, start)
);

create table if not exists public.city_proximities (
  id uuid primary key,
  city text not null,
  nearby_city text not null,
  priority integer not null check (priority between 1 and 999),
  created_at timestamptz not null,
  unique (city, nearby_city),
  check (city <> nearby_city)
);

create table if not exists public.schedule_requests (
  id uuid primary key,
  speaker_id uuid not null,
  vendor_account_id uuid not null,
  desired jsonb not null default '[]'::jsonb,
  preferred_cities jsonb not null default '[]'::jsonb,
  match_mode text not null default 'schedule_first' check (match_mode in ('schedule_first', 'location_first')),
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
  studio_id uuid,
  vendor_account_id uuid,
  reason text not null,
  status text not null,
  created_at timestamptz not null,
  resolved_at timestamptz,
  constraint appeals_exactly_one_source_check
    check ((studio_id is null) <> (vendor_account_id is null))
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
create index if not exists idx_city_proximities_city_priority on public.city_proximities (city, priority);
create index if not exists idx_requests_vendor on public.schedule_requests (vendor_account_id);
create index if not exists idx_bookings_studio on public.bookings (studio_id);
create index if not exists idx_appeals_booking on public.appeals (booking_id);
create index if not exists idx_appeals_studio on public.appeals (studio_id);
create index if not exists idx_appeals_vendor on public.appeals (vendor_account_id);
create unique index if not exists idx_appeals_pending_booking
  on public.appeals (booking_id) where status = 'pending';
create index if not exists idx_notifications_account on public.notifications (account_id);

create or replace function public.resolve_booking_appeal(p_appeal_id uuid, p_decision text)
returns text
language plpgsql
set search_path = public
as $$
declare
  selected_appeal public.appeals%rowtype;
  selected_booking public.bookings%rowtype;
  selected_request public.schedule_requests%rowtype;
  studio_account_id uuid;
  merged_desired jsonb;
begin
  select * into selected_appeal
  from public.appeals
  where id = p_appeal_id and status = 'pending'
  for update;

  if not found then return 'not_found'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;

  if p_decision = 'rejected' then
    update public.appeals set status = 'rejected', resolved_at = now() where id = selected_appeal.id;
    if selected_appeal.studio_id is not null then
      select account_id into studio_account_id from public.studios where id = selected_appeal.studio_id;
      if studio_account_id is not null then
        insert into public.notifications (id, account_id, kind, message, read, created_at)
        values (gen_random_uuid(), studio_account_id, 'appeal_rejected',
          '申诉已被驳回(预约 ' || left(selected_appeal.booking_id::text, 8) || '),原预约档期仍然有效。', false, now());
      end if;
    else
      insert into public.notifications (id, account_id, kind, message, read, created_at)
      values (gen_random_uuid(), selected_appeal.vendor_account_id, 'appeal_rejected',
        '取消申诉已被驳回(预约 ' || left(selected_appeal.booking_id::text, 8) || '),原预约档期仍然有效。', false, now());
    end if;
    return 'ok';
  end if;

  select * into selected_booking
  from public.bookings
  where id = selected_appeal.booking_id
  for update;
  if not found then raise exception 'booking not found'; end if;

  delete from public.slots where booking_id = selected_booking.id;
  update public.bookings set status = 'released' where id = selected_booking.id;

  select account_id into studio_account_id from public.studios where id = selected_booking.studio_id;
  if selected_appeal.studio_id is not null then
    select * into selected_request from public.schedule_requests where id = selected_booking.request_id for update;
    if found then
      select coalesce(jsonb_agg(slot), '[]'::jsonb) into merged_desired
      from (
        select distinct value as slot
        from jsonb_array_elements_text(coalesce(selected_request.desired, '[]'::jsonb))
        union
        select distinct value as slot
        from jsonb_array_elements_text(coalesce(selected_booking.slots, '[]'::jsonb))
      ) combined_slots;
      update public.schedule_requests set desired = merged_desired, status = 'reopened' where id = selected_request.id;
    end if;
    insert into public.notifications (id, account_id, kind, message, read, created_at)
    values (gen_random_uuid(), selected_booking.vendor_account_id, 'booking_released',
      '原定录音棚因申诉已释放你的档期,请重新选择录音棚(档期已为你保留,无需重新填写)。', false, now());
    if studio_account_id is not null then
      insert into public.notifications (id, account_id, kind, message, read, created_at)
      values (gen_random_uuid(), studio_account_id, 'appeal_approved', '申诉已通过,相关档期已释放。', false, now());
    end if;
  else
    insert into public.notifications (id, account_id, kind, message, read, created_at)
    values (gen_random_uuid(), selected_booking.vendor_account_id, 'booking_cancelled',
      '取消申诉已通过,预约 ' || left(selected_booking.id::text, 8) || ' 已取消。', false, now());
    if studio_account_id is not null then
      insert into public.notifications (id, account_id, kind, message, read, created_at)
      values (gen_random_uuid(), studio_account_id, 'booking_cancelled',
        '供应商取消申诉已通过,预约 ' || left(selected_booking.id::text, 8) || ' 已取消,相关档期已释放。', false, now());
    end if;
  end if;

  update public.appeals set status = 'approved', resolved_at = now() where id = selected_appeal.id;
  return 'ok';
end;
$$;

revoke execute on function public.resolve_booking_appeal(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_booking_appeal(uuid, text) to service_role;

-- 开启 RLS（不加策略 = 禁止匿名/公开直连访问；service_role 绕过 RLS）
alter table public.accounts enable row level security;
alter table public.studios enable row level security;
alter table public.speakers enable row level security;
alter table public.slots enable row level security;
alter table public.city_proximities enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.appeals enable row level security;
alter table public.notifications enable row level security;
