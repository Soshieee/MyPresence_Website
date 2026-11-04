-- Use the mobile app's existing leader_verification_requests object as the
-- authoritative source for lifegroup leader applications.
--
-- The object is expected to expose:
-- lifegroup_id, group_name, group_description, leader_contact,
-- approval_status, requested_at, leader_user_id, leader_name,
-- leader_avatar_url, and member_count.
--
-- Review actions still target the lifegroup ID. The existing
-- review_verification(...) RPC validates and updates the underlying lifegroup
-- and lifegroup_members rows transactionally.

begin;

do $$
begin
  if to_regclass('public.leader_verification_requests') is null then
    raise exception 'public.leader_verification_requests is missing';
  end if;
  if to_regclass('public.verification_reviews') is null
     or to_regclass('public.lifegroups') is null
     or to_regclass('public.lifegroup_members') is null then
    raise exception 'Verification dependencies are missing; run the verification migrations first.';
  end if;
end $$;

-- Serialize replacement with Verification Center reads.
lock table public.verification_requests in access exclusive mode;
drop view if exists public.verification_requests;

-- Use the view owner for underlying reads because the mobile view is not
-- directly readable by ordinary authenticated clients. The explicit
-- is_admin() predicate below remains the authorization boundary.
create view public.verification_requests
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
leader_requests as (
  select
    lrq.lifegroup_id,
    lrq.group_name,
    lrq.group_description,
    lrq.leader_contact,
    lrq.approval_status,
    lrq.requested_at,
    lrq.leader_user_id,
    lrq.leader_name,
    lrq.leader_avatar_url,
    lrq.member_count,
    lrs.decision as last_decision,
    lrs.comments as last_comments,
    lrs.reviewed_at as last_reviewed_at
  from public.leader_verification_requests lrq
  left join lifegroup_review_state lrs
    on lrs.target_id = lrq.lifegroup_id
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
    p.status,
    case
      when p.status = 'pending'
        or exists (
          select 1 from public.social_post_images i
          where i.post_id = p.id and i.status = 'pending'
        ) then 'pending'
      when p.status = 'rejected'
        or exists (
          select 1 from public.social_post_images i
          where i.post_id = p.id and i.status = 'rejected'
        ) then 'rejected'
      when p.status = 'approved'
        and not exists (
          select 1 from public.social_post_images i
          where i.post_id = p.id and i.status is distinct from 'approved'
        ) then 'approved'
      else 'pending'
    end as overall_status,
    (select count(*)::int from public.social_post_images i where i.post_id = p.id) as image_count,
    (select count(*)::int from public.social_post_images i where i.post_id = p.id and i.status = 'pending') as pending_image_count,
    (select count(*)::int from public.social_post_images i where i.post_id = p.id and i.status = 'approved') as approved_image_count,
    (select count(*)::int from public.social_post_images i where i.post_id = p.id and i.status = 'rejected') as rejected_image_count,
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
    s.id,
    s.category,
    'submission'::text,
    s.user_id,
    s.lifegroup_id,
    coalesce(
      nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      nullif(btrim(s.submission_data ->> 'full_name'), ''),
      'Member'::text
    ),
    pr.profile_img_url,
    pr.profile_img_url,
    coalesce(
      nullif(btrim(s.submission_data ->> 'details'), ''),
      nullif(btrim(s.submission_data ->> 'description'), ''),
      nullif(btrim(s.submission_data ->> 'reason'), ''),
      'Review the submitted information below.'::text
    ),
    s.created_at,
    s.status,
    s.status,
    case when s.storage_path is null then 0 else 1 end,
    0,
    0,
    0,
    s.storage_path,
    s.submission_data,
    lg.name,
    lg.leader_id,
    coalesce(nullif(btrim(concat_ws(' ', lp.first_name, lp.last_name)), ''), 'Unassigned'::text),
    s.rejection_reason,
    s.reviewed_at,
    pr.gender,
    pr.birthday,
    pr.network
  from public.verification_submissions s
  left join public.profiles pr on pr.id = s.user_id
  left join public.lifegroups lg on lg.id = s.lifegroup_id
  left join public.profiles lp on lp.id = lg.leader_id

  union all

  select
    lrq.lifegroup_id,
    'lifegroup_leader'::text,
    'submission'::text,
    lrq.leader_user_id,
    lrq.lifegroup_id,
    coalesce(nullif(btrim(lrq.leader_name), ''), 'Member'::text),
    lrq.leader_avatar_url,
    pr.profile_img_url,
    coalesce(nullif(btrim(lrq.group_description), ''), ('Lifegroup leader application for ' || lrq.group_name)::text),
    lrq.requested_at,
    case
      when lower(btrim(coalesce(lrq.approval_status, ''))) in ('approved', 'active') then 'approved'
      when lower(btrim(coalesce(lrq.approval_status, ''))) in ('rejected', 'denied') then 'rejected'
      else 'pending'
    end,
    case
      when lrq.last_decision = 'rejected'
        or lower(btrim(coalesce(lrq.approval_status, ''))) in ('rejected', 'denied') then 'rejected'
      when lrq.last_decision = 'approved'
        or lower(btrim(coalesce(lrq.approval_status, ''))) in ('approved', 'active') then 'approved'
      else 'pending'
    end,
    0,
    0,
    0,
    0,
    null::text,
    jsonb_build_object(
      'lifegroup_name', lrq.group_name,
      'description', lrq.group_description,
      'leader_contact', lrq.leader_contact,
      'member_count', lrq.member_count
    ),
    lrq.group_name,
    lg.leader_id,
    coalesce(nullif(btrim(concat_ws(' ', lp.first_name, lp.last_name)), ''), 'Unassigned'::text),
    case when lrq.last_decision = 'rejected' then lrq.last_comments else null end,
    lrq.last_reviewed_at,
    pr.gender,
    pr.birthday,
    pr.network
  from leader_requests lrq
  left join public.lifegroups lg on lg.id = lrq.lifegroup_id
  left join public.profiles pr on pr.id = lrq.leader_user_id
  left join public.profiles lp on lp.id = lg.leader_id
)
select *
from requests
where public.is_admin();

revoke all on public.verification_requests from public, anon;
grant select on public.verification_requests to authenticated;

commit;
