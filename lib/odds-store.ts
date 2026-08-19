/**
 * Reading prices back out of the database.
 *
 * The pick page and the save endpoint both read the newest stored snapshot
 * rather than calling the odds feed. Two reasons: it costs nothing, and it
 * guarantees the price shown on screen is exactly the price recorded — no
 * chance of the feed shifting between render and tap.
 */

import type { Outcome } from "./scoring.ts";

export interface PricedMatch {
  matchId: string;
  prices: Record<Outcome, number>;
  fetchedAt: string;
}

interface SnapshotRow {
  match_id: string;
  outcome: Outcome;
  american: number;
  fetched_at: string;
}

/**
 * Collapse raw snapshot rows to the newest complete price set per match.
 * Pure, so it can be tested without a database.
 */
export function latestPrices(rows: SnapshotRow[]): Map<string, PricedMatch> {
  const newest = new Map<string, Map<Outcome, SnapshotRow>>();

  for (const r of rows) {
    if (!newest.has(r.match_id)) newest.set(r.match_id, new Map());
    const slot = newest.get(r.match_id)!;
    const existing = slot.get(r.outcome);
    if (!existing || r.fetched_at > existing.fetched_at) slot.set(r.outcome, r);
  }

  const out = new Map<string, PricedMatch>();
  for (const [matchId, slot] of newest) {
    const home = slot.get("HOME"), draw = slot.get("DRAW"), away = slot.get("AWAY");
    if (!home || !draw || !away) continue; // never show a half-priced match
    out.set(matchId, {
      matchId,
      prices: { HOME: home.american, DRAW: draw.american, AWAY: away.american },
      fetchedAt: [home, draw, away].map((r) => r.fetched_at).sort().at(-1)!,
    });
  }
  return out;
}

/** Minutes since a snapshot was taken, for the "prices as of" line. */
export function ageMinutes(fetchedAt: string, now = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - new Date(fetchedAt).getTime()) / 60_000));
}

export function describeAge(minutes: number): string {
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.round(minutes / 60);
  return h === 1 ? "an hour ago" : `${h} hours ago`;
}
