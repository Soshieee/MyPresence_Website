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

Run `supabase/schema.sql` and the required migration files in the `supabase/`
folder using the Supabase SQL Editor. Website account registration also requires
the server-only `SUPABASE_SERVICE_ROLE_KEY`; never expose it in frontend code.
