import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Send you to the round you can still pick in.
 *
 * Matches lock individually, so a matchweek stays pickable until its LAST
 * kick-off — a Monday night fixture keeps the week alive all weekend. Looking
 * at the first kick-off instead would skip you to next week the moment Friday
 * started.
 */
export default async function Home() {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date().toISOString();

  const { data: open } = await db
    .from("matchweeks")
    .select("mw_number")
    .gt("last_kickoff", now)
    .order("mw_number")
    .limit(1)
    .maybeSingle();

  if (open) redirect(`/matchweek/${open.mw_number}`);
  redirect("/standings");
}
