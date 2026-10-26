# MyPresence Website

The website portion for our app called MyPresence: A Mobile Event Management and Automated Attendance Monitoring System with Data Analytics for HPCI Thrive.

## Features

- Member registration with webcam face capture and descriptor extraction
- Real-time attendance scanning with service or event grouping
- One Sunday Service check-in per member per day
- Attendance analytics views (mix, timeline, funnel, and linked events)
- Date-range filtering for records and dashboard analytics
- Event manager integration with Supabase
- Poll management with open/closed/archived states and vote results
- Calendar image upload and display through Supabase Storage
- Edge-case handling for camera and face detection issues

## Tech Stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- face-api.js
- react-webcam
- Supabase

## Supabase setup

For an existing database, run `supabase/schema.sql` first, then run these in order:

```text
supabase/patch_2026_10_22_polls_calendar.sql
supabase/patch_2026_10_23_poll_question_text.sql
supabase/patch_2026_10_23_calendar_img_url.sql
supabase/patch_2026_10_26_sunday_service_restriction.sql
```

The first patch adds poll status/archive metadata, vote identity fields, the `calendar_img_url` column, and the public `calendar` storage bucket. The second moves the poll question into `suggestion_question_text`, makes `suggestion_text` hold only the clean choice label, removes legacy question rows, and keeps one vote per poll using `poll_key` as `question_id`.

The third patch is the calendar column cleanup. Deploy the app version that reads and writes `calendar_img_url` **before** running it. It copies legacy `image_url` values into `calendar_img_url`, aborts if the two columns disagree, and then drops `image_url`. It is idempotent and makes no change after the legacy column is gone.

The fourth patch adds the database-level Sunday Service rule: a member can have only one First Service or Second Service attendance row per calendar day. It preserves existing history; if old conflicting rows exist, it skips the unique index but still installs the trigger that blocks new conflicts.

The mobile app contract is documented in `docs/app-poll-calendar-contract.md`.

