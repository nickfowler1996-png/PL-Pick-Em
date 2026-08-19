import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { latestPrices } from "@/lib/odds-store";

export const dynamic = "force-dynamic";

/**
 * Current prices for a matchweek, read from stored snapshots.
 *
 * Costs no odds-feed credits — the snapshot cron is the only thing that calls
 * the feed. Refreshing this page all day is free.
 */
export async function GET(req: Request) {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const mwNumber = Number(new URL(req.url).searchParams.get("mw"));
  if (!mwNumber) return NextResponse.json({ error: "mw required" }, { status: 400 });

  const { data: mw } = await db
    .from("matchweeks").select("id").eq("mw_number", mwNumber).maybeSingle();
  if (!mw) return NextResponse.json({ error: "unknown matchweek" }, { status: 404 });

  const { data: matches } = await db.from("matches").select("id").eq("matchweek_id", mw.id);
  const ids = (matches ?? []).map((m) => m.id);

  const { data: rows } = await db
    .from("odds_snapshots")
    .select("match_id, outcome, american, fetched_at")
    .in("match_id", ids)
    .order("fetched_at", { ascending: false })
    .limit(ids.length * 3 * 4);   // a few generations deep, then collapsed

  const priced = latestPrices(rows ?? []);

  return NextResponse.json({
    prices: Object.fromEntries([...priced].map(([id, p]) => [id, p.prices])),
    fetchedAt: [...priced.values()].map((p) => p.fetchedAt).sort().at(-1) ?? null,
  });
}
