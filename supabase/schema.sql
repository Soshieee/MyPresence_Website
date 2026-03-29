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
  attended_date date not null,
  attended_at timestamptz not null default timezone('utc'::text, now()),
  constraint attendance_student_fk foreign key (student_id) references public.users(student_id) on update cascade on delete restrict,
  constraint attendance_unique_per_session unique (student_id, attended_date, attendance_context, attendance_group)
);

alter table public.attendance add column if not exists was_newcomer boolean not null default false;
alter table public.attendance add column if not exists attendance_context text;
alter table public.attendance add column if not exists attendance_group text;

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

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  event_date date,
  location text,
  poster_url text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists attendance_attended_date_idx on public.attendance(attended_date);
create index if not exists attendance_student_id_idx on public.attendance(student_id);
create index if not exists events_event_date_idx on public.events(event_date);

-- Enable RLS if you need auth-aware policies.
alter table public.users enable row level security;
alter table public.attendance enable row level security;
alter table public.events enable row level security;

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
end $$;
