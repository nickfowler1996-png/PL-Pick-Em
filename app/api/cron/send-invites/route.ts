import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendMatchweekInvite } from "@/lib/email";
import { requireCron } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Send the pick email for any matchweek whose send_at has passed and which
 * hasn't gone out yet. Runs every 6 hours.
 *
 * send_at is computed in sync-fixtures: 72h before first kickoff normally, 24h
 * when the round follows too closely on the last one.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();

  const { data: due } = await db
    .from("matchweeks")
    .select("id, mw_number, quarter, send_mode, first_kickoff, locks_at")
    .is("invite_sent_at", null)
    .lte("send_at", now)
    .gt("locks_at", now)          // never invite a round that already locked
    .order("mw_number");

  const { data: players } = await db
    .from("players")
    .select("id, email, display_name")
    .eq("active", true);

  const sent: number[] = [];

  for (const mw of due ?? []) {
    await sendMatchweekInvite({ db, matchweek: mw, players: players ?? [] });
    await db.from("matchweeks").update({ invite_sent_at: now }).eq("id", mw.id);
    sent.push(mw.mw_number);
  }

  return NextResponse.json({ sent, recipients: players?.length ?? 0 });
}
