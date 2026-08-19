/**
 * football-data.org client — fixtures, results, and the official matchday
 * number that drives every matchweek in this app.
 */

import type { Outcome } from "./scoring.ts";

const BASE = "https://api.football-data.org/v4";
const COMPETITION = "PL";

export type MatchStatus = "SCHEDULED" | "IN_PLAY" | "FINISHED" | "POSTPONED";

export interface Fixture {
  fdMatchId: number;
  matchday: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  result: Outcome | null;
}

/* ------------------------------------------------------------------ */
/* Mapping — pure, so it can be tested without a network call          */
/* ------------------------------------------------------------------ */

/** Statuses the feed uses that we treat as "not going to be played here". */
const POSTPONED_STATUSES = new Set(["POSTPONED", "SUSPENDED", "CANCELLED", "AWARDED"]);

export function deriveResult(home: number | null, away: number | null): Outcome | null {
  if (home === null || away === null) return null;
  if (home > away) return "HOME";
  if (away > home) return "AWAY";
  return "DRAW";
}

export function normaliseStatus(raw: string): MatchStatus {
  if (raw === "FINISHED") return "FINISHED";
  if (POSTPONED_STATUSES.has(raw)) return "POSTPONED";
  if (raw === "IN_PLAY" || raw === "PAUSED") return "IN_PLAY";
  return "SCHEDULED";
}

interface RawMatch {
  id: number;
  matchday: number;
  utcDate: string;
  status: string;
  homeTeam: { shortName?: string; name: string };
  awayTeam: { shortName?: string; name: string };
  score?: { fullTime?: { home: number | null; away: number | null } };
}

export function mapFixture(raw: RawMatch): Fixture {
  const status = normaliseStatus(raw.status);
  const homeScore = raw.score?.fullTime?.home ?? null;
  const awayScore = raw.score?.fullTime?.away ?? null;

  return {
    fdMatchId: raw.id,
    matchday: raw.matchday,
    homeTeam: raw.homeTeam.shortName ?? raw.homeTeam.name,
    awayTeam: raw.awayTeam.shortName ?? raw.awayTeam.name,
    kickoff: new Date(raw.utcDate),
    status,
    homeScore,
    awayScore,
    // Only a finished match has a result. A postponed one stays null and gets
    // voided at settlement.
    result: status === "FINISHED" ? deriveResult(homeScore, awayScore) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export async function fetchSeasonFixtures(season: number): Promise<Fixture[]> {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) throw new Error("FOOTBALL_DATA_TOKEN is not set");

  const res = await fetch(`${BASE}/competitions/${COMPETITION}/matches?season=${season}`, {
    headers: { "X-Auth-Token": token },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`football-data ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as { matches: RawMatch[] };
  return body.matches.map(mapFixture);
}
