import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase-server";
import { validateSlip, computeAllowance, type Multiplier, type Outcome } from "@/lib/scoring";
import { quarterOf } from "@/lib/matchweek";
import { latestPrices } from "@/lib/odds-store";

export const dynamic = "force-dynamic";

/**
 * Save one pick.
 *
 * Everything the client claims is re-checked here: the deadline, the multiplier
 * allowance, and above all the price. The price is read from the stored
 * snapshot rather than trusted from the request body — otherwise anyone could
 * post themselves +99999 odds. Reading the same row the page rendered from
 * also means the price you saw is exactly the price you get.
 */
export async function POST(req: Request) {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    matchId: string; outcome: Outcome; multiplier: Multiplier;
  };

  if (!["HOME", "DRAW", "AWAY"].includes(body.outcome)) {
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(body.multiplier)) {
    return NextResponse.json({ error: "Invalid multiplier" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: match } = await admin
    .from("matches")
    .select("id, home_team, away_team, voided, matchweeks!inner(id, mw_number, season, quarter, locks_at)")
    .eq("id", body.matchId)
    .single();

  if (!match) return NextResponse.json({ error: "Unknown match" }, { status: 404 });

  const mw = (match as any).matchweeks;

  if (new Date() >= new Date(mw.locks_at)) {
    return NextResponse.json({ error: "Picks closed when the first match kicked off." }, { status: 409 });
  }

  // Price comes from the stored snapshot. Never trust a price from the client.
  const { data: snapshotRows } = await admin
    .from("odds_snapshots")
    .select("match_id, outcome, american, fetched_at")
    .eq("match_id", body.matchId)
    .order("fetched_at", { ascending: false })
    .limit(12);

  const priced = latestPrices(
    (snapshotRows ?? []) as Parameters<typeof latestPrices>[0]
  ).get(body.matchId);

  if (!priced) {
    return NextResponse.json(
      { error: "No price stored for that match yet. Try again shortly." },
      { status: 503 }
    );
  }
  const priceTaken = priced.prices[body.outcome];

  // Recount allowances from what this player has actually spent.
  //
  // One query, then three views of it. The split matters: validateSlip is
  // given THIS week's picks explicitly, so the allowance handed alongside it
  // must cover only *earlier* weeks. Counting a pick in both places makes a
  // single quad look like two and rejects every later change.
  const { data: allPicks } = await admin
    .from("picks")
    .select(
      "multiplier, match_id, matches!inner(voided, matchweek_id, matchweeks!inner(season, quarter))"
    )
    .eq("player_id", user.id)
    .neq("match_id", body.matchId);

  const rows = (allPicks ?? []) as any[];

  const thisWeek = rows.filter((p) => p.matches.matchweek_id === mw.id);
  const earlier = rows.filter((p) => p.matches.matchweek_id !== mw.id);

  const shape = (list: any[]) =>
    list.map((p) => ({ multiplier: p.multiplier as Multiplier, voided: p.matches.voided }));

  const earlierThisSeason = earlier.filter((p) => p.matches.matchweeks.season === mw.season);
  const earlierThisQuarter = earlierThisSeason.filter(
    (p) => p.matches.matchweeks.quarter === mw.quarter
  );

  const allowance = computeAllowance(shape(earlierThisQuarter), shape(earlierThisSeason));

  const errors = validateSlip(
    [
      ...thisWeek.map((p) => ({ multiplier: p.multiplier as Multiplier })),
      { multiplier: body.multiplier },
    ],
    allowance
  );

  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, code: errors[0].code }, { status: 422 });
  }

  const { error } = await admin.from("picks").upsert(
    {
      player_id: user.id,
      match_id: body.matchId,
      outcome: body.outcome,
      multiplier: body.multiplier,
      price_taken: priceTaken,
      picked_at: new Date().toISOString(),
    },
    { onConflict: "player_id,match_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, priceTaken, multiplier: body.multiplier });
}
