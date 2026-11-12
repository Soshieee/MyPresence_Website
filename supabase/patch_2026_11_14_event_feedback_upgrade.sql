-- MyPresence Event Feedback upgrade — 2026-11-14 (rev 2)
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run (rev 1 already applied? this version fixes it — see §3).
--
-- Implements the approved Decision #1 (category ratings may be N/A) plus
-- access-rule housekeeping, using ONLY provably-safe operations:
--   1. The six category rating columns become nullable (DROP NOT NULL is a
--      no-op if already nullable). The mobile app keeps sending all seven
--      ratings — fully backward compatible. `overall_rating` stays required.
--   2. CHECK constraints are NOT modified: a plain `rating BETWEEN 1 AND 5`
--      check already permits NULL (NULL fails no CHECK).
--   3. REV 2 CHANGE: the three generic policies added by rev 1
--      (event_feedback_select_authenticated / insert_own / update_own) are
--      DROPPED. Inspection showed the table already ships stricter, correct
--      policies (own rows gated by is_church_verified(); admin-only deletes
--      via is_event_feedback_admin()) and the generic ones weakened them by
--      letting any authenticated user read all feedback without verification.
--   4. One additive policy is created instead: web administrators (public.
--      is_admin()) may SELECT all feedback so the Events-manager analytics
--      card works. Members keep the existing mobile-app policies untouched.
--   5. TRUNCATE is revoked from application roles.
--   6. DELETE grants and the two triggers (guard_event_feedback_update,
--      prepare_event_feedback) remain untouched — the existing DELETE policy
--      is already admin-only.

begin;

-- ---------------------------------------------------------------------------
-- 1. Category ratings may be N/A (NULL = not applicable, never zero)
-- ---------------------------------------------------------------------------
alter table public.event_feedback alter column food_rating drop not null;
alter table public.event_feedback alter column venue_rating drop not null;
alter table public.event_feedback alter column music_rating drop not null;
alter table public.event_feedback alter column program_rating drop not null;
alter table public.event_feedback alter column staff_rating drop not null;
alter table public.event_feedback alter column speaker_rating drop not null;

-- overall_rating remains NOT NULL (required). comment keeps its default ''.

-- ---------------------------------------------------------------------------
-- 2. Housekeeping: application roles must not be able to truncate feedback
-- ---------------------------------------------------------------------------
revoke truncate on public.event_feedback from authenticated;
revoke truncate on public.event_feedback from anon;

-- ---------------------------------------------------------------------------
-- 3. Remove the over-permissive generic policies from rev 1.
--    The pre-existing policies are stricter and correct:
--      event_feedback_select  -> own rows (verified) or feedback admin
--      event_feedback_insert  -> own rows (verified) or feedback admin
--      event_feedback_update  -> own rows (verified) or feedback admin
--      event_feedback_delete  -> feedback admin only
-- ---------------------------------------------------------------------------
drop policy if exists event_feedback_select_authenticated on public.event_feedback;
drop policy if exists event_feedback_insert_own on public.event_feedback;
drop policy if exists event_feedback_update_own on public.event_feedback;

-- ---------------------------------------------------------------------------
-- 4. Web administrators may read all feedback (Events-manager analytics).
--    Additive only — it does not affect member insert/update/delete rules.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_feedback'
      and policyname = 'event_feedback_select_web_admin'
  ) then
    create policy event_feedback_select_web_admin
      on public.event_feedback
      for select
      to authenticated
      using (public.is_admin());
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 5. Verification queries (run after applying)
-- ---------------------------------------------------------------------------
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies where tablename = 'event_feedback' order by policyname;
--
-- select column_name, is_nullable from information_schema.columns
-- where table_name = 'event_feedback' order by ordinal_position;
--
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_name = 'event_feedback' and grantee in ('anon', 'authenticated');
