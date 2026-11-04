-- Persist lifegroup leader decisions to the authoritative approval fields.
--
-- leader_verification_requests is a view over lifegroups.approval_status.
-- The previous review function changed lifecycle status but left that
-- approval status unchanged, so the mobile app and view could remain pending.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lifegroups'
      and column_name = 'approval_status'
  ) then
    raise exception 'lifegroups.approval_status is missing; refusing to alter review behavior';
  end if;
end $$;

create or replace function public.review_lifegroup_verification(
  p_target_id uuid,
  p_decision text,
  p_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_existing_leader_id uuid;
  v_lifegroup_status text;
  v_approval_status text;
  v_external_status text;
  v_reason text := nullif(btrim(coalesce(p_comments, '')), '');
  v_reviewed_at timestamptz := timezone('utc', now());
begin
  if not public.is_admin() then
    raise exception 'VERIFICATION_ADMIN_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'VERIFICATION_DECISION_INVALID';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'VERIFICATION_REJECTION_REASON_REQUIRED';
  end if;

  select lg.leader_id, lg.status, lower(btrim(coalesce(lg.approval_status, '')))
    into v_user_id, v_lifegroup_status, v_approval_status
  from public.lifegroups lg
  where lg.id = p_target_id
  for update;

  if not found then
    raise exception 'VERIFICATION_TARGET_NOT_FOUND';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
  end if;

  if exists (
    select 1
    from public.verification_reviews r
    where r.target_id = p_target_id
      and r.category = 'lifegroup_leader'
      and r.component = 'submission'
  ) then
    raise exception 'VERIFICATION_ALREADY_REVIEWED';
  end if;

  select lower(btrim(coalesce(lrq.approval_status, '')))
    into v_external_status
  from public.leader_verification_requests lrq
  where lrq.lifegroup_id = p_target_id;

  if coalesce(v_external_status, v_approval_status) not in
      ('pending', 'under review', 'under_review', 'review') then
    raise exception 'VERIFICATION_ALREADY_REVIEWED';
  end if;

  if p_decision = 'approved' then
    select leader_id
      into v_existing_leader_id
    from public.lifegroups
    where id = p_target_id
    for update;

    if v_existing_leader_id is not null
       and v_existing_leader_id <> v_user_id then
      raise exception 'VERIFICATION_LIFEGROUP_ALREADY_LED';
    end if;
    if exists (
      select 1
      from public.lifegroup_members m
      where m.lifegroup_id = p_target_id
        and m.user_id <> v_user_id
        and m.role = 'leader'
        and m.status = 'active'
    ) then
      raise exception 'VERIFICATION_LIFEGROUP_ALREADY_LED';
    end if;
  end if;

  update public.lifegroups
  set approval_status = p_decision,
      status = case when p_decision = 'approved' then 'active' else 'rejected' end,
      updated_at = v_reviewed_at
  where id = p_target_id
    and lower(btrim(coalesce(approval_status, ''))) in
      ('pending', 'under review', 'under_review', 'review');

  if not found then
    raise exception 'VERIFICATION_ALREADY_REVIEWED';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lifegroups' and column_name = 'reviewed_at'
  ) then
    execute
      'update public.lifegroups set reviewed_at = $1 where id = $2'
      using v_reviewed_at, p_target_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lifegroups' and column_name = 'reviewed_by'
  ) then
    execute
      'update public.lifegroups set reviewed_by = $1 where id = $2'
      using auth.uid(), p_target_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lifegroups' and column_name = 'rejection_reason'
  ) then
    execute
      'update public.lifegroups set rejection_reason = $1 where id = $2'
      using case when p_decision = 'rejected' then v_reason else null end, p_target_id;
  end if;

  if p_decision = 'approved' then
    update public.lifegroup_members
    set role = 'leader',
        status = 'active',
        updated_at = v_reviewed_at
    where lifegroup_id = p_target_id
      and user_id = v_user_id;

    if not found then
      insert into public.lifegroup_members (lifegroup_id, user_id, role, status)
      values (p_target_id, v_user_id, 'leader', 'active');
    end if;
  else
    update public.lifegroup_members
    set status = 'rejected',
        updated_at = v_reviewed_at
    where lifegroup_id = p_target_id
      and user_id = v_user_id
      and role = 'leader'
      and status in ('pending', 'active');
  end if;

  insert into public.verification_reviews (
    target_id, category, component, reviewer_id, decision, comments
  )
  values (
    p_target_id, 'lifegroup_leader', 'submission', auth.uid(), p_decision, v_reason
  );
end;
$$;

revoke all on function public.review_lifegroup_verification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_lifegroup_verification(uuid, text, text) to authenticated;

commit;
