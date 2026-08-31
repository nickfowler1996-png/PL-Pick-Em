import { NextResponse } from "next/server";
import { fetchMatchdayFixtures } from "@/lib/football-data";
import { requireCron } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const SEASON_START_YEAR = Number(process.env.SEASON_START_YEAR ?? "2026");

/**
 * Pull scores for any matchweek that's under way but not yet settled.
 *
 * Runs every 30 minutes. sync-fixtures already does this, but only once a
 * night and across all 380 matches — which meant a Saturday result didn't
 * surface until Sunday morning, and a round finishing Sunday night couldn't
 * settle until Monday. This touches one matchday at a time.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  // Rounds that have started and haven't closed. Usually one; occasionally two
  // when a postponed fixture holds an earlier round open.
  const { data: live, error } = await db
    .from("matchweeks")
    .select("id, mw_number")
    .lte("first_kickoff", now)
    .is("settled_at", null)
    .order("mw_number");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!live?.length) return NextResponse.json({ skipped: "no round in progress" });

  const updated: unknown[] = [];
  const errors: string[] = [];

  for (const mw of live) {
    const fixtures = await fetchMatchdayFixtures(SEASON_START_YEAR, mw.mw_number);
    let written = 0;
    let finished = 0;

    for (const f of fixtures) {
      if (f.status === "FINISHED") finished++;

      const { error: upErr } = await db
        .from("matches")
        .update({
          home_score: f.homeScore,
          away_score: f.awayScore,
          status: f.status,
          result: f.result,
        })
        .eq("fd_match_id", f.fdMatchId);

      if (upErr) {
        if (errors.length < 3) errors.push(`${f.fdMatchId}: ${upErr.message}`);
        continue;
      }
      written++;
    }

    updated.push({
      matchweek: mw.mw_number,
      fixtures: fixtures.length,
      finished,
      written,
    });
  }

  return NextResponse.json(
    { updated, errors },
    { status: errors.length > 0 ? 500 : 200 }
  );
}
