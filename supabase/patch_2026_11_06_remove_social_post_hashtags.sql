-- Remove the legacy social-post hashtag association table.
--
-- Hashtags remain available through public.social_hashtags and continue to
-- support event_hashtags and poll_hashtags. Social posts no longer expose
-- hashtag associations through public.social_feed.
--
-- Run after the existing hashtag and verification migrations.

begin;

-- Acquire the legacy relation lock before dropping its dependent view. This
-- establishes a single lock order and prevents old social_feed reads from
-- starting between the view and table changes.
lock table public.social_post_hashtags in access exclusive mode;

drop view if exists public.social_feed;
drop table if exists public.social_post_hashtags cascade;

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
  '{}'::text[] as hashtags
from public.social_posts p
where p.status = 'approved'
  and p.expires_at > now()
  and not exists (
    select 1
    from public.social_post_images i
    where i.post_id = p.id
      and i.status <> 'approved'
  );

grant select on public.social_feed to anon, authenticated;

commit;
