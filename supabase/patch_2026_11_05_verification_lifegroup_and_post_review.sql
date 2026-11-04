-- Verification Center follow-up migration (2026-11-05).
--
-- Fixes:
--   1. Lifegroup leader applications created directly in public.lifegroups
--      (the mobile app's "Under review" flow) are now visible to admins.
--   2. Social posts are reviewed as a whole: one decision approves or rejects
--      the content and every attached image in one transaction.
--
-- It does NOT redefine public.is_admin() or public.is_social_admin().
--
-- Run once in the Supabase SQL Editor after the 2026-11-04 migration.
-- This file is transactional.

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing; refusing to change verification objects.';
  end if;
  if to_regclass('public.verification_submissions') is null
     or to_regclass('public.verification_reviews') is null
     or to_regclass('public.lifegroups') is null
     or to_regclass('public.lifegroup_members') is null then
    raise exception 'Verification tables are missing; run the 2026-11-03 and 2026-11-04 migrations first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Review RPC: whole-post social review + lifegroup-row review
-- ---------------------------------------------------------------------------

create or replace function public.review_verification(
  p_target_id uuid,
  p_category text,
  p_component text,
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
  v_lifegroup_id uuid;
  v_existing_leader_id uuid;
  v_status text;
  v_storage_path text;
  v_submission_data jsonb;
  v_post_id uuid;
  v_profile_image text;
  v_reason text := nullif(btrim(coalesce(p_comments, '')), '');
  v_submission_found boolean := false;
  v_image record;
  v_has_rejected boolean := false;
  v_has_nonapproved boolean := false;
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

  if p_category = 'social_post' and p_component = 'post' then
    -- Whole-post review: content and every image are decided together.
    select user_id, status
      into v_user_id, v_status
    from public.social_posts
    where id = p_target_id
    for update;

    if not found then
      raise exception 'VERIFICATION_TARGET_NOT_FOUND';
    end if;
    if v_user_id = auth.uid() then
      raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
    end if;

    select
      coalesce(bool_or(i.status = 'rejected'), false),
      coalesce(bool_or(i.status is distinct from 'approved'), false)
      into v_has_rejected, v_has_nonapproved
    from public.social_post_images i
    where i.post_id = p_target_id;

    -- Reject a post once. Allow a legacy post whose content was approved
    -- before per-image review was removed, as long as it is not rejected.
    if v_status = 'rejected'
       or v_has_rejected
       or (v_status = 'approved' and not v_has_nonapproved) then
      raise exception 'VERIFICATION_ALREADY_REVIEWED';
    end if;

    perform 1
    from public.social_post_images
    where post_id = p_target_id
    for update;

    update public.social_posts
    set status = p_decision,
        rejection_reason = v_reason,
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;

    update public.social_post_images
    set status = p_decision,
        rejection_reason = v_reason,
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where post_id = p_target_id;

    -- Audit each image separately; the final insert records the post itself.
    for v_image in
      select id
      from public.social_post_images
      where post_id = p_target_id
      order by sort_order, created_at
    loop
      insert into public.verification_reviews (
        target_id,
        category,
        component,
        reviewer_id,
        decision,
        comments
      )
      values (
        v_image.id,
        'social_post_image',
        'image',
        auth.uid(),
        p_decision,
        v_reason
      );
    end loop;

  elsif p_category = 'social_post' and p_component = 'content' then
    -- Legacy content-only review kept for older clients.
    select user_id, status
      into v_user_id, v_status
    from public.social_posts
    where id = p_target_id
    for update;

    if not found then
      raise exception 'VERIFICATION_TARGET_NOT_FOUND';
    end if;
    if v_user_id = auth.uid() then
      raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
    end if;
    if v_status <> 'pending' then
      raise exception 'VERIFICATION_ALREADY_REVIEWED';
    end if;

    update public.social_posts
    set status = p_decision,
        rejection_reason = v_reason,
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;

  elsif p_category = 'social_post_image' and p_component = 'image' then
    -- Legacy single-image review kept for older clients.
    select i.post_id, p.user_id, i.status
      into v_post_id, v_user_id, v_status
    from public.social_post_images i
    join public.social_posts p on p.id = i.post_id
    where i.id = p_target_id
    for update of i, p;

    if not found then
      raise exception 'VERIFICATION_TARGET_NOT_FOUND';
    end if;
    if v_user_id = auth.uid() then
      raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
    end if;
    if v_status <> 'pending' then
      raise exception 'VERIFICATION_ALREADY_REVIEWED';
    end if;

    update public.social_post_images
    set status = p_decision,
        rejection_reason = v_reason,
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;

  elsif p_category in ('user', 'profile_picture', 'lifegroup_leader')
        and p_component = 'submission' then
    select user_id, lifegroup_id, status, storage_path, submission_data
      into v_user_id, v_lifegroup_id, v_status, v_storage_path, v_submission_data
    from public.verification_submissions
    where id = p_target_id
    for update;

    v_submission_found := found;

    if v_submission_found then
      if v_user_id = auth.uid() then
        raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
      end if;
      if v_status <> 'pending' then
        raise exception 'VERIFICATION_ALREADY_REVIEWED';
      end if;

      update public.verification_submissions
      set status = p_decision,
          rejection_reason = v_reason,
          reviewed_at = timezone('utc', now()),
          reviewed_by = auth.uid()
      where id = p_target_id;

      if p_category = 'profile_picture' and p_decision = 'approved' then
        v_profile_image := coalesce(
          nullif(v_submission_data ->> 'profile_img_url', ''),
          nullif(v_submission_data ->> 'public_url', ''),
          v_storage_path
        );

        if v_profile_image is null then
          raise exception 'VERIFICATION_PROFILE_IMAGE_REQUIRED';
        end if;

        update public.profiles
        set profile_img_url = v_profile_image,
            updated_at = timezone('utc', now())
        where id = v_user_id;

        if not found then
          raise exception 'VERIFICATION_PROFILE_NOT_FOUND';
        end if;
      elsif p_category = 'lifegroup_leader' then
        if v_lifegroup_id is null then
          raise exception 'VERIFICATION_LIFEGROUP_REQUIRED';
        end if;

        select leader_id
          into v_existing_leader_id
        from public.lifegroups
        where id = v_lifegroup_id
        for update;

        if not found then
          raise exception 'VERIFICATION_LIFEGROUP_NOT_FOUND';
        end if;

        -- Never overwrite a different active leader through an application
        -- approval. The admin must resolve leadership separately first.
        if p_decision = 'approved'
           and v_existing_leader_id is not null
           and v_existing_leader_id <> v_user_id then
          raise exception 'VERIFICATION_LIFEGROUP_ALREADY_LED';
        end if;

        if p_decision = 'approved' and exists (
          select 1
          from public.lifegroup_members m
          where m.lifegroup_id = v_lifegroup_id
            and m.user_id <> v_user_id
            and m.role = 'leader'
            and m.status = 'active'
        ) then
          raise exception 'VERIFICATION_LIFEGROUP_ALREADY_LED';
        end if;

        if p_decision = 'approved' then
          update public.lifegroups
          set leader_id = v_user_id,
              status = 'active',
              updated_at = timezone('utc', now())
          where id = v_lifegroup_id;

          update public.lifegroup_members
          set role = 'leader',
              status = 'active',
              updated_at = timezone('utc', now())
          where lifegroup_id = v_lifegroup_id
            and user_id = v_user_id;

          if not found then
            insert into public.lifegroup_members (lifegroup_id, user_id, role, status)
            values (v_lifegroup_id, v_user_id, 'leader', 'active');
          end if;
        else
          update public.lifegroups
          set status = 'rejected',
              updated_at = timezone('utc', now())
          where id = v_lifegroup_id
            and status = 'pending';

          begin
            update public.lifegroup_members
            set status = 'rejected',
                updated_at = timezone('utc', now())
            where lifegroup_id = v_lifegroup_id
              and user_id = v_user_id
              and role = 'leader'
              and status = 'pending';
          exception when check_violation then
            null;
          end;
        end if;
      end if;

    elsif p_category = 'lifegroup_leader' then
      -- The mobile app's "Under review" lifegroup application is a row in
      -- public.lifegroups, so review the lifegroup itself when no submission
      -- row exists for the same id.
      select leader_id, status
        into v_user_id, v_status
      from public.lifegroups
      where id = p_target_id
      for update;

      if not found then
        raise exception 'VERIFICATION_TARGET_NOT_FOUND';
      end if;
      if v_user_id = auth.uid() then
        raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
      end if;

      if v_status = 'pending' then
        v_status := 'pending';
      elsif exists (
        select 1
        from public.lifegroup_members m
        where m.lifegroup_id = p_target_id
          and m.user_id = v_user_id
          and m.role = 'leader'
          and m.status = 'pending'
      ) then
        v_status := 'pending';
      elsif v_status = 'rejected' or exists (
        select 1
        from public.verification_reviews r
        where r.target_id = p_target_id
          and r.category = 'lifegroup_leader'
          and r.decision = 'rejected'
      ) then
        v_status := 'rejected';
      elsif v_status in ('active', 'approved') or exists (
        select 1
        from public.verification_reviews r
        where r.target_id = p_target_id
          and r.category = 'lifegroup_leader'
          and r.decision = 'approved'
      ) then
        v_status := 'approved';
      else
        v_status := 'pending';
      end if;

      if v_status <> 'pending' then
        raise exception 'VERIFICATION_ALREADY_REVIEWED';
      end if;

      if p_decision = 'approved' and exists (
        select 1
        from public.lifegroup_members m
        where m.lifegroup_id = p_target_id
          and m.user_id <> v_user_id
          and m.role = 'leader'
          and m.status = 'active'
      ) then
        raise exception 'VERIFICATION_LIFEGROUP_ALREADY_LED';
      end if;

      v_lifegroup_id := p_target_id;

      update public.lifegroups
      set leader_id = v_user_id,
          status = case when p_decision = 'approved' then 'active' else 'rejected' end,
          updated_at = timezone('utc', now())
      where id = v_lifegroup_id;

      if p_decision = 'approved' then
        update public.lifegroup_members
        set role = 'leader',
            status = 'active',
            updated_at = timezone('utc', now())
        where lifegroup_id = v_lifegroup_id
          and user_id = v_user_id;

        if not found then
          insert into public.lifegroup_members (lifegroup_id, user_id, role, status)
          values (v_lifegroup_id, v_user_id, 'leader', 'active');
        end if;
      else
        begin
          update public.lifegroup_members
          set status = 'rejected',
              updated_at = timezone('utc', now())
          where lifegroup_id = v_lifegroup_id
            and user_id = v_user_id
            and role = 'leader';
        exception when check_violation then
          null;
        end;
      end if;
    else
      raise exception 'VERIFICATION_TARGET_NOT_FOUND';
    end if;

  else
    raise exception 'VERIFICATION_CATEGORY_INVALID';
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
    p_target_id,
    p_category,
    p_component,
    auth.uid(),
    p_decision,
    v_reason
  );
end;
$$;

revoke all on function public.review_verification(uuid, text, text, text, text) from public, anon;
grant execute on function public.review_verification(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Mobile-readable status: include lifegroup applications
-- ---------------------------------------------------------------------------

create or replace function public.get_my_verification_status()
returns table (
  category text,
  status text,
  rejection_reason text,
  lifegroup_id uuid,
  submitted_at timestamptz,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with lifegroup_review_state as (
    select distinct on (r.target_id)
      r.target_id,
      r.decision,
      r.comments,
      r.reviewed_at
    from public.verification_reviews r
    where r.category = 'lifegroup_leader'
    order by r.target_id, r.reviewed_at desc
  ),
  statuses as (
    select
      s.category,
      s.status,
      s.rejection_reason,
      s.lifegroup_id,
      s.created_at as submitted_at,
      s.reviewed_at
    from public.verification_submissions s
    where s.user_id = auth.uid()

    union all

    select
      'lifegroup_leader'::text as category,
      case
        when lg.status = 'pending' then 'pending'
        when exists (
          select 1
          from public.lifegroup_members m
          where m.lifegroup_id = lg.id
            and m.user_id = lg.leader_id
            and m.role = 'leader'
            and m.status = 'pending'
        ) then 'pending'
        when lrs.decision = 'rejected' then 'rejected'
        when lg.status = 'rejected' then 'rejected'
        when lrs.decision = 'approved' then 'approved'
        when lg.status in ('active', 'approved') then 'approved'
        else 'pending'
      end as status,
      case when lrs.decision = 'rejected' then lrs.comments else null end as rejection_reason,
      lg.id as lifegroup_id,
      lg.created_at as submitted_at,
      lrs.reviewed_at
    from public.lifegroups lg
    left join lifegroup_review_state lrs on lrs.target_id = lg.id
    where lg.leader_id = auth.uid()
      and (
        lg.status = 'pending'
        or lrs.target_id is not null
        or exists (
          select 1
          from public.lifegroup_members m
          where m.lifegroup_id = lg.id
            and m.user_id = lg.leader_id
            and m.role = 'leader'
            and m.status = 'pending'
        )
      )
      and not exists (
        select 1
        from public.verification_submissions s
        where s.category = 'lifegroup_leader'
          and s.lifegroup_id = lg.id
      )
  )
  select distinct on (category)
    category,
    status,
    rejection_reason,
    lifegroup_id,
    submitted_at,
    reviewed_at
  from statuses
  order by category, submitted_at desc;
$$;

revoke all on function public.get_my_verification_status() from public, anon;
grant execute on function public.get_my_verification_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin verification list: include lifegroup applications
-- ---------------------------------------------------------------------------

drop view if exists public.verification_requests;
create view public.verification_requests
with (security_invoker = true)
as
with lifegroup_review_state as (
  select distinct on (r.target_id)
    r.target_id,
    r.decision,
    r.comments,
    r.reviewed_at
  from public.verification_reviews r
  where r.category = 'lifegroup_leader'
  order by r.target_id, r.reviewed_at desc
),
lifegroup_requests as (
  select
    lg.id,
    lg.leader_id,
    lg.name,
    lg.description,
    lg.leader_contact,
    lg.join_mode,
    lg.created_at,
    lrs.decision as last_decision,
    lrs.comments as last_comments,
    lrs.reviewed_at as last_reviewed_at,
    case
      when lg.status = 'pending' then 'pending'
      when exists (
        select 1
        from public.lifegroup_members m
        where m.lifegroup_id = lg.id
          and m.user_id = lg.leader_id
          and m.role = 'leader'
          and m.status = 'pending'
      ) then 'pending'
      when lrs.decision = 'rejected' then 'rejected'
      when lg.status = 'rejected' then 'rejected'
      when lrs.decision = 'approved' then 'approved'
      when lg.status in ('active', 'approved') then 'approved'
      else 'pending'
    end as normalized_status
  from public.lifegroups lg
  left join lifegroup_review_state lrs on lrs.target_id = lg.id
  where (
    lg.status = 'pending'
    or lrs.target_id is not null
    or exists (
      select 1
      from public.lifegroup_members m
      where m.lifegroup_id = lg.id
        and m.user_id = lg.leader_id
        and m.role = 'leader'
        and m.status = 'pending'
    )
  )
  and not exists (
    select 1
    from public.verification_submissions s
    where s.category = 'lifegroup_leader'
      and s.lifegroup_id = lg.id
  )
),
requests as (
  select
    p.id as request_id,
    'social'::text as category,
    'content'::text as component,
    p.user_id,
    null::uuid as lifegroup_id,
    coalesce(
      nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      nullif(btrim(p.author_display_name), ''),
      'Member'::text
    ) as submitter_name,
    p.author_avatar_url as submitter_avatar_url,
    pr.profile_img_url as current_profile_img_url,
    p.caption as detail,
    p.created_at as submitted_at,
    p.status as status,
    case
      when p.status = 'pending'
        or exists (
          select 1
          from public.social_post_images i
          where i.post_id = p.id
            and i.status = 'pending'
        ) then 'pending'
      when p.status = 'rejected'
        or exists (
          select 1
          from public.social_post_images i
          where i.post_id = p.id
            and i.status = 'rejected'
        ) then 'rejected'
      when p.status = 'approved'
        and not exists (
          select 1
          from public.social_post_images i
          where i.post_id = p.id
            and i.status is distinct from 'approved'
        ) then 'approved'
      else 'pending'
    end as overall_status,
    (
      select count(*)::int
      from public.social_post_images i
      where i.post_id = p.id
    ) as image_count,
    (
      select count(*)::int
      from public.social_post_images i
      where i.post_id = p.id
        and i.status = 'pending'
    ) as pending_image_count,
    (
      select count(*)::int
      from public.social_post_images i
      where i.post_id = p.id
        and i.status = 'approved'
    ) as approved_image_count,
    (
      select count(*)::int
      from public.social_post_images i
      where i.post_id = p.id
        and i.status = 'rejected'
    ) as rejected_image_count,
    null::text as storage_path,
    null::jsonb as submission_data,
    null::text as lifegroup_name,
    null::uuid as current_leader_id,
    null::text as current_leader_name,
    p.rejection_reason,
    p.reviewed_at,
    pr.gender as submitter_gender,
    pr.birthday as submitter_birthday,
    pr.network as submitter_network
  from public.social_posts p
  left join public.profiles pr on pr.id = p.user_id

  union all

  select
    s.id as request_id,
    s.category,
    'submission'::text as component,
    s.user_id,
    s.lifegroup_id,
    coalesce(
      nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      nullif(btrim(s.submission_data ->> 'full_name'), ''),
      'Member'::text
    ) as submitter_name,
    pr.profile_img_url as submitter_avatar_url,
    pr.profile_img_url as current_profile_img_url,
    coalesce(
      nullif(btrim(s.submission_data ->> 'details'), ''),
      nullif(btrim(s.submission_data ->> 'description'), ''),
      nullif(btrim(s.submission_data ->> 'reason'), ''),
      'Review the submitted information below.'::text
    ) as detail,
    s.created_at as submitted_at,
    s.status as status,
    s.status as overall_status,
    case when s.storage_path is null then 0 else 1 end as image_count,
    0 as pending_image_count,
    0 as approved_image_count,
    0 as rejected_image_count,
    s.storage_path,
    s.submission_data,
    lg.name as lifegroup_name,
    lg.leader_id as current_leader_id,
    coalesce(
      nullif(btrim(concat_ws(' ', lp.first_name, lp.last_name)), ''),
      'Unassigned'::text
    ) as current_leader_name,
    s.rejection_reason,
    s.reviewed_at,
    pr.gender as submitter_gender,
    pr.birthday as submitter_birthday,
    pr.network as submitter_network
  from public.verification_submissions s
  left join public.profiles pr on pr.id = s.user_id
  left join public.lifegroups lg on lg.id = s.lifegroup_id
  left join public.profiles lp on lp.id = lg.leader_id

  union all

  select
    lrq.id as request_id,
    'lifegroup_leader'::text as category,
    'submission'::text as component,
    lrq.leader_id as user_id,
    lrq.id as lifegroup_id,
    coalesce(
      nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Member'::text
    ) as submitter_name,
    pr.profile_img_url as submitter_avatar_url,
    pr.profile_img_url as current_profile_img_url,
    coalesce(
      nullif(btrim(lrq.description), ''),
      ('Lifegroup leader application for ' || lrq.name)::text
    ) as detail,
    lrq.created_at as submitted_at,
    lrq.normalized_status as status,
    lrq.normalized_status as overall_status,
    0 as image_count,
    0 as pending_image_count,
    0 as approved_image_count,
    0 as rejected_image_count,
    null::text as storage_path,
    jsonb_build_object(
      'lifegroup_name', lrq.name,
      'description', lrq.description,
      'leader_contact', lrq.leader_contact,
      'join_mode', lrq.join_mode
    ) as submission_data,
    lrq.name as lifegroup_name,
    lrq.leader_id as current_leader_id,
    coalesce(
      nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Unassigned'::text
    ) as current_leader_name,
    case when lrq.last_decision = 'rejected' then lrq.last_comments else null end as rejection_reason,
    lrq.last_reviewed_at as reviewed_at,
    pr.gender as submitter_gender,
    pr.birthday as submitter_birthday,
    pr.network as submitter_network
  from lifegroup_requests lrq
  left join public.profiles pr on pr.id = lrq.leader_id
)
select *
from requests
where public.is_admin();

revoke all on public.verification_requests from public, anon;
grant select on public.verification_requests to authenticated;

commit;
