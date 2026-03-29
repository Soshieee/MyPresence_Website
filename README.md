# MyPresence Website

The website portion for our app called MyPresence: A Mobile Event Management and Automated Attendance Monitoring System with Data Analytics for HPCI Thrive.

## Features

- Member registration with webcam face capture and descriptor extraction
- Real-time attendance scanning with service or event grouping
- Attendance analytics views (mix, timeline, and funnel)
- Date-range filtering for records and dashboard analytics
- Event manager integration with Supabase
- Edge-case handling for camera and face detection issues

## Tech Stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- face-api.js
- react-webcam
- Supabase

## Setup

1. Install dependencies

  npm install

2. Create environment file from example and set values

  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

3. Run database schema in Supabase

  - supabase/schema.sql
  - For upgrades, run supabase/patch_2026_03_29.sql

4. Ensure face-api model files are in public/models

5. Start the app

  npm run dev
