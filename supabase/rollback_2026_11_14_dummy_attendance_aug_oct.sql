-- MyPresence — rollback for the dummy attendance seed (2026-11-14)
-- Run in the Supabase SQL Editor as the project owner (postgres). Safe to re-run.
-- Removes everything created by supabase/seed_2026_11_14_dummy_attendance_aug_oct.sql:
--   • event_feedback rows for the five dummy events
--   • all attendance rows for TEST-#### members
--   • the five dummy events (deleted after attendance — the
--     events_prevent_linked_delete guard blocks deleting linked events)
--   • the 40 dummy auth accounts (dummy01…dummy40@mypresence.test) + identities
--   • the 260 dummy members (student_id TEST-0001…TEST-0260)
-- Real data is never touched: every delete is scoped to the TEST-% / dummy
-- markers the seed created.

begin;

select 'before — feedback' as check_name, count(*) as value
from public.event_feedback f
join public.events e on e.id = f.event_id
where (e.title, e.event_date) in (
  ('Rooftop Live',     date '2024-08-17'),
  ('Men''s Workshop',  date '2024-09-14'),
  ('38th Anniversary', date '2024-10-04'),
  ('Rooftop Live',     date '2025-08-16'),
  ('39th Anniversary', date '2025-10-04')
);

select 'before — attendance' as check_name, count(*) as value from public.attendance where student_id like 'TEST-%';
select 'before — members' as check_name, count(*) as value from public.users where student_id like 'TEST-%';
select 'before — events' as check_name, count(*) as value from public.events where (title, event_date) in (
  ('Rooftop Live',     date '2024-08-17'),
  ('Men''s Workshop',  date '2024-09-14'),
  ('38th Anniversary', date '2024-10-04'),
  ('Rooftop Live',     date '2025-08-16'),
  ('39th Anniversary', date '2025-10-04')
);
select 'before — auth accounts' as check_name, count(*) as value from auth.users where email like 'dummy%@mypresence.test';

-- 1. Feedback for the dummy events (user_id references auth.users — remove first).
delete from public.event_feedback f
using public.events e
where f.event_id = e.id
  and (e.title, e.event_date) in (
    ('Rooftop Live',     date '2024-08-17'),
    ('Men''s Workshop',  date '2024-09-14'),
    ('38th Anniversary', date '2024-10-04'),
    ('Rooftop Live',     date '2025-08-16'),
    ('39th Anniversary', date '2025-10-04')
  );

-- 2. Attendance (attendance_student_fk is ON DELETE RESTRICT — before members).
delete from public.attendance where student_id like 'TEST-%';

-- 3. The five dummy events (guard requires zero linked attendance first).
delete from public.events
where (title, event_date) in (
  ('Rooftop Live',     date '2024-08-17'),
  ('Men''s Workshop',  date '2024-09-14'),
  ('38th Anniversary', date '2024-10-04'),
  ('Rooftop Live',     date '2025-08-16'),
  ('39th Anniversary', date '2025-10-04')
);

-- 4. Auth identities then accounts (feedback rows referencing them are gone).
delete from auth.identities
where user_id in (select id from auth.users where email like 'dummy%@mypresence.test');

delete from auth.users where email like 'dummy%@mypresence.test';

-- 5. Members last.
delete from public.users where student_id like 'TEST-%';

-- 6. Verify — every line should read 0 / true.
select 'after — feedback' as check_name, count(*) as value
from public.event_feedback f
join public.events e on e.id = f.event_id
where (e.title, e.event_date) in (
  ('Rooftop Live',     date '2024-08-17'),
  ('Men''s Workshop',  date '2024-09-14'),
  ('38th Anniversary', date '2024-10-04'),
  ('Rooftop Live',     date '2025-08-16'),
  ('39th Anniversary', date '2025-10-04')
);

select 'after — attendance' as check_name, count(*) as value from public.attendance where student_id like 'TEST-%';
select 'after — members' as check_name, count(*) as value from public.users where student_id like 'TEST-%';
select 'after — events' as check_name, count(*) as value from public.events where (title, event_date) in (
  ('Rooftop Live',     date '2024-08-17'),
  ('Men''s Workshop',  date '2024-09-14'),
  ('38th Anniversary', date '2024-10-04'),
  ('Rooftop Live',     date '2025-08-16'),
  ('39th Anniversary', date '2025-10-04')
);
select 'after — auth accounts' as check_name, count(*) as value from auth.users where email like 'dummy%@mypresence.test';

commit;
