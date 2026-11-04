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

function logRegistrationFailure(operation: string, error: unknown, context?: Record<string, unknown>) {
  const details =
    typeof error === "object" && error !== null
      ? error as { message?: unknown; code?: unknown; status?: unknown; details?: unknown; hint?: unknown }
      : {};

  console.error(`Website registration failed during ${operation}.`, {
    ...context,
    code: typeof details.code === "string" ? details.code : undefined,
    status: typeof details.status === "number" ? details.status : undefined,
    message: typeof details.message === "string" ? details.message : String(error),
    details: typeof details.details === "string" ? details.details : undefined,
    hint: typeof details.hint === "string" ? details.hint : undefined
  });
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

    let url: string;
    let anonKey: string;
    let serviceRoleKey: string;

    try {
      ({ url, anonKey, serviceRoleKey } = getServerEnv());
    } catch (error) {
      logRegistrationFailure("server configuration", error, {
        missing: [
          !process.env.NEXT_PUBLIC_SUPABASE_URL ? "NEXT_PUBLIC_SUPABASE_URL" : null,
          !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
          !process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null
        ].filter(Boolean)
      });
      return Response.json({ error: "Registration is not configured on the server." }, { status: 500 });
    }

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const redirectTo = `${new URL(request.url).origin}/auth/callback`;

    type SignUpResult = Awaited<ReturnType<typeof authClient.auth.signUp>>;
    let signUpData: SignUpResult["data"];
    let signUpError: SignUpResult["error"];

    try {
      ({ data: signUpData, error: signUpError } = await authClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { first_name: firstName, last_name: lastName }
        }
      }));
    } catch (error) {
      logRegistrationFailure("Supabase Auth sign-up request", error);
      return Response.json({ error: "The account could not be created by Supabase Auth." }, { status: 502 });
    }

    if (signUpError) {
      logRegistrationFailure("Supabase Auth sign-up", signUpError);
      return Response.json({ error: signUpError.message }, { status: 400 });
    }

    if (!signUpData.user) {
      logRegistrationFailure("Supabase Auth sign-up response", new Error("Supabase returned no user or error."), {
        hasSession: Boolean(signUpData.session)
      });
      return Response.json(
        {
          error:
            "Supabase did not create the account. Check that email signups are enabled and that this site URL is allowed in Supabase Auth settings."
        },
        { status: 502 }
      );
    }

    if (signUpData.user.identities?.length === 0) {
      return Response.json(
        { error: "An account with this email already exists. Return to login or use Forgot Password." },
        { status: 400 }
      );
    }

    const userId = signUpData.user.id;

    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });

    if (profileError) {
      logRegistrationFailure("profiles upsert", profileError, { userId });
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
      if (cleanupError) logRegistrationFailure("Auth cleanup after profiles failure", cleanupError, { userId });
      return Response.json({ error: "The account profile could not be created." }, { status: 500 });
    }

    const { error: verificationError } = await adminClient.from("user_verifications").upsert({
      user_id: userId,
      status: "pending",
      account_type: "web_admin"
    }, { onConflict: "user_id" });

    if (verificationError) {
      logRegistrationFailure("user_verifications upsert", verificationError, { userId });
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
      if (cleanupError) logRegistrationFailure("Auth cleanup after verification failure", cleanupError, { userId });
      return Response.json({ error: "The verification application could not be created." }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Website registration failed:", error);
    return Response.json({ error: "Registration is temporarily unavailable." }, { status: 500 });
  }
}
