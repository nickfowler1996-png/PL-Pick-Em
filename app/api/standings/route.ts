import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { buildStandings } from "@/lib/scoring";
import { quarterRange, quarterOf } from "@/lib/matchweek";

export const dynamic = "force-dynamic";

/** Standings plus the current round's progress. Polled by the live table. */
export async function GET() {
  const db = supabaseServer();

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: players } = await db.from("players").select("id, display_name").eq("active", true);
  const { data: results } = await db
    .from("matchweek_results")
    .select("player_id, total, matchweeks!inner(mw_number)");

  const latest = await db
    .from("matchweeks")
    .select("id, mw_number, settled_at")
    .lt("first_kickoff", new Date().toISOString())
    .order("mw_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentMw = latest.data?.mw_number ?? 1;
  const nameById = new Map((players ?? []).map((p) => [p.id, p.display_name]));

  const rows = buildStandings(
    (results ?? []).map((r: any) => ({
      playerId: r.player_id,
      matchweek: r.matchweeks.mw_number,
      total: Number(r.total),
    })),
    quarterRange(currentMw)
  ).map((r) => ({
    playerId: r.playerId,
    name: nameById.get(r.playerId) ?? "Unknown",
    quarterTotal: r.quarterTotal,
    seasonTotal: r.seasonTotal,
    matchweeksWon: r.matchweeksWon,
  }));

  let progress = null;
  if (latest.data) {
    const { data: matches } = await db.from("matches").select("status").eq("matchweek_id", latest.data.id);
    progress = {
      matchweek: currentMw,
      finished: (matches ?? []).filter((m) => m.status === "FINISHED").length,
      total: (matches ?? []).length,
      settled: Boolean(latest.data.settled_at),
    };
  }

  return NextResponse.json({ rows, progress, quarter: quarterOf(currentMw).q });
}
