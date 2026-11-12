-- Rollback for patch_2026_11_14_p0_security_hardening.sql — 2026-11-14
-- Run in the Supabase SQL Editor as the project owner (postgres).
--
-- WARNING: this restores the DEVELOPMENT allow-all policies. Only use it to
-- undo the P0 patch during testing. The restored state allows anonymous
-- read/write on members (including face descriptors), attendance, and events.
--
-- Note: the admin checks added to delete_member/delete_event and the
-- is_social_admin() grant changes are intentionally KEPT after rollback —
-- they are strict improvements. Drop them explicitly only if truly needed.

begin;

-- 1. users — restore dev allow-all
drop policy if exists users_select_authenticated on public.users;
drop policy if exists users_insert_authenticated on public.users;
drop policy if exists users_update_authenticated on public.users;
drop policy if exists allow_all_users_dev on public.users;
create policy allow_all_users_dev on public.users for all using (true) with check (true);

-- 2. attendance — restore dev allow-all
drop policy if exists attendance_select_authenticated on public.attendance;
drop policy if exists attendance_insert_authenticated on public.attendance;
drop policy if exists attendance_update_authenticated on public.attendance;
drop policy if exists allow_all_attendance_dev on public.attendance;
create policy allow_all_attendance_dev on public.attendance for all using (true) with check (true);

-- 3. events — restore dev allow-all
drop policy if exists events_public_select on public.events;
drop policy if exists events_admin_insert on public.events;
drop policy if exists events_admin_update on public.events;
drop policy if exists events_admin_delete on public.events;
drop policy if exists allow_all_events_dev on public.events;
create policy allow_all_events_dev on public.events for all using (true) with check (true);

-- 4. event_suggestions — restore dev allow-all
drop policy if exists event_suggestions_select_authenticated on public.event_suggestions;
drop policy if exists event_suggestions_insert_authenticated on public.event_suggestions;
drop policy if exists event_suggestions_admin_update on public.event_suggestions;
drop policy if exists event_suggestions_admin_delete on public.event_suggestions;
drop policy if exists allow_all_event_suggestions_dev on public.event_suggestions;
create policy allow_all_event_suggestions_dev on public.event_suggestions for all using (true) with check (true);

-- 5. EventPoll_Submissions — restore pre-patch state (RLS disabled, old policies)
drop policy if exists "Authenticated users can view poll results" on public."EventPoll_Submissions";
drop policy if exists "Users can insert their own poll submissions" on public."EventPoll_Submissions";
drop policy if exists "Users can update their own poll submissions" on public."EventPoll_Submissions";
drop policy if exists "Admins can delete poll submissions" on public."EventPoll_Submissions";
alter table public."EventPoll_Submissions" disable row level security;
create policy "Authenticated users can view poll results"
  on public."EventPoll_Submissions" for select to authenticated using (true);
create policy "Authenticated users can delete poll submissions"
  on public."EventPoll_Submissions" for delete to authenticated using (true);

-- 6. calendar — restore authenticated-write policy
drop policy if exists calendar_admin_write on public.calendar;
create policy calendar_authenticated_write
  on public.calendar
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Calendar images can be managed by administrators" on storage.objects;
create policy "Calendar images can be managed by authenticated users"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'calendar')
  with check (bucket_id = 'calendar');

notify pgrst, 'reload schema';

commit;
