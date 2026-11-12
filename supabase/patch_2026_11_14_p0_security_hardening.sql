-- MyPresence P0 Security Hardening — 2026-11-14
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run.
--
-- Purpose: replace the development allow-all RLS policies on the core tables
-- (supabase/schema.sql:401-439) with role-aware policies, close direct
-- anonymous access to member and attendance data, tighten privileged RPCs,
-- and restrict poll/calendar writes.
--
-- Shared-database note: this project shares its Supabase instance with the
-- HPCI Thrive mobile app. Every policy below keeps access for the
-- `authenticated` role so signed-in mobile users continue to work. Only the
-- `anon` role loses access, plus direct DELETE on member/attendance rows.
--
-- Expected behavior after this patch:
--   anon (no session)           -> can read events and calendar images only
--   authenticated (non-admin)   -> read/write members (no delete), read/write
--                                  attendance (no delete), read events,
--                                  vote on polls, add suggestions
--   authenticated (admin)       -> everything above plus event/poll/calendar
--                                  management and member/event deletion via RPC
--
-- Rollback available at supabase/rollback_2026_11_14_p0_security_hardening.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. public.users (members + face descriptors)
--    The dev policy allowed anonymous read AND write of member records and
--    biometric descriptors. Direct deletes are removed entirely for normal
--    roles; deletion happens through the admin-gated delete_member RPC.
-- ---------------------------------------------------------------------------
drop policy if exists allow_all_users_dev on public.users;

drop policy if exists users_select_authenticated on public.users;
create policy users_select_authenticated
  on public.users
  for select
  to authenticated
  using (true);

drop policy if exists users_insert_authenticated on public.users;
create policy users_insert_authenticated
  on public.users
  for insert
  to authenticated
  with check (true);

drop policy if exists users_update_authenticated on public.users;
create policy users_update_authenticated
  on public.users
  for update
  to authenticated
  using (true)
  with check (true);

revoke all on public.users from anon;
revoke delete on public.users from authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.attendance
--    Same treatment as users: authenticated read/insert/update only, no
--    direct delete (delete_member / delete_event RPCs handle deletions).
-- ---------------------------------------------------------------------------
drop policy if exists allow_all_attendance_dev on public.attendance;

drop policy if exists attendance_select_authenticated on public.attendance;
create policy attendance_select_authenticated
  on public.attendance
  for select
  to authenticated
  using (true);

drop policy if exists attendance_insert_authenticated on public.attendance;
create policy attendance_insert_authenticated
  on public.attendance
  for insert
  to authenticated
  with check (true);

drop policy if exists attendance_update_authenticated on public.attendance;
create policy attendance_update_authenticated
  on public.attendance
  for update
  to authenticated
  using (true)
  with check (true);

revoke all on public.attendance from anon;
revoke delete on public.attendance from authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.events
--    Event information (title, date, location, poster) stays publicly
--    readable so pre-login/public screens and the mobile app keep working.
--    All writes now require an administrator.
-- ---------------------------------------------------------------------------
drop policy if exists allow_all_events_dev on public.events;

drop policy if exists events_public_select on public.events;
create policy events_public_select
  on public.events
  for select
  using (true);

drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert
  on public.events
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists events_admin_update on public.events;
create policy events_admin_update
  on public.events
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete
  on public.events
  for delete
  to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.events from anon;

-- ---------------------------------------------------------------------------
-- 4. public.event_suggestions (poll definitions + plain suggestions)
--    Signed-in users may read poll definitions and add plain suggestions
--    (mobile flow). Only administrators may modify or remove rows.
-- ---------------------------------------------------------------------------
drop policy if exists allow_all_event_suggestions_dev on public.event_suggestions;

drop policy if exists event_suggestions_select_authenticated on public.event_suggestions;
create policy event_suggestions_select_authenticated
  on public.event_suggestions
  for select
  to authenticated
  using (true);

drop policy if exists event_suggestions_insert_authenticated on public.event_suggestions;
create policy event_suggestions_insert_authenticated
  on public.event_suggestions
  for insert
  to authenticated
  with check (true);

drop policy if exists event_suggestions_admin_update on public.event_suggestions;
create policy event_suggestions_admin_update
  on public.event_suggestions
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists event_suggestions_admin_delete on public.event_suggestions;
create policy event_suggestions_admin_delete
  on public.event_suggestions
  for delete
  to authenticated
  using (public.is_admin());

revoke all on public.event_suggestions from anon;

-- ---------------------------------------------------------------------------
-- 5. public."EventPoll_Submissions" (poll votes)
--    RLS was never enabled on this table; the previous policies were inert
--    and any authenticated user could delete any votes. Enable RLS and lock
--    it to one vote per account (voter_key = auth.uid(), the value the
--    insert trigger assigns), with deletion reserved for administrators.
-- ---------------------------------------------------------------------------
alter table public."EventPoll_Submissions" enable row level security;

drop policy if exists "Authenticated users can view poll results" on public."EventPoll_Submissions";
create policy "Authenticated users can view poll results"
  on public."EventPoll_Submissions"
  for select
  to authenticated
  using (true);

drop policy if exists "Users can insert their own poll submissions" on public."EventPoll_Submissions";
create policy "Users can insert their own poll submissions"
  on public."EventPoll_Submissions"
  for insert
  to authenticated
  with check (voter_key = auth.uid()::text);

drop policy if exists "Users can update their own poll submissions" on public."EventPoll_Submissions";
create policy "Users can update their own poll submissions"
  on public."EventPoll_Submissions"
  for update
  to authenticated
  using (voter_key = auth.uid()::text)
  with check (voter_key = auth.uid()::text);

drop policy if exists "Authenticated users can delete poll submissions" on public."EventPoll_Submissions";
drop policy if exists "Admins can delete poll submissions" on public."EventPoll_Submissions";
create policy "Admins can delete poll submissions"
  on public."EventPoll_Submissions"
  for delete
  to authenticated
  using (public.is_admin());

revoke all on public."EventPoll_Submissions" from anon;

-- ---------------------------------------------------------------------------
-- 6. public.calendar (monthly calendar image)
--    Public read stays; management becomes administrator-only (was: any
--    authenticated user could replace or delete the calendar image).
-- ---------------------------------------------------------------------------
drop policy if exists calendar_authenticated_write on public.calendar;
drop policy if exists calendar_admin_write on public.calendar;
create policy calendar_admin_write
  on public.calendar
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Storage: the calendar bucket objects follow the same rule.
drop policy if exists "Calendar images can be managed by authenticated users" on storage.objects;
drop policy if exists "Calendar images can be managed by administrators" on storage.objects;
create policy "Calendar images can be managed by administrators"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'calendar' and public.is_admin())
  with check (bucket_id = 'calendar' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. Privileged RPCs: delete_member and delete_event
--    Both were executable by ANY signed-in account. Add the administrator
--    check (same rule the Verification Center uses).
-- ---------------------------------------------------------------------------
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

  if not coalesce(public.is_admin(), false) then
    raise exception 'Only administrators can delete members.' using errcode = '42501';
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

  if not coalesce(public.is_admin(), false) then
    raise exception 'Only administrators can delete events.' using errcode = '42501';
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

revoke all on function public.delete_member(uuid) from public;
revoke all on function public.delete_member(uuid) from anon;
grant execute on function public.delete_member(uuid) to authenticated;

revoke all on function public.delete_event(uuid, text) from public;
revoke all on function public.delete_event(uuid, text) from anon;
grant execute on function public.delete_event(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. is_social_admin(): a boolean helper that reveals admin/staff status.
--    Keep it callable only by authenticated sessions (it previously kept the
--    default PUBLIC EXECUTE grant).
-- ---------------------------------------------------------------------------
revoke all on function public.is_social_admin() from public;
revoke all on function public.is_social_admin() from anon;
grant execute on function public.is_social_admin() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 9. Verification queries (run after applying)
-- ---------------------------------------------------------------------------
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('users', 'attendance', 'events', 'event_suggestions',
--                     'EventPoll_Submissions', 'calendar')
-- order by tablename, policyname;
--
-- select relname, relrowsecurity
-- from pg_class
-- where relname = 'EventPoll_Submissions';
