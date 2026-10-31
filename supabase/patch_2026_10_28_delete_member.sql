-- MyPresence member deletion — 2026-10-28
-- Run in the Supabase SQL Editor as the project owner (postgres).
-- Safe to re-run.
-- The function requires a signed-in Supabase Auth session, so test it through
-- the Members page rather than calling it directly from the SQL Editor.

begin;

-- Deletes the selected member and only that member's attendance rows in one
-- transaction. The auth check prevents anonymous callers even if the function
-- is ever exposed through PostgREST.
create or replace function public.delete_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to delete a member.' using errcode = '42501';
  end if;

  select student_id
  into v_student_id
  from public.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  delete from public.attendance
  where student_id = v_student_id;

  delete from public.users
  where id = p_user_id;
end;
$$;

revoke all on function public.delete_member(uuid) from public;
revoke all on function public.delete_member(uuid) from anon;
grant execute on function public.delete_member(uuid) to authenticated;

-- Anonymous callers must not bypass the function with direct table deletes.
-- Signed-in users keep the existing development policies used by Settings reset.
revoke delete on table public.attendance from anon;
revoke delete on table public.users from anon;

notify pgrst, 'reload schema';

commit;
