import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchEplOdds, matchKey, lastQuota } from "@/lib/odds-api";
import { shouldSnapshot } from "@/lib/odds-schedule";
import { requireCron } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Take a priced snapshot of the open matchweek.
 *
 * Runs every 15 minutes, but only actually calls the odds feed when the
 * cadence in lib/odds-schedule says it's due — every 2h early in the window,
 * hourly in the last day, every 15 min in the final two hours. That keeps a
 * whole season inside the free tier.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date();

  const { data: mw } = await db
    .from("matchweeks")
    .select("id, mw_number, send_at, locks_at")
    .gt("locks_at", now.toISOString())
    .order("mw_number")
    .limit(1)
    .maybeSingle();

  if (!mw) return NextResponse.json({ skipped: "no open matchweek" });

  const { data: matches } = await db
    .from("matches")
    .select("id, home_team, away_team")
    .eq("matchweek_id", mw.id);

  if (!matches?.length) return NextResponse.json({ skipped: "no fixtures" });

  const { data: last } = await db
    .from("odds_snapshots")
    .select("fetched_at")
    .in("match_id", matches.map((m) => m.id))
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const decision = shouldSnapshot(
    new Date(mw.locks_at),
    new Date(mw.send_at),
    last ? new Date(last.fetched_at) : null,
    lastQuota()?.remaining ?? null,
    now
  );

  if (!decision.fetch) {
    return NextResponse.json({ matchweek: mw.mw_number, skipped: decision.reason });
  }

  const odds = await fetchEplOdds(true);
  const byKey = new Map(odds.map((o) => [matchKey(o.homeTeam, o.awayTeam), o]));

  const rows: { match_id: string; outcome: string; american: number; fetched_at: string }[] = [];
  const unmatched: string[] = [];

  for (const m of matches) {
    const event = byKey.get(matchKey(m.home_team, m.away_team));
    if (!event) { unmatched.push(`${m.home_team} v ${m.away_team}`); continue; }
    for (const outcome of ["HOME", "DRAW", "AWAY"] as const) {
      rows.push({
        match_id: m.id,
        outcome,
        american: event.prices[outcome],
        fetched_at: now.toISOString(),
      });
    }
  }

  if (rows.length) await db.from("odds_snapshots").insert(rows);

  return NextResponse.json({
    matchweek: mw.mw_number,
    priced: rows.length / 3,
    hoursToLock: Math.round(decision.hoursLeft * 10) / 10,
    nextInMinutes: decision.intervalMinutes,
    quotaRemaining: lastQuota()?.remaining ?? null,
    // A club here means the two feeds disagree on its name. Fix teamKey().
    unmatched,
  });
}
