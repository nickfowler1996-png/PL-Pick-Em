import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { quarterOf } from "@/lib/matchweek";
import { computeAllowance, MULTIPLIER_LIMITS, type Multiplier } from "@/lib/scoring";
import PickBoard from "./PickBoard";

export const dynamic = "force-dynamic";

export default async function MatchweekPage({ params }: { params: { mw: string } }) {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/login?next=/matchweek/${params.mw}`);

  const mwNumber = Number(params.mw);

  const { data: mw } = await db
    .from("matchweeks")
    .select("id, mw_number, season, quarter, locks_at, send_mode")
    .eq("mw_number", mwNumber)
    .maybeSingle();

  if (!mw) {
    return <main className="wrap"><p className="note">Matchweek {params.mw} isn&apos;t scheduled yet.</p></main>;
  }

  const { data: matches } = await db
    .from("matches")
    .select("id, home_team, away_team, kickoff, status, result, voided")
    .eq("matchweek_id", mw.id)
    .order("kickoff");

  const { data: myPicks } = await db
    .from("picks")
    .select("match_id, outcome, multiplier, price_taken")
    .eq("player_id", user.id)
    .in("match_id", (matches ?? []).map((m) => m.id));

  // Allowance carried in from earlier rounds, with voided fixtures refunded.
  const { data: history } = await db
    .from("picks")
    .select("multiplier, matches!inner(voided, matchweek_id, matchweeks!inner(season, quarter))")
    .eq("player_id", user.id);

  const outsideThisWeek = (history ?? []).filter((p: any) => p.matches.matchweek_id !== mw.id);
  const shape = (rows: any[]) =>
    rows.map((p) => ({ multiplier: p.multiplier as Multiplier, voided: p.matches.voided }));

  const allowance = computeAllowance(
    shape(outsideThisWeek.filter((p: any) =>
      p.matches.matchweeks.season === mw.season && p.matches.matchweeks.quarter === mw.quarter)),
    shape(outsideThisWeek.filter((p: any) => p.matches.matchweeks.season === mw.season))
  );

  return (
    <PickBoard
      matchweek={{
        number: mw.mw_number,
        quarter: mw.quarter,
        locksAt: mw.locks_at,
        compressed: mw.send_mode === "compressed",
      }}
      matches={(matches ?? []).map((m) => ({
        id: m.id,
        home: m.home_team,
        away: m.away_team,
        kickoff: m.kickoff,
        status: m.status,
        voided: m.voided,
      }))}
      initialPicks={Object.fromEntries(
        (myPicks ?? []).map((p) => [p.match_id, {
          outcome: p.outcome, multiplier: p.multiplier as Multiplier, priceTaken: p.price_taken,
        }])
      )}
      allowance={allowance}
      limits={MULTIPLIER_LIMITS}
    />
  );
}
