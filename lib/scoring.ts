/**
 * Scoring engine — Premier League Pick 'em
 *
 * Net-profit scoring. A correct pick pays profit only; a wrong pick costs
 * the stake. A missing pick is settled exactly as though it were wrong.
 *
 *   -110 correct at 1x  -> +$90.91
 *   +250 correct at 1x  -> +$250.00
 *   anything wrong at 1x -> -$100.00
 */

export const BASE_STAKE = 100;

export type Outcome = "HOME" | "DRAW" | "AWAY";
export type Multiplier = 1 | 2 | 3 | 4;

/**
 * Three independent pools. A triple is not an upgraded double and does not
 * consume one — each multiplier is drawn from its own allowance.
 *
 * So the biggest possible week is 2 doubles + 2 triples + 1 quad = five
 * boosted matches, if you happen to have all of them in hand.
 */
export const MULTIPLIER_LIMITS = {
  /** Doubles reset every matchweek. Unused doubles do NOT roll over. */
  doublesPerMatchweek: 2,
  /** Triples reset at the start of each quarter. */
  tripleUpgradesPerQuarter: 2,
  /** One quad for the whole season. */
  quadsPerSeason: 1,
} as const;

/** Most matches that can carry a multiplier in a single week. */
export const MAX_BOOSTED_PER_WEEK =
  MULTIPLIER_LIMITS.doublesPerMatchweek +
  MULTIPLIER_LIMITS.tripleUpgradesPerQuarter +
  MULTIPLIER_LIMITS.quadsPerSeason;

/* ------------------------------------------------------------------ */
/* Odds conversion                                                     */
/* ------------------------------------------------------------------ */

export function toDecimal(american: number): number {
  if (american === 0 || !Number.isFinite(american)) {
    throw new Error(`Invalid American odds: ${american}`);
  }
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function toAmerican(decimal: number): number {
  if (!(decimal > 1)) throw new Error(`Invalid decimal odds: ${decimal}`);
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

/**
 * Settle a single pick.
 * @param price  American odds stamped on the pick at the moment it was made
 * @param mult   1 | 2 | 3 | 4
 * @param correct whether the pick matched the final result
 */
export function settlePick(price: number, mult: Multiplier, correct: boolean): number {
  const stake = BASE_STAKE * mult;
  if (!correct) return -stake;
  return round2(stake * (toDecimal(price) - 1));
}

/** A match ready for settlement. */
export interface SettledMatch {
  matchId: string;
  /** Null only when the match is voided. */
  result: Outcome | null;
  /**
   * Postponed and never played inside this matchweek. Voided matches score
   * nothing for anyone — no payout, and no -$100 penalty for not picking it.
   */
  voided?: boolean;
}

export interface StoredPick {
  matchId: string;
  outcome: Outcome;
  multiplier: Multiplier;
  /** The price the player took. Never re-look-up odds at settlement time. */
  priceTaken: number;
}

export interface PickLine {
  matchId: string;
  outcome: Outcome | null;
  multiplier: Multiplier;
  priceTaken: number | null;
  correct: boolean;
  amount: number;
  /**
   * "settled"  a real pick against a real result
   * "no_pick"  -$100 penalty for leaving a match blank
   * "void"     postponed fixture, scores zero either way
   */
  reason: "settled" | "no_pick" | "void";
}

export interface PlayerResult {
  playerId: string;
  total: number;
  lines: PickLine[];
  missedMatches: number;
  voidedMatches: number;
}

/**
 * Settle one player's matchweek.
 *
 * Every match in the matchweek produces a line. If the player has no pick for
 * a match, it is settled as -$100 at 1x, exactly as if they had picked wrong.
 * This covers both a fully missing slip and a partially completed one.
 */
export function settlePlayerMatchweek(
  playerId: string,
  matches: SettledMatch[],
  picks: StoredPick[]
): PlayerResult {
  const byMatch = new Map(picks.map((p) => [p.matchId, p]));
  const lines: PickLine[] = [];
  let total = 0;
  let missed = 0;
  let voided = 0;

  for (const m of matches) {
    const pick = byMatch.get(m.matchId);

    // A voided fixture is removed from the week entirely. It pays nothing and
    // it penalises nothing, so a blank on a postponed match costs you nothing.
    if (m.voided || m.result === null) {
      voided++;
      lines.push({
        matchId: m.matchId,
        outcome: pick?.outcome ?? null,
        multiplier: pick?.multiplier ?? 1,
        priceTaken: pick?.priceTaken ?? null,
        correct: false,
        amount: 0,
        reason: "void",
      });
      continue;
    }

    if (!pick) {
      missed++;
      const amount = -BASE_STAKE;
      total += amount;
      lines.push({
        matchId: m.matchId,
        outcome: null,
        multiplier: 1,
        priceTaken: null,
        correct: false,
        amount,
        reason: "no_pick",
      });
      continue;
    }

    const correct = pick.outcome === m.result;
    const amount = settlePick(pick.priceTaken, pick.multiplier, correct);
    total += amount;
    lines.push({
      matchId: m.matchId,
      outcome: pick.outcome,
      multiplier: pick.multiplier,
      priceTaken: pick.priceTaken,
      correct,
      amount,
      reason: "settled",
    });
  }

  return {
    playerId,
    total: round2(total),
    lines,
    missedMatches: missed,
    voidedMatches: voided,
  };
}

/* ------------------------------------------------------------------ */
/* Multiplier validation                                               */
/* ------------------------------------------------------------------ */

/**
 * What a player has already spent in EARLIER matchweeks.
 *
 * Must exclude the matchweek being validated. The slip under validation is
 * passed to validateSlip separately, so counting the current week here too
 * double-counts it — one quad reads as two and every later edit is rejected.
 */
export interface Allowance {
  /** Triples used earlier in the current quarter, excluding this matchweek. */
  tripleUpgradesUsedThisQuarter: number;
  /** Whether the season quad was spent in an earlier matchweek. */
  quadUsedThisSeason: boolean;
}

/**
 * Work out what a player has actually spent, given every pick they have made
 * in the relevant window.
 *
 * Picks on voided fixtures don't count as spent. A triple or a quad that landed
 * on a postponed match is handed straight back, because those allowances are
 * scarce — a quad is once a season — and losing one to a fixture that never
 * kicked off isn't a decision the player made.
 *
 * Weekly doubles are not refundable in any meaningful sense: they don't roll
 * over, so once the matchweek is gone, so are they.
 *
 * @param quarterPicks picks made so far in the CURRENT quarter
 * @param seasonPicks  picks made so far in the CURRENT season
 */
export function computeAllowance(
  quarterPicks: { multiplier: Multiplier; voided: boolean }[],
  seasonPicks: { multiplier: Multiplier; voided: boolean }[]
): Allowance {
  return {
    tripleUpgradesUsedThisQuarter: quarterPicks.filter(
      (p) => p.multiplier === 3 && !p.voided
    ).length,
    quadUsedThisSeason: seasonPicks.some((p) => p.multiplier === 4 && !p.voided),
  };
}

export interface ValidationError {
  code: "TOO_MANY_DOUBLES" | "TOO_MANY_TRIPLES" | "QUAD_ALREADY_USED" | "BAD_MULTIPLIER";
  message: string;
}

/**
 * Validate a slip's multiplier usage against what the player has left.
 *
 * Each multiplier draws on its own pool and nothing else: spending a triple
 * doesn't cost you a double, and the quad costs neither.
 *
 * Run this server-side on every save. The client's counters are a convenience,
 * not a source of truth.
 */
export function validateSlip(
  picks: Pick<StoredPick, "multiplier">[],
  allowance: Allowance
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (picks.some((p) => ![1, 2, 3, 4].includes(p.multiplier))) {
    errors.push({ code: "BAD_MULTIPLIER", message: "Multiplier must be 1, 2, 3 or 4." });
    return errors;
  }

  const doublesUsed = picks.filter((p) => p.multiplier === 2).length;
  const triplesUsed = picks.filter((p) => p.multiplier === 3).length;
  const quadsUsed = picks.filter((p) => p.multiplier === 4).length;

  if (doublesUsed > MULTIPLIER_LIMITS.doublesPerMatchweek) {
    errors.push({
      code: "TOO_MANY_DOUBLES",
      message: `You have ${MULTIPLIER_LIMITS.doublesPerMatchweek} doubles a week. This slip uses ${doublesUsed}.`,
    });
  }

  const totalTriples = triplesUsed + allowance.tripleUpgradesUsedThisQuarter;
  if (totalTriples > MULTIPLIER_LIMITS.tripleUpgradesPerQuarter) {
    const left = Math.max(0, MULTIPLIER_LIMITS.tripleUpgradesPerQuarter - allowance.tripleUpgradesUsedThisQuarter);
    errors.push({
      code: "TOO_MANY_TRIPLES",
      message: `You have ${left} triple${left === 1 ? "" : "s"} left this quarter. This slip uses ${triplesUsed}.`,
    });
  }

  if (quadsUsed + (allowance.quadUsedThisSeason ? 1 : 0) > MULTIPLIER_LIMITS.quadsPerSeason) {
    errors.push({
      code: "QUAD_ALREADY_USED",
      message: "Your quad is gone for the season.",
    });
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export interface StandingRow {
  playerId: string;
  quarterTotal: number;
  seasonTotal: number;
  matchweeksWon: number;
}

/**
 * Build the leaderboard from already-settled matchweek totals.
 * @param totals rows of { playerId, matchweek, total }
 * @param currentQuarterRange inclusive [start, end] matchweek numbers
 */
export function buildStandings(
  totals: { playerId: string; matchweek: number; total: number }[],
  currentQuarterRange: [number, number]
): StandingRow[] {
  const [qStart, qEnd] = currentQuarterRange;
  const acc = new Map<string, StandingRow>();

  for (const t of totals) {
    if (!acc.has(t.playerId)) {
      acc.set(t.playerId, {
        playerId: t.playerId,
        quarterTotal: 0,
        seasonTotal: 0,
        matchweeksWon: 0,
      });
    }
    const row = acc.get(t.playerId)!;
    row.seasonTotal = round2(row.seasonTotal + t.total);
    if (t.matchweek >= qStart && t.matchweek <= qEnd) {
      row.quarterTotal = round2(row.quarterTotal + t.total);
    }
  }

  // Award matchweek wins (ties all count as a win).
  const byWeek = new Map<number, { playerId: string; total: number }[]>();
  for (const t of totals) {
    if (!byWeek.has(t.matchweek)) byWeek.set(t.matchweek, []);
    byWeek.get(t.matchweek)!.push({ playerId: t.playerId, total: t.total });
  }
  for (const rows of byWeek.values()) {
    const best = Math.max(...rows.map((r) => r.total));
    for (const r of rows) {
      if (r.total === best) acc.get(r.playerId)!.matchweeksWon++;
    }
  }

  return [...acc.values()];
}

/* ------------------------------------------------------------------ */
/* Group aggregate                                                     */
/* ------------------------------------------------------------------ */

export interface GroupTotals {
  players: number;
  week: number | null;
  quarter: number;
  season: number;
  /** Season total divided by the number of players. */
  averageSeason: number;
}

/**
 * Sum the pool.
 *
 * Best read as a scoreboard against the bookmakers rather than a pot of money:
 * under net scoring a pick at fair odds is worth nothing in expectation, so a
 * group total above zero means the pool has collectively beaten the prices it
 * was offered, and below zero means it hasn't.
 */
export function groupTotals(
  rows: { quarterTotal: number; seasonTotal: number; weekTotal?: number | null }[]
): GroupTotals {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const weekValues = rows
    .map((r) => r.weekTotal)
    .filter((v): v is number => typeof v === "number");

  const season = round2(rows.reduce((a, r) => a + r.seasonTotal, 0));

  return {
    players: rows.length,
    week: weekValues.length > 0 ? round2(weekValues.reduce((a, v) => a + v, 0)) : null,
    quarter: round2(rows.reduce((a, r) => a + r.quarterTotal, 0)),
    season,
    averageSeason: rows.length > 0 ? round2(season / rows.length) : 0,
  };
}
