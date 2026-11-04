-- Connect the admin Verification Center to the mobile app's authoritative
-- public.app_user_verification table.

begin;

do $$
declare
  v_kind "char";
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regclass('public.app_user_verification') is null
     or to_regclass('public.user_verifications') is null
     or to_regclass('public.verification_reviews') is null then
    raise exception 'Required user verification objects are missing.';
  end if;

  select c.relkind
  into v_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'app_user_verification';

  if v_kind not in ('r', 'p', 'v') then
    raise exception 'public.app_user_verification must be a table, partitioned table, or view.';
  end if;
end $$;

-- The view is the read source for the admin tab. The review RPC below remains
-- the only write path.
grant usage on schema public to authenticated;
grant select on public.app_user_verification to authenticated;

create or replace function public.count_user_verifications(p_status text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
begin
  if not public.is_admin() then
    raise exception 'VERIFICATION_ADMIN_REQUIRED';
  end if;

  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'VERIFICATION_STATUS_INVALID';
  end if;

  select count(*)
  into v_count
  from public.app_user_verification v
  where (p_status is null or v.status = p_status);

  return v_count;
end;
$$;

create or replace function public.list_user_verifications(
  p_status text default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 10,
  p_sort_asc boolean default false
)
returns table (
  user_id uuid,
  email character varying,
  first_name text,
  last_name text,
  status text,
  rejection_reason text,
  account_created_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'VERIFICATION_ADMIN_REQUIRED';
  end if;

  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'VERIFICATION_STATUS_INVALID';
  end if;

  if p_offset < 0 or p_limit < 1 or p_limit > 100 then
    raise exception 'VERIFICATION_PAGINATION_INVALID';
  end if;

  return query
  select
    v.user_id,
    v.email,
    v.first_name,
    v.last_name,
    v.status,
    v.rejection_reason,
    v.account_created_at,
    v.submitted_at,
    v.reviewed_at,
    v.reviewed_by,
    count(*) over () as total_count
  from public.app_user_verification v
  where (p_status is null or v.status = p_status)
    and (
      nullif(btrim(coalesce(p_search, '')), '') is null
      or v.email ilike '%' || btrim(p_search) || '%'
      or v.first_name ilike '%' || btrim(p_search) || '%'
      or v.last_name ilike '%' || btrim(p_search) || '%'
    )
  order by
    case when p_sort_asc then v.submitted_at end asc,
    case when not p_sort_asc then v.submitted_at end desc
  offset p_offset
  limit p_limit;
end;
$$;

revoke all on function public.count_user_verifications(text) from public, anon;
revoke all on function public.list_user_verifications(text, text, integer, integer, boolean) from public, anon;
grant execute on function public.count_user_verifications(text) to authenticated;
grant execute on function public.list_user_verifications(text, text, integer, integer, boolean) to authenticated;

create or replace function public.review_user_verification(
  p_user_id uuid,
  p_decision text,
  p_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record_count integer;
begin
  if not public.is_admin() then
    raise exception 'VERIFICATION_ADMIN_REQUIRED';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'VERIFICATION_DECISION_INVALID';
  end if;

  if p_decision = 'rejected' and nullif(btrim(coalesce(p_comments, '')), '') is null then
    raise exception 'VERIFICATION_REJECTION_REASON_REQUIRED';
  end if;

  select count(*)
  into v_record_count
  from public.app_user_verification
  where user_id = p_user_id;

  if v_record_count = 0 then
    raise exception 'VERIFICATION_TARGET_NOT_FOUND';
  end if;

  if v_record_count > 1 then
    raise exception 'USER_VERIFICATION_DUPLICATE';
  end if;

  update public.user_verifications
  set status = p_decision,
      rejection_reason = case
        when p_decision = 'rejected' then nullif(btrim(coalesce(p_comments, '')), '')
        else null
      end,
      reviewed_at = timezone('utc', now()),
      reviewed_by = auth.uid()
  where user_id = p_user_id
    and status = 'pending';

  if not found then
    raise exception 'VERIFICATION_ALREADY_REVIEWED';
  end if;

  insert into public.verification_reviews (
    target_id,
    category,
    component,
    reviewer_id,
    decision,
    comments
  )
  values (
    p_user_id,
    'user',
    'submission',
    auth.uid(),
    p_decision,
    nullif(btrim(coalesce(p_comments, '')), '')
  );
end;
$$;

revoke all on function public.review_user_verification(uuid, text, text) from public, anon;
grant execute on function public.review_user_verification(uuid, text, text) to authenticated;

commit;
