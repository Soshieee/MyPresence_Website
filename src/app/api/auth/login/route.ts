import {
  createServerAuthClient,
  createServerServiceClient,
  getServerSupabaseConfig,
  isServerConfigError
} from "@/lib/supabase-server";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

type LoginStatusRow = {
  out_allowed: boolean;
  out_failed_count: number;
  out_retry_after_seconds: number;
};

type LoginFailureRow = {
  out_failed_count: number;
  out_locked_until: string | null;
  out_retry_after_seconds: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value: unknown) {
  return text(value).trim().toLowerCase();
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function logAuthError(operation: string, error: unknown) {
  const details =
    typeof error === "object" && error !== null
      ? error as { message?: unknown; code?: unknown; status?: unknown }
      : {};

  console.error(`Login API failed during ${operation}.`, {
    code: typeof details.code === "string" ? details.code : undefined,
    status: typeof details.status === "number" ? details.status : undefined,
    message: typeof details.message === "string" ? details.message : String(error)
  });
}

function lockoutResponse(retryAfterSeconds: number) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));

  return json(
    {
      error: `Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      code: "ACCOUNT_LOCKED",
      retryAfterSeconds: retryAfter
    },
    429,
    { "Retry-After": String(retryAfter) }
  );
}

export async function POST(request: Request) {
  let body: LoginBody;

  try {
    body = await request.json() as LoginBody;
  } catch {
    return json({ error: "Invalid sign-in request." }, 400);
  }

  const email = normalizeEmail(body.email);
  const password = text(body.password);

  if (!email || !password) {
    return json({ error: "Email and password are required." }, 400);
  }

  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  if (password.length > 4096) {
    return json({ error: "The password is too long." }, 400);
  }

  try {
    const config = getServerSupabaseConfig();
    const adminClient = createServerServiceClient(config);
    const authClient = createServerAuthClient(config);

    const { data: statusData, error: statusError } = await adminClient.rpc("auth_login_status", {
      p_email: email
    });

    if (statusError) {
      logAuthError("lockout status lookup", statusError);
      return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
    }

    const statusRow = firstRow<LoginStatusRow>(statusData);

    if (!statusRow) {
      logAuthError("lockout status lookup", new Error("No lockout status row was returned."));
      return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
    }

    if (!statusRow.out_allowed) {
      return lockoutResponse(Number(statusRow.out_retry_after_seconds) || 900);
    }

    let signInResult: Awaited<ReturnType<typeof authClient.auth.signInWithPassword>>;

    try {
      signInResult = await authClient.auth.signInWithPassword({ email, password });
    } catch (error) {
      logAuthError("Supabase sign-in request", error);
      return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
    }

    const { data: signInData, error: signInError } = signInResult;

    if (signInError) {
      if (signInError.status === 429) {
        return json(
          { error: "Too many sign-in requests. Please wait a moment and try again.", code: "AUTH_RATE_LIMITED" },
          429,
          { "Retry-After": "60" }
        );
      }

      if (typeof signInError.status === "number" && signInError.status >= 500) {
        logAuthError("Supabase sign-in", signInError);
        return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
      }

      const { data: failureData, error: failureError } = await adminClient.rpc("auth_login_failure", {
        p_email: email
      });

      if (failureError) {
        logAuthError("failed-attempt tracking", failureError);
        return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
      }

      const failureRow = firstRow<LoginFailureRow>(failureData);

      if (!failureRow) {
        logAuthError("failed-attempt tracking", new Error("No failed-attempt row was returned."));
        return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
      }

      const failedCount = Math.max(0, Number(failureRow.out_failed_count) || 0);
      const retryAfterSeconds = Math.max(0, Number(failureRow.out_retry_after_seconds) || 0);

      if (retryAfterSeconds > 0) {
        return lockoutResponse(retryAfterSeconds);
      }

      if (failedCount >= 3) {
        const remainingAttempts = Math.max(0, 5 - failedCount);

        if (remainingAttempts > 0) {
          return json(
            {
              error: "Incorrect email or password. If you recently registered, verify your email before signing in.",
              code: "INVALID_CREDENTIALS",
              warning:
                `Too many failed attempts. ${remainingAttempts} ${remainingAttempts === 1 ? "attempt" : "attempts"} remaining before a temporary 15-minute lockout.`,
              remainingAttempts
            },
            401
          );
        }
      }

      return json(
        {
          error: "Incorrect email or password. If you recently registered, verify your email before signing in.",
          code: "INVALID_CREDENTIALS"
        },
        401
      );
    }

    const session = signInData.session;

    if (!session) {
      logAuthError("Supabase sign-in response", new Error("Sign-in succeeded without a session."));
      return json(
        { error: "Sign-in could not be completed. Please contact an administrator." },
        401
      );
    }

    const { error: resetError } = await adminClient.rpc("auth_login_success", {
      p_email: email
    });

    if (resetError) {
      // Do not block a valid sign-in because a security counter could not be
      // cleared. The next successful sign-in will try again.
      logAuthError("successful-login reset", resetError);
    }

    return json({
      ok: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in
    });
  } catch (error) {
    if (isServerConfigError(error)) {
      logAuthError("server configuration", error);
      return json({ error: "Sign-in is not configured on the server." }, 500);
    }

    logAuthError("unexpected error", error);
    return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 500);
  }
}
