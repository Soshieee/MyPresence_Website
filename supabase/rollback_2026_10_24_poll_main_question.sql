-- MyPresence poll main question — ROLLBACK for 2026-10-24
-- Run in the Supabase SQL Editor as the project owner (postgres).
--
-- The patch saved the pre-change rows in the private poll_backup schema.
-- New main-question values are copied to poll_backup.main_questions_20261024
-- before the column is removed.
--
-- This rollback is intentionally strict: it stops if restoring the old
-- event-wide option uniqueness or one-vote-per-event rule would lose or
-- invalidate existing poll data.

begin;

-- ---------------------------------------------------------------------------
-- 0. Preserve new main-question values
-- ---------------------------------------------------------------------------
create schema if not exists poll_backup;

create table if not exists poll_backup.main_questions_20261024 as
  select id, main_question
  from public.event_suggestions
  where main_question is not null;

-- ---------------------------------------------------------------------------
-- 1. Preflight the restored constraints
-- ---------------------------------------------------------------------------
do $$
declare
  v_duplicate_text integer;
  v_duplicate_votes integer;
begin
  select count(*) into v_duplicate_text
  from (
    select event_id, suggestion_text
    from public.event_suggestions
    group by event_id, suggestion_text
    having count(*) > 1
  ) duplicates;

  if v_duplicate_text > 0 then
    raise exception 'Rollback stopped: % event/option text duplicate(s) exist. Resolve them before restoring the old unique index.', v_duplicate_text;
  end if;

  select count(*) into v_duplicate_votes
  from (
    select event_id, user_id
    from public."EventPoll_Submissions"
    where user_id is not null
    group by event_id, user_id
    having count(*) > 1
  ) duplicates;

  if v_duplicate_votes > 0 then
    raise exception 'Rollback stopped: % member(s) have votes in more than one poll. Resolve them before restoring one-vote-per-event.', v_duplicate_votes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Restore the old vote grouping and one-vote-per-event rule
-- ---------------------------------------------------------------------------
update public."EventPoll_Submissions" as submission
set question_id = backup.question_id
from poll_backup.event_poll_submissions_20261024 as backup
where submission.event_id = backup.event_id
  and submission.poll_id = backup.poll_id;

alter table public."EventPoll_Submissions"
  drop constraint if exists one_vote_per_user_per_event;

alter table public."EventPoll_Submissions"
  add constraint one_vote_per_user_per_event unique (event_id, user_id);

-- Restore the original (NOT VALID) foreign key. It is restored for schema
-- parity with the pre-migration database; new votes will be rejected until the
-- poll migration is applied again.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_poll_submissions_question_fk'
  ) then
    alter table public."EventPoll_Submissions"
      add constraint event_poll_submissions_question_fk
      foreign key (question_id)
      references public.event_suggestions(id)
      on update cascade on delete cascade
      not valid;
  end if;
end $$;

-- Restore the pre-migration vote trigger. It only resolves a question-row id;
-- with choice-only polls it leaves question_id null, which is why the old
-- one-vote-per-event constraint was the effective duplicate guard.
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

-- ---------------------------------------------------------------------------
-- 3. Restore event-wide option uniqueness
-- ---------------------------------------------------------------------------
drop index if exists public.event_suggestions_event_poll_choice_unique_idx;
drop index if exists public.event_suggestions_event_plain_text_unique_idx;

create unique index if not exists event_suggestions_event_text_unique_idx
  on public.event_suggestions(event_id, suggestion_text);

-- ---------------------------------------------------------------------------
-- 4. Remove the admin read/delete policies added by the migration
-- ---------------------------------------------------------------------------
drop policy if exists "Authenticated users can view poll results" on public."EventPoll_Submissions";
drop policy if exists "Authenticated users can delete poll submissions" on public."EventPoll_Submissions";

-- ---------------------------------------------------------------------------
-- 5. Remove the main-question column after backing it up
-- ---------------------------------------------------------------------------
alter table public.event_suggestions
  drop column if exists main_question;

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------
select 'poll vote uniqueness' as check_name, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'EventPoll_Submissions'
  and indexname in ('one_vote_per_user_per_event', 'event_poll_submissions_one_vote_idx')
order by indexname;

select 'event option uniqueness' as check_name, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'event_suggestions'
  and indexname in (
    'event_suggestions_event_text_unique_idx',
    'event_suggestions_event_poll_choice_unique_idx',
    'event_suggestions_event_plain_text_unique_idx'
  )
order by indexname;

commit;
