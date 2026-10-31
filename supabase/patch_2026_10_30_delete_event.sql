-- MyPresence event deletion — 2026-10-30
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run.
--
-- p_attendance_mode:
--   'keep'   -> unlink attendance records (event_id = null), then delete the event
--   'delete' -> permanently delete the event's attendance records, then the event
--
-- Poll submissions and suggestions tied to the event are always removed.

begin;

create or replace function public.delete_event(
  p_event_id uuid,
  p_attendance_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_title text;
  v_attendance_count integer := 0;
  v_suggestion_count integer := 0;
  v_submission_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to delete an event.' using errcode = '42501';
  end if;

  if p_attendance_mode is null or p_attendance_mode not in ('keep', 'delete') then
    raise exception 'Invalid attendance mode.' using errcode = '22023';
  end if;

  select title
  into v_event_title
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;

  select count(*)
  into v_attendance_count
  from public.attendance
  where event_id = p_event_id;

  select count(*)
  into v_suggestion_count
  from public.event_suggestions
  where event_id = p_event_id;

  select count(*)
  into v_submission_count
  from public."EventPoll_Submissions"
  where event_id = p_event_id
     or poll_id in (
       select id from public.event_suggestions where event_id = p_event_id
     );

  if p_attendance_mode = 'delete' then
    delete from public.attendance
    where event_id = p_event_id;
  else
    update public.attendance
    set event_id = null
    where event_id = p_event_id;
  end if;

  delete from public."EventPoll_Submissions"
  where event_id = p_event_id
     or poll_id in (
       select id from public.event_suggestions where event_id = p_event_id
     );

  delete from public.event_suggestions
  where event_id = p_event_id;

  delete from public.events
  where id = p_event_id;

  return jsonb_build_object(
    'title', v_event_title,
    'attendance_mode', p_attendance_mode,
    'attendance_count', v_attendance_count,
    'suggestion_count', v_suggestion_count,
    'submission_count', v_submission_count
  );
end;
$$;

revoke all on function public.delete_event(uuid, text) from public;
revoke all on function public.delete_event(uuid, text) from anon;
grant execute on function public.delete_event(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
