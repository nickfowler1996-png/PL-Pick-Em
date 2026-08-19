/**
 * Email — Resend.
 *
 * Three sends: the matchweek invite, a nudge for incomplete slips, and the
 * results recap once the round settles. Each carries a per-player magic link
 * so nobody has to remember a password to make picks.
 *
 * Render functions are pure and exported so they can be tested without a
 * network call or an API key.
 */

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerResult } from "./scoring.ts";

const FROM = process.env.EMAIL_FROM ?? "Pick 'em <picks@example.com>";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export interface Player {
  id: string;
  email: string;
  display_name: string;
}

export interface MatchweekRow {
  id: string;
  mw_number: number;
  quarter?: number;
  send_mode?: "standard" | "compressed";
  first_kickoff?: string;
  locks_at: string;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function money(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `−$${s}` : `$${s}`;
}

export function formatKickoff(iso: string, tz = "Europe/London"): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  });
}

export function hoursUntil(iso: string, now = new Date()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 3_600_000));
}

/* ------------------------------------------------------------------ */
/* Shared shell                                                        */
/* ------------------------------------------------------------------ */

const C = {
  bg: "#141E1A", card: "#1B2823", rule: "#2E3F38",
  chalk: "#EDEAE0", dim: "#8FA097", gold: "#E9C46A",
  up: "#6FCF97", down: "#EB5757",
};

function shell(opts: { eyebrow: string; heading: string; body: string; cta?: { label: string; href: string } }): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding-bottom:16px;border-bottom:1px solid ${C.rule};">
    <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${C.dim};padding-bottom:6px;">${opts.eyebrow}</div>
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:30px;font-weight:700;color:${C.chalk};line-height:1.1;">${opts.heading}</div>
  </td></tr>
  <tr><td style="padding-top:18px;">${opts.body}</td></tr>
  ${opts.cta ? `<tr><td style="padding-top:22px;">
    <a href="${opts.cta.href}" style="display:block;text-align:center;background:${C.gold};color:${C.bg};text-decoration:none;padding:15px;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;letter-spacing:.08em;text-transform:uppercase;border-radius:2px;">${opts.cta.label}</a>
    <div style="font-family:'Courier New',monospace;font-size:10px;color:${C.dim};text-align:center;padding-top:10px;">This link signs you in. Don't forward it.</div>
  </td></tr>` : ""}
</table>
</td></tr></table></body></html>`;
}

const p = (text: string) =>
  `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.chalk};margin:0 0 12px;">${text}</p>`;

const dim = (text: string) =>
  `<p style="font-family:'Courier New',monospace;font-size:12px;line-height:1.7;color:${C.dim};margin:0 0 10px;">${text}</p>`;

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export function renderInvite(mw: MatchweekRow, name: string, href: string) {
  const urgent = mw.send_mode === "compressed";
  const hrs = hoursUntil(mw.locks_at);

  return {
    subject: urgent
      ? `Matchweek ${mw.mw_number} — quick turnaround, picks close in ${hrs}h`
      : `Matchweek ${mw.mw_number} is open`,
    html: shell({
      eyebrow: `Premier League · Quarter ${mw.quarter ?? "—"}`,
      heading: `Matchweek ${mw.mw_number}`,
      body:
        p(`${name} — the board is up.`) +
        (urgent
          ? p(`Short week: this round follows straight on from the last one, so you have about <strong style="color:${C.gold}">${hrs} hours</strong> rather than the usual three days.`)
          : p(`Picks close at <strong style="color:${C.gold}">${formatKickoff(mw.locks_at)}</strong>, when the first match kicks off.`)) +
        dim(`Every match needs a pick. Anything you leave blank scores −$100, same as getting it wrong.`) +
        dim(`Prices are live — you're locked in at whatever you see when you tap.`),
      cta: { label: "Make your picks", href },
    }),
    text: `${name} — Matchweek ${mw.mw_number} is open. Picks close ${formatKickoff(mw.locks_at)}. Every blank scores -$100. ${href}`,
  };
}

export function renderReminder(mw: MatchweekRow, name: string, made: number, total: number, href: string) {
  const left = total - made;
  const hrs = hoursUntil(mw.locks_at);

  return {
    subject: `${left} match${left === 1 ? "" : "es"} left — Matchweek ${mw.mw_number} closes in ${hrs}h`,
    html: shell({
      eyebrow: `Closes ${formatKickoff(mw.locks_at)}`,
      heading: made === 0 ? "You haven't picked yet" : `${left} still open`,
      body:
        p(`${name} — you've made <strong style="color:${C.gold}">${made} of ${total}</strong> picks for Matchweek ${mw.mw_number}.`) +
        p(`Blanks are settled as losses. Leaving all ${total} would cost <strong style="color:${C.down}">${money(-100 * total)}</strong>.`) +
        dim(`Unused doubles don't roll over either — spend them or lose them.`),
      cta: { label: made === 0 ? "Make your picks" : "Finish your slip", href },
    }),
    text: `${name} — ${made}/${total} picks made for Matchweek ${mw.mw_number}. Closes in ${hrs}h. Blanks cost $100 each. ${href}`,
  };
}

export function renderRecap(
  mw: MatchweekRow,
  name: string,
  you: PlayerResult | undefined,
  standings: { name: string; quarterTotal: number; seasonTotal: number }[],
  winners: string[],
  quarterEnd: boolean,
  href: string
) {
  const rows = standings
    .map((s, i) => `<tr>
      <td style="padding:9px 8px;border-bottom:1px solid ${C.rule};font-family:'Courier New',monospace;font-size:12px;color:${C.dim};">${i + 1}</td>
      <td style="padding:9px 8px;border-bottom:1px solid ${C.rule};font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${s.name === name ? C.gold : C.chalk};">${s.name}</td>
      <td style="padding:9px 8px;border-bottom:1px solid ${C.rule};font-family:'Courier New',monospace;font-size:13px;color:${s.quarterTotal < 0 ? C.down : C.up};text-align:right;">${money(s.quarterTotal)}</td>
      <td style="padding:9px 8px;border-bottom:1px solid ${C.rule};font-family:'Courier New',monospace;font-size:13px;color:${C.dim};text-align:right;">${money(s.seasonTotal)}</td>
    </tr>`)
    .join("");

  const yourLine = you
    ? p(`You finished the week at <strong style="color:${you.total < 0 ? C.down : C.up}">${money(you.total)}</strong>` +
        (you.missedMatches > 0 ? `, including ${you.missedMatches} blank${you.missedMatches === 1 ? "" : "s"} at −$100 each.` : ".") +
        (you.voidedMatches > 0 ? ` ${you.voidedMatches} fixture${you.voidedMatches === 1 ? " was" : "s were"} postponed and voided.` : ""))
    : "";

  return {
    subject: quarterEnd
      ? `Quarter ${mw.quarter} is settled — Matchweek ${mw.mw_number} results`
      : `Matchweek ${mw.mw_number} results`,
    html: shell({
      eyebrow: quarterEnd ? `Quarter ${mw.quarter} final` : `Quarter ${mw.quarter ?? "—"}`,
      heading: `Matchweek ${mw.mw_number} settled`,
      body:
        p(`Week won by <strong style="color:${C.gold}">${winners.join(", ")}</strong>.`) +
        yourLine +
        (quarterEnd ? p(`That's Quarter ${mw.quarter} done. Quarter totals reset next week — season totals carry on.`) : "") +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-collapse:collapse;">
          <tr>
            <th></th>
            <th style="text-align:left;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:${C.dim};padding:0 8px 8px;font-weight:400;">Player</th>
            <th style="text-align:right;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:${C.dim};padding:0 8px 8px;font-weight:400;">Quarter</th>
            <th style="text-align:right;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:${C.dim};padding:0 8px 8px;font-weight:400;">Season</th>
          </tr>${rows}</table>`,
      cta: { label: "See the full board", href },
    }),
    text: `Matchweek ${mw.mw_number} settled. Won by ${winners.join(", ")}. ${you ? `You: ${money(you.total)}.` : ""} ${href}`,
  };
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

const resend = () => new Resend(process.env.RESEND_API_KEY!);

/**
 * Mint a one-tap sign-in link per player. Falls back to the bare URL if the
 * admin API is unavailable — a login prompt is better than a broken email.
 */
async function magicLink(db: SupabaseClient, email: string, path: string): Promise<string> {
  const redirectTo = `${APP_URL}${path}`;
  try {
    const { data, error } = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error || !data?.properties?.action_link) return redirectTo;
    return data.properties.action_link;
  } catch {
    return redirectTo;
  }
}

/** Resend accepts up to 100 messages per batch — one call covers the pool. */
async function sendBatch(messages: { to: string; subject: string; html: string; text: string }[]) {
  if (messages.length === 0) return;
  await resend().batch.send(
    messages.map((m) => ({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }))
  );
}

export async function sendMatchweekInvite(args: {
  db: SupabaseClient;
  matchweek: MatchweekRow;
  players: Player[];
}) {
  const path = `/matchweek/${args.matchweek.mw_number}`;
  const messages = await Promise.all(
    args.players.map(async (pl) => {
      const t = renderInvite(args.matchweek, pl.display_name, await magicLink(args.db, pl.email, path));
      return { to: pl.email, ...t };
    })
  );
  await sendBatch(messages);
}

export async function sendSlipReminder(args: {
  db: SupabaseClient;
  matchweek: MatchweekRow;
  totalMatches: number;
  players: (Player & { made: number })[];
}) {
  const path = `/matchweek/${args.matchweek.mw_number}`;
  const messages = await Promise.all(
    args.players.map(async (pl) => {
      const t = renderReminder(
        args.matchweek, pl.display_name, pl.made, args.totalMatches,
        await magicLink(args.db, pl.email, path)
      );
      return { to: pl.email, ...t };
    })
  );
  await sendBatch(messages);
}

export async function sendResultsRecap(args: {
  db: SupabaseClient;
  matchweek: MatchweekRow;
  results: PlayerResult[];
  winners: string[];
  isQuarterEnd: boolean;
}) {
  const { data: players } = await args.db
    .from("players")
    .select("id, email, display_name")
    .eq("active", true);

  const nameById = new Map((players ?? []).map((pl) => [pl.id, pl.display_name]));

  const { data: board } = await args.db
    .from("standings")
    .select("player_id, display_name, quarter_total, season_total")
    .eq("quarter", args.matchweek.quarter);

  const standings = (board ?? [])
    .map((b) => ({
      name: b.display_name,
      quarterTotal: Number(b.quarter_total),
      seasonTotal: Number(b.season_total),
    }))
    .sort((a, b) => b.quarterTotal - a.quarterTotal);

  const winnerNames = args.winners.map((id) => nameById.get(id) ?? "Unknown");
  const path = `/standings`;

  const messages = await Promise.all(
    (players ?? []).map(async (pl) => {
      const t = renderRecap(
        args.matchweek,
        pl.display_name,
        args.results.find((r) => r.playerId === pl.id),
        standings,
        winnerNames,
        args.isQuarterEnd,
        await magicLink(args.db, pl.email, path)
      );
      return { to: pl.email, ...t };
    })
  );

  await sendBatch(messages);
}
