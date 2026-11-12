-- MyPresence — TEMPORARY P7 test harness (2026-11-14)
-- PURPOSE: exercise the Automated Insights thresholds without the web rating
-- UI (rating is mobile-only by design). Inserts 5 synthetic low-rated
-- feedback rows for ONE event, using accounts that have not yet submitted
-- feedback for it. Every inserted row is tagged 'P7-TEST' in the comment so
-- the cleanup removes EXACTLY what was added — nothing else.
--
-- USAGE:
--   1. Set @event_id below to an event you want the alert to fire for.
--   2. Run the whole script (insert section).
--   3. Open the Home dashboard as an administrator — the low-rating insight
--      (and, with the speaker ratings below, the category-outlier flag in the
--      Events manager) should appear.
--   4. Run the cleanup section to remove the test rows.
--
-- !! Run the cleanup when you are done. Test rows are visible in the
-- !! Events-manager feedback analytics while they exist.

begin;

-- ---------------------------------------------------------------------
-- CONFIGURE: pick the event (defaults to the seeded 'Thesis Defense')
-- ---------------------------------------------------------------------
create temp table if not exists p7_test_config as
  select '2fc66f1d-d31a-45af-803f-e587ecfa4732'::uuid as event_id;

-- ---------------------------------------------------------------------
-- INSERT: 5 synthetic responses (overall 2.83★ average, speaker 1★ outlier)
-- ---------------------------------------------------------------------
insert into public.event_feedback (
  event_id, user_id, overall_rating, comment,
  food_rating, venue_rating, music_rating, program_rating, staff_rating, speaker_rating
)
select
  (select event_id from p7_test_config),
  u.id,
  3,
  'P7-TEST: synthetic response for automated-insights testing.',
  3, 3, 3, 3, 3, 1
from auth.users u
where u.id not in (
  select user_id from public.event_feedback
  where event_id = (select event_id from p7_test_config)
)
limit 5;

-- ---------------------------------------------------------------------
-- VERIFY: counts as they will appear in event_feedback_summary
-- ---------------------------------------------------------------------
select count(*) as test_rows
from public.event_feedback
where comment = 'P7-TEST';

commit;

-- ---------------------------------------------------------------------
-- CLEANUP (run after testing)
-- ---------------------------------------------------------------------
-- begin;
-- delete from public.event_feedback where comment = 'P7-TEST';
-- drop table if exists p7_test_config;
-- commit;
