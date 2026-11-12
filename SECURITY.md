# Security Policy — MyPresence (HPCI Thrive)

## Reporting a vulnerability

Email the system administrator directly (the account that owns the Supabase
project), or raise a private GitHub security advisory via
**Repository → Security → Advisories → New draft security advisory**.
Please do not open public issues for anything security-sensitive.

## Security posture (what protects this system)

| Layer | Control |
|---|---|
| Account creation | Public self-registration is disabled server-side (`/api/auth/register` returns 403). Accounts exist only by administrator invitation (P6) and become administrators on activation — the invite itself is the trust decision. |
| Authentication | Supabase Auth with email confirmation, OTP-based password reset, and login lockout (5 failures → 15-minute lock, hashed emails, service-role-only RPCs). |
| Authorization | Row Level Security on every table. The dev `allow-all` policies were replaced by role-aware policies (P0). Admin checks run in the database (`is_admin()` / `app_admins`), not just in the UI. |
| Privileged operations | Destructive RPCs (`delete_member`, `delete_event`) require the administrator role inside the function. Invitation tracking and auth-lockout tables are writable only through the service-role server routes. |
| Secrets | `SUPABASE_SERVICE_ROLE_KEY` and the anon key live only in environment variables (`.env.local` is gitignored; Vercel env vars in production). The service-role key is never imported by client code. |
| Biometric data | Face descriptors (128-d embeddings, no images) are stored in `public.users.descriptor` and are fetched only by the scanner and enrollment flows. The kiosk display never receives biometric data — it renders a locally-streamed preview and first names only. |
| Feedback privacy | Members see their own submissions; administrators read aggregates and comments through RLS (`is_event_feedback_admin()` / `is_admin()`). Anonymous visitors have no grants on feedback, members, or attendance. |
| Public display | The kiosk route has no database access and renders only broadcast outcomes, sanitized status text, and a locally-streamed camera preview. |
| Supply chain | Dependabot (npm + GitHub Actions) and CodeQL (security-extended) run weekly; CI lints and builds every push. |

## Known accepted risks (documented, monitored)

- The scanner and analytics pages run in the browser with the anon key;
  RLS is the enforcement layer. The face descriptor column is readable by
  authenticated accounts that need it for on-device matching — moving
  matching server-side would remove even that exposure (planned improvement).
- Login lockout is keyed per email (no IP throttle) — a deliberate,
  documented trade-off.
- Kiosk broadcast payloads (first name + outcome + local camera preview)
  are visible to anyone holding the public anon key; they contain no
  identifiers beyond a first name.

## Verified practices for contributors

- Never commit `.env.local`, service-role keys, or Brevo credentials.
- Never weaken an RLS policy to make a UI flow work — change the UI flow.
- All new tables must enable RLS with explicit role policies.
- Prefer security-definer RPCs with internal role checks for privileged
  writes.
