-- MyPresence — interim admin-account helper (2026-11-14)
-- Run in Supabase SQL Editor as the project owner (postgres).
--
-- Simplifies adding administrator accounts until the administrator-controlled
-- invitation feature (P6) replaces it. Workflow:
--   1. Supabase Dashboard -> Authentication -> Users -> "Add user"
--      (set a temporary password, tick "Auto Confirm User")
--   2. Run:  select public.add_admin_account('email@example.com', 'First', 'Last');
--   3. The new admin signs in at /login with the password you set.
--
-- SECURITY: this function is intentionally NOT callable by app users
-- (revokes below). Only the dashboard SQL editor (postgres) can run it.

create or replace function public.add_admin_account(
  p_email text,
  p_first_name text,
  p_last_name text
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(p_email));
begin
  if coalesce(v_email, '') = '' then
    raise exception 'Email is required.';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if not found then
    raise exception 'No account found for %. Create it first: Authentication -> Users -> Add user (tick Auto Confirm).', v_email;
  end if;

  if exists (select 1 from auth.users where id = v_user_id and email_confirmed_at is null) then
    raise exception 'The email for this account is not confirmed yet. Confirm it in Authentication -> Users first.';
  end if;

  insert into public.profiles (id, first_name, last_name, updated_at)
  values (v_user_id, p_first_name, p_last_name, now())
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name  = excluded.last_name,
        updated_at = now();

  insert into public.app_admins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  return format('%s (%s) is now an administrator.', v_email, v_user_id);
end;
$$;

revoke all on function public.add_admin_account(text, text, text) from public;
revoke all on function public.add_admin_account(text, text, text) from anon;
revoke all on function public.add_admin_account(text, text, text) from authenticated;
