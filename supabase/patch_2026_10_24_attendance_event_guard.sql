-- MyPresence attendance/event upgrade — 2026-10-24
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run. Creates a private backup schema before changing data.
-- Rollback: supabase/rollback_2026_10_24_attendance_event_guard.sql

begin;

-- ---------------------------------------------------------------------------
-- 0. Private backups (not exposed through PostgREST)
-- ---------------------------------------------------------------------------
create schema if not exists attendance_backup;

create table if not exists attendance_backup.attendance_20261024 as
  select * from public.attendance;

create table if not exists attendance_backup.events_20261024 as
  select * from public.events;

create table if not exists attendance_backup.users_20261024 as
  select id, student_id, is_active from public.users;

-- ---------------------------------------------------------------------------
-- 1. Existing columns / defaults
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists is_active boolean;
update public.users set is_active = true where is_active is null;
alter table public.users alter column is_active set default true;
alter table public.users alter column is_active set not null;

alter table public.attendance add column if not exists service_type text;
alter table public.events add column if not exists event_type text;

-- ---------------------------------------------------------------------------
-- 2. Normalise legacy attendance rows (generic "Events" -> real type)
-- ---------------------------------------------------------------------------
update public.attendance
set attendance_context = attendance_group
where attendance_context = 'Events'
  and attendance_group in ('Rooftop', 'Women''s Network', 'Men''s Network');

update public.attendance
set service_type = attendance_group
where attendance_context = 'Sunday Service'
  and service_type is null
  and attendance_group in ('First Service', 'Second Service');

-- ---------------------------------------------------------------------------
-- 3. Preflight checks — abort before adding constraints if data is unsafe
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad_context integer;
  v_bad_group integer;
  v_bad_service integer;
  v_sunday_dupes integer;
  v_bad_event_type integer;
begin
  select count(*) into v_bad_context
  from public.attendance
  where attendance_context is null
     or attendance_context not in (
       'Sunday Service', 'Prayer Meeting', 'Rooftop', 'Women''s Network', 'Men''s Network'
     );

  if v_bad_context > 0 then
    raise exception 'Migration stopped: % attendance row(s) have an unsupported or null attendance_context. Fix them first.', v_bad_context;
  end if;

  select count(*) into v_bad_group
  from public.attendance
  where (attendance_context = 'Sunday Service'
         and attendance_group not in ('First Service', 'Second Service'))
     or (attendance_context in ('Prayer Meeting', 'Rooftop', 'Women''s Network', 'Men''s Network')
         and attendance_group is distinct from attendance_context);

  if v_bad_group > 0 then
    raise exception 'Migration stopped: % attendance row(s) have an invalid attendance_group for their type.', v_bad_group;
  end if;

  select count(*) into v_bad_service
  from public.attendance
  where service_type is not null
    and service_type not in ('First Service', 'Second Service');

  if v_bad_service > 0 then
    raise exception 'Migration stopped: % attendance row(s) have an invalid service_type.', v_bad_service;
  end if;

  select count(*) into v_sunday_dupes
  from (
    select student_id, attended_date
    from public.attendance
    where attendance_context = 'Sunday Service'
    group by student_id, attended_date
    having count(*) > 1
  ) duplicates;

  if v_sunday_dupes > 0 then
    raise exception 'Migration stopped: % member/date combination(s) already have multiple Sunday Service rows. Resolve them before adding the unique index.', v_sunday_dupes;
  end if;

  select count(*) into v_bad_event_type
  from public.events
  where event_type is not null
    and event_type not in ('Sunday Service', 'Rooftop', 'Women''s Network', 'Men''s Network', 'General');

  if v_bad_event_type > 0 then
    raise exception 'Migration stopped: % event(s) have an unsupported event_type.', v_bad_event_type;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Constraints
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_context_allowed') then
    alter table public.attendance
      add constraint attendance_context_allowed
      check (
        attendance_context is not null
        and attendance_context in ('Sunday Service', 'Prayer Meeting', 'Rooftop', 'Women''s Network', 'Men''s Network')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'attendance_group_allowed') then
    alter table public.attendance
      add constraint attendance_group_allowed
      check (
        attendance_group is not null
        and attendance_group in ('First Service', 'Second Service', 'Prayer Meeting', 'Rooftop', 'Women''s Network', 'Men''s Network')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'attendance_service_type_allowed') then
    alter table public.attendance
      add constraint attendance_service_type_allowed
      check (service_type is null or service_type in ('First Service', 'Second Service'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'attendance_session_consistency') then
    alter table public.attendance
      add constraint attendance_session_consistency
      check (
        attendance_context is not null
        and attendance_group is not null
        and (
          (attendance_context = 'Sunday Service'
            and service_type in ('First Service', 'Second Service')
            and attendance_group = service_type)
          or
          (attendance_context in ('Prayer Meeting', 'Rooftop', 'Women''s Network', 'Men''s Network')
            and service_type is null
            and attendance_group = attendance_context)
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'events_event_type_allowed') then
    alter table public.events
      add constraint events_event_type_allowed
      check (event_type is null or event_type in ('Sunday Service', 'Rooftop', 'Women''s Network', 'Men''s Network', 'General'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Race-safe uniqueness
-- ---------------------------------------------------------------------------
-- One Sunday Service record per member per date, regardless of First/Second.
create unique index if not exists attendance_unique_sunday_per_date
  on public.attendance (student_id, attended_date)
  where attendance_context = 'Sunday Service';

create index if not exists attendance_context_idx
  on public.attendance (attendance_context);

create index if not exists events_event_type_idx
  on public.events (event_type);

-- ---------------------------------------------------------------------------
-- 6. Attendance write guard
-- ---------------------------------------------------------------------------
create or replace function public.attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active boolean;
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

  -- Inactive members may not create new attendance rows.
  if tg_op = 'INSERT' then
    select is_active into v_active
    from public.users
    where student_id = new.student_id;

    if not found then
      raise exception 'MEMBER_NOT_FOUND' using errcode = '23503';
    end if;

    if v_active is false then
      raise exception 'MEMBER_INACTIVE' using errcode = '23514';
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

-- ---------------------------------------------------------------------------
-- 7. Event write guards
-- ---------------------------------------------------------------------------
create or replace function public.events_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.event_type is null then
    raise exception 'EVENT_TYPE_REQUIRED' using errcode = '23514';
  end if;

  if new.event_type not in ('Sunday Service', 'Rooftop', 'Women''s Network', 'Men''s Network', 'General') then
    raise exception 'EVENT_TYPE_INVALID' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.event_type is distinct from old.event_type then
    if exists (
      select 1
      from public.attendance a
      where a.event_id = new.id
        and not (
          new.event_type = 'General'
          or (a.attendance_context = 'Sunday Service' and new.event_type = 'Sunday Service')
          or (a.attendance_context = 'Rooftop' and new.event_type = 'Rooftop')
          or (a.attendance_context = 'Women''s Network' and new.event_type = 'Women''s Network')
          or (a.attendance_context = 'Men''s Network' and new.event_type = 'Men''s Network')
        )
    ) then
      raise exception 'EVENT_TYPE_IN_USE' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists events_guard_before_write on public.events;
create trigger events_guard_before_write
before insert or update of event_type
on public.events
for each row execute function public.events_guard();

create or replace function public.events_prevent_linked_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.attendance where event_id = old.id) then
    raise exception 'EVENT_HAS_ATTENDANCE' using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists events_prevent_linked_delete on public.events;
create trigger events_prevent_linked_delete
before delete on public.events
for each row execute function public.events_prevent_linked_delete();

-- ---------------------------------------------------------------------------
-- 8. Classify the one existing event whose category is unambiguous
--    (all other untyped events stay null and appear as "Needs review")
-- ---------------------------------------------------------------------------
update public.events
set event_type = 'Women''s Network'
where event_type is null
  and title = 'Women''s Empowerment'
  and details ilike '%Women''s Network%';

-- ---------------------------------------------------------------------------
-- 9. Verification (inspect the results in the SQL Editor output)
-- ---------------------------------------------------------------------------
select 'attendance types' as check_name, attendance_context, count(*) as rows
from public.attendance
group by attendance_context
order by attendance_context;

select 'events needing review' as check_name, id, title, event_date
from public.events
where event_type is null
order by created_at desc;

select 'sunday unique index' as check_name, indexname
from pg_indexes
where schemaname = 'public'
  and indexname = 'attendance_unique_sunday_per_date';

select 'triggers' as check_name, tgname
from pg_trigger
where not tgisinternal
  and tgrelid in ('public.attendance'::regclass, 'public.events'::regclass)
order by tgname;

commit;
