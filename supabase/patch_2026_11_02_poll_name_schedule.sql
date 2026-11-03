-- Poll names + schedule + server-side voting window — 2026-11-02
--
-- Run this after:
--   patch_2026_10_22_polls_calendar.sql
--   patch_2026_10_23_poll_question_text.sql
--   patch_2026_10_24_poll_main_question.sql
--
-- Adds:
--   * poll_name        optional administrator-facing poll label
--   * poll_starts_at   optional timestamptz; voting is blocked before this time
--   * poll_ends_at     optional timestamptz; voting is blocked at/after this time
--
-- Poll status is derived from the schedule:
--   archived  when poll_status = 'archived'
--   ended     when poll_status = 'closed', or poll_ends_at has passed
--   scheduled when poll_starts_at is in the future
--   active    otherwise
--
-- Existing votes and results are preserved. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schedule columns
-- ---------------------------------------------------------------------------
alter table public.event_suggestions
  add column if not exists poll_name text;

alter table public.event_suggestions
  add column if not exists poll_starts_at timestamptz;

alter table public.event_suggestions
  add column if not exists poll_ends_at timestamptz;

comment on column public.event_suggestions.poll_name is
  'Optional administrator-facing poll name. Repeated on every choice row for that poll.';

comment on column public.event_suggestions.poll_starts_at is
  'Voting opens at this time. Null means the poll is available immediately. Repeated on every choice row.';

comment on column public.event_suggestions.poll_ends_at is
  'Voting closes at this time. Null means no automatic end time. Repeated on every choice row.';

-- End must be later than start. A start without an end, or an end without a
-- start, remains valid.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_suggestions_poll_schedule_check'
  ) then
    alter table public.event_suggestions
      add constraint event_suggestions_poll_schedule_check
      check (
        poll_ends_at is null
        or poll_starts_at is null
        or poll_ends_at > poll_starts_at
      );
  end if;
end $$;

create index if not exists event_suggestions_poll_schedule_idx
  on public.event_suggestions (poll_starts_at, poll_ends_at)
  where poll_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Shared effective status helper
-- ---------------------------------------------------------------------------
create or replace function public.poll_effective_status(
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_status, 'open') = 'archived' then 'archived'
    when coalesce(p_status, 'open') = 'closed' then 'ended'
    when p_starts_at is not null and now() < p_starts_at then 'scheduled'
    when p_ends_at is not null and now() >= p_ends_at then 'ended'
    else 'active'
  end;
$$;

comment on function public.poll_effective_status(text, timestamptz, timestamptz) is
  'Returns scheduled, active, ended, or archived from the stored poll status and schedule.';

-- ---------------------------------------------------------------------------
-- 3. Enforce the voting window in the database
-- ---------------------------------------------------------------------------
-- The mobile app writes directly to EventPoll_Submissions, so the trigger is
-- the authoritative guard. It also prevents votes for archived choices.
create or replace function public.set_event_poll_submission_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_poll_key uuid;
  v_poll_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_archived_at timestamptz;
  v_effective_status text;
begin
  if new.voter_key is null then
    new.voter_key := nullif(auth.uid()::text, '');
  end if;

  if new.poll_id is not null then
    select
      choice_row.poll_key,
      choice_row.poll_status,
      choice_row.poll_starts_at,
      choice_row.poll_ends_at,
      choice_row.archived_at
    into
      v_poll_key,
      v_poll_status,
      v_starts_at,
      v_ends_at,
      v_archived_at
    from public.event_suggestions as choice_row
    where choice_row.id::text = new.poll_id::text
      and choice_row.item_kind = 'choice'
    limit 1;

    if not found then
      raise exception 'POLL_CHOICE_NOT_FOUND' using errcode = '23503';
    end if;

    if v_poll_key is null then
      raise exception 'POLL_NOT_FOUND' using errcode = '23503';
    end if;

    if v_archived_at is not null then
      raise exception 'POLL_CHOICE_ARCHIVED' using errcode = '23514';
    end if;

    new.question_id := v_poll_key;
  elsif new.question_id is not null then
    -- Support clients that send the stable poll key instead of a choice id.
    select
      choice_row.poll_key,
      choice_row.poll_status,
      choice_row.poll_starts_at,
      choice_row.poll_ends_at
    into
      v_poll_key,
      v_poll_status,
      v_starts_at,
      v_ends_at
    from public.event_suggestions as choice_row
    where choice_row.poll_key = new.question_id
      and choice_row.item_kind = 'choice'
    order by choice_row.sort_order
    limit 1;

    if not found then
      raise exception 'POLL_NOT_FOUND' using errcode = '23503';
    end if;
  end if;

  if v_poll_key is null then
    raise exception 'POLL_NOT_FOUND' using errcode = '23503';
  end if;

  v_effective_status := public.poll_effective_status(v_poll_status, v_starts_at, v_ends_at);

  if v_effective_status = 'archived' then
    raise exception 'POLL_ARCHIVED' using errcode = '23514';
  end if;

  if v_effective_status = 'scheduled' then
    raise exception 'POLL_NOT_STARTED' using errcode = '23514';
  end if;

  if v_effective_status = 'ended' then
    raise exception 'POLL_ENDED' using errcode = '23514';
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
-- 4. Verification
-- ---------------------------------------------------------------------------
select 'poll schedule columns' as check_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'event_suggestions'
  and column_name in ('poll_name', 'poll_starts_at', 'poll_ends_at')
order by column_name;

select 'poll schedule constraint' as check_name, conname
from pg_constraint
where conname = 'event_suggestions_poll_schedule_check';

commit;
