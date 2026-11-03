-- Allow attendance scans for inactive members.
--
-- Account status and attendance eligibility are separate:
--   * inactive members remain inactive in public.users;
--   * inactive members may still be recognized and recorded in attendance;
--   * duplicate attendance, Sunday Service, and linked-event rules are unchanged.
--
-- Run this after patch_2026_10_24_attendance_event_guard.sql.
-- Safe to re-run. It replaces the attendance guard function only.

begin;

create or replace function public.attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_event_found boolean;
  v_conflict integer;
begin
  -- Keep older clients working: a generic "Events" row is stored as its real type.
  if new.attendance_context = 'Events' then
    if new.attendance_group in ('Rooftop', 'Women''s Network', 'Men''s Network') then
      new.attendance_context := new.attendance_group;
    else
      raise exception 'ATTENDANCE_TYPE_INVALID' using errcode = '23514';
    end if;
  end if;

  if new.attendance_context is null
     or new.attendance_context not in (
       'Sunday Service', 'Prayer Meeting', 'Rooftop', 'Women''s Network', 'Men''s Network'
     ) then
    raise exception 'ATTENDANCE_TYPE_INVALID' using errcode = '23514';
  end if;

  if new.attendance_context = 'Sunday Service' then
    if new.attendance_group not in ('First Service', 'Second Service') then
      raise exception 'ATTENDANCE_GROUP_INVALID' using errcode = '23514';
    end if;
    new.service_type := new.attendance_group;
  else
    new.attendance_group := new.attendance_context;
    new.service_type := null;
  end if;

  -- Members must still exist, but their is_active flag does not block a scan.
  -- The member's account status is never changed by attendance writes.
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.users
      where student_id = new.student_id
    ) then
      raise exception 'MEMBER_NOT_FOUND' using errcode = '23503';
    end if;
  end if;

  -- A linked event must exist and match the attendance type (General matches all).
  if new.event_id is not null then
    select event_type, true into v_event_type, v_event_found
    from public.events
    where id = new.event_id;

    if not coalesce(v_event_found, false) then
      raise exception 'EVENT_NOT_FOUND' using errcode = '23503';
    end if;

    if v_event_type is null then
      raise exception 'EVENT_TYPE_REQUIRED' using errcode = '23514';
    end if;

    if not (
      v_event_type = 'General'
      or (new.attendance_context = 'Sunday Service' and v_event_type = 'Sunday Service')
      or (new.attendance_context = 'Rooftop' and v_event_type = 'Rooftop')
      or (new.attendance_context = 'Women''s Network' and v_event_type = 'Women''s Network')
      or (new.attendance_context = 'Men''s Network' and v_event_type = 'Men''s Network')
    ) then
      raise exception 'EVENT_TYPE_MISMATCH' using errcode = '23514';
    end if;
  end if;

  -- Friendly pre-check; the partial unique index is the race-safe guarantee.
  if new.attendance_context = 'Sunday Service' then
    select count(*) into v_conflict
    from public.attendance
    where student_id = new.student_id
      and attended_date = new.attended_date
      and attendance_context = 'Sunday Service'
      and (tg_op = 'INSERT' or id <> new.id);

    if v_conflict > 0 then
      raise exception 'DUPLICATE_SUNDAY_SERVICE' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_guard_before_write on public.attendance;
create trigger attendance_guard_before_write
before insert or update of student_id, attended_date, attendance_context, attendance_group, service_type, event_id
on public.attendance
for each row execute function public.attendance_guard();

-- Verification: the function body should no longer contain MEMBER_INACTIVE.
select 'attendance guard allows inactive members' as check_name,
       position('MEMBER_INACTIVE' in pg_get_functiondef('public.attendance_guard()'::regprocedure)) = 0 as ok;

commit;
