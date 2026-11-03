-- Hashtag management and event/poll associations.
-- Additive only: existing tables and rows are preserved.

begin;

create table if not exists public.social_hashtags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now())
);

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
  -- Keep that convention so the existing name-format check remains valid.
  new.name := normalized;
  return new;
end;
$$;

drop trigger if exists prepare_social_hashtag on public.social_hashtags;
create trigger prepare_social_hashtag
before insert or update of name, normalized_name
on public.social_hashtags
for each row execute function public.prepare_social_hashtag();

update public.social_hashtags
set name = name
where normalized_name is null
   or normalized_name <> public.normalize_social_hashtag(name)
   or name <> public.normalize_social_hashtag(name);

alter table public.social_hashtags alter column normalized_name set not null;
create unique index if not exists social_hashtags_normalized_name_idx
  on public.social_hashtags (normalized_name);
create index if not exists social_hashtags_default_idx
  on public.social_hashtags (is_default, normalized_name);

create table if not exists public.event_hashtags (
  event_id uuid not null references public.events(id) on update cascade on delete cascade,
  hashtag_id uuid not null references public.social_hashtags(id) on update cascade on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (event_id, hashtag_id)
);

create index if not exists event_hashtags_hashtag_id_idx
  on public.event_hashtags (hashtag_id);

create table if not exists public.poll_hashtags (
  event_id uuid not null references public.events(id) on update cascade on delete cascade,
  poll_key uuid not null,
  hashtag_id uuid not null references public.social_hashtags(id) on update cascade on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (event_id, poll_key, hashtag_id)
);

create index if not exists poll_hashtags_lookup_idx
  on public.poll_hashtags (event_id, poll_key);
create index if not exists poll_hashtags_hashtag_id_idx
  on public.poll_hashtags (hashtag_id);

create or replace function public.validate_poll_hashtag()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.event_suggestions
    where event_id = new.event_id
      and poll_key = new.poll_key
  ) then
    raise exception 'POLL_NOT_FOUND';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_poll_hashtag on public.poll_hashtags;
create constraint trigger validate_poll_hashtag
after insert or update on public.poll_hashtags
for each row execute function public.validate_poll_hashtag();

alter table public.social_hashtags enable row level security;
alter table public.event_hashtags enable row level security;
alter table public.poll_hashtags enable row level security;

drop policy if exists "Authenticated users can read social hashtags" on public.social_hashtags;
create policy "Authenticated users can read social hashtags"
on public.social_hashtags for select to authenticated using (true);

drop policy if exists "Admins can manage social hashtags" on public.social_hashtags;
create policy "Admins can manage social hashtags"
on public.social_hashtags for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read event hashtags" on public.event_hashtags;
create policy "Authenticated users can read event hashtags"
on public.event_hashtags for select to authenticated using (true);

drop policy if exists "Admins can manage event hashtags" on public.event_hashtags;
create policy "Admins can manage event hashtags"
on public.event_hashtags for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read poll hashtags" on public.poll_hashtags;
create policy "Authenticated users can read poll hashtags"
on public.poll_hashtags for select to authenticated using (true);

drop policy if exists "Admins can manage poll hashtags" on public.poll_hashtags;
create policy "Admins can manage poll hashtags"
on public.poll_hashtags for all to authenticated
using (public.is_admin())
with check (public.is_admin());

commit;
