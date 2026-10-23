-- Poll question text + choice-only rows.
--
-- Run this after patch_2026_10_22_polls_calendar.sql.
--
-- New model:
--   * event_suggestions rows are choices only.
--   * suggestion_text is the clean choice label ("ya", "na").
--   * suggestion_question_text is the poll question, repeated on every choice.
--   * poll_key groups the choices.
--   * EventPoll_Submissions.question_id stores the poll_key, so one voter can
--     still have only one vote per poll.
--
-- This patch migrates old [POLL_Q:...] question rows into the question column
-- on their choices, then removes those question rows. It keeps votes by
-- normalizing submission.question_id to the poll key first.
--
-- It is additive/idempotent and does not delete unrelated suggestions.

begin;

-- ---------------------------------------------------------------------------
-- 1. Question text column
-- ---------------------------------------------------------------------------

alter table public.event_suggestions
  add column if not exists suggestion_question_text text;

comment on column public.event_suggestions.suggestion_question_text is
  'Poll question shown above the choices. Repeated on every choice row for that poll.';

-- ---------------------------------------------------------------------------
-- 2. Turn legacy question rows into choice-row metadata
-- ---------------------------------------------------------------------------

update public.event_suggestions as choice_row
set
  suggestion_question_text = coalesce(
    nullif(btrim(choice_row.suggestion_question_text), ''),
    nullif(btrim(question_row.suggestion_question_text), ''),
    nullif(
      btrim(regexp_replace(question_row.suggestion_text, '^\[POLL_Q(?::[^\]]+)?\]\s*', '')),
      ''
    )
  ),
  suggestion_text = btrim(
    regexp_replace(choice_row.suggestion_text, '^\[POLL_C(?::[^\]]+)?\]\s*', '')
  ),
  item_kind = 'choice',
  poll_status = case
    when question_row.archived_at is not null then 'archived'
    else question_row.poll_status
  end,
  updated_at = timezone('utc'::text, now())
from public.event_suggestions as question_row
where question_row.event_id = choice_row.event_id
  and question_row.poll_key = choice_row.poll_key
  and question_row.item_kind = 'question'
  and choice_row.id <> question_row.id
  and (
    choice_row.item_kind = 'choice'
    or choice_row.suggestion_text like '[POLL_C%'
  );

-- Remove any remaining encoded choice prefixes. This also handles legacy polls
-- that never got a matching question row.
update public.event_suggestions
set
  suggestion_text = btrim(regexp_replace(suggestion_text, '^\[POLL_C(?::[^\]]+)?\]\s*', '')),
  item_kind = 'choice',
  updated_at = timezone('utc'::text, now())
where suggestion_text like '[POLL_C%';

-- ---------------------------------------------------------------------------
-- 3. Normalize vote grouping before removing question rows
-- ---------------------------------------------------------------------------

-- question_id used to point at a question row. The new model has no question
-- rows, so it becomes the stable poll key instead.
alter table public."EventPoll_Submissions"
  drop constraint if exists event_poll_submissions_question_fk;

update public."EventPoll_Submissions" as submission
set question_id = choice_row.poll_key
from public.event_suggestions as choice_row
where choice_row.id::text = submission.poll_id::text
  and choice_row.poll_key is not null;

comment on column public."EventPoll_Submissions".question_id is
  'Poll key from event_suggestions.poll_key. One vote per question_id + voter_key.';

-- Now the old question rows are no longer needed by submissions.
delete from public.event_suggestions as question_row
where question_row.item_kind = 'question'
  and exists (
    select 1
    from public.event_suggestions as choice_row
    where choice_row.event_id = question_row.event_id
      and choice_row.poll_key = question_row.poll_key
      and choice_row.id <> question_row.id
  );

-- ---------------------------------------------------------------------------
-- 4. Keep the submission trigger working without question rows
-- ---------------------------------------------------------------------------

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

drop trigger if exists set_event_poll_submission_metadata on public."EventPoll_Submissions";
create trigger set_event_poll_submission_metadata
before insert or update on public."EventPoll_Submissions"
for each row execute function public.set_event_poll_submission_metadata();

commit;
