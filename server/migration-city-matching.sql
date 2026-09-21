begin;

alter table public.studios
  add column if not exists business_hours jsonb not null
  default '{"0":{"enabled":true,"start":"08:00","end":"22:00"},"1":{"enabled":true,"start":"08:00","end":"22:00"},"2":{"enabled":true,"start":"08:00","end":"22:00"},"3":{"enabled":true,"start":"08:00","end":"22:00"},"4":{"enabled":true,"start":"08:00","end":"22:00"},"5":{"enabled":true,"start":"08:00","end":"22:00"},"6":{"enabled":true,"start":"08:00","end":"22:00"}}'::jsonb;

alter table public.schedule_requests
  add column if not exists preferred_cities jsonb not null default '[]'::jsonb,
  add column if not exists match_mode text not null default 'schedule_first';

update public.schedule_requests
set preferred_cities = '[]'::jsonb
where preferred_cities is null;

update public.schedule_requests
set match_mode = 'schedule_first'
where match_mode is null or match_mode not in ('schedule_first', 'location_first');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schedule_requests_match_mode_check'
  ) then
    alter table public.schedule_requests
      add constraint schedule_requests_match_mode_check
      check (match_mode in ('schedule_first', 'location_first'));
  end if;
end $$;

create table if not exists public.city_proximities (
  id uuid primary key,
  city text not null,
  nearby_city text not null,
  priority integer not null check (priority between 1 and 999),
  created_at timestamptz not null,
  unique (city, nearby_city),
  check (city <> nearby_city)
);

create index if not exists idx_city_proximities_city_priority
  on public.city_proximities (city, priority);

alter table public.city_proximities enable row level security;

delete from public.slots where status = 'free';

with ranked_slots as (
  select id, row_number() over (
    partition by studio_id, date, start
    order by case status when 'locked' then 0 else 1 end, created_at desc
  ) as row_number
  from public.slots
)
delete from public.slots
where id in (select id from ranked_slots where row_number > 1);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'slots_studio_date_start_key'
  ) then
    alter table public.slots
      add constraint slots_studio_date_start_key unique (studio_id, date, start);
  end if;
end $$;

alter table public.slots
  drop constraint if exists slots_status_check;

alter table public.slots
  add constraint slots_status_check check (status in ('free', 'blocked', 'locked'));

commit;
