import { NextResponse } from "next/server";
import { fetchMatchdayFixtures } from "@/lib/football-data";
import { requireCron } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const SEASON_START_YEAR = Number(process.env.SEASON_START_YEAR ?? "2026");

/** Retry once on a transient failure before giving up on a matchday. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e: any) {
      if (attempt === 2) return { ok: false, error: `${label}: ${e?.message ?? e}` };
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return { ok: false, error: `${label}: unreachable` };
}

/**
 * Pull scores for any matchweek that's under way but not yet settled.
 *
 * Writes a whole matchday in one upsert rather than ten separate updates.
 * Ten round trips meant ten chances of a gateway timeout, and a single timed
 * out row was enough to fail the run — which then repeated every half hour.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: live, error } = await db
    .from("matchweeks")
    .select("id, mw_number")
    .lte("first_kickoff", now)
    .is("settled_at", null)
    .order("mw_number");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!live?.length) return NextResponse.json({ skipped: "no round in progress" });

  const updated: unknown[] = [];
  const warnings: string[] = [];

  for (const mw of live) {
    const fetched = await withRetry(
      () => fetchMatchdayFixtures(SEASON_START_YEAR, mw.mw_number),
      `matchweek ${mw.mw_number} fetch`
    );

    if (!fetched.ok) { warnings.push(fetched.error); continue; }
    const fixtures = fetched.value;

    // One request for the whole matchday.
    const written = await withRetry(async () => {
      const { error: upErr } = await db.from("matches").upsert(
        fixtures.map((f) => ({
          matchweek_id: mw.id,
          fd_match_id: f.fdMatchId,
          home_team: f.homeTeam,
          away_team: f.awayTeam,
          kickoff: f.kickoff.toISOString(),
          home_score: f.homeScore,
          away_score: f.awayScore,
          status: f.status,
          result: f.result,
        })),
        { onConflict: "fd_match_id" }
      );
      if (upErr) throw new Error(upErr.message);
      return fixtures.length;
    }, `matchweek ${mw.mw_number} write`);

    if (!written.ok) { warnings.push(written.error); continue; }

    updated.push({
      matchweek: mw.mw_number,
      fixtures: fixtures.length,
      finished: fixtures.filter((f) => f.status === "FINISHED").length,
      written: written.value,
    });
  }

  // A transient blip on one matchday isn't a failure — the next tick retries
  // in 30 minutes. Only report an error if nothing at all got through.
  const allFailed = updated.length === 0 && warnings.length > 0;

  return NextResponse.json(
    { updated, warnings },
    { status: allFailed ? 500 : 200 }
  );
}
