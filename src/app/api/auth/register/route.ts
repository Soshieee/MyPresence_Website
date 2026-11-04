import { createClient } from "@supabase/supabase-js";

type RegistrationBody = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  password?: unknown;
};

function getServerEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Server Supabase configuration is incomplete.");
  }

  return { url, anonKey, serviceRoleKey };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as RegistrationBody;
    const firstName = text(body.firstName);
    const lastName = text(body.lastName);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    if (!firstName || !lastName || !email || !password) {
      return Response.json({ error: "First name, last name, email, and password are required." }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters long." }, { status: 400 });
    }

    const { url, anonKey, serviceRoleKey } = getServerEnv();
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const redirectTo = `${new URL(request.url).origin}/auth/callback`;

    const { data: signUpData, error: signUpError } = await authClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { first_name: firstName, last_name: lastName }
      }
    });

    if (signUpError || !signUpData.user || signUpData.user.identities?.length === 0) {
      return Response.json({ error: signUpError?.message ?? "Unable to create the account." }, { status: 400 });
    }

    const userId = signUpData.user.id;
    const { data: existingVerification, error: existingVerificationError } = await adminClient
      .from("user_verifications")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingVerificationError) {
      await adminClient.auth.admin.deleteUser(userId);
      return Response.json({ error: "The verification application could not be checked." }, { status: 500 });
    }

    if (existingVerification) {
      await adminClient.auth.admin.deleteUser(userId);
      return Response.json({ error: "Unable to create the account." }, { status: 400 });
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });

    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      return Response.json({ error: "The account profile could not be created." }, { status: 500 });
    }

    const { error: verificationError } = await adminClient.from("user_verifications").upsert({
      user_id: userId,
      status: "pending",
      account_type: "web_admin"
    }, { onConflict: "user_id" });

    if (verificationError) {
      await adminClient.auth.admin.deleteUser(userId);
      return Response.json({ error: "The verification application could not be created." }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Website registration failed:", error);
    return Response.json({ error: "Registration is temporarily unavailable." }, { status: 500 });
  }
}
