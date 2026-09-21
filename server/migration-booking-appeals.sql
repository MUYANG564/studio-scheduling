begin;

alter table public.appeals
  add column if not exists vendor_account_id uuid;

alter table public.appeals
  alter column studio_id drop not null;

alter table public.appeals
  drop constraint if exists appeals_exactly_one_source_check;

alter table public.appeals
  add constraint appeals_exactly_one_source_check
  check ((studio_id is null) <> (vendor_account_id is null));

create index if not exists idx_appeals_studio
  on public.appeals (studio_id);

create index if not exists idx_appeals_vendor
  on public.appeals (vendor_account_id);

create unique index if not exists idx_appeals_pending_booking
  on public.appeals (booking_id) where status = 'pending';

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

commit;
