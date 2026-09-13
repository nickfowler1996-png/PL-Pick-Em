import { NextResponse } from "next/server";
import { fetchSeasonFixtures } from "@/lib/football-data";
import { groupIntoMatchweeks, computeSendWindow, quarterOf } from "@/lib/matchweek";
import { requireCron } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

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

  const db = supabaseAdmin();

  const fixtures = await fetchSeasonFixtures(SEASON_START_YEAR);
  const weeks = groupIntoMatchweeks(fixtures);

  let matchweeksWritten = 0;
  let matchesWritten = 0;
  const compressed: number[] = [];
  const errors: string[] = [];

  for (let i = 0; i < weeks.length; i++) {
    const wk = weeks[i];
    const prev = i > 0 ? weeks[i - 1].lastKickoff : null;
    const window = computeSendWindow(wk.firstKickoff, prev);
    if (window.mode === "compressed") compressed.push(wk.matchweek);

    const { data: mwRow, error: mwError } = await db
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

    // Surface the reason rather than silently writing nothing.
    if (mwError) {
      if (errors.length < 3) errors.push(`matchweek ${wk.matchweek}: ${mwError.message}`);
      continue;
    }
    if (!mwRow) {
      if (errors.length < 3) errors.push(`matchweek ${wk.matchweek}: upsert returned no row`);
      continue;
    }
    matchweeksWritten++;

    for (const f of wk.fixtures) {
      const { error: matchError } = await db.from("matches").upsert(
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
      if (matchError) {
        if (errors.length < 3) errors.push(`match ${f.fdMatchId}: ${matchError.message}`);
        continue;
      }
      matchesWritten++;
    }
  }

  const body = {
    season: SEASON_LABEL,
    fixturesFetched: fixtures.length,
    matchweeks: matchweeksWritten,
    matches: matchesWritten,
    compressedRounds: compressed,
    errors,
  };

  // Only a total failure is worth failing the run over. A few rows erroring
  // out of 380 gets retried on the next nightly pass, and a red run every time
  // trains you to ignore the alert.
  const allFailed = matchweeksWritten === 0 && errors.length > 0;
  return NextResponse.json(body, { status: allFailed ? 500 : 200 });
}
