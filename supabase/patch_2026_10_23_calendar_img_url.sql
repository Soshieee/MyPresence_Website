-- Calendar image column cleanup.
--
-- Canonical column: public.calendar.calendar_img_url
--
-- Existing deployments created by patch_2026_10_22_polls_calendar.sql may have
-- an extra public.calendar.image_url column. This patch copies any legacy
-- image_url values into calendar_img_url, verifies that no values differ, and
-- then drops image_url.
--
-- IMPORTANT: deploy the app version that reads/writes calendar_img_url before
-- running this patch. Older app versions still select image_url and will fail
-- once the column is removed.
--
-- The live calendar table was checked before writing this patch: it had one row
-- and calendar_img_url matched image_url. The checks below still abort the
-- transaction instead of dropping data if that is not true.

begin;

alter table public.calendar add column if not exists calendar_img_url text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'calendar'
      and column_name = 'image_url'
  ) then
    -- Preserve any old value that was not copied into the canonical column.
    execute $sql$
      update public.calendar
      set calendar_img_url = image_url
      where calendar_img_url is null
        and image_url is not null
    $sql$;

    -- Abort rather than discard a conflicting value.
    if exists (
      select 1
      from public.calendar
      where image_url is not null
        and calendar_img_url is distinct from image_url
    ) then
      raise exception 'calendar image migration stopped: calendar_img_url and image_url differ';
    end if;

    execute 'alter table public.calendar drop column image_url';
  end if;
end $$;

commit;
