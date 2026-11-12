-- MyPresence Event Feedback summary counts — 2026-11-14 (rev 3)
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run.
--
-- Adds per-category response counts to event_feedback_summary (Decision #1:
-- administrators must see the sample size behind each category average).
-- The new columns are APPENDED at the end of the view, so every existing
-- consumer (mobile app included) keeps working unchanged. avg() already
-- ignores NULL category ratings, so N/A responses never distort averages.
--
-- This view remains a plain view and updates automatically with every
-- insert/update/delete of feedback.
--
-- Requires: patch_2026_11_14_event_feedback_upgrade.sql (rev 2) so the
-- category columns are nullable and web admins can read feedback.

create or replace view public.event_feedback_summary as
 select event_id,
    count(*) AS total_responses,
    min(created_at)::date AS first_response_day,
    max(updated_at)::date AS last_activity_day,
    round(avg(overall_rating), 2) AS avg_overall_rating,
    round(avg(food_rating), 2) AS avg_food_rating,
    round(avg(venue_rating), 2) AS avg_venue_rating,
    round(avg(music_rating), 2) AS avg_music_rating,
    round(avg(program_rating), 2) AS avg_program_rating,
    round(avg(staff_rating), 2) AS avg_staff_rating,
    round(avg(speaker_rating), 2) AS avg_speaker_rating,
    count(food_rating) AS food_responses,
    count(venue_rating) AS venue_responses,
    count(music_rating) AS music_responses,
    count(program_rating) AS program_responses,
    count(staff_rating) AS staff_responses,
    count(speaker_rating) AS speaker_responses
   FROM event_feedback
  GROUP BY event_id;

notify pgrst, 'reload schema';

-- Verification (run after applying):
-- select * from public.event_feedback_summary;
-- The result should now include the six *_responses columns.
--
-- Also confirm the web-admin read policy from rev 2 is present:
-- select policyname from pg_policies
-- where tablename = 'event_feedback'
--   and policyname = 'event_feedback_select_web_admin';
