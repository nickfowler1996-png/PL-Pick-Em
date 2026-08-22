import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { buildGrid, type GridPick } from "@/lib/pick-grid";

export const dynamic = "force-dynamic";

/**
 * Everyone's picks for a matchweek.
 *
 * Refuses to answer before lock. The database enforces this too, so a direct
 * query can't get round it — this check just produces a friendlier response
 * than an empty grid.
 */
export async function GET(req: Request) {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("mw"));

  // Default to the most recent matchweek that has locked.
  const now = new Date().toISOString();
  const { data: mw } = requested
    ? await db.from("matchweeks")
        .select("id, mw_number, quarter, locks_at, settled_at")
        .eq("mw_number", requested).maybeSingle()
    : await db.from("matchweeks")
        .select("id, mw_number, quarter, locks_at, settled_at")
        .lte("locks_at", now)
        .order("mw_number", { ascending: false })
        .limit(1).maybeSingle();

  if (!mw) {
    return NextResponse.json({ locked: false, reason: "no_locked_matchweek" });
  }

  const locked = new Date() >= new Date(mw.locks_at);
  if (!locked) {
    return NextResponse.json({
      locked: false,
      reason: "not_yet",
      matchweek: mw.mw_number,
      locksAt: mw.locks_at,
    });
  }

  const [{ data: matches }, { data: players }] = await Promise.all([
    db.from("matches")
      .select("id, home_team, away_team, kickoff, status, result, voided")
      .eq("matchweek_id", mw.id).order("kickoff"),
    db.from("players").select("id, display_name").eq("active", true),
  ]);

  const matchIds = (matches ?? []).map((m) => m.id);

  const { data: picks } = await db
    .from("picks")
    .select("player_id, match_id, outcome, multiplier, price_taken, settled_amount")
    .in("match_id", matchIds);

  // Which matchweeks can be browsed at all.
  const { data: available } = await db
    .from("matchweeks")
    .select("mw_number")
    .lte("locks_at", now)
    .order("mw_number");

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

  return NextResponse.json({
    locked: true,
    matchweek: mw.mw_number,
    quarter: mw.quarter,
    settled: Boolean(mw.settled_at),
    meId: user.id,
    availableMatchweeks: (available ?? []).map((a) => a.mw_number),
    ...grid,
  });
}
