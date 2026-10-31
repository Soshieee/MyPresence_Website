-- MyPresence poll main question + per-poll voting — 2026-10-24
-- Run after patch_2026_10_23_poll_question_text.sql.
-- Safe to re-run. Creates private backups before changing data.
-- Rollback: supabase/rollback_2026_10_24_poll_main_question.sql

begin;

-- ---------------------------------------------------------------------------
-- 0. Private backups (not exposed through PostgREST)
-- ---------------------------------------------------------------------------
create schema if not exists poll_backup;

create table if not exists poll_backup.event_suggestions_20261024 as
  select * from public.event_suggestions;

create table if not exists poll_backup.event_poll_submissions_20261024 as
  select * from public."EventPoll_Submissions";

-- ---------------------------------------------------------------------------
-- 1. Main question column
-- ---------------------------------------------------------------------------
alter table public.event_suggestions
  add column if not exists main_question text;

comment on column public.event_suggestions.main_question is
  'Main question/description shown above the poll question. Repeated on every choice row for that poll.';

-- ---------------------------------------------------------------------------
-- 2. Remove the obsolete question-row foreign key
-- ---------------------------------------------------------------------------
-- The current poll model stores the stable poll key in
-- EventPoll_Submissions.question_id. The old FK pointed that column at an
-- event_suggestions row id, so every new vote failed once question_id became
-- the poll key. Drop it before normalizing existing votes.
alter table public."EventPoll_Submissions"
  drop constraint if exists event_poll_submissions_question_fk;

-- ---------------------------------------------------------------------------
-- 3. Normalize existing votes to the stable poll key
-- ---------------------------------------------------------------------------
do $$
declare
  v_duplicate_votes integer;
begin
  select count(*) into v_duplicate_votes
  from (
    select choice_row.poll_key, submission.voter_key
    from public."EventPoll_Submissions" as submission
    join public.event_suggestions as choice_row
      on choice_row.id::text = submission.poll_id::text
    where choice_row.poll_key is not null
      and submission.voter_key is not null
    group by choice_row.poll_key, submission.voter_key
    having count(*) > 1
  ) duplicates;

  if v_duplicate_votes > 0 then
    raise exception 'Migration stopped: % poll/voter combination(s) would violate the one-vote-per-poll rule. Resolve them first.', v_duplicate_votes;
  end if;
end $$;

update public."EventPoll_Submissions" as submission
set question_id = choice_row.poll_key
from public.event_suggestions as choice_row
where choice_row.id::text = submission.poll_id::text
  and choice_row.poll_key is not null
  and submission.question_id is distinct from choice_row.poll_key;

comment on column public."EventPoll_Submissions".question_id is
  'Poll key from event_suggestions.poll_key. One vote per question_id + voter_key.';

-- ---------------------------------------------------------------------------
-- 4. Keep the vote trigger grouping by poll key
-- ---------------------------------------------------------------------------
-- The old trigger looked for a separate question row. This database uses
-- choice rows only, so the old trigger left question_id null and the unique
-- index below could not block a second vote in the same poll. Resolve the
-- stable poll key from the selected choice row instead.
create or replace function public.set_event_poll_submission_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  resolved_poll_key uuid;
begin
  if new.voter_key is null then
    new.voter_key := nullif(auth.uid()::text, '');
  end if;

  if new.poll_id is not null then
    select choice_row.poll_key
    into resolved_poll_key
    from public.event_suggestions as choice_row
    where choice_row.id::text = new.poll_id::text
      and choice_row.item_kind = 'choice'
    limit 1;

    if resolved_poll_key is not null then
      new.question_id := resolved_poll_key;
    end if;
  end if;

  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. One vote per poll, not one vote per event
-- ---------------------------------------------------------------------------
alter table public."EventPoll_Submissions"
  drop constraint if exists one_vote_per_user_per_event;
drop index if exists public.one_vote_per_user_per_event;

create unique index if not exists event_poll_submissions_one_vote_idx
  on public."EventPoll_Submissions"(question_id, voter_key);

-- ---------------------------------------------------------------------------
-- 6. Allow the same option label in different polls
-- ---------------------------------------------------------------------------
-- The old event-wide unique index prevented two different polls from having
-- the same option text (for example, both polls offering "Yes"). Poll options
-- are now unique within their poll; plain suggestions stay unique per event.
drop index if exists public.event_suggestions_event_text_unique_idx;

create unique index if not exists event_suggestions_event_poll_choice_unique_idx
  on public.event_suggestions(event_id, poll_key, suggestion_text)
  where poll_key is not null and item_kind = 'choice';

create unique index if not exists event_suggestions_event_plain_text_unique_idx
  on public.event_suggestions(event_id, suggestion_text)
  where poll_key is null;

-- ---------------------------------------------------------------------------
-- 7. Admin website read/delete access for poll results
-- ---------------------------------------------------------------------------
-- The mobile app still filters by user_id and only shows the signed-in user's
-- vote. The admin website needs to read all counts and remove a poll's votes
-- when an administrator deletes that poll.
drop policy if exists "Authenticated users can view poll results" on public."EventPoll_Submissions";
create policy "Authenticated users can view poll results"
  on public."EventPoll_Submissions"
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can delete poll submissions" on public."EventPoll_Submissions";
create policy "Authenticated users can delete poll submissions"
  on public."EventPoll_Submissions"
  for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------
select 'event_suggestions main_question' as check_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'event_suggestions'
  and column_name = 'main_question';

select 'poll indexes' as check_name, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('event_suggestions', 'EventPoll_Submissions')
  and indexname in (
    'event_suggestions_event_poll_choice_unique_idx',
    'event_suggestions_event_plain_text_unique_idx',
    'event_poll_submissions_one_vote_idx',
    'one_vote_per_user_per_event'
  )
order by indexname;

commit;
