import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { buildStandings } from "@/lib/scoring";
import { quarterRange, quarterOf } from "@/lib/matchweek";
import { buildGrid, type GridPick } from "@/lib/pick-grid";

export const dynamic = "force-dynamic";

/**
 * Standings, including the round currently in progress.
 *
 * Settled matchweeks come from matchweek_results. The live round is scored on
 * the fly from finished matches, so the table moves through the weekend
 * instead of jumping once on Monday night.
 *
 * Provisional totals are only computed once the round has locked — before
 * that nobody may read anyone else's picks, and there'd be nothing to score.
 */
export async function GET() {
  const db = supabaseServer();

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date().toISOString();

  const { data: players } = await db
    .from("players").select("id, display_name").eq("active", true);

  const { data: results } = await db
    .from("matchweek_results")
    .select("player_id, total, matchweeks!inner(mw_number)");

  const latest = await db
    .from("matchweeks")
    .select("id, mw_number, settled_at, locks_at")
    .lt("first_kickoff", now)
    .order("mw_number", { ascending: false })
    .limit(1).maybeSingle();

  const currentMw = latest.data?.mw_number ?? 1;
  const nameById = new Map((players ?? []).map((p) => [p.id, p.display_name]));

  const settledRows = (results ?? []).map((r: any) => ({
    playerId: r.player_id,
    matchweek: r.matchweeks.mw_number,
    total: Number(r.total),
  }));

  /* ---- the round in progress, scored live ---- */

  const liveMw = latest.data;
  const liveLocked = liveMw ? new Date() >= new Date(liveMw.locks_at) : false;
  const liveOpen = liveMw ? !liveMw.settled_at && liveLocked : false;

  const weekTotals = new Map<string, number | null>();
  let progress = null;

  if (liveMw) {
    const { data: matches } = await db
      .from("matches")
      .select("id, home_team, away_team, kickoff, status, result, voided")
      .eq("matchweek_id", liveMw.id).order("kickoff");

    progress = {
      matchweek: currentMw,
      finished: (matches ?? []).filter((m) => m.status === "FINISHED").length,
      total: (matches ?? []).length,
      settled: Boolean(liveMw.settled_at),
      locked: liveLocked,
    };

    if (liveOpen) {
      const matchIds = (matches ?? []).map((m) => m.id);
      const { data: picks } = await db
        .from("picks")
        .select("player_id, match_id, outcome, multiplier, price_taken, settled_amount")
        .in("match_id", matchIds);

      const grid = buildGrid(
        (matches ?? []).map((m) => ({
          id: m.id, home: m.home_team, away: m.away_team, kickoff: m.kickoff,
          result: m.result, voided: m.voided, status: m.status,
        })),
        (players ?? []).map((p) => ({ id: p.id, name: p.display_name })),
        (picks ?? []).map((p): GridPick => ({
          playerId: p.player_id, matchId: p.match_id, outcome: p.outcome,
          multiplier: p.multiplier, priceTaken: p.price_taken,
          settledAmount: p.settled_amount === null ? null : Number(p.settled_amount),
        }))
      );

      for (const t of grid.totals) weekTotals.set(t.playerId, t.total);
    }
  }

  /* ---- combine ---- */

  const [qStart, qEnd] = quarterRange(currentMw);
  const liveInQuarter = liveOpen && currentMw >= qStart && currentMw <= qEnd;

  const rows = buildStandings(settledRows, [qStart, qEnd]).map((r) => {
    const week = weekTotals.get(r.playerId) ?? null;
    return {
      playerId: r.playerId,
      name: nameById.get(r.playerId) ?? "Unknown",
      quarterTotal: r.quarterTotal + (liveInQuarter && week ? week : 0),
      seasonTotal: r.seasonTotal + (liveOpen && week ? week : 0),
      matchweeksWon: r.matchweeksWon,
      weekTotal: week,
    };
  });

  // Anyone with no settled history yet still belongs on the board.
  for (const p of players ?? []) {
    if (rows.some((r) => r.playerId === p.id)) continue;
    const week = weekTotals.get(p.id) ?? null;
    rows.push({
      playerId: p.id,
      name: p.display_name,
      quarterTotal: liveInQuarter && week ? week : 0,
      seasonTotal: liveOpen && week ? week : 0,
      matchweeksWon: 0,
      weekTotal: week,
    });
  }

  return NextResponse.json({
    rows,
    progress,
    quarter: quarterOf(currentMw).q,
    // True when the totals above include a round that hasn't closed yet.
    provisional: liveOpen && weekTotals.size > 0,
    liveMatchweek: liveOpen ? currentMw : null,
  });
}
