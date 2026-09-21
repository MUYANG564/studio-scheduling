create or replace function public.admin_adjust_booking(p_booking_id uuid, p_slots jsonb, p_status text)
returns text
language plpgsql
set search_path = public
as $$
declare
  selected_booking public.bookings%rowtype;
  studio_account_id uuid;
  slot_value text;
  affected_rows integer;
begin
  if p_status not in ('confirmed', 'released')
    or jsonb_typeof(p_slots) <> 'array'
    or jsonb_array_length(p_slots) = 0
    or jsonb_array_length(p_slots) > 500 then
    raise exception 'invalid booking adjustment';
  end if;

  if exists (
    select 1 from jsonb_array_elements_text(p_slots) value
    where value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} ([01][0-9]|2[0-3]):(00|30)$'
  ) then
    raise exception 'invalid booking slot';
  end if;

  select * into selected_booking from public.bookings where id = p_booking_id for update;
  if not found then return 'not_found'; end if;

  if p_status = 'confirmed' and exists (
    select 1
    from jsonb_array_elements_text(p_slots) value
    join public.slots slot
      on slot.studio_id = selected_booking.studio_id
      and slot.date = split_part(value, ' ', 1)
      and slot.start = split_part(value, ' ', 2)
    where slot.status = 'locked' and slot.booking_id is distinct from selected_booking.id
  ) then
    return 'slot_conflict';
  end if;

  delete from public.slots where booking_id = selected_booking.id;

  if p_status = 'confirmed' then
    for slot_value in select value from jsonb_array_elements_text(p_slots)
    loop
      insert into public.slots (id, studio_id, date, start, status, booking_id, created_at)
      values (
        gen_random_uuid(), selected_booking.studio_id, split_part(slot_value, ' ', 1),
        split_part(slot_value, ' ', 2), 'locked', selected_booking.id, now()
      )
      on conflict (studio_id, date, start) do update
      set status = 'locked', booking_id = selected_booking.id
      where public.slots.status <> 'locked' or public.slots.booking_id = selected_booking.id;
      get diagnostics affected_rows = row_count;
      if affected_rows = 0 then raise exception 'slot_conflict'; end if;
    end loop;
  end if;

  update public.bookings set slots = p_slots, status = p_status where id = selected_booking.id;
  if p_status = 'released' then
    update public.appeals set status = 'rejected', resolved_at = now()
    where booking_id = selected_booking.id and status = 'pending';
  end if;

  select account_id into studio_account_id from public.studios where id = selected_booking.studio_id;
  insert into public.notifications (id, account_id, kind, message, read, created_at)
  values (
    gen_random_uuid(), selected_booking.vendor_account_id, 'admin_record_updated',
    '后台已调整预约 ' || left(selected_booking.id::text, 8) || ' 的档期或状态，请进入系统查看最新内容。', false, now()
  );
  if studio_account_id is not null then
    insert into public.notifications (id, account_id, kind, message, read, created_at)
    values (
      gen_random_uuid(), studio_account_id, 'admin_record_updated',
      '后台已调整预约 ' || left(selected_booking.id::text, 8) || ' 的档期或状态，请进入系统查看最新内容。', false, now()
    );
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.admin_adjust_booking(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_booking(uuid, jsonb, text) to service_role;
