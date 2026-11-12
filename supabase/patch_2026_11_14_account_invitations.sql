-- MyPresence Account Invitations — 2026-11-14
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run.
--
-- Implements administrator-controlled account provisioning (P6):
--   * Public self-registration is already closed in the app (P0).
--   * Administrators invite accounts through the web console; Supabase Auth
--     sends the invitation email (via the project's custom SMTP — Brevo).
--   * Web accounts are only ever created by an explicit administrator
--     invitation — the invite itself is the trust decision — so the invited
--     account BECOMES AN ADMINISTRATOR upon activation
--     (mark_invitation_accepted inserts into app_admins, idempotent).
--   * The activation page marks the invitation accepted through
--     mark_invitation_accepted().

begin;

create table if not exists public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'canceled')),
  created_at timestamptz not null default now(),
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  canceled_at timestamptz,
  note text
);

comment on table public.account_invitations is
  'Administrator-issued account invitations. Supabase Auth owns the secure
activation links; this table only tracks status. One pending invitation per
email address.';

create unique index if not exists account_invitations_email_pending_idx
  on public.account_invitations (lower(email))
  where status = 'pending';

create index if not exists account_invitations_sent_at_idx
  on public.account_invitations (sent_at desc);

-- ---------------------------------------------------------------------------
-- RLS: administrators can read the list; all writes happen through the
-- trusted server routes (service role), never directly from the browser.
-- ---------------------------------------------------------------------------
alter table public.account_invitations enable row level security;

drop policy if exists account_invitations_admin_select on public.account_invitations;
create policy account_invitations_admin_select
  on public.account_invitations
  for select
  to authenticated
  using (public.is_admin());

revoke insert, update, delete, truncate on public.account_invitations from authenticated;
revoke all on public.account_invitations from anon;

-- ---------------------------------------------------------------------------
-- RPC: the activation page marks its own invitation accepted. Security
-- definer because the table itself is not writable by authenticated roles.
-- ---------------------------------------------------------------------------
create or replace function public.mark_invitation_accepted()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  update public.account_invitations
    set status = 'accepted',
        accepted_at = now()
  where lower(email) = lower(v_email)
    and status = 'pending';

  -- Invited accounts are issued by administrators, so activation grants
  -- administrator access (the invite itself was the trust decision).
  insert into public.app_admins (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.mark_invitation_accepted() from public;
revoke all on function public.mark_invitation_accepted() from anon;
grant execute on function public.mark_invitation_accepted() to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verification (run after applying):
-- select * from public.account_invitations;
-- select proname from pg_proc where proname = 'mark_invitation_accepted';
