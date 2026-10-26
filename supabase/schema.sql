-- Users table stores one face descriptor per user.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  full_name text not null,
  age int,
  gender text,
  newcomer boolean not null default true,
  descriptor jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.users add column if not exists age int;
alter table public.users add column if not exists gender text;
alter table public.users add column if not exists newcomer boolean not null default true;

-- Attendance table stores daily presence logs.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  full_name text not null,
  was_newcomer boolean not null default false,
  attendance_context text,
  attendance_group text,
  event_id uuid,
  attended_date date not null,
  attended_at timestamptz not null default timezone('utc'::text, now()),
  constraint attendance_student_fk foreign key (student_id) references public.users(student_id) on update cascade on delete restrict,
  constraint attendance_unique_per_session unique (student_id, attended_date, attendance_context, attendance_group)
);

alter table public.attendance add column if not exists was_newcomer boolean not null default false;
alter table public.attendance add column if not exists attendance_context text;
alter table public.attendance add column if not exists attendance_group text;
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
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.event_suggestions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on update cascade on delete cascade,
  suggestion_text text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists attendance_attended_date_idx on public.attendance(attended_date);
create index if not exists attendance_student_id_idx on public.attendance(student_id);
create index if not exists attendance_event_id_idx on public.attendance(event_id);
create index if not exists events_event_date_idx on public.events(event_date);
create index if not exists event_suggestions_event_id_idx on public.event_suggestions(event_id);
create unique index if not exists event_suggestions_event_text_unique_idx on public.event_suggestions(event_id, suggestion_text);

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
