-- Review a social post and all of its attached images as one submission.

begin;

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

    update public.social_post_images
    set status = p_decision,
        rejection_reason = nullif(btrim(coalesce(p_comments, '')), ''),
        reviewed_at = timezone('utc', now()),
        reviewed_by = auth.uid()
    where post_id = p_target_id;
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

commit;
