import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { quarterOf } from "@/lib/matchweek";
import StandingsLive from "./StandingsLive";

export const dynamic = "force-dynamic";

export default async function Standings() {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const { data: latest } = await db
    .from("matchweeks")
    .select("mw_number")
    .lt("first_kickoff", new Date().toISOString())
    .order("mw_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const quarter = quarterOf(latest?.mw_number ?? 1).q;

  return (
    <main className="wrap">
      <header className="mast">
        <div>
          <div className="eyebrow">Premier League · Quarter {quarter}</div>
          <h1 className="display">Standings</h1>
        </div>
        <a className="lock" href="/">Back to picks →</a>
      </header>
      <StandingsLive initialRows={[]} initialProgress={null} quarter={quarter} meId={user.id} />
    </main>
  );
}
