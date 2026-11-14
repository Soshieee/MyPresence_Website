-- MyPresence — dummy attendance seed, Aug–Oct 2024 and Aug–Oct 2025 (2026-11-14)
-- Run in the Supabase SQL Editor as the project owner (postgres). Safe to re-run.
-- Rollback: supabase/rollback_2026_11_14_dummy_attendance_aug_oct.sql
--
-- What it creates (all clearly marked, removable in one rollback run):
--   • 260 dummy members: student_id TEST-0001…TEST-0260, full_name "Test <First> <Last>",
--     created 2024-07-01 (eligible for every occasion), active, not newcomers.
--     The first 40 (all male) also get auth.accounts (dummy01…dummy40@mypresence.test,
--     password DummyPass!2024 — never signed in) to serve as event-feedback respondents
--     (event_feedback.user_id resolves against auth.users).
--   • 5 events (event_type NOT NULL per the 2026-10-24 guard):
--       Rooftop Live        2024-08-17  (Rooftop)   attendance context 'Rooftop'
--       Men's Workshop      2024-09-14  (General)   attendance context 'Men's Network'
--       38th Anniversary    2024-10-04  (General)   attendance context 'Sunday Service'
--       Rooftop Live        2025-08-16  (Rooftop)   attendance context 'Rooftop'
--       39th Anniversary    2025-10-04  (General)   attendance context 'Sunday Service'
--   • 4,695 attendance rows with the story below (curated, not random):
--       Aug 2024  Sundays 102/98/105/**134** (rise after Rooftop Live), prayers 38/41/36/44,
--                 Men's 24, Women's 28, Rooftop Live 88 — feedback GOOD (~4.77★, 30 responses)
--       Aug 2025  Sundays 108/112/104/**86** (drop after Rooftop Live), prayers 42/45/39/47,
--                 Men's 26, Women's 30, Rooftop Live 92 — feedback BAD (1.50★, 28 responses)
--       Sep 2024  Sundays 105/110/110/114, prayers 37/40/39/42, Men's **41** (rise after
--                 the Sep 14 Men's Workshop, 75), Women's 27 — no feedback on the workshop
--       Sep 2025  Sundays 102/106/106/109, prayers 44/41/46/43, Men's **22** (below 2024), Women's 29
--       Oct 2024  38th Anniversary **208 = month peak** (Fri Oct 4, First 114 / Second 94),
--                 Sundays 112/116/**152** (rise after the anniversary)/126, prayers 40/43/46/38,
--                 Men's 26, Women's 30 — feedback GOOD (4.75★, 32 responses)
--       Oct 2025  39th Anniversary **196 = month peak** (Sat Oct 4, First 108 / Second 88),
--                 Sundays 114/108/**132** (smaller rise than 2024)/119, prayers 46/43/47/41,
--                 Men's 24, Women's 31 — feedback MID (3.20★, 30 responses, below 2024)
--   • Sundays are First Service / Second Service splits (~55/45); one member per Sunday date
--     (the partial unique index allows only one Sunday Service row per member per date).
--   • No comments on any feedback row (comment = '').
--
-- Attendance generation is deterministic (hashtext scoring with a per-member faithfulness
-- factor), so re-runs produce the exact same rows and the guard triggers never fire.

begin;

-- ---------------------------------------------------------------------------
-- 1. Dummy members (260) — the first 40 (all male) get explicit ids so the
--    matching auth.accounts below can mirror them one-to-one.
--    Males are TEST-0001…TEST-0130, females TEST-0131…TEST-0260.
-- ---------------------------------------------------------------------------
insert into public.users (id, student_id, full_name, age, gender, newcomer, is_active, descriptor, created_at)
select
  ('00000000-0000-4000-8000-' || lpad((100000000000 + s.g)::text, 12, '0'))::uuid,
  s.sid,
  d.full_name,
  s.age,
  d.gender,
  false,
  true,
  d.descr,
  make_timestamptz(2024, 7, 1, 9, 0, 0, 'Asia/Singapore')
from (
  select g,
         'TEST-' || lpad(g::text, 4, '0') as sid,
         (array['Alex','Caleb','Elijah','Gabriel','Isaac','Kaleb','Micah','Obadiah','Quincy','Samuel','Uriel','Wesley','Zachary'])[((g - 1) % 13) + 1] as first_part,
         (array['Tan','Lim','Wong','Ng','Chan','Koh','Lee','Teo','Goh','Chua'])[((g - 1) / 13) + 1] as last_part,
         18 + ((g * 7) % 53) as age
  from generate_series(1, 40) g
) s
cross join lateral (
  select 'Test ' || s.first_part || ' ' || s.last_part as full_name,
         case when s.g <= 130 then 'Male' else 'Female' end as gender,
         jsonb_agg(
           (((((('x' || substr(md5(s.sid || ':' || i::text), 1, 8))::bit(32)::int % 2000) + 2000) % 2000) - 1000)::numeric / 1000)
           order by i
         ) as descr
  from generate_series(1, 128) i
) d
on conflict (student_id) do nothing;

insert into public.users (student_id, full_name, age, gender, newcomer, is_active, descriptor, created_at)
select
  s.sid,
  'Test ' || s.first_part || ' ' || s.last_part as full_name,
  s.age,
  case when s.g <= 130 then 'Male' else 'Female' end as gender,
  false,
  true,
  d.descr,
  make_timestamptz(2024, 7, 1, 9, 0, 0, 'Asia/Singapore')
from (
  select g,
         'TEST-' || lpad(g::text, 4, '0') as sid,
         case
           when g <= 130 then (array['Alex','Caleb','Elijah','Gabriel','Isaac','Kaleb','Micah','Obadiah','Quincy','Samuel','Uriel','Wesley','Zachary'])[((g - 1) % 13) + 1]
           else (array['Betty','Damaris','Faith','Hannah','Jemima','Lydia','Naomi','Priscilla','Rachel','Tabitha','Vanessa','Xandria','Yohanna'])[((g - 131) % 13) + 1]
         end as first_part,
         (array['Tan','Lim','Wong','Ng','Chan','Koh','Lee','Teo','Goh','Chua'])[(((g - 1) % 130) / 13) + 1] as last_part,
         18 + ((g * 7) % 53) as age
  from generate_series(41, 260) g
) s
cross join lateral (
  select jsonb_agg(
           (((((('x' || substr(md5(s.sid || ':' || i::text), 1, 8))::bit(32)::int % 2000) + 2000) % 2000) - 1000)::numeric / 1000)
           order by i
         ) as descr
  from generate_series(1, 128) i
) d
on conflict (student_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Auth accounts for the 40 feedback respondents (male TEST-0001…TEST-0040).
-- ---------------------------------------------------------------------------
create temp table seed_auth_pool on commit drop as
select id, student_id, full_name, row_number() over (order by student_id) as seq
from (
  select id, student_id, full_name
  from public.users
  where student_id like 'TEST-%' and gender = 'Male'
  order by student_id
  limit 40
) t;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  p.id,
  'authenticated',
  'authenticated',
  'dummy' || lpad(p.seq::text, 2, '0') || '@mypresence.test',
  extensions.crypt('DummyPass!2024', extensions.gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('dummy', true, 'full_name', p.full_name),
  '', '', '', ''
from seed_auth_pool p
on conflict do nothing;

insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(),
  p.id,
  jsonb_build_object(
    'sub', p.id::text,
    'email', 'dummy' || lpad(p.seq::text, 2, '0') || '@mypresence.test',
    'email_verified', true
  ),
  'email',
  p.id::text,
  null,
  now(),
  now()
from seed_auth_pool p
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Events (guard requires a non-null event_type from the allowed list).
-- ---------------------------------------------------------------------------
insert into public.events (title, details, event_date, location, event_type)
select v.title, v.details, v.event_date, v.location, v.event_type
from (values
  ('Rooftop Live',     'Rooftop Live — worship night on the church rooftop.', date '2024-08-17', 'Church Rooftop', 'Rooftop'),
  ('Men''s Workshop',  'Men''s Workshop — practical teaching and hands-on sessions.', date '2024-09-14', 'Main Hall', 'General'),
  ('38th Anniversary', 'Celebrating 38 years of God''s faithfulness.', date '2024-10-04', 'Main Sanctuary', 'General'),
  ('Rooftop Live',     'Rooftop Live — worship night on the church rooftop.', date '2025-08-16', 'Church Rooftop', 'Rooftop'),
  ('39th Anniversary', 'Celebrating 39 years of God''s faithfulness.', date '2025-10-04', 'Main Sanctuary', 'General')
) as v(title, details, event_date, location, event_type)
where not exists (
  select 1 from public.events e
  where e.title = v.title and e.event_date = v.event_date
);

create temp table seed_events on commit drop as
select e.id, case
  when e.title = 'Rooftop Live'     and e.event_date = date '2024-08-17' then 'rooftop2024'
  when e.title = 'Men''s Workshop'  and e.event_date = date '2024-09-14' then 'workshop2024'
  when e.title = '38th Anniversary' and e.event_date = date '2024-10-04' then 'anniv2024'
  when e.title = 'Rooftop Live'     and e.event_date = date '2025-08-16' then 'rooftop2025'
  when e.title = '39th Anniversary' and e.event_date = date '2025-10-04' then 'anniv2025'
end as event_key
from public.events e
where (e.title, e.event_date) in (
  ('Rooftop Live',     date '2024-08-17'),
  ('Men''s Workshop',  date '2024-09-14'),
  ('38th Anniversary', date '2024-10-04'),
  ('Rooftop Live',     date '2025-08-16'),
  ('39th Anniversary', date '2025-10-04')
);

-- ---------------------------------------------------------------------------
-- 4. Occasion definitions (curated headcounts).
--    seed_single: one session per occasion (prayers, networks, Rooftop Live).
--    seed_sunday: Sunday Service dates — First/Second split, anniversaries included.
-- ---------------------------------------------------------------------------
create temp table seed_single on commit drop as
-- Rooftop Live events (context 'Rooftop' per the event-type guard)
select 'rooftop-2024'::text as occ_key, date '2024-08-17' as odate, 'Rooftop'::text as context, 'Rooftop'::text as grp,
       ev.id as event_id, 19::int as hh, 0::int as mm, null::text as gender_filter, 88::int as headcount
from seed_events ev where ev.event_key = 'rooftop2024'
union all
select 'rooftop-2025', date '2025-08-16', 'Rooftop', 'Rooftop',
       ev.id, 19, 0, null, 92
from seed_events ev where ev.event_key = 'rooftop2025'
union all
-- Men's Workshop (context 'Men's Network', event_type General satisfies the guard)
select 'workshop-2024', date '2024-09-14', 'Men''s Network', 'Men''s Network',
       ev.id, 14, 0, 'Male', 75
from seed_events ev where ev.event_key = 'workshop2024'
union all
-- Prayer meetings — Aug/Sep/Oct 2024
select 'pray-2024-08-08',  date '2024-08-08', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 38
union all select 'pray-2024-08-15', date '2024-08-15', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 41
union all select 'pray-2024-08-22', date '2024-08-22', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 36
union all select 'pray-2024-08-29', date '2024-08-29', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 44
union all select 'pray-2024-09-05', date '2024-09-05', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 37
union all select 'pray-2024-09-12', date '2024-09-12', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 40
union all select 'pray-2024-09-19', date '2024-09-19', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 39
union all select 'pray-2024-09-26', date '2024-09-26', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 42
union all select 'pray-2024-10-10', date '2024-10-10', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 40
union all select 'pray-2024-10-17', date '2024-10-17', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 43
union all select 'pray-2024-10-24', date '2024-10-24', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 46
union all select 'pray-2024-10-31', date '2024-10-31', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 38
union all
-- Prayer meetings — Aug/Sep/Oct 2025
select 'pray-2025-08-07',  date '2025-08-07', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 42
union all select 'pray-2025-08-14', date '2025-08-14', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 45
union all select 'pray-2025-08-21', date '2025-08-21', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 39
union all select 'pray-2025-08-28', date '2025-08-28', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 47
union all select 'pray-2025-09-04', date '2025-09-04', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 44
union all select 'pray-2025-09-11', date '2025-09-11', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 41
union all select 'pray-2025-09-18', date '2025-09-18', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 46
union all select 'pray-2025-09-25', date '2025-09-25', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 43
union all select 'pray-2025-10-09', date '2025-10-09', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 46
union all select 'pray-2025-10-16', date '2025-10-16', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 43
union all select 'pray-2025-10-23', date '2025-10-23', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 47
union all select 'pray-2025-10-30', date '2025-10-30', 'Prayer Meeting', 'Prayer Meeting', null::uuid, 19, 30, null, 41
union all
-- Networks — 2024
select 'men-2024-08-09',   date '2024-08-09', 'Men''s Network', 'Men''s Network', null::uuid, 19, 30, 'Male', 24
union all select 'women-2024-08-23', date '2024-08-23', 'Women''s Network', 'Women''s Network', null::uuid, 19, 30, 'Female', 28
union all select 'men-2024-09-20',   date '2024-09-20', 'Men''s Network', 'Men''s Network', null::uuid, 19, 30, 'Male', 41
union all select 'women-2024-09-27', date '2024-09-27', 'Women''s Network', 'Women''s Network', null::uuid, 19, 30, 'Female', 27
union all select 'men-2024-10-11',   date '2024-10-11', 'Men''s Network', 'Men''s Network', null::uuid, 19, 30, 'Male', 26
union all select 'women-2024-10-25', date '2024-10-25', 'Women''s Network', 'Women''s Network', null::uuid, 19, 30, 'Female', 30
union all
-- Networks — 2025
select 'men-2025-08-08',   date '2025-08-08', 'Men''s Network', 'Men''s Network', null::uuid, 19, 30, 'Male', 26
union all select 'women-2025-08-22', date '2025-08-22', 'Women''s Network', 'Women''s Network', null::uuid, 19, 30, 'Female', 30
union all select 'men-2025-09-19',   date '2025-09-19', 'Men''s Network', 'Men''s Network', null::uuid, 19, 30, 'Male', 22
union all select 'women-2025-09-26', date '2025-09-26', 'Women''s Network', 'Women''s Network', null::uuid, 19, 30, 'Female', 29
union all select 'men-2025-10-10',   date '2025-10-10', 'Men''s Network', 'Men''s Network', null::uuid, 19, 30, 'Male', 24
union all select 'women-2025-10-24', date '2025-10-24', 'Women''s Network', 'Women''s Network', null::uuid, 19, 30, 'Female', 31;

create temp table seed_sunday on commit drop as
-- Regular Sundays 2024
select 'sun-2024-08-04'::text as occ_key, date '2024-08-04' as odate, null::uuid as event_id, 56::int as first_n, 46::int as second_n
union all select 'sun-2024-08-11', date '2024-08-11', null::uuid, 54, 44
union all select 'sun-2024-08-18', date '2024-08-18', null::uuid, 58, 47
union all select 'sun-2024-08-25', date '2024-08-25', null::uuid, 74, 60
union all select 'sun-2024-09-08', date '2024-09-08', null::uuid, 58, 47
union all select 'sun-2024-09-15', date '2024-09-15', null::uuid, 61, 49
union all select 'sun-2024-09-22', date '2024-09-22', null::uuid, 61, 49
union all select 'sun-2024-09-29', date '2024-09-29', null::uuid, 63, 51
union all select 'sun-2024-10-06', date '2024-10-06', null::uuid, 62, 50
union all select 'sun-2024-10-13', date '2024-10-13', null::uuid, 64, 52
union all select 'sun-2024-10-20', date '2024-10-20', null::uuid, 84, 68
union all select 'sun-2024-10-27', date '2024-10-27', null::uuid, 69, 57
union all
-- Regular Sundays 2025
select 'sun-2025-08-03', date '2025-08-03', null::uuid, 59, 49
union all select 'sun-2025-08-10', date '2025-08-10', null::uuid, 62, 50
union all select 'sun-2025-08-17', date '2025-08-17', null::uuid, 57, 47
union all select 'sun-2025-08-24', date '2025-08-24', null::uuid, 47, 39
union all select 'sun-2025-09-07', date '2025-09-07', null::uuid, 56, 46
union all select 'sun-2025-09-14', date '2025-09-14', null::uuid, 58, 48
union all select 'sun-2025-09-21', date '2025-09-21', null::uuid, 58, 48
union all select 'sun-2025-09-28', date '2025-09-28', null::uuid, 60, 49
union all select 'sun-2025-10-05', date '2025-10-05', null::uuid, 63, 51
union all select 'sun-2025-10-12', date '2025-10-12', null::uuid, 59, 49
union all select 'sun-2025-10-19', date '2025-10-19', null::uuid, 73, 59
union all select 'sun-2025-10-26', date '2025-10-26', null::uuid, 65, 54
union all
-- Anniversaries (linked to their events, month peaks)
select 'anniv-2024-10-04', date '2024-10-04', ev.id, 114, 94
from seed_events ev where ev.event_key = 'anniv2024'
union all
select 'anniv-2025-10-04', date '2025-10-04', ev.id, 108, 88
from seed_events ev where ev.event_key = 'anniv2025';

-- ---------------------------------------------------------------------------
-- 5. Attendance rows. Deterministic selection: hash noise minus a per-member
--    faithfulness bonus; members TEST-0001…TEST-0040 are forced into every
--    EVENT (they are the feedback respondents — they must have attended).
-- ---------------------------------------------------------------------------
insert into public.attendance (student_id, full_name, was_newcomer, attendance_context, attendance_group, service_type, event_id, attended_date, attended_at)
select
  p.student_id,
  p.full_name,
  false,
  p.context,
  p.grp,
  null,
  p.event_id,
  p.odate,
  make_timestamptz(extract(year from p.odate)::int, extract(month from p.odate)::int, extract(day from p.odate)::int, p.hh, p.mm, 0, 'Asia/Singapore')
from (
  select
    o.occ_key, o.odate, o.context, o.grp, o.event_id, o.hh, o.mm, o.headcount,
    u.student_id, u.full_name,
    row_number() over (partition by o.occ_key order by
      case
        when o.event_id is not null and u.student_id <= 'TEST-0040' then -1000::numeric
        else (((hashtext(u.student_id || ':' || o.occ_key)::int % 1000) + 1000) % 1000)::numeric / 10
             - (40 - (((hashtext(u.student_id || 'faith')::int % 100) + 100) % 100)::numeric / 2.5)
      end
    ) as rn
  from seed_single o
  join public.users u
    on u.student_id like 'TEST-%'
   and (o.gender_filter is null or u.gender = o.gender_filter)
) p
where p.rn <= p.headcount
  and not exists (
    select 1 from public.attendance a
    where a.student_id = p.student_id
      and a.attended_date = p.odate
      and a.attendance_context = p.context
      and a.attendance_group is not distinct from p.grp
  );

insert into public.attendance (student_id, full_name, was_newcomer, attendance_context, attendance_group, service_type, event_id, attended_date, attended_at)
select
  p.student_id,
  p.full_name,
  false,
  'Sunday Service',
  case when p.rn <= p.first_n then 'First Service' else 'Second Service' end,
  case when p.rn <= p.first_n then 'First Service' else 'Second Service' end,
  p.event_id,
  p.odate,
  make_timestamptz(extract(year from p.odate)::int, extract(month from p.odate)::int, extract(day from p.odate)::int,
                   case when p.rn <= p.first_n then 9 else 11 end,
                   case when p.rn <= p.first_n then 0 else 30 end, 0, 'Asia/Singapore')
from (
  select
    o.occ_key, o.odate, o.first_n, (o.first_n + o.second_n) as total, o.event_id,
    u.student_id, u.full_name,
    row_number() over (partition by o.occ_key order by
      case
        when o.event_id is not null and u.student_id <= 'TEST-0040' then -1000::numeric
        else (((hashtext(u.student_id || ':' || o.occ_key)::int % 1000) + 1000) % 1000)::numeric / 10
             - (40 - (((hashtext(u.student_id || 'faith')::int % 100) + 100) % 100)::numeric / 2.5)
      end
    ) as rn
  from seed_sunday o
  join public.users u on u.student_id like 'TEST-%'
) p
where p.rn <= p.total
  and not exists (
    select 1 from public.attendance a
    where a.student_id = p.student_id
      and a.attended_date = p.odate
      and a.attendance_context = 'Sunday Service'
  );

-- ---------------------------------------------------------------------------
-- 6. Feedback for the four feedback events (overall 1–5; categories mirror the
--    overall rating, null on every 9th response as N/A; comment always '').
--    The Men's Workshop intentionally has NO feedback — it exercises the
--    "No feedback recorded" state in the Events tab.
--
--    The prepare_event_feedback() trigger rejects inserts made while nobody is
--    signed in (auth.uid() is null in the SQL Editor), so every insert below is
--    made "as" its respondent by spoofing that user's JWT claims — the same
--    context the trigger sees when a real user submits from the app.
--    It also enforces a feedback window, which backdated 2024/2025 events fail;
--    user triggers on the table are therefore disabled just for these inserts
--    and re-enabled immediately after (FK triggers stay active throughout).
-- ---------------------------------------------------------------------------
create temp table seed_feedback on commit drop as
select 'rooftop2024'::text as event_key, 'good'::text as mood, 30::int as k
union all select 'rooftop2025', 'bad', 28
union all select 'anniv2024',   'good', 32
union all select 'anniv2025',   'mid',  30;

create temp table seed_feedback_rows on commit drop as
select
  ev.id as event_id,
  m.id as user_id,
  m.ov,
  (m.rn % 9 = 0) as cat_null
from (
  select
    f.event_key,
    p.id, p.rn,
    case f.mood
      when 'good' then case when p.rn % 4 = 0 then 4 else 5 end
      when 'bad'  then case when p.rn % 2 = 0 then 2 else 1 end
      else             case when p.rn % 5 = 0 then 2 when p.rn % 2 = 0 then 4 else 3 end
    end as ov
  from seed_feedback f
  join (
    select pool.id, pool.student_id, fb.event_key,
           row_number() over (partition by fb.event_key order by hashtext(pool.student_id || ':' || fb.event_key)) as rn
    from seed_auth_pool pool
    cross join (select event_key from seed_feedback) fb
  ) p on p.event_key = f.event_key
  where p.rn <= f.k
) m
join seed_events ev on ev.event_key = m.event_key;

alter table public.event_feedback disable trigger user;

do $seed_feedback_as_users$
declare
  r record;
begin
  for r in
    select distinct user_id from seed_feedback_rows order by user_id
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'authenticated', 'sub', r.user_id::text)::text,
      true
    );

    insert into public.event_feedback
      (event_id, user_id, overall_rating, food_rating, venue_rating, music_rating, program_rating, staff_rating, speaker_rating, comment)
    select
      s.event_id,
      s.user_id,
      s.ov, s.ov, s.ov, s.ov, s.ov, s.ov,
      case when s.cat_null then null else s.ov end,
      ''
    from seed_feedback_rows s
    where s.user_id = r.user_id
      and not exists (
        select 1 from public.event_feedback x
        where x.event_id = s.event_id and x.user_id = s.user_id
      );
  end loop;

  perform set_config('request.jwt.claims', '', true);
end
$seed_feedback_as_users$;

alter table public.event_feedback enable trigger user;

-- ---------------------------------------------------------------------------
-- 7. Verify — every line should read OK / true. Compare against the numbers
--    in the header comment.
-- ---------------------------------------------------------------------------
select 'single occasions' as section, o.occ_key, o.odate::text as date, o.context,
       o.headcount as expected, count(a.id) as actual,
       case when count(a.id) = o.headcount then 'OK' else 'MISMATCH' end as status
from seed_single o
left join public.attendance a
  on a.student_id like 'TEST-%'
 and a.attended_date = o.odate
 and a.attendance_context = o.context
group by 1, 2, 3, 4, 5
order by 3, 2;

select 'sundays' as section, o.odate::text as date,
       o.first_n as expected_first, count(a.id) filter (where a.attendance_group = 'First Service') as actual_first,
       o.second_n as expected_second, count(a.id) filter (where a.attendance_group = 'Second Service') as actual_second,
       case when count(a.id) filter (where a.attendance_group = 'First Service') = o.first_n
             and count(a.id) filter (where a.attendance_group = 'Second Service') = o.second_n
            then 'OK' else 'MISMATCH' end as status
from seed_sunday o
left join public.attendance a
  on a.student_id like 'TEST-%'
 and a.attended_date = o.odate
 and a.attendance_context = 'Sunday Service'
group by 1, 2, 3, 5
order by 2;

select 'feedback' as section, ev.event_key, f.k as expected_responses, count(x.id) as actual_responses,
       round(avg(x.overall_rating)::numeric, 2) as avg_overall
from seed_feedback f
join seed_events ev on ev.event_key = f.event_key
left join public.event_feedback x on x.event_id = ev.id
group by 1, 2, 3
order by 2;

select 'members (expect 260)' as section, count(*) as value from public.users where student_id like 'TEST-%';
select 'auth accounts (expect 40)' as section, count(*) as value from auth.users where email like 'dummy%@mypresence.test';
select 'attendance rows' as section, count(*) as value from public.attendance where student_id like 'TEST-%';

commit;
