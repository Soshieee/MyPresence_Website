-- Hashtag normalization and case-insensitive deduplication.
--
-- This is a follow-up to patch_2026_11_03_event_poll_hashtags.sql. It is
-- idempotent and additive for the canonical catalog and event/poll
-- relationship tables. Social-post hashtag associations are intentionally
-- handled by the follow-up removal migration. It does not change RLS. The live database remains the authority
-- for who may create/update/delete hashtags (currently is_social_admin()).
--
-- Safe duplicate handling:
--   * Existing hashtag rows are normalized in place.
--   * If two rows normalize to the same value, their event, poll, and social
--   * Existing event and poll associations are re-pointed to the
--     oldest/default row before the duplicate row is removed.
--   * If an unknown foreign key still references a duplicate row, the
--     transaction aborts instead of deleting data.

begin;

alter table public.social_hashtags add column if not exists normalized_name text;
alter table public.social_hashtags add column if not exists is_default boolean not null default false;
alter table public.social_hashtags add column if not exists is_active boolean not null default true;
alter table public.social_hashtags add column if not exists created_at timestamptz not null default timezone('utc'::text, now());

create or replace function public.normalize_social_hashtag(value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := lower(regexp_replace(btrim(coalesce(value, '')), '^#+', ''));
  if normalized = '' or normalized !~ '^[a-z0-9_][a-z0-9_]{0,49}$' then
    raise exception 'INVALID_HASHTAG_FORMAT';
  end if;
  return normalized;
end;
$$;

create or replace function public.prepare_social_hashtag()
returns trigger
language plpgsql
as $$
declare
  normalized text;
begin
  normalized := public.normalize_social_hashtag(new.name);
  new.normalized_name := normalized;
  -- Existing deployments store hashtag names without the visual # prefix.
  new.name := normalized;
  return new;
end;
$$;

drop trigger if exists prepare_social_hashtag on public.social_hashtags;
create trigger prepare_social_hashtag
before insert or update of name, normalized_name
on public.social_hashtags
for each row execute function public.prepare_social_hashtag();

-- Normalize every existing row through the trigger. This also fills in
-- normalized_name for rows created before the column was populated.
update public.social_hashtags
set name = name;

-- Merge rows that now share a normalized_name. The oldest default row wins;
-- otherwise the oldest row wins. Associations are re-pointed, never cascaded.
do $$
declare
  duplicate_group record;
  canonical_id uuid;
  duplicate_ids uuid[];
begin
  for duplicate_group in
    select normalized_name
    from public.social_hashtags
    group by normalized_name
    having count(*) > 1
  loop
    select id
    into canonical_id
    from public.social_hashtags
    where normalized_name = duplicate_group.normalized_name
    order by is_default desc, created_at asc, id asc
    limit 1;

    select array_agg(id)
    into duplicate_ids
    from public.social_hashtags
    where normalized_name = duplicate_group.normalized_name
      and id <> canonical_id;

    if duplicate_ids is null or cardinality(duplicate_ids) = 0 then
      continue;
    end if;

    if to_regclass('public.event_hashtags') is not null then
      execute
        'insert into public.event_hashtags (event_id, hashtag_id)
         select event_id, $1
         from public.event_hashtags
         where hashtag_id = any($2)
         on conflict do nothing'
        using canonical_id, duplicate_ids;

      execute
        'delete from public.event_hashtags where hashtag_id = any($1)'
        using duplicate_ids;
    end if;

    if to_regclass('public.poll_hashtags') is not null then
      execute
        'insert into public.poll_hashtags (event_id, poll_key, hashtag_id)
         select event_id, poll_key, $1
         from public.poll_hashtags
         where hashtag_id = any($2)
         on conflict do nothing'
        using canonical_id, duplicate_ids;

      execute
        'delete from public.poll_hashtags where hashtag_id = any($1)'
        using duplicate_ids;
    end if;

    -- Unknown FKs intentionally block this delete. That is safer than
    -- guessing at a cascade and losing an association.
    delete from public.social_hashtags where id = any(duplicate_ids);
  end loop;
end;
$$;

alter table public.social_hashtags alter column normalized_name set not null;

create unique index if not exists social_hashtags_normalized_name_idx
  on public.social_hashtags (normalized_name);

create index if not exists social_hashtags_default_idx
  on public.social_hashtags (is_default, normalized_name);

commit;
