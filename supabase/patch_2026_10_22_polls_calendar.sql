-- Poll management + calendar image support.
--
-- This patch is additive. It does not drop or reset any existing table or row.
-- Review it first, then run it in the Supabase SQL Editor.
--
-- Note: the poll question-row model in this file is superseded by
-- patch_2026_10_23_poll_question_text.sql. Run that patch afterward.
--
-- After running it:
--   1. The Event Manager can edit polls without deleting/recreating them.
--   2. Poll status (open/closed/archived) and option archiving are persistent.
--   3. EventPoll_Submissions can store the poll question, selected option, and voter key.
--   4. The calendar table can store one current image, and the "calendar" storage bucket exists.
--
-- RLS note: this patch does not replace existing policies on event_suggestions
-- or EventPoll_Submissions. It does add a public-read policy for calendar and
-- authenticated write access to the calendar storage bucket. Review the policies
-- section before running in production.

begin;

-- ---------------------------------------------------------------------------
-- 1. Calendar image table
-- ---------------------------------------------------------------------------

create table if not exists public.calendar (
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.calendar add column if not exists id uuid;
update public.calendar set id = gen_random_uuid() where id is null;
alter table public.calendar alter column id set default gen_random_uuid();
alter table public.calendar alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.calendar'::regclass
      and contype = 'p'
  ) then
    alter table public.calendar add constraint calendar_pkey primary key (id);
  end if;
end $$;

-- Existing deployments that used the older image_url column should run
-- patch_2026_10_23_calendar_img_url.sql after deploying the updated app.
alter table public.calendar add column if not exists calendar_img_url text;
alter table public.calendar add column if not exists storage_path text;
alter table public.calendar add column if not exists updated_at timestamptz not null
  default timezone('utc'::text, now());

create index if not exists calendar_updated_at_idx on public.calendar(updated_at desc);

alter table public.calendar enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar'
      and policyname = 'calendar_public_read'
  ) then
    create policy calendar_public_read on public.calendar
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar'
      and policyname = 'calendar_authenticated_write'
  ) then
    create policy calendar_authenticated_write on public.calendar
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Poll metadata on event_suggestions
-- ---------------------------------------------------------------------------

alter table public.event_suggestions add column if not exists poll_key uuid;
alter table public.event_suggestions add column if not exists item_kind text;
alter table public.event_suggestions add column if not exists poll_status text not null
  default 'open';
alter table public.event_suggestions add column if not exists archived_at timestamptz;
alter table public.event_suggestions add column if not exists sort_order int not null
  default 0;
alter table public.event_suggestions add column if not exists updated_at timestamptz not null
  default timezone('utc'::text, now());

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_suggestions_item_kind_check'
  ) then
    alter table public.event_suggestions
      add constraint event_suggestions_item_kind_check
      check (item_kind is null or item_kind in ('question', 'choice'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_suggestions_poll_status_check'
  ) then
    alter table public.event_suggestions
      add constraint event_suggestions_poll_status_check
      check (poll_status in ('open', 'closed', 'archived'));
  end if;
end $$;

-- Explicitly mark existing encoded poll rows and recover their poll key.
update public.event_suggestions
set
  item_kind = case
    when suggestion_text like '[POLL_Q%' then 'question'
    when suggestion_text like '[POLL_C%' then 'choice'
    else item_kind
  end,
  poll_key = coalesce(
    poll_key,
    (regexp_match(
      lower(suggestion_text),
      '^\[poll_[qc]:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]'
    ))[1]::uuid
  ),
  updated_at = coalesce(updated_at, created_at)
where suggestion_text like '[POLL_%';

-- Legacy polls written as [POLL_Q] / [POLL_C] had no poll id. Group each
-- event's legacy poll under one generated key so it becomes editable.
do $$
declare
  event_row record;
  generated_key uuid;
begin
  for event_row in
    select distinct event_id
    from public.event_suggestions
    where poll_key is null
      and suggestion_text like '[POLL_%'
  loop
    generated_key := gen_random_uuid();

    update public.event_suggestions
    set poll_key = generated_key,
        updated_at = timezone('utc'::text, now())
    where event_id = event_row.event_id
      and poll_key is null
      and suggestion_text like '[POLL_%';
  end loop;
end $$;

create index if not exists event_suggestions_poll_key_idx
  on public.event_suggestions(poll_key);

create index if not exists event_suggestions_event_poll_idx
  on public.event_suggestions(event_id, poll_key, item_kind);

-- ---------------------------------------------------------------------------
-- 3. Vote submissions
-- ---------------------------------------------------------------------------
-- poll_id remains the selected event_suggestions row id. It is compared as
-- text so this patch also works if an existing deployment created poll_id as
-- text instead of uuid.
-- question_id is the parent poll question row.
-- voter_key is the stable app user id. If the app uses Supabase Auth, the
-- trigger below fills it from auth.uid() automatically.

create table if not exists public."EventPoll_Submissions" (
  event_id uuid,
  poll_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public."EventPoll_Submissions" add column if not exists question_id uuid;
alter table public."EventPoll_Submissions" add column if not exists voter_key text;
alter table public."EventPoll_Submissions" add column if not exists updated_at timestamptz not null
  default timezone('utc'::text, now());

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_poll_submissions_question_fk'
  ) then
    alter table public."EventPoll_Submissions"
      add constraint event_poll_submissions_question_fk
      foreign key (question_id)
      references public.event_suggestions(id)
      on update cascade on delete cascade
      not valid;
  end if;

end $$;

-- PostgreSQL allows multiple rows where one of the columns is null, so anonymous
-- submissions remain possible until the app sends a voter key. Authenticated
-- submissions are limited to one row per poll question per voter.
create unique index if not exists event_poll_submissions_one_vote_idx
  on public."EventPoll_Submissions"(question_id, voter_key);

create index if not exists event_poll_submissions_event_idx
  on public."EventPoll_Submissions"(event_id);

create index if not exists event_poll_submissions_poll_idx
  on public."EventPoll_Submissions"(poll_id);

create or replace function public.set_event_poll_submission_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  resolved_question_id uuid;
begin
  if new.voter_key is null then
    new.voter_key := nullif(auth.uid()::text, '');
  end if;

  if new.poll_id is not null then
    select question_row.id
    into resolved_question_id
    from public.event_suggestions choice_row
    join public.event_suggestions question_row
      on question_row.event_id = choice_row.event_id
     and question_row.poll_key = choice_row.poll_key
     and question_row.item_kind = 'question'
    where choice_row.id::text = new.poll_id::text
      and choice_row.item_kind = 'choice'
    limit 1;

    if resolved_question_id is not null then
      new.question_id := resolved_question_id;
    end if;
  end if;

  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_event_poll_submission_metadata on public."EventPoll_Submissions";
create trigger set_event_poll_submission_metadata
before insert or update on public."EventPoll_Submissions"
for each row execute function public.set_event_poll_submission_metadata();

-- ---------------------------------------------------------------------------
-- 4. Calendar storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'calendar',
  'calendar',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Calendar images are publicly readable" on storage.objects;
create policy "Calendar images are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'calendar');

drop policy if exists "Calendar images can be managed by authenticated users" on storage.objects;
create policy "Calendar images can be managed by authenticated users"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'calendar')
  with check (bucket_id = 'calendar');

commit;
