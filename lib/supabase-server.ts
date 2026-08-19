import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Supabase rejects a URL with a trailing slash — it builds
 * `https://x.supabase.co//rest/v1/...` and returns "Invalid path specified in
 * request URL". Pasting a URL with a trailing slash is easy to do and hard to
 * spot, so normalise it here instead.
 */
function cleanUrl(raw: string | undefined, name: string): string {
  if (!raw) throw new Error(`${name} is not set`);
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(trimmed)) {
    throw new Error(
      `${name} looks wrong: "${trimmed}". Expected https://<project-id>.supabase.co`
    );
  }
  return trimmed;
}

/** Request-scoped client. Respects RLS — use for anything a player does. */
export function supabaseServer() {
  const store = cookies();
  return createServerClient(
    cleanUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
          catch { /* called from a Server Component; middleware handles refresh */ }
        },
      },
    }
  );
}

/** Bypasses RLS. Cron jobs and settlement only — never a user request. */
export const supabaseAdmin = () =>
  createClient(
    cleanUrl(process.env.SUPABASE_URL, "SUPABASE_URL"),
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
