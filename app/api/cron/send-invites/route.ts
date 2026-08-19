import { NextResponse } from "next/server";
import { sendMatchweekInvite } from "@/lib/email";
import { requireCron } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Send the pick email for any open matchweek, to anyone who hasn't had it.
 *
 * Runs every 6 hours. Tracked per player rather than per matchweek, so
 * somebody who signs up midway through the week still gets the invite on the
 * next pass instead of silently missing the round.
 */
export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: due, error: mwError } = await db
    .from("matchweeks")
    .select("id, mw_number, quarter, send_mode, first_kickoff, locks_at")
    .lte("send_at", now)
    .gt("locks_at", now)
    .order("mw_number");

  if (mwError) return NextResponse.json({ error: mwError.message }, { status: 500 });

  const { data: players } = await db
    .from("players")
    .select("id, email, display_name")
    .eq("active", true);

  const sent: unknown[] = [];

  for (const mw of due ?? []) {
    const { data: already } = await db
      .from("email_sends")
      .select("player_id")
      .eq("matchweek_id", mw.id)
      .eq("kind", "invite");

    const had = new Set((already ?? []).map((r) => r.player_id));
    const toSend = (players ?? []).filter((p) => !had.has(p.id));

    if (toSend.length === 0) continue;

    await sendMatchweekInvite({ db, matchweek: mw, players: toSend });

    await db.from("email_sends").upsert(
      toSend.map((p) => ({ player_id: p.id, matchweek_id: mw.id, kind: "invite" }))
    );

    await db.from("matchweeks").update({ invite_sent_at: now }).eq("id", mw.id);
    sent.push({ matchweek: mw.mw_number, recipients: toSend.length });
  }

  return NextResponse.json({ sent, activePlayers: players?.length ?? 0 });
}
