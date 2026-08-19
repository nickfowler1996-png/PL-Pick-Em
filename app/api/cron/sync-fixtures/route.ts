import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchSeasonFixtures } from "@/lib/football-data";
import { groupIntoMatchweeks, computeSendWindow, quarterOf } from "@/lib/matchweek";
import { requireCron } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SEASON_START_YEAR = Number(process.env.SEASON_START_YEAR ?? "2026");
const SEASON_LABEL = `${SEASON_START_YEAR}/${String(SEASON_START_YEAR + 1).slice(2)}`;

/**
 * Pull the full fixture list daily and rebuild matchweeks from the feed's
 * official matchday field.
 *
 * Fixtures move. Re-deriving send windows every day means a rescheduled match
 * automatically shifts the email, including flipping a round into the
 * compressed 24-hour window if it becomes a midweek one.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const fixtures = await fetchSeasonFixtures(SEASON_START_YEAR);
  const weeks = groupIntoMatchweeks(fixtures);

  let matchweeksWritten = 0;
  let matchesWritten = 0;
  const compressed: number[] = [];

  for (let i = 0; i < weeks.length; i++) {
    const wk = weeks[i];
    const prev = i > 0 ? weeks[i - 1].lastKickoff : null;
    const window = computeSendWindow(wk.firstKickoff, prev);
    if (window.mode === "compressed") compressed.push(wk.matchweek);

    const { data: mwRow } = await db
      .from("matchweeks")
      .upsert(
        {
          season: SEASON_LABEL,
          mw_number: wk.matchweek,
          quarter: quarterOf(wk.matchweek).q,
          first_kickoff: wk.firstKickoff.toISOString(),
          last_kickoff: wk.lastKickoff.toISOString(),
          send_at: window.sendAt.toISOString(),
          send_mode: window.mode,
          locks_at: window.locksAt.toISOString(),
        },
        { onConflict: "season,mw_number" }
      )
      .select("id")
      .single();

    if (!mwRow) continue;
    matchweeksWritten++;

    for (const f of wk.fixtures) {
      await db.from("matches").upsert(
        {
          matchweek_id: mwRow.id,
          fd_match_id: f.fdMatchId,
          home_team: f.homeTeam,
          away_team: f.awayTeam,
          kickoff: f.kickoff.toISOString(),
          home_score: f.homeScore,
          away_score: f.awayScore,
          status: f.status,
          result: f.result,
        },
        { onConflict: "fd_match_id" }
      );
      matchesWritten++;
    }
  }

  return NextResponse.json({
    season: SEASON_LABEL,
    matchweeks: matchweeksWritten,
    matches: matchesWritten,
    compressedRounds: compressed,
  });
}
