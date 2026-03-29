# Face Recognition Attendance System

A web-based attendance app built with Next.js, Tailwind CSS, face-api.js, react-webcam, and Supabase.

## Features

- User registration with webcam face capture and descriptor extraction
- Real-time attendance scanning with face matching threshold of 0.5
- Duplicate attendance prevention for the same user on the same day
- Attendance records view with date filtering
- Edge-case handling:
  - no face detected
  - multiple faces detected
  - low-confidence match
  - camera permission denied

## Tech Stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- face-api.js
- react-webcam
- Supabase (`@supabase/supabase-js`)

## Setup

1. Install dependencies

```bash
npm install
```

2. Create environment file

```bash
cp .env.example .env.local
```

Set values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. Create tables in Supabase SQL editor

- Run [supabase/schema.sql](supabase/schema.sql)

4. Add face-api.js model files

- Copy required model files into [public/models](public/models)
- See [public/models/README.md](public/models/README.md)

5. Start app

```bash
npm run dev
```

## Routes

- `/register`: register a user with webcam capture
- `/attendance`: live attendance scanner
- `/records`: attendance logs with date filter

## Notes

- `users.descriptor` is stored as JSON array and converted to `Float32Array` during matching.
- Attendance matching uses `faceapi.FaceMatcher` with threshold `0.5`.
- Duplicate prevention is handled both client-side and with DB unique constraint `(student_id, attended_date)`.
