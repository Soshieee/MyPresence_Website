-- Verification for patch_2026_11_12_auth_lockout.sql and
-- patch_2026_11_13_password_reset_feedback.sql
-- Run these in the Supabase SQL Editor (runs as `postgres`) AFTER applying the
-- patches. Paste each section separately. All probes are transactional (rolled
-- back), so they never leave rows behind and never touch real accounts.

-- =============================================================
-- SECTION 1 - Structure checks (read-only, safe anywhere)
-- =============================================================
begin;

-- 1a. Both tables exist (expect two non-null names)
select to_regclass('public.auth_login_attempts') as attempts_table,
       to_regclass('public.auth_security_events') as events_table;

-- 1b. RLS enabled on both (expect true, true)
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('auth_login_attempts', 'auth_security_events')
order by 1;

-- 1c. All six functions exist (expect 6 rows)
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'auth_email_hash',
    'auth_login_status',
    'auth_login_failure',
    'auth_login_success',
    'auth_admin_unlock',
    'auth_begin_password_reset'
  )
order by 1;

-- 1d. Client roles have NO direct table access (expect false on all four)
select has_table_privilege('anon', 'public.auth_login_attempts', 'select') as anon_read_attempts,
       has_table_privilege('anon', 'public.auth_security_events', 'insert') as anon_write_events,
       has_table_privilege('authenticated', 'public.auth_login_attempts', 'select') as authed_read_attempts,
       has_table_privilege('authenticated', 'public.auth_security_events', 'insert') as authed_write_events;

-- 1e. Dependency: is_admin() exists (expect non-null)
select to_regprocedure('public.is_admin()') as is_admin_fn;

rollback;

-- =============================================================
-- SECTION 2 - Admin guard probe
-- EXPECT: ERROR "AUTH_ADMIN_REQUIRED" (that passing result IS the test),
-- then paste ROLLBACK to close the aborted transaction.
-- =============================================================
begin;
select public.auth_admin_unlock('staging-probe@example.com');
rollback;

-- =============================================================
-- SECTION 3 - Lockout lifecycle probe (rolled back, zero residue)
-- EXPECT in order:
--   status  -> (true, 0, 0)
--   failures 1-4 -> counts 1..4, null locked_until, retry 0
--   failure 5   -> count 5, locked_until set, retry_after ~900
--   status      -> (false, 5, ~8xx)
--   unlock (as service_role) -> true
--   final status -> (true, 0, 0)
-- =============================================================
begin;
select public.auth_login_status('staging-probe@example.com');
select public.auth_login_failure('staging-probe@example.com');
select public.auth_login_failure('staging-probe@example.com');
select public.auth_login_failure('staging-probe@example.com');
select public.auth_login_failure('staging-probe@example.com');
select public.auth_login_failure('staging-probe@example.com');
select public.auth_login_status('staging-probe@example.com');
set local role service_role;
select public.auth_admin_unlock('staging-probe@example.com');
select public.auth_login_status('staging-probe@example.com');
rollback;

-- =============================================================
-- SECTION 4 - Password-reset status probe (rolled back)
-- EXPECT: 'not_found' for an unregistered email (as below).
-- For a verified account, expect 'sent' (replace the address with a real
-- one; no email is sent by this function, and the event row is rolled back).
-- A 4th request within 15 minutes for the same verified account returns
-- 'rate_limited'.
-- =============================================================
begin;
select public.auth_begin_password_reset('staging-probe@example.com');
rollback;
