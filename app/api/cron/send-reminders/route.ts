import { NextResponse } from "next/server";
import { computeReminderAt } from "@/lib/matchweek";
import { sendSlipReminder } from "@/lib/email";
import { requireCron } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Nudge anyone with an incomplete slip, 24 hours before lock.
 *
 * Runs hourly, tracked per player. Worth doing properly: a missed slip costs
 * -$100 a match, so a silent no-show on a 10-fixture round is -$1,000 and
 * effectively ends someone's quarter.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = supabaseAdmin();
  const now = new Date();

  const { data: upcoming, error: mwError } = await db
    .from("matchweeks")
    .select("id, mw_number, send_at, locks_at")
    .lte("send_at", now.toISOString())
    .gt("locks_at", now.toISOString());

  if (mwError) return NextResponse.json({ error: mwError.message }, { status: 500 });

  const nudged: unknown[] = [];

  for (const mw of upcoming ?? []) {
    const dueAt = computeReminderAt(new Date(mw.locks_at), new Date(mw.send_at));
    if (now < dueAt) continue;

    const { data: matches } = await db
      .from("matches")
      .select("id")
      .eq("matchweek_id", mw.id)
      .eq("voided", false);

    const matchIds = (matches ?? []).map((m) => m.id);
    if (matchIds.length === 0) continue;

    const { data: players } = await db
      .from("players")
      .select("id, email, display_name")
      .eq("active", true);

    const { data: picks } = await db
      .from("picks")
      .select("player_id, match_id")
      .in("match_id", matchIds);

    const counts = new Map<string, number>();
    for (const p of picks ?? []) counts.set(p.player_id, (counts.get(p.player_id) ?? 0) + 1);

    const { data: already } = await db
      .from("email_sends")
      .select("player_id")
      .eq("matchweek_id", mw.id)
      .eq("kind", "reminder");

    const had = new Set((already ?? []).map((r) => r.player_id));

    const incomplete = (players ?? [])
      .map((p) => ({ ...p, made: counts.get(p.id) ?? 0 }))
      .filter((p) => p.made < matchIds.length && !had.has(p.id));

    if (incomplete.length === 0) continue;

    await sendSlipReminder({
      db, matchweek: mw, totalMatches: matchIds.length, players: incomplete,
    });

    await db.from("email_sends").upsert(
      incomplete.map((p) => ({ player_id: p.id, matchweek_id: mw.id, kind: "reminder" }))
    );

    await db.from("matchweeks").update({ reminder_sent_at: now.toISOString() }).eq("id", mw.id);
    nudged.push({ matchweek: mw.mw_number, nudged: incomplete.length });
  }

  return NextResponse.json({ nudged });
}
