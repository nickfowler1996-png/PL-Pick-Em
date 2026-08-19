import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeReminderAt } from "@/lib/matchweek";
import { sendSlipReminder } from "@/lib/email";
import { requireCron } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Nudge anyone with an incomplete slip 6 hours before lock. Runs hourly.
 *
 * Worth doing properly: a missed slip costs -$100 a match, so with 10 fixtures
 * a silent no-show is -$1,000 and effectively ends someone's quarter.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date();

  const { data: upcoming } = await db
    .from("matchweeks")
    .select("id, mw_number, locks_at")
    .is("reminder_sent_at", null)
    .not("invite_sent_at", "is", null)
    .gt("locks_at", now.toISOString());

  const nudged: unknown[] = [];

  for (const mw of upcoming ?? []) {
    if (now < computeReminderAt(new Date(mw.locks_at))) continue;

    const { data: matches } = await db.from("matches").select("id").eq("matchweek_id", mw.id);
    const matchIds = (matches ?? []).map((m) => m.id);

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

    const incomplete = (players ?? [])
      .map((p) => ({ ...p, made: counts.get(p.id) ?? 0 }))
      .filter((p) => p.made < matchIds.length);

    if (incomplete.length > 0) {
      await sendSlipReminder({ db, matchweek: mw, totalMatches: matchIds.length, players: incomplete });
    }

    await db.from("matchweeks").update({ reminder_sent_at: now.toISOString() }).eq("id", mw.id);
    nudged.push({ matchweek: mw.mw_number, nudged: incomplete.length });
  }

  return NextResponse.json({ nudged });
}
