-- MyPresence attendance/event upgrade — ROLLBACK for 2026-10-24
-- Run in the Supabase SQL Editor as the project owner (postgres).
--
-- This removes the new guards/constraints and restores the data snapshot that
-- the patch saved in the private attendance_backup schema. The backup schema is
-- intentionally left in place so you can inspect or re-apply it later.
--
-- New attendance/events created AFTER the upgrade are NOT deleted by this
-- script. If you also want to remove test rows created after the upgrade, use
-- the optional section at the bottom.

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove write guards first so legacy data can be restored freely.
-- ---------------------------------------------------------------------------
drop trigger if exists attendance_guard_before_write on public.attendance;
drop function if exists public.attendance_guard();

drop trigger if exists events_guard_before_write on public.events;
drop function if exists public.events_guard();

drop trigger if exists events_prevent_linked_delete on public.events;
drop function if exists public.events_prevent_linked_delete();

-- ---------------------------------------------------------------------------
-- 2. Remove indexes and constraints added by the patch.
-- ---------------------------------------------------------------------------
drop index if exists public.attendance_unique_sunday_per_date;
drop index if exists public.attendance_context_idx;
drop index if exists public.events_event_type_idx;

alter table public.attendance drop constraint if exists attendance_context_allowed;
alter table public.attendance drop constraint if exists attendance_group_allowed;
alter table public.attendance drop constraint if exists attendance_service_type_allowed;
alter table public.attendance drop constraint if exists attendance_session_consistency;
alter table public.events drop constraint if exists events_event_type_allowed;

-- ---------------------------------------------------------------------------
-- 3. Restore the pre-upgrade snapshot.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('attendance_backup.attendance_20261024') is not null then
    update public.attendance a
    set attendance_context = b.attendance_context,
        attendance_group = b.attendance_group,
        service_type = b.service_type,
        event_id = b.event_id
    from attendance_backup.attendance_20261024 b
    where a.id = b.id;
  end if;

  if to_regclass('attendance_backup.events_20261024') is not null then
    update public.events e
    set title = b.title,
        details = b.details,
        event_date = b.event_date,
        location = b.location,
        poster_url = b.poster_url,
        event_type = b.event_type
    from attendance_backup.events_20261024 b
    where e.id = b.id;
  end if;

  if to_regclass('attendance_backup.users_20261024') is not null then
    update public.users u
    set is_active = b.is_active
    from attendance_backup.users_20261024 b
    where u.id = b.id;
  end if;
end $$;

-- Keep the column/default in place: is_active already existed before the patch.
-- Registration from older builds omits it and receives the default (true).

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
select 'attendance types after rollback' as check_name, attendance_context, count(*) as rows
from public.attendance
group by attendance_context
order by attendance_context;

select 'triggers remaining' as check_name, tgname
from pg_trigger
where not tgisinternal
  and tgrelid in ('public.attendance'::regclass, 'public.events'::regclass)
order by tgname;

commit;

-- ---------------------------------------------------------------------------
-- OPTIONAL: remove rows created after the upgrade (test data only)
-- Uncomment and run separately ONLY if you are sure no real attendance was
-- recorded after the upgrade. This deletes every attendance row that did not
-- exist when the patch was applied.
-- ---------------------------------------------------------------------------
-- delete from public.attendance a
-- where not exists (
--   select 1 from attendance_backup.attendance_20261024 b where b.id = a.id
-- );
