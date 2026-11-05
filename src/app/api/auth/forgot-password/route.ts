import {
  createServerAuthClient,
  createServerServiceClient,
  getConfiguredSiteUrl,
  getServerSupabaseConfig,
  isServerConfigError
} from "@/lib/supabase-server";

type ForgotPasswordBody = {
  email?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value: unknown) {
  return text(value).trim().toLowerCase();
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

function logResetError(operation: string, error: unknown) {
  const details =
    typeof error === "object" && error !== null
      ? error as { message?: unknown; code?: unknown; status?: unknown }
      : {};

  console.error(`Forgot-password API failed during ${operation}.`, {
    code: typeof details.code === "string" ? details.code : undefined,
    status: typeof details.status === "number" ? details.status : undefined,
    message: typeof details.message === "string" ? details.message : String(error)
  });
}

async function waitForMinimumDuration(startedAt: number, minimumMs: number) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: ForgotPasswordBody;

  try {
    body = await request.json() as ForgotPasswordBody;
  } catch {
    return json({ error: "Invalid password reset request." }, 400);
  }

  const email = normalizeEmail(body.email);

  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  try {
    const config = getServerSupabaseConfig();
    const adminClient = createServerServiceClient(config);
    const authClient = createServerAuthClient(config);

    const { data: resetStatus, error: resetCheckError } = await adminClient.rpc(
      "auth_begin_password_reset",
      { p_email: email }
    );

    if (resetCheckError) {
      logResetError("account and rate-limit check", resetCheckError);
      await waitForMinimumDuration(startedAt, 450);
      return json({ error: "Password reset is temporarily unavailable. Please try again." }, 503);
    }

    // The SQL function reports one of three statuses so the login page can give
    // precise feedback instead of an intentionally generic reply.
    if (resetStatus === "sent") {
      const redirectTo = `${getConfiguredSiteUrl(request)}/auth/reset-password`;
      const { error: sendError } = await authClient.auth.resetPasswordForEmail(email, {
        redirectTo
      });

      if (sendError) {
        logResetError("Supabase reset email request", sendError);
        await waitForMinimumDuration(startedAt, 450);
        return json(
          { error: "The reset email could not be sent right now. Please try again." },
          502
        );
      }

      await waitForMinimumDuration(startedAt, 450);
      return json({ ok: true, message: "A password reset code has been sent." });
    }

    if (resetStatus === "rate_limited") {
      await waitForMinimumDuration(startedAt, 450);
      return json(
        {
          error: "Too many reset requests. Please wait a few minutes and try again.",
          code: "RESET_RATE_LIMITED",
          retryAfterSeconds: 900
        },
        429,
        { "Retry-After": "900" }
      );
    }

    if (resetStatus === "not_found") {
      await waitForMinimumDuration(startedAt, 450);
      return json(
        {
          error: "No account found for that email.",
          code: "EMAIL_NOT_FOUND"
        },
        404
      );
    }

    logResetError(
      "reset status check",
      new Error(`Unexpected reset status: ${String(resetStatus)}`)
    );
    await waitForMinimumDuration(startedAt, 450);
    return json({ error: "Password reset is temporarily unavailable. Please try again." }, 503);
  } catch (error) {
    if (isServerConfigError(error)) {
      logResetError("server configuration", error);
      await waitForMinimumDuration(startedAt, 450);
      return json({ error: "Password reset is not configured on the server." }, 500);
    }

    logResetError("unexpected error", error);
    await waitForMinimumDuration(startedAt, 450);
    return json({ error: "Password reset is temporarily unavailable. Please try again." }, 500);
  }
}
