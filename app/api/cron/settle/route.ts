import { NextResponse } from "next/server";
import { evaluateMatchweek, settleAllPlayers, matchweekWinners } from "@/lib/settle";
import { isQuarterEnd } from "@/lib/matchweek";
import { sendResultsRecap } from "@/lib/email";
import { requireCron } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { StoredPick } from "@/lib/scoring";
import type { MatchRow } from "@/lib/settle";

export const dynamic = "force-dynamic";

/**
 * Settle any matchweek whose last match has finished.
 *
 * Runs hourly. A round stays open until every fixture in it is done, so nothing
 * appears on the leaderboard mid-weekend. Postponed fixtures are voided rather
 * than waited on, and a 24-hour grace window past the last kickoff stops a
 * rearranged fixture freezing the table indefinitely.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = supabaseAdmin();

  const { data: matchweeks, error } = await db
    .from("matchweeks")
    .select("id, mw_number, season, quarter, last_kickoff, locks_at, settled_at")
    .is("settled_at", null)
    .lt("first_kickoff", new Date().toISOString())
    .order("mw_number");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settled: unknown[] = [];
  const waiting: unknown[] = [];

  for (const mw of matchweeks ?? []) {
    const { data: matches } = await db
      .from("matches")
      .select("id, status, result, kickoff")
      .eq("matchweek_id", mw.id);

    // Supabase infers enum columns as plain strings, so narrow them here.
    const rows: MatchRow[] = (matches ?? []).map((m) => ({
      matchId: m.id,
      status: m.status as MatchRow["status"],
      result: m.result as MatchRow["result"],
      kickoff: new Date(m.kickoff),
    }));

    const decision = evaluateMatchweek(
      rows,
      {
        lastKickoff: new Date(mw.last_kickoff),
        alreadySettled: Boolean(mw.settled_at),
      }
    );

    if (!decision.ready) {
      waiting.push({ matchweek: mw.mw_number, reason: decision.reason, waitingOn: decision.waitingOn });
      continue;
    }

    // Everyone active is settled, whether or not they submitted anything.
    const { data: players } = await db
      .from("players")
      .select("id, display_name, email")
      .eq("active", true);

    const matchIds = decision.matches.map((m) => m.matchId);
    const { data: picks } = await db
      .from("picks")
      .select("player_id, match_id, outcome, multiplier, price_taken")
      .in("match_id", matchIds);

    const byPlayer = new Map<string, StoredPick[]>();
    for (const p of picks ?? []) {
      if (!byPlayer.has(p.player_id)) byPlayer.set(p.player_id, []);
      byPlayer.get(p.player_id)!.push({
        matchId: p.match_id,
        outcome: p.outcome as StoredPick["outcome"],
        multiplier: p.multiplier as StoredPick["multiplier"],
        priceTaken: p.price_taken,
      });
    }

    const results = settleAllPlayers(
      (players ?? []).map((p) => p.id),
      decision.matches,
      byPlayer
    );

    // Write per-pick amounts so the recap can show the line-by-line breakdown.
    for (const r of results) {
      for (const line of r.lines) {
        if (line.reason !== "settled") continue;
        await db
          .from("picks")
          .update({ settled_amount: line.amount })
          .eq("player_id", r.playerId)
          .eq("match_id", line.matchId);
      }
    }

    await db.from("matchweek_results").upsert(
      results.map((r) => ({
        player_id: r.playerId,
        matchweek_id: mw.id,
        total: r.total,
        missed_matches: r.missedMatches,
        voided_matches: r.voidedMatches,
      }))
    );

    await db.from("matches").update({ voided: true }).in(
      "id",
      decision.matches.filter((m) => m.voided).map((m) => m.matchId)
    );

    await db.from("matchweeks").update({ settled_at: new Date().toISOString() }).eq("id", mw.id);

    await sendResultsRecap({
      db,
      matchweek: mw,
      results,
      winners: matchweekWinners(results),
      isQuarterEnd: isQuarterEnd(mw.mw_number),
    });

    settled.push({
      matchweek: mw.mw_number,
      players: results.length,
      voided: decision.voidedCount,
      winners: matchweekWinners(results),
    });
  }

  return NextResponse.json({ settled, waiting });
}
