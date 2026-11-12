import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfiguredSiteUrl } from "@/lib/supabase-server";

// P6 — Administrator-controlled account provisioning.
// POST /api/auth/invite { email } — sends (or re-sends) a Supabase Auth
// invitation to the given address. Requires an authenticated administrator
// (Bearer token verified against app_admins). Supabase Auth owns the secure
// activation link and delivers the email through the project's custom SMTP
// (Brevo). No passwords are ever sent or set here.

function getServerEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Server Supabase configuration is incomplete.");
  }

  return { url, anonKey, serviceRoleKey };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findAuthUserByEmail(
  adminClient: SupabaseClient,
  email: string
) {
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const match = data.users.find((user) => (user.email ?? "").toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    let url: string;
    let anonKey: string;
    let serviceRoleKey: string;
    try {
      ({ url, anonKey, serviceRoleKey } = getServerEnv());
    } catch {
      return Response.json({ error: "Invitations are not configured on the server." }, { status: 500 });
    }

    const adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Verify the caller is a signed-in administrator.
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) {
      return Response.json({ error: "Sign in to manage invitations." }, { status: 401 });
    }
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      return Response.json({ error: "Sign in to manage invitations." }, { status: 401 });
    }
    const { data: adminRow, error: adminError } = await adminClient
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (adminError || !adminRow) {
      return Response.json({ error: "Administrator access required." }, { status: 403 });
    }

    const existing = await findAuthUserByEmail(adminClient, email);
    let resent = false;
    if (existing) {
      const isActive = Boolean(existing.email_confirmed_at) || Boolean(existing.last_sign_in_at);
      if (isActive) {
        return Response.json(
          { error: "This email already has an active account. Manage it in the Verification Center." },
          { status: 409 }
        );
      }
      // Existing unconfirmed account: re-send the invitation.
      resent = true;
    }

    const redirectTo = `${getConfiguredSiteUrl(request)}/auth/complete-invite`;
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo
    });

    if (inviteError) {
      const message = inviteError.message ?? "";
      if (/already/i.test(message) && /registered|confirmed|invited/i.test(message)) {
        return Response.json(
          { error: "This email already has an active account or was just invited." },
          { status: 409 }
        );
      }
      return Response.json(
        { error: message || "The invitation could not be sent. Check the project's SMTP settings." },
        { status: 502 }
      );
    }

    // Track the invitation (one pending row per email).
    const sentAt = new Date().toISOString();
    const { data: pendingRow } = await adminClient
      .from("account_invitations")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingRow) {
      await adminClient
        .from("account_invitations")
        .update({ sent_at: sentAt, invited_by: userData.user.id })
        .eq("id", pendingRow.id);
    } else {
      const { error: insertError } = await adminClient.from("account_invitations").insert({
        email,
        invited_by: userData.user.id,
        sent_at: sentAt
      });
      if (insertError && insertError.code === "23505") {
        await adminClient
          .from("account_invitations")
          .update({ sent_at: sentAt, invited_by: userData.user.id })
          .eq("email", email)
          .eq("status", "pending");
      } else if (insertError) {
        return Response.json(
          { error: `The invitation was sent, but tracking failed: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    return Response.json({
      ok: true,
      resent,
      message: resent
        ? `Invitation re-sent to ${email}.`
        : `Invitation sent to ${email}. They will receive an activation link by email.`
    });
  } catch (error) {
    console.error("Invitation failed:", error);
    return Response.json({ error: "The invitation could not be processed." }, { status: 500 });
  }
}
