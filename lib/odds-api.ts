/**
 * The Odds API client.
 *
 * One call costs markets x regions credits, so h2h + uk = 1 credit and returns
 * every EPL fixture at once. A 60-second cache keeps a whole pool of players
 * browsing off a handful of credits an hour.
 */

import type { Outcome } from "./scoring.ts";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "soccer_epl";
const CACHE_TTL_MS = 60_000;

export interface MatchOdds {
  oddsEventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
  prices: Record<Outcome, number>; // American odds
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

interface RawEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    markets: { key: string; outcomes: { name: string; price: number }[] }[];
  }[];
}

/**
 * Reduce one event to a single set of prices.
 *
 * The feed returns every bookmaker. We take the best available price for each
 * outcome, which is what OddsChecker shows you and keeps one book's outlier
 * from setting the line.
 */
export function mapEvent(raw: RawEvent): MatchOdds | null {
  const best: Partial<Record<Outcome, number>> = {};

  for (const book of raw.bookmakers ?? []) {
    const h2h = book.markets?.find((m) => m.key === "h2h");
    if (!h2h) continue;

    for (const o of h2h.outcomes ?? []) {
      const slot = classifyOutcome(o.name, raw.home_team, raw.away_team);
      if (!slot) continue;
      const current = best[slot];
      if (current === undefined || isBetter(o.price, current)) best[slot] = o.price;
    }
  }

  if (best.HOME === undefined || best.DRAW === undefined || best.AWAY === undefined) {
    return null; // incomplete market, skip rather than show a half-priced match
  }

  return {
    oddsEventId: raw.id,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    commenceTime: new Date(raw.commence_time),
    prices: { HOME: best.HOME, DRAW: best.DRAW, AWAY: best.AWAY },
  };
}

/** Higher payout wins. +250 beats +180; -110 beats -150. */
export function isBetter(a: number, b: number): boolean {
  const dec = (n: number) => (n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n));
  return dec(a) > dec(b);
}

export function classifyOutcome(
  name: string,
  homeTeam: string,
  awayTeam: string
): Outcome | null {
  if (name === "Draw") return "DRAW";
  if (name === homeTeam) return "HOME";
  if (name === awayTeam) return "AWAY";
  return null;
}

/* ------------------------------------------------------------------ */
/* Team-name reconciliation                                            */
/* ------------------------------------------------------------------ */

/**
 * The two feeds don't agree on club names. football-data says "Nott'm Forest";
 * the odds feed says "Nottingham Forest". Normalise both sides to a key.
 */
export function teamKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(fc|afc|association football club)\b/g, "")
    .replace(/\bnottm\b/g, "nottingham")
    .replace(/\bman\b/g, "manchester")
    .replace(/\bwolverhampton wanderers\b/g, "wolves")
    .replace(/\bbrighton and hove albion\b/g, "brighton")
    .replace(/\btottenham hotspur\b/g, "tottenham")
    .replace(/\bwest ham united\b/g, "west ham")
    .replace(/\bnewcastle united\b/g, "newcastle")
    .replace(/\bleeds united\b/g, "leeds")
    .replace(/\bafc bournemouth\b/g, "bournemouth")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchKey(home: string, away: string): string {
  return `${teamKey(home)}|${teamKey(away)}`;
}

/* ------------------------------------------------------------------ */
/* Fetch with cache                                                    */
/* ------------------------------------------------------------------ */

let cache: { at: number; data: MatchOdds[] } | null = null;
let quota: { remaining: number; used: number } | null = null;

export function _resetCache() {
  cache = null;
  quota = null;
}

/** Credits left this month, as of the last call. Null until we've made one. */
export function lastQuota() {
  return quota;
}

export async function fetchEplOdds(force = false): Promise<MatchOdds[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY is not set");

  const url =
    `${BASE}/sports/${SPORT}/odds` +
    `?apiKey=${key}&regions=uk&markets=h2h&oddsFormat=american`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    // Serve stale rather than breaking the pick page mid-week.
    if (cache) return cache.data;
    throw new Error(`odds api ${res.status}: ${await res.text()}`);
  }

  quota = readQuota(res);

  const raw = (await res.json()) as RawEvent[];
  const data = raw.map(mapEvent).filter((x): x is MatchOdds => x !== null);

  cache = { at: Date.now(), data };
  return data;
}

/** Remaining quota, straight off the response headers. Worth logging. */
export function readQuota(res: Response) {
  return {
    remaining: Number(res.headers.get("x-requests-remaining") ?? NaN),
    used: Number(res.headers.get("x-requests-used") ?? NaN),
  };
}
