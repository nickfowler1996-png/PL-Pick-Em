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
 * The two feeds don't agree on club names, and the disagreement isn't a fixed
 * list you can maintain by hand — it changes every August with promotion.
 * football-data says "Nottingham" where the odds feed says "Nottingham Forest";
 * "Brighton Hove" against "Brighton and Hove Albion".
 *
 * So rather than enumerate clubs, normalise both sides and accept a match when
 * one name is a prefix of the other. That handles dropped suffixes without
 * ever confusing two genuinely different clubs — "Manchester City" and
 * "Manchester United" are neither equal nor a prefix of one another.
 */
export function teamKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    // Strip apostrophes before punctuation becomes spaces, or "Nott'm"
    // turns into "nott m" and the abbreviation rules stop matching.
    .replace(/['\u2018\u2019\u0060]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(fc|afc|cf|association football club)\b/g, " ")
    .replace(/\bnottm\b/g, "nottingham")
    .replace(/\bman\b/g, "manchester")
    .replace(/\bwolves\b/g, "wolverhampton")
    .replace(/\bspurs\b/g, "tottenham")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two club names refer to the same club. */
export function sameTeam(a: string, b: string): boolean {
  const x = teamKey(a);
  const y = teamKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "nottingham" vs "nottingham forest", "brighton hove" vs
  // "brighton hove albion". Guard the boundary so "wes" can't match "west ham".
  return x.startsWith(y + " ") || y.startsWith(x + " ");
}

export function matchKey(home: string, away: string): string {
  return `${teamKey(home)}|${teamKey(away)}`;
}

/**
 * Find the priced event for a fixture. Both clubs must agree, so a shared
 * city name can't pair the wrong two sides.
 */
export function findEventFor(
  home: string,
  away: string,
  events: MatchOdds[]
): MatchOdds | undefined {
  return events.find((e) => sameTeam(e.homeTeam, home) && sameTeam(e.awayTeam, away));
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
