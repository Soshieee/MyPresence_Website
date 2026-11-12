import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// P6 — Invitation management.
// GET  /api/auth/invitations — list tracked invitations (admin only).
// POST /api/auth/invitations { id, action: "cancel" } — cancel a pending
// invitation. When the invited person never activated (no confirmed email and
// no sign-in), the pre-created Auth account is removed so the link can never
// be used later. Active accounts are never touched.

function getServerEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Server Supabase configuration is incomplete.");
  }

  return { url, anonKey, serviceRoleKey };
}

async function requireAdmin(
  request: Request,
  url: string,
  anonKey: string,
  serviceRoleKey: string
) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return { error: "Sign in to manage invitations.", status: 401 as const };
  }
  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return { error: "Sign in to manage invitations.", status: 401 as const };
  }
  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: adminRow, error: adminError } = await adminClient
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (adminError || !adminRow) {
    return { error: "Administrator access required.", status: 403 as const };
  }
  return { userId: userData.user.id, adminClient };
}

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

export async function GET(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getServerEnv();
    const auth = await requireAdmin(request, url, anonKey, serviceRoleKey);
    if ("error" in auth) {
      return Response.json({ error: auth.error }, { status: auth.status });
    }

    const { data, error } = await auth.adminClient
      .from("account_invitations")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(200);

    if (error) {
      return Response.json(
        { error: `Invitations could not be loaded: ${error.message}` },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, invitations: data ?? [] });
  } catch (error) {
    console.error("Invitation list failed:", error);
    return Response.json({ error: "Invitations could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown;
      action?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!id || action !== "cancel") {
      return Response.json({ error: "A invitation id and the cancel action are required." }, { status: 400 });
    }

    const { url, anonKey, serviceRoleKey } = getServerEnv();
    const auth = await requireAdmin(request, url, anonKey, serviceRoleKey);
    if ("error" in auth) {
      return Response.json({ error: auth.error }, { status: auth.status });
    }

    const { data: row, error: rowError } = await auth.adminClient
      .from("account_invitations")
      .select("id, email, status")
      .eq("id", id)
      .maybeSingle();

    if (rowError || !row) {
      return Response.json({ error: "Invitation not found." }, { status: 404 });
    }
    if (row.status !== "pending") {
      return Response.json(
        { error: `Only pending invitations can be canceled (this one is ${row.status}).` },
        { status: 400 }
      );
    }

    // Remove the pre-created Auth account only while it is still dormant, so
    // a canceled link can never be activated afterwards.
    let accountRemoved = false;
    const user = await findAuthUserByEmail(auth.adminClient, row.email);
    if (user && !user.email_confirmed_at && !user.last_sign_in_at) {
      const { error: deleteError } = await auth.adminClient.auth.admin.deleteUser(user.id);
      if (deleteError) {
        return Response.json(
          { error: `The invitation was not canceled: ${deleteError.message}` },
          { status: 502 }
        );
      }
      accountRemoved = true;
    } else if (user) {
      return Response.json(
        {
          error:
            "This account is already active (signed in or confirmed), so it cannot be canceled here. Manage it in the Verification Center."
        },
        { status: 409 }
      );
    }

    const { error: updateError } = await auth.adminClient
      .from("account_invitations")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      return Response.json(
        { error: `The invitation could not be canceled: ${updateError.message}` },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      accountRemoved,
      message: accountRemoved
        ? `Invitation canceled and the unused account for ${row.email} was removed.`
        : `Invitation for ${row.email} was canceled.`
    });
  } catch (error) {
    console.error("Invitation cancellation failed:", error);
    return Response.json({ error: "The invitation could not be canceled." }, { status: 500 });
  }
}
