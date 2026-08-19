import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Sends you to whichever matchweek is currently open for picks. */
export default async function Home() {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date().toISOString();

  const { data: open } = await db
    .from("matchweeks")
    .select("mw_number")
    .gt("locks_at", now)
    .order("mw_number")
    .limit(1)
    .maybeSingle();

  if (open) redirect(`/matchweek/${open.mw_number}`);
  redirect("/standings");
}
