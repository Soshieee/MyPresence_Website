-- Verification Center corrective migration (2026-11-04).
--
-- Authorized changes only:
--   * public feed exposes only approved posts and approved images
--   * social image SELECT hides pending/rejected images from anon/public
--   * user inserts are forced to pending; review fields are protected
--   * verification decisions must go through the audited RPC
--   * social content and each image are reviewed independently
--   * approved lifegroup leaders update lifegroups.leader_id and membership
--   * mobile users can read their own verification status via an RPC
--   * admin verification list is server-filtered/paginated
--
-- It does NOT redefine public.is_admin() or public.is_social_admin().
-- The live definitions are kept as-is.
--
-- Run once in the Supabase SQL Editor. This file is transactional.

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing; refusing to change verification policies.';
  end if;
  if to_regprocedure('public.is_social_admin()') is null then
    raise exception 'public.is_social_admin() is missing; refusing to change social policies.';
  end if;
  if to_regclass('public.social_posts') is null
     or to_regclass('public.social_post_images') is null
     or to_regclass('public.verification_submissions') is null
     or to_regclass('public.verification_reviews') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.lifegroups') is null
     or to_regclass('public.lifegroup_members') is null then
    raise exception 'A required table is missing; refusing to apply verification fixes.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Public feed: approved posts only, approved images only, no partial posts
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER is intentional and narrow: the public caller must not be
-- able to see pending/rejected image rows, but the feed still has to know
-- whether such a row exists before publishing a post. Only a boolean is
-- returned, and only for approved, unexpired posts.
create or replace function public.social_post_has_nonapproved_images(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.social_posts p
    where p.id = p_post_id
      and p.status = 'approved'
      and p.expires_at > now()
      and exists (
        select 1
        from public.social_post_images i
        where i.post_id = p.id
          and i.status is distinct from 'approved'
      )
  );
$$;

revoke all on function public.social_post_has_nonapproved_images(uuid) from public;
grant execute on function public.social_post_has_nonapproved_images(uuid) to anon, authenticated;

drop view if exists public.social_feed;
create view public.social_feed
with (security_invoker = true)
as
select
  p.id,
  p.user_id,
  p.author_display_name,
  p.author_avatar_url,
  p.caption,
  p.created_at,
  p.expires_at,
  coalesce((
    select array_agg(i.storage_path order by i.sort_order, i.created_at)
    from public.social_post_images i
    where i.post_id = p.id
      and i.status = 'approved'
  ), '{}'::text[]) as image_paths,
  coalesce((
    select array_agg(h.name order by h.name)
    from public.social_post_hashtags ph
    join public.social_hashtags h on h.id = ph.hashtag_id
    where ph.post_id = p.id
  ), '{}'::text[]) as hashtags
from public.social_posts p
where p.status = 'approved'
  and p.expires_at > now()
  and not public.social_post_has_nonapproved_images(p.id);

grant select on public.social_feed to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Post/image RLS: public sees only approved components
-- ---------------------------------------------------------------------------

-- Split the public policy from the authenticated policy so anon never calls
-- is_social_admin()/is_admin(). Admins get a separate permissive policy.
drop policy if exists social_posts_select on public.social_posts;
create policy social_posts_select
on public.social_posts
for select to authenticated
using (
  (status = 'approved' and expires_at > now())
  or user_id = auth.uid()
  or public.is_social_admin()
);

drop policy if exists social_posts_public_select on public.social_posts;
create policy social_posts_public_select
on public.social_posts
for select to anon
using (status = 'approved' and expires_at > now());

drop policy if exists social_posts_admin_select on public.social_posts;
create policy social_posts_admin_select
on public.social_posts
for select to authenticated
using (public.is_admin());

drop policy if exists social_post_images_select on public.social_post_images;
create policy social_post_images_select
on public.social_post_images
for select to authenticated
using (
  (
    status = 'approved'
    and exists (
      select 1
      from public.social_posts p
      where p.id = social_post_images.post_id
        and p.status = 'approved'
        and p.expires_at > now()
    )
  )
  or exists (
    select 1
    from public.social_posts p
    where p.id = social_post_images.post_id
      and p.user_id = auth.uid()
  )
  or public.is_social_admin()
);

drop policy if exists social_post_images_public_select on public.social_post_images;
create policy social_post_images_public_select
on public.social_post_images
for select to anon
using (
  status = 'approved'
  and exists (
    select 1
    from public.social_posts p
    where p.id = social_post_images.post_id
      and p.status = 'approved'
      and p.expires_at > now()
  )
);

drop policy if exists social_post_images_admin_select on public.social_post_images;
create policy social_post_images_admin_select
on public.social_post_images
for select to authenticated
using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. User inserts are pending; users cannot promote their own media
-- ---------------------------------------------------------------------------

drop policy if exists social_posts_insert on public.social_posts;
create policy social_posts_insert
on public.social_posts
for insert to authenticated
with check (user_id = auth.uid() and status = 'pending');

drop policy if exists social_post_images_insert on public.social_post_images;
create policy social_post_images_insert
on public.social_post_images
for insert to authenticated
with check (
  status = 'pending'
  and exists (
    select 1
    from public.social_posts p
    where p.id = social_post_images.post_id
      and p.user_id = auth.uid()
      and p.status = 'pending'
  )
);

drop policy if exists social_post_images_update on public.social_post_images;
create policy social_post_images_update
on public.social_post_images
for update to authenticated
using (
  status = 'pending'
  and exists (
    select 1
    from public.social_posts p
    where p.id = social_post_images.post_id
      and p.user_id = auth.uid()
      and p.status = 'pending'
  )
)
with check (
  status = 'pending'
  and exists (
    select 1
    from public.social_posts p
    where p.id = social_post_images.post_id
      and p.user_id = auth.uid()
      and p.status = 'pending'
  )
);

-- ---------------------------------------------------------------------------
-- 4. Review-field guards
-- ---------------------------------------------------------------------------

create or replace function public.guard_social_post_review_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- SECURITY DEFINER review functions run as their owner, so the trigger
  -- allows those trusted writes. Direct API writes run as authenticated/anon.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.rejection_reason := null;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'VERIFICATION_REVIEW_FIELDS_PROTECTED';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_social_post_review_fields on public.social_posts;
create trigger guard_social_post_review_fields
before insert or update on public.social_posts
for each row execute function public.guard_social_post_review_fields();

create or replace function public.guard_social_post_image_review_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- SECURITY DEFINER review functions run as their owner, so the trigger
  -- allows those trusted writes. Direct API writes run as authenticated/anon.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.rejection_reason := null;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'VERIFICATION_REVIEW_FIELDS_PROTECTED';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_social_post_image_review_fields on public.social_post_images;
create trigger guard_social_post_image_review_fields
before insert or update on public.social_post_images
for each row execute function public.guard_social_post_image_review_fields();

create or replace function public.guard_verification_submission_review_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- SECURITY DEFINER review functions run as their owner, so the trigger
  -- allows those trusted writes. Direct API writes run as authenticated/anon.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.rejection_reason := null;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'VERIFICATION_REVIEW_FIELDS_PROTECTED';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_verification_submission_review_fields on public.verification_submissions;
create trigger guard_verification_submission_review_fields
before insert or update on public.verification_submissions
for each row execute function public.guard_verification_submission_review_fields();

-- ---------------------------------------------------------------------------
-- 5. Verification submissions: users insert their own pending row; admins read
-- ---------------------------------------------------------------------------

drop policy if exists "Admins can manage verification submissions" on public.verification_submissions;
drop policy if exists "Users can insert their own verification submissions" on public.verification_submissions;
drop policy if exists "Admins can read verification submissions" on public.verification_submissions;

create policy "Users can insert their own verification submissions"
on public.verification_submissions
for insert to authenticated
with check (auth.uid() = user_id and status = 'pending');

create policy "Admins can read verification submissions"
on public.verification_submissions
for select to authenticated
using (public.is_admin());

revoke all on public.verification_submissions from public, anon;
revoke update, delete on public.verification_submissions from authenticated;
grant select, insert on public.verification_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Verification reviews are append-only and admin-readable
-- ---------------------------------------------------------------------------

drop policy if exists "Admins can read verification reviews" on public.verification_reviews;
create policy "Admins can read verification reviews"
on public.verification_reviews
for select to authenticated
using (public.is_admin());

revoke all on public.verification_reviews from public, anon;
revoke insert, update, delete on public.verification_reviews from authenticated;
grant select on public.verification_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Mobile-readable status (no documents, storage paths, or reviewer notes)
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
  select distinct on (s.category)
    s.category,
    s.status,
    s.rejection_reason,
    s.lifegroup_id,
    s.created_at,
    s.reviewed_at
  from public.verification_submissions s
  where s.user_id = auth.uid()
  order by s.category, s.created_at desc;
$$;

revoke all on function public.get_my_verification_status() from public, anon;
grant execute on function public.get_my_verification_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Audited review RPC: independent components, idempotent, self-review blocked
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
  v_status text;
  v_storage_path text;
  v_submission_data jsonb;
  v_post_id uuid;
  v_profile_image text;
begin
  if not public.is_admin() then
    raise exception 'VERIFICATION_ADMIN_REQUIRED';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'VERIFICATION_DECISION_INVALID';
  end if;

  if p_decision = 'rejected'
     and nullif(btrim(coalesce(p_comments, '')), '') is null then
    raise exception 'VERIFICATION_REJECTION_REASON_REQUIRED';
  end if;

  if p_category = 'social_post' and p_component = 'content' then
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
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;
  elsif p_category = 'social_post_image' and p_component = 'image' then
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
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
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

    if not found then
      raise exception 'VERIFICATION_TARGET_NOT_FOUND';
    end if;
    if v_user_id = auth.uid() then
      raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN';
    end if;
    if v_status <> 'pending' then
      raise exception 'VERIFICATION_ALREADY_REVIEWED';
    end if;

    update public.verification_submissions
    set status = p_decision,
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
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
    elsif p_category = 'lifegroup_leader' and p_decision = 'approved' then
      if v_lifegroup_id is null then
        raise exception 'VERIFICATION_LIFEGROUP_REQUIRED';
      end if;

      perform 1
      from public.lifegroups
      where id = v_lifegroup_id
      for update;

      if not found then
        raise exception 'VERIFICATION_LIFEGROUP_NOT_FOUND';
      end if;

      update public.lifegroups
      set leader_id = v_user_id,
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
    nullif(btrim(coalesce(p_comments, '')), '')
  );
end;
$$;

revoke all on function public.review_verification(uuid, text, text, text, text) from public, anon;
grant execute on function public.review_verification(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Admin verification list (server-side filters/pagination)
-- ---------------------------------------------------------------------------

drop view if exists public.verification_requests;
create view public.verification_requests
with (security_invoker = true)
as
with requests as (
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
            and i.status <> 'approved'
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
)
select *
from requests
where public.is_admin();

revoke all on public.verification_requests from public, anon;
grant select on public.verification_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Additive admin storage reads (no public access, no policy replacement)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'verification_admins_read_social_post_images'
  ) then
    create policy "verification_admins_read_social_post_images"
    on storage.objects
    for select
    to authenticated
    using (bucket_id = 'social-post-images' and public.is_admin());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'verification_admins_read_avatars'
  ) then
    create policy "verification_admins_read_avatars"
    on storage.objects
    for select
    to authenticated
    using (bucket_id = 'avatars' and public.is_admin());
  end if;
end $$;

commit;
