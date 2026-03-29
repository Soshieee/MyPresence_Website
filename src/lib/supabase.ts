import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const hasUrl = Boolean(supabaseUrl?.trim());
const hasKey = Boolean(supabaseAnonKey?.trim());
const looksLikeProjectApiUrl = Boolean(
  supabaseUrl?.trim().match(/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i)
);

export const supabaseEnvIssue = !hasUrl
  ? "Missing NEXT_PUBLIC_SUPABASE_URL in .env.local"
  : !hasKey
    ? "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
    : !looksLikeProjectApiUrl
      ? "NEXT_PUBLIC_SUPABASE_URL must be your project API URL like https://<project-ref>.supabase.co (not dashboard URL)"
      : null;

export const hasSupabaseEnv = supabaseEnvIssue === null;

const resolvedSupabaseUrl = hasSupabaseEnv ? supabaseUrl!.trim() : "https://placeholder.supabase.co";
const resolvedSupabaseAnonKey = hasSupabaseEnv ? supabaseAnonKey!.trim() : "placeholder-anon-key";

// Use harmless placeholders during build if env vars are not set yet.
export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey);
