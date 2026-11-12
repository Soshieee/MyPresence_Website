const SESSION_HINT_COOKIE = "mp_auth_hint";
const SESSION_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Lightweight session marker used by src/proxy.ts to redirect unauthenticated
 * visitors away from app pages at the server level.
 *
 * IMPORTANT: this cookie is client-controlled and is NOT an authentication
 * mechanism. It only improves the redirect experience. Real authorization is
 * enforced by Supabase RLS policies (see supabase/patch_2026_11_14_p0_security_hardening.sql)
 * and the server-side auth API routes.
 */
export function setSessionHint() {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_HINT_COOKIE}=1; path=/; max-age=${SESSION_HINT_MAX_AGE_SECONDS}; samesite=lax`;
}

export function clearSessionHint() {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
