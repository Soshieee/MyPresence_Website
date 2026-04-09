-- One-time patch for analytics + events upgrade.
-- Run this in Supabase SQL Editor if dashboard shows missing users.age or missing public.events.

alter table if exists public.users add column if not exists age int;
alter table if exists public.users add column if not exists gender text;
alter table if exists public.users add column if not exists newcomer boolean not null default true;

alter table if exists public.attendance add column if not exists was_newcomer boolean not null default false;
alter table if exists public.attendance add column if not exists attendance_context text;
alter table if exists public.attendance add column if not exists attendance_group text;
alter table if exists public.attendance add column if not exists event_id uuid;

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

create table if not exists public.event_suggestions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on update cascade on delete cascade,
  suggestion_text text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists events_event_date_idx on public.events(event_date);
create index if not exists attendance_event_id_idx on public.attendance(event_id);
create index if not exists event_suggestions_event_id_idx on public.event_suggestions(event_id);
create unique index if not exists event_suggestions_event_text_unique_idx on public.event_suggestions(event_id, suggestion_text);

alter table public.events enable row level security;
alter table public.event_suggestions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'events' and policyname = 'allow_all_events_dev'
  ) then
    create policy allow_all_events_dev on public.events
      for all
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_suggestions' and policyname = 'allow_all_event_suggestions_dev'
  ) then
    create policy allow_all_event_suggestions_dev on public.event_suggestions
      for all
      using (true)
      with check (true);
  end if;
end $$;
