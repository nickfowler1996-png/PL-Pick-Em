/**
 * The reveal grid — what everyone picked, once the matchweek has locked.
 *
 * Pure shaping only. Whether a player is allowed to see any of this is
 * enforced in Postgres (see supabase/04-reveal-picks.sql), not here.
 */

import type { Outcome, Multiplier } from "./scoring.ts";

export interface GridPlayer {
  id: string;
  name: string;
}

export interface GridMatch {
  id: string;
  home: string;
  away: string;
  kickoff: string;
  result: Outcome | null;
  voided: boolean;
  status: string;
}

export interface GridPick {
  playerId: string;
  matchId: string;
  outcome: Outcome;
  multiplier: Multiplier;
  priceTaken: number;
  settledAmount: number | null;
}

export type CellStatus = "pending" | "correct" | "wrong" | "blank" | "void";

export interface GridCell {
  playerId: string;
  outcome: Outcome | null;
  multiplier: Multiplier;
  /** Short label for the chosen side: the club name, "Draw", or "—". */
  label: string;
  /** Compact form for a dense grid: "ARS", "D", or "—". */
  short: string;
  priceTaken: number | null;
  status: CellStatus;
  amount: number | null;
}

export interface GridRow {
  match: GridMatch;
  cells: GridCell[];
}

export interface Grid {
  rows: GridRow[];
  players: GridPlayer[];
  /** Running total for the matchweek, null while matches are still unplayed. */
  totals: { playerId: string; total: number | null; settledCount: number }[];
  /** How many in the round have a result yet. */
  finished: number;
  total: number;
}

const BASE_STAKE = 100;

/**
 * Three-letter club codes, for use as column headers.
 *
 * Keys are matched as prefixes of the normalised name, so both "Nottingham"
 * and "Nottingham Forest" resolve to NFO. Anything unlisted falls back to its
 * first three letters, which is fine for a club that turns up after promotion.
 */
const CODES: [string, string][] = [
  ["manchester city", "MCI"], ["manchester united", "MUN"],
  ["sheffield united", "SHU"], ["sheffield wednesday", "SHW"],
  ["west bromwich", "WBA"], ["west ham", "WHU"],
  ["nottingham", "NFO"], ["brighton", "BHA"], ["crystal palace", "CRY"],
  ["tottenham", "TOT"], ["wolverhampton", "WOL"], ["wolves", "WOL"],
  ["aston villa", "AVL"], ["newcastle", "NEW"], ["bournemouth", "BOU"],
  ["arsenal", "ARS"], ["chelsea", "CHE"], ["liverpool", "LIV"],
  ["everton", "EVE"], ["fulham", "FUL"], ["brentford", "BRE"],
  ["burnley", "BUR"], ["leeds", "LEE"], ["leicester", "LEI"],
  ["southampton", "SOU"], ["sunderland", "SUN"], ["ipswich", "IPS"],
  ["coventry", "COV"], ["hull", "HUL"], ["norwich", "NOR"],
  ["watford", "WAT"], ["middlesbrough", "MID"], ["stoke", "STK"],
  ["luton", "LUT"], ["blackburn", "BLB"], ["birmingham", "BIR"],
  ["preston", "PNE"], ["millwall", "MIL"], ["swansea", "SWA"],
  ["cardiff", "CAR"], ["plymouth", "PLY"], ["portsmouth", "POR"],
  ["oxford", "OXF"], ["derby", "DER"], ["wrexham", "WRE"],
];

export function abbrev(name: string): string {
  const n = name
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\bnottm\b/g, "nottingham")
    .replace(/\bman\b/g, "manchester")
    .replace(/\b(fc|afc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [key, code] of CODES) {
    if (n === key || n.startsWith(key + " ")) return code;
  }
  return n.replace(/ /g, "").slice(0, 3).toUpperCase();
}

function labelFor(m: GridMatch, outcome: Outcome | null): string {
  if (outcome === null) return "—";
  if (outcome === "DRAW") return "Draw";
  return outcome === "HOME" ? m.home : m.away;
}

function shortFor(m: GridMatch, outcome: Outcome | null): string {
  if (outcome === null) return "—";
  if (outcome === "DRAW") return "D";
  return abbrev(outcome === "HOME" ? m.home : m.away);
}

/**
 * Build the grid.
 *
 * A cell is "pending" until its match finishes. Once it does, a missing pick
 * becomes "blank" and carries the -$100 penalty, matching how settlement
 * scores it — so the grid agrees with the leaderboard rather than telling a
 * different story.
 */
export function buildGrid(
  matches: GridMatch[],
  players: GridPlayer[],
  picks: GridPick[]
): Grid {
  const byMatch = new Map<string, Map<string, GridPick>>();
  for (const p of picks) {
    if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, new Map());
    byMatch.get(p.matchId)!.set(p.playerId, p);
  }

  const running = new Map<string, { total: number; settled: number }>();
  for (const pl of players) running.set(pl.id, { total: 0, settled: 0 });

  const rows: GridRow[] = matches.map((m) => {
    const picksHere = byMatch.get(m.id);
    const played = m.status === "FINISHED" && m.result !== null;

    const cells: GridCell[] = players.map((pl) => {
      const pick = picksHere?.get(pl.id);
      const acc = running.get(pl.id)!;

      if (m.voided) {
        return {
          playerId: pl.id,
          outcome: pick?.outcome ?? null,
          multiplier: pick?.multiplier ?? 1,
          label: labelFor(m, pick?.outcome ?? null),
          short: shortFor(m, pick?.outcome ?? null),
          priceTaken: pick?.priceTaken ?? null,
          status: "void",
          amount: 0,
        };
      }

      if (!pick) {
        // Blanks only reveal as losses once the match has actually been played.
        const amount = played ? -BASE_STAKE : null;
        if (played) { acc.total += amount!; acc.settled++; }
        return {
          playerId: pl.id,
          outcome: null,
          multiplier: 1,
          label: "—",
          short: "—",
          priceTaken: null,
          status: played ? "blank" : "pending",
          amount,
        };
      }

      if (!played) {
        return {
          playerId: pl.id,
          outcome: pick.outcome,
          multiplier: pick.multiplier,
          label: labelFor(m, pick.outcome),
          short: shortFor(m, pick.outcome),
          priceTaken: pick.priceTaken,
          status: "pending",
          amount: null,
        };
      }

      const correct = pick.outcome === m.result;
      const amount = pick.settledAmount ?? fallbackAmount(pick, correct);
      acc.total += amount;
      acc.settled++;

      return {
        playerId: pl.id,
        outcome: pick.outcome,
        multiplier: pick.multiplier,
        label: labelFor(m, pick.outcome),
        short: shortFor(m, pick.outcome),
        priceTaken: pick.priceTaken,
        status: correct ? "correct" : "wrong",
        amount,
      };
    });

    return { match: m, cells };
  });

  return {
    rows,
    players,
    totals: players.map((pl) => {
      const acc = running.get(pl.id)!;
      return {
        playerId: pl.id,
        total: acc.settled > 0 ? Math.round(acc.total * 100) / 100 : null,
        settledCount: acc.settled,
      };
    }),
    finished: matches.filter((m) => m.status === "FINISHED").length,
    total: matches.length,
  };
}

/**
 * Score a pick the grid can see but settlement hasn't written yet — matches
 * finish one at a time, while settled_amount is only filled in once the whole
 * round closes.
 */
function fallbackAmount(pick: GridPick, correct: boolean): number {
  const stake = BASE_STAKE * pick.multiplier;
  if (!correct) return -stake;
  const d =
    pick.priceTaken > 0
      ? 1 + pick.priceTaken / 100
      : 1 + 100 / Math.abs(pick.priceTaken);
  return Math.round(stake * (d - 1) * 100) / 100;
}

/** Who agreed with whom — useful for the "everyone went the same way" line. */
export function consensus(row: GridRow): { outcome: Outcome; count: number } | null {
  const tally = new Map<Outcome, number>();
  for (const c of row.cells) {
    if (!c.outcome) continue;
    tally.set(c.outcome, (tally.get(c.outcome) ?? 0) + 1);
  }
  if (tally.size === 0) return null;

  let best: Outcome = "HOME";
  let count = -1;
  for (const [outcome, n] of tally) {
    if (n > count) { best = outcome; count = n; }
  }
  return { outcome: best, count };
}
