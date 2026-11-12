// P0 security hardening: public self-registration is disabled.
// Accounts are created only through administrator-controlled provisioning
// (Supabase Auth admin invitations — implemented in a later phase).
// Any sign-up attempt is rejected server-side regardless of Supabase Auth
// project settings, so hiding the UI alone is never the enforcement point.

export async function POST() {
  return Response.json(
    {
      error:
        "Account creation is disabled. MyPresence accounts are created by administrator invitation. Please contact your system administrator."
    },
    { status: 403 }
  );
}
