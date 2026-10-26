-- Sunday Service attendance restriction.
--
-- A member may attend only one Sunday Service (First Service or Second Service)
-- per calendar day. The trigger is the authoritative check; the unique index is
-- added when existing data has no conflicts and provides a second layer of
-- protection for new rows.
--
-- Existing attendance history is never deleted or changed. If old conflicting
-- rows already exist, the unique index is skipped and the trigger still blocks
-- new conflicting scans.

begin;

-- Prevent scans from racing with the conflict check and index creation below.
lock table public.attendance in share row exclusive mode;

-- Speeds up the trigger lookup.
create index if not exists attendance_sunday_service_lookup_idx
  on public.attendance (student_id, attended_date)
  where attendance_context = 'Sunday Service'
    and attendance_group in ('First Service', 'Second Service');

-- A partial unique index gives the database a strong invariant when the current
-- data is clean. Skip it when historical conflicts exist so this migration does
-- not destroy or rewrite valid records.
do $$
begin
  if exists (
    select 1
    from public.attendance
    where attendance_context = 'Sunday Service'
      and attendance_group in ('First Service', 'Second Service')
    group by student_id, attended_date
    having count(*) > 1
  ) then
    raise notice 'Existing Sunday Service conflicts found; unique index skipped. The trigger will block new conflicts.';
  else
    create unique index if not exists attendance_sunday_service_once_per_day_idx
      on public.attendance (student_id, attended_date)
      where attendance_context = 'Sunday Service'
        and attendance_group in ('First Service', 'Second Service');
  end if;
end $$;

create or replace function public.enforce_sunday_service_once_per_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.attendance_context = 'Sunday Service'
     and new.attendance_group in ('First Service', 'Second Service') then
    -- Serialize concurrent scans for the same member and date. The lock is
    -- released automatically when the insert/update transaction ends.
    perform pg_advisory_xact_lock(
      hashtextextended(
        'sunday-service:' || new.student_id || ':' || new.attended_date::text,
        0
      )
    );

    -- Same-service duplicates are left to attendance_unique_per_session so the
    -- existing duplicate flow/message stays in place. Only the cross-service
    -- conflict is handled here.
    if exists (
      select 1
      from public.attendance existing
      where existing.student_id = new.student_id
        and existing.attended_date = new.attended_date
        and existing.attendance_context = 'Sunday Service'
        and existing.attendance_group in ('First Service', 'Second Service')
        and existing.attendance_group <> new.attendance_group
        and existing.id is distinct from new.id
    ) then
      raise exception 'This user has already scanned for the Sunday Service for the day'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_sunday_service_once_per_day on public.attendance;
create trigger enforce_sunday_service_once_per_day
before insert or update of student_id, attended_date, attendance_context, attendance_group
on public.attendance
for each row execute function public.enforce_sunday_service_once_per_day();

commit;
