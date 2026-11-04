-- Add backward-compatible account classification and secure Web Admin approval.
-- Run after the existing user verification migrations.

begin;

alter table public.user_verifications
  add column if not exists account_type text;

alter table public.user_verifications
  drop constraint if exists user_verifications_account_type_check;

alter table public.user_verifications
  add constraint user_verifications_account_type_check
  check (account_type is null or account_type in ('regular_user', 'web_admin'));

create index if not exists user_verifications_account_type_idx
  on public.user_verifications (account_type, status, created_at desc);

-- Keep the existing view columns and append account_type. Null historical values
-- are exposed as regular-user applications without rewriting the source rows.
create or replace view public.app_user_verification as
select
  uv.user_id,
  au.email,
  p.first_name,
  p.last_name,
  uv.status,
  uv.rejection_reason,
  au.created_at as account_created_at,
  uv.created_at as submitted_at,
  uv.reviewed_at,
  uv.reviewed_by,
  coalesce(uv.account_type, 'regular_user') as account_type
from public.user_verifications uv
join auth.users au on au.id = uv.user_id
left join public.profiles p on p.id = uv.user_id;

grant usage on schema public to authenticated;
grant select on public.app_user_verification to authenticated;

drop function if exists public.list_user_verifications_v2(text, text, integer, integer, boolean, text);

create function public.list_user_verifications_v2(
  p_status text default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 10,
  p_sort_asc boolean default false,
  p_account_type text default null
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
  account_type text,
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

  if p_account_type is not null and p_account_type not in ('regular_user', 'web_admin') then
    raise exception 'VERIFICATION_ACCOUNT_TYPE_INVALID';
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
    v.account_type,
    count(*) over () as total_count
  from public.app_user_verification v
  where (p_status is null or v.status = p_status)
    and (p_account_type is null or v.account_type = p_account_type)
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

revoke all on function public.list_user_verifications_v2(text, text, integer, integer, boolean, text) from public, anon;
grant execute on function public.list_user_verifications_v2(text, text, integer, integer, boolean, text) to authenticated;

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
  v_account_type text;
  v_email_confirmed boolean;
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

  if p_user_id = auth.uid() then
    raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
  end if;

  select
    coalesce(uv.account_type, 'regular_user'),
    au.email_confirmed_at is not null
  into v_account_type, v_email_confirmed
  from public.user_verifications uv
  join auth.users au on au.id = uv.user_id
  where uv.user_id = p_user_id
    and uv.status = 'pending'
  for update;

  if not found then
    if exists (select 1 from public.user_verifications where user_id = p_user_id) then
      raise exception 'VERIFICATION_ALREADY_REVIEWED';
    end if;
    raise exception 'VERIFICATION_TARGET_NOT_FOUND';
  end if;

  if v_account_type = 'web_admin' and p_decision = 'approved' and not v_email_confirmed then
    raise exception 'VERIFICATION_EMAIL_NOT_CONFIRMED';
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

  if v_account_type = 'web_admin' and p_decision = 'approved' then
    insert into public.app_admins (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;
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
