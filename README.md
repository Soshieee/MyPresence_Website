# MyPresence Website

The website portion for our app called MyPresence: A Mobile Event Management and Automated Attendance Monitoring System with Data Analytics for HPCI Thrive.

## Features

- Member registration with webcam face capture and descriptor extraction
- Real-time attendance scanning with service or event grouping, including inactive members without changing account status
- One Sunday Service check-in per member per day
- Attendance analytics views (mix, timeline, funnel, and linked events)
- Date-range filtering for records and dashboard analytics
- Event manager integration with Supabase
- Named polls with optional start/end schedules, derived Scheduled/Active/Ended status, and preserved vote results
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
supabase/patch_2026_10_24_attendance_event_guard.sql
supabase/patch_2026_10_24_poll_main_question.sql
supabase/patch_2026_10_26_sunday_service_restriction.sql
supabase/patch_2026_10_28_delete_member.sql
supabase/patch_2026_10_30_delete_event.sql
supabase/patch_2026_11_02_allow_inactive_attendance.sql
supabase/patch_2026_11_02_poll_name_schedule.sql
```

The first patch adds poll status/archive metadata, vote identity fields, the `calendar_img_url` column, and the public `calendar` storage bucket. The second moves the poll question into `suggestion_question_text`, makes `suggestion_text` hold only the clean choice label, removes legacy question rows, and keeps one vote per poll using `poll_key` as `question_id`.

The third patch is the calendar column cleanup. Deploy the app version that reads and writes `calendar_img_url` **before** running it. It copies legacy `image_url` values into `calendar_img_url`, aborts if the two columns disagree, and then drops `image_url`. It is idempotent and makes no change after the legacy column is gone.

The fourth patch adds the attendance/event guard. It normalizes attendance groups, enforces the supported types, and adds a unique index so each member has only one Sunday Service record per date; First and Second Service share that record. It also validates linked events. The original inactive-member block is removed by the ninth patch.

The fifth patch adds `main_question`, drops the obsolete poll question foreign key, normalizes existing votes to the stable `poll_key`, and updates the vote trigger. Run it after the poll question patch.

The sixth patch reinforces the Sunday Service rule with an additional trigger and partial unique index. It preserves existing history; if old conflicting rows exist, it skips the unique index but still installs the trigger that blocks new conflicts. It is safe to run after the attendance/event guard.

The seventh patch adds the authenticated `delete_member` function used by the Members page. It deletes the selected member and that member's attendance records in one transaction. Run it before using the Delete action.

The eighth patch adds the authenticated `delete_event` function used by the Event Manager. It deletes an event in one transaction, either unlinking its attendance records (keeping history) or deleting them, and always removes the event's polls, votes, and suggestions. Run it before using the Delete action.

The ninth patch allows inactive members to be scanned. It replaces the attendance guard so account status (`users.is_active`) and attendance eligibility are separate; inactive members remain inactive after a scan, and duplicate/session/event rules are unchanged.

The tenth patch adds `poll_name`, `poll_starts_at`, and `poll_ends_at`. It enforces `poll_ends_at > poll_starts_at` and installs a trigger that rejects votes before the scheduled start, after the scheduled end, or on closed/archived polls. Derived status is `Scheduled`, `Active`, or `Ended` (with the existing `Archived` state preserved).

The mobile app contract is documented in `docs/app-poll-calendar-contract.md`.

