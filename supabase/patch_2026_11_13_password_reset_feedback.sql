-- Password reset: confirmed accounts only, with explicit status feedback.
-- Run after patch_2026_11_12_auth_lockout.sql.
-- Changes auth_begin_password_reset from a boolean to a status string so the
-- login page can show precise messages:
--   'sent'        -> account exists (verified) and is within the rate limit
--   'not_found'   -> no verified account for that email
--   'rate_limited'-> verified account, but 3+ requests in the last 15 minutes
-- Creates/modifies security functions only. It does not alter or delete
-- existing application data.

begin;

-- The return type changes (boolean -> text), so the function must be dropped
-- before it can be recreated. Nothing else depends on it.
drop function if exists public.auth_begin_password_reset(text);

create or replace function public.auth_begin_password_reset(p_email text)
returns text
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
  -- Only verified accounts may receive a reset email. Unverified signups must
  -- use the verification-code resend flow instead.
  select exists (
    select 1
    from auth.users
    where lower(email) = v_email
      and email_confirmed_at is not null
  )
  into v_exists;

  if not v_exists then
    return 'not_found';
  end if;

  select count(*)
  into v_requests
  from public.auth_security_events
  where event_type = 'password_reset_requested'
    and email_hash = v_hash
    and created_at > now() - interval '15 minutes';

  if v_requests >= 3 then
    return 'rate_limited';
  end if;

  insert into public.auth_security_events (event_type, email_hash)
  values ('password_reset_requested', v_hash);

  delete from public.auth_security_events
  where created_at < now() - interval '90 days';

  return 'sent';
end;
$$;

revoke all on function public.auth_begin_password_reset(text) from public, anon, authenticated;
grant execute on function public.auth_begin_password_reset(text) to service_role;

commit;
