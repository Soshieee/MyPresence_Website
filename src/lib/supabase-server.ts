import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ServerSupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

export function getServerSupabaseConfig(): ServerSupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Server Supabase configuration is incomplete.");
  }

  return { url, anonKey, serviceRoleKey };
}

export function createServerAuthClient(config: ServerSupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function createServerServiceClient(config: ServerSupabaseConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function getConfiguredSiteUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configured) {
    try {
      const parsed = new URL(configured);
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    } catch {
      // Fall through to the request origin if the configured value is malformed.
    }
  }

  return new URL(request.url).origin;
}

export function isServerConfigError(error: unknown): boolean {
  return error instanceof Error && error.message === "Server Supabase configuration is incomplete.";
}
