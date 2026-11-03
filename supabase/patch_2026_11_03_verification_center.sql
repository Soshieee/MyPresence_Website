-- Centralized verification center.
-- Safe to run once after the existing social schema is present.

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1
      from public.app_admins
      where user_id = auth.uid()
    );
$$;

create or replace function public.is_social_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.role() = 'service_role'
    or public.is_admin()
    or (auth.jwt() -> 'app_metadata' ->> 'is_staff') = 'true';
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.social_posts
  drop constraint if exists social_posts_status_check;

alter table public.social_posts
  add constraint social_posts_status_check
  check (status in ('pending', 'approved', 'rejected'));

alter table public.social_posts
  add column if not exists rejection_reason text;

alter table public.social_post_images
  add column if not exists status text not null default 'pending',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists rejection_reason text;

alter table public.social_post_images
  drop constraint if exists social_post_images_status_check;

alter table public.social_post_images
  add constraint social_post_images_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- Existing images were already publishable whenever their parent post was approved.
update public.social_post_images
set status = 'approved'
where status = 'pending'
  and created_at < timezone('utc', now());

create table if not exists public.verification_submissions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('user', 'profile_picture', 'lifegroup_leader')),
  user_id uuid not null references auth.users(id) on delete restrict,
  lifegroup_id uuid references public.lifegroups(id) on delete restrict,
  storage_path text,
  submission_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create index if not exists verification_submissions_status_idx
  on public.verification_submissions (category, status, created_at desc);

create table if not exists public.verification_reviews (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null,
  category text not null check (category in ('social_post', 'social_post_image', 'user', 'profile_picture', 'lifegroup_leader')),
  component text,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  comments text,
  reviewed_at timestamptz not null default timezone('utc', now())
);

create index if not exists verification_reviews_target_idx
  on public.verification_reviews (target_id, reviewed_at desc);

alter table public.verification_submissions enable row level security;
alter table public.verification_reviews enable row level security;

drop policy if exists "Admins can manage verification submissions" on public.verification_submissions;
create policy "Admins can manage verification submissions"
on public.verification_submissions
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can read verification reviews" on public.verification_reviews;
create policy "Admins can read verification reviews"
on public.verification_reviews
for select to authenticated
using (public.is_admin());

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

  if p_category = 'social_post' and p_component = 'content' then
    update public.social_posts
    set status = p_decision,
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;
    if not found then raise exception 'VERIFICATION_TARGET_NOT_FOUND'; end if;
  elsif p_category = 'social_post_image' and p_component = 'image' then
    update public.social_post_images
    set status = p_decision,
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;
    if not found then raise exception 'VERIFICATION_TARGET_NOT_FOUND'; end if;
  elsif p_category in ('user', 'profile_picture', 'lifegroup_leader') then
    select user_id, lifegroup_id
    into v_user_id, v_lifegroup_id
    from public.verification_submissions
    where id = p_target_id
    for update;
    if not found then raise exception 'VERIFICATION_TARGET_NOT_FOUND'; end if;
    if v_user_id = auth.uid() then raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN'; end if;

    update public.verification_submissions
    set status = p_decision,
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where id = p_target_id;

    if p_category = 'profile_picture' and p_decision = 'approved' then
      update public.profiles
      set profile_img_url = (
        select storage_path
        from public.verification_submissions
        where id = p_target_id
      )
      where id = v_user_id;
    elsif p_category = 'lifegroup_leader' and p_decision = 'approved' then
      update public.lifegroups
      set leader_id = v_user_id,
          updated_at = timezone('utc', now())
      where id = v_lifegroup_id;
    end if;
  else
    raise exception 'VERIFICATION_CATEGORY_INVALID';
  end if;

  insert into public.verification_reviews (
    target_id, category, component, reviewer_id, decision, comments
  )
  values (
    p_target_id, p_category, p_component, auth.uid(), p_decision,
    nullif(btrim(coalesce(p_comments, '')), '')
  );
end;
$$;

revoke all on function public.review_verification(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.review_verification(uuid, text, text, text, text) to authenticated;

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
  and not exists (
    select 1
    from public.social_post_images i
    where i.post_id = p.id
      and i.status <> 'approved'
  );

commit;
