import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

/** Where magic links land. Exchanges the code for a session, then redirects. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const { error } = await supabaseServer().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=expired", url.origin));
}
