-- Users table stores one face descriptor per user.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  full_name text not null,
  age int,
  gender text,
  newcomer boolean not null default true,
  is_active boolean not null default true,
  descriptor jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.users add column if not exists age int;
alter table public.users add column if not exists gender text;
alter table public.users add column if not exists newcomer boolean not null default true;
alter table public.users add column if not exists is_active boolean;
update public.users set is_active = true where is_active is null;
alter table public.users alter column is_active set default true;
alter table public.users alter column is_active set not null;

-- Attendance table stores daily presence logs.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  full_name text not null,
  was_newcomer boolean not null default false,
  attendance_context text,
  attendance_group text,
  service_type text,
  event_id uuid,
  attended_date date not null,
  attended_at timestamptz not null default timezone('utc'::text, now()),
  constraint attendance_student_fk foreign key (student_id) references public.users(student_id) on update cascade on delete restrict,
  constraint attendance_unique_per_session unique (student_id, attended_date, attendance_context, attendance_group)
);

alter table public.attendance add column if not exists was_newcomer boolean not null default false;
alter table public.attendance add column if not exists attendance_context text;
alter table public.attendance add column if not exists attendance_group text;
alter table public.attendance add column if not exists service_type text;
alter table public.attendance add column if not exists event_id uuid;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'attendance_unique_per_day'
  ) then
    alter table public.attendance drop constraint attendance_unique_per_day;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_unique_per_session'
  ) then
    alter table public.attendance
      add constraint attendance_unique_per_session unique (student_id, attended_date, attendance_context, attendance_group);
  end if;
end $$;

-- A member may attend only one Sunday Service per day. The trigger enforces the
-- rule for new rows even when historical conflicts exist; the partial unique
-- index is added when the current data is clean.
create index if not exists attendance_sunday_service_lookup_idx
  on public.attendance (student_id, attended_date)
  where attendance_context = 'Sunday Service'
    and attendance_group in ('First Service', 'Second Service');

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
    perform pg_advisory_xact_lock(
      hashtextextended(
        'sunday-service:' || new.student_id || ':' || new.attended_date::text,
        0
      )
    );

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

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  event_date date,
  location text,
  poster_url text,
  event_type text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.events add column if not exists event_type text;

create table if not exists public.event_suggestions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on update cascade on delete cascade,
  suggestion_text text not null,
  main_question text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.event_suggestions add column if not exists main_question text;

-- Normalise legacy rows so the constraints/indexes below can be applied safely.
update public.attendance
set attendance_context = attendance_group
where attendance_context = 'Events'
  and attendance_group in ('Rooftop', 'Women''s Network', 'Men''s Network');

update public.attendance
set service_type = attendance_group
where attendance_context = 'Sunday Service'
  and service_type is null
  and attendance_group in ('First Service', 'Second Service');

update public.events
set event_type = 'Women''s Network'
where event_type is null
  and title = 'Women''s Empowerment'
  and details ilike '%Women''s Network%';

create index if not exists attendance_attended_date_idx on public.attendance(attended_date);
create index if not exists attendance_student_id_idx on public.attendance(student_id);
create index if not exists attendance_event_id_idx on public.attendance(event_id);
create index if not exists attendance_context_idx on public.attendance(attendance_context);
create unique index if not exists attendance_unique_sunday_per_date
  on public.attendance (student_id, attended_date)
  where attendance_context = 'Sunday Service';
create index if not exists events_event_date_idx on public.events(event_date);
create index if not exists events_event_type_idx on public.events(event_type);
create index if not exists event_suggestions_event_id_idx on public.event_suggestions(event_id);
create unique index if not exists event_suggestions_event_text_unique_idx on public.event_suggestions(event_id, suggestion_text);

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

-- Attendance writes: normalise type/session, block inactive members, duplicate
-- Sunday rows, and incompatible linked events.
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

-- Event writes: type is required, and changing it is blocked while linked
-- attendance uses an incompatible type.
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


-- Enable RLS if you need auth-aware policies.
alter table public.users enable row level security;
alter table public.attendance enable row level security;
alter table public.events enable row level security;
alter table public.event_suggestions enable row level security;

-- Example permissive policies for development only.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'allow_all_users_dev'
  ) then
    create policy allow_all_users_dev on public.users
      for all
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance' and policyname = 'allow_all_attendance_dev'
  ) then
    create policy allow_all_attendance_dev on public.attendance
      for all
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'events' and policyname = 'allow_all_events_dev'
  ) then
    create policy allow_all_events_dev on public.events
      for all
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'event_suggestions' and policyname = 'allow_all_event_suggestions_dev'
  ) then
    create policy allow_all_event_suggestions_dev on public.event_suggestions
      for all
      using (true)
      with check (true);
  end if;
end $$;

-- Delete a member together with that member's attendance history in one
-- transaction. Requires an authenticated Supabase session.
create or replace function public.delete_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to delete a member.' using errcode = '42501';
  end if;

  select student_id
  into v_student_id
  from public.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  delete from public.attendance
  where student_id = v_student_id;

  delete from public.users
  where id = p_user_id;
end;
$$;

revoke all on function public.delete_member(uuid) from public;
revoke all on function public.delete_member(uuid) from anon;
grant execute on function public.delete_member(uuid) to authenticated;

revoke delete on table public.attendance from anon;
revoke delete on table public.users from anon;

notify pgrst, 'reload schema';
