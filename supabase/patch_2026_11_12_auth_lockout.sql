-- Server-side login lockout, admin unlock, and password-reset existence checks.
-- Run after patch_2026_11_11_account_registration.sql.
-- This migration creates new security tables/functions only. It does not alter
-- or delete existing application data.

begin;

create extension if not exists pgcrypto with schema extensions;

-- One row per normalized email hash. The raw email is never stored here.
create table if not exists public.auth_login_attempts (
  email_hash text primary key,
  failed_count integer not null default 0
    check (failed_count >= 0 and failed_count <= 100),
  locked_until timestamptz,
  last_failed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit/rate-limit records. No raw email, password, or IP address is stored.
create table if not exists public.auth_security_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  email_hash text,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists auth_login_attempts_updated_idx
  on public.auth_login_attempts (updated_at);

create index if not exists auth_security_events_email_created_idx
  on public.auth_security_events (email_hash, created_at desc);

create index if not exists auth_security_events_type_created_idx
  on public.auth_security_events (event_type, created_at desc);

alter table public.auth_login_attempts enable row level security;
alter table public.auth_security_events enable row level security;

-- No policies are intentionally created. Only security-definer functions and
-- the service role can access these tables.
revoke all on table public.auth_login_attempts from public, anon, authenticated;
revoke all on table public.auth_security_events from public, anon, authenticated;

grant select, insert, update, delete on table public.auth_login_attempts to service_role;
grant select, insert on table public.auth_security_events to service_role;
grant usage, select on sequence public.auth_security_events_id_seq to service_role;

-- Normalize once so every function hashes the same representation.
create or replace function public.auth_email_hash(p_email text)
returns text
language sql
immutable
set search_path = extensions, public, pg_temp
as $$
  select encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex');
$$;

revoke all on function public.auth_email_hash(text) from public, anon, authenticated;

create or replace function public.auth_login_status(p_email text)
returns table (
  out_allowed boolean,
  out_failed_count integer,
  out_retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text := public.auth_email_hash(p_email);
  v_row public.auth_login_attempts%rowtype;
begin
  -- Opportunistic cleanup. This only removes old lockout records, never member
  -- or attendance records.
  delete from public.auth_login_attempts
  where updated_at < now() - interval '30 days'
    and (locked_until is null or locked_until <= now());

  select *
  into v_row
  from public.auth_login_attempts
  where email_hash = v_hash
  for update;

  if not found then
    return query select true, 0, 0;
    return;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return query
    select
      false,
      v_row.failed_count,
      greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::integer);
    return;
  end if;

  -- Expired lockouts restore access and reset the consecutive-failure count.
  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update public.auth_login_attempts
    set failed_count = 0,
        locked_until = null,
        updated_at = now()
    where email_hash = v_hash;

    return query select true, 0, 0;
    return;
  end if;

  return query select true, v_row.failed_count, 0;
end;
$$;

revoke all on function public.auth_login_status(text) from public, anon, authenticated;
grant execute on function public.auth_login_status(text) to service_role;

create or replace function public.auth_login_failure(p_email text)
returns table (
  out_failed_count integer,
  out_locked_until timestamptz,
  out_retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text := public.auth_email_hash(p_email);
  v_count integer;
  v_locked_until timestamptz;
begin
  insert into public.auth_login_attempts (
    email_hash,
    failed_count,
    last_failed_at,
    created_at,
    updated_at
  )
  values (v_hash, 1, now(), now(), now())
  on conflict (email_hash) do update
  set failed_count = case
        when auth_login_attempts.locked_until is not null
             and auth_login_attempts.locked_until > now()
          then auth_login_attempts.failed_count
        when auth_login_attempts.locked_until is not null
             and auth_login_attempts.locked_until <= now()
          then 1
        else least(auth_login_attempts.failed_count + 1, 100)
      end,
      locked_until = case
        when auth_login_attempts.locked_until is not null
             and auth_login_attempts.locked_until <= now()
          then null
        else auth_login_attempts.locked_until
      end,
      last_failed_at = now(),
      updated_at = now()
  returning failed_count, locked_until
  into v_count, v_locked_until;

  -- A lockout is never extended while it is still active.
  if v_count >= 5 and (v_locked_until is null or v_locked_until <= now()) then
    update public.auth_login_attempts
    set failed_count = greatest(v_count, 5),
        locked_until = now() + interval '15 minutes',
        updated_at = now()
    where email_hash = v_hash
    returning failed_count, locked_until
    into v_count, v_locked_until;

    insert into public.auth_security_events (event_type, email_hash)
    values ('login_lockout', v_hash);
  end if;

  -- Keep security event records bounded without touching application data.
  delete from public.auth_security_events
  where created_at < now() - interval '90 days';

  return query
  select
    v_count,
    v_locked_until,
    case
      when v_locked_until is not null and v_locked_until > now()
        then greatest(1, ceil(extract(epoch from (v_locked_until - now())))::integer)
      else 0
    end;
end;
$$;

revoke all on function public.auth_login_failure(text) from public, anon, authenticated;
grant execute on function public.auth_login_failure(text) to service_role;

create or replace function public.auth_login_success(p_email text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.auth_login_attempts
  where email_hash = public.auth_email_hash(p_email);
end;
$$;

revoke all on function public.auth_login_success(text) from public, anon, authenticated;
grant execute on function public.auth_login_success(text) to service_role;

create or replace function public.auth_admin_unlock(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text := public.auth_email_hash(p_email);
  v_deleted integer := 0;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'AUTH_ADMIN_REQUIRED';
  end if;

  delete from public.auth_login_attempts
  where email_hash = v_hash;

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    insert into public.auth_security_events (event_type, email_hash, actor_id)
    values ('admin_unlock', v_hash, auth.uid());
  end if;

  return v_deleted > 0;
end;
$$;

revoke all on function public.auth_admin_unlock(text) from public, anon;
grant execute on function public.auth_admin_unlock(text) to authenticated, service_role;

-- Returns true only when the email exists and the request is within the
-- per-email reset window. The HTTP route always returns the same generic reply.
create or replace function public.auth_begin_password_reset(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash text := public.auth_email_hash(p_email);
  v_exists boolean;
  v_requests integer;
begin
  select exists (
    select 1
    from auth.users
    where lower(email) = v_email
  )
  into v_exists;

  if not v_exists then
    return false;
  end if;

  select count(*)
  into v_requests
  from public.auth_security_events
  where event_type = 'password_reset_requested'
    and email_hash = v_hash
    and created_at > now() - interval '15 minutes';

  if v_requests >= 3 then
    return false;
  end if;

  insert into public.auth_security_events (event_type, email_hash)
  values ('password_reset_requested', v_hash);

  delete from public.auth_security_events
  where created_at < now() - interval '90 days';

  return true;
end;
$$;

revoke all on function public.auth_begin_password_reset(text) from public, anon, authenticated;
grant execute on function public.auth_begin_password_reset(text) to service_role;

commit;
