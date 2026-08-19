/**
 * Settlement.
 *
 * A matchweek settles once its last match has finished — not match by match.
 * Nothing hits the leaderboard until the whole round is done.
 */

import {
  settlePlayerMatchweek,
  type SettledMatch,
  type StoredPick,
  type PlayerResult,
} from "./scoring.ts";
import type { MatchStatus } from "./football-data.ts";

/**
 * How long to wait past a matchweek's last scheduled kickoff before giving up
 * on anything still unplayed and voiding it.
 *
 * Without this, a single postponed fixture rearranged for six weeks' time would
 * freeze the leaderboard for the entire pool. 24 hours clears the round the day
 * after it was meant to end.
 */
export const VOID_GRACE_HOURS = 24;

export interface MatchRow {
  matchId: string;
  status: MatchStatus;
  result: "HOME" | "DRAW" | "AWAY" | null;
  kickoff: Date;
}

export type SettleDecision =
  | { ready: false; reason: "already_settled" | "matches_still_to_play" | "no_matches"; waitingOn: number }
  | { ready: true; matches: SettledMatch[]; voidedCount: number };

/**
 * Decide whether a matchweek can be settled, and if so which fixtures count.
 *
 * Ready when every match has finished. If the grace window has expired, we
 * settle anyway and void whatever never got played.
 */
export function evaluateMatchweek(
  matches: MatchRow[],
  opts: { lastKickoff: Date; alreadySettled: boolean; now?: Date }
): SettleDecision {
  const now = opts.now ?? new Date();

  if (opts.alreadySettled) return { ready: false, reason: "already_settled", waitingOn: 0 };
  if (matches.length === 0) return { ready: false, reason: "no_matches", waitingOn: 0 };

  const unfinished = matches.filter((m) => m.status !== "FINISHED");
  const graceExpired =
    now.getTime() > opts.lastKickoff.getTime() + VOID_GRACE_HOURS * 3600_000;

  // Anything postponed is voided immediately — it was never going to be played
  // in this round. Anything else still pending holds the week up until grace.
  const stillPending = unfinished.filter((m) => m.status !== "POSTPONED");

  if (stillPending.length > 0 && !graceExpired) {
    return { ready: false, reason: "matches_still_to_play", waitingOn: stillPending.length };
  }

  const settledMatches: SettledMatch[] = matches.map((m) => {
    const isVoid = m.status !== "FINISHED" || m.result === null;
    return { matchId: m.matchId, result: isVoid ? null : m.result, voided: isVoid };
  });

  return {
    ready: true,
    matches: settledMatches,
    voidedCount: settledMatches.filter((m) => m.voided).length,
  };
}

/**
 * Settle every player, including anyone who never opened the email.
 *
 * The player list is the source of truth, not the pick table — a player with
 * zero picks still gets a row, and takes -$100 per non-voided match.
 */
export function settleAllPlayers(
  playerIds: string[],
  matches: SettledMatch[],
  picksByPlayer: Map<string, StoredPick[]>
): PlayerResult[] {
  return playerIds.map((id) =>
    settlePlayerMatchweek(id, matches, picksByPlayer.get(id) ?? [])
  );
}

/** Winners of a settled matchweek. Ties share it. */
export function matchweekWinners(results: PlayerResult[]): string[] {
  if (results.length === 0) return [];
  const best = Math.max(...results.map((r) => r.total));
  return results.filter((r) => r.total === best).map((r) => r.playerId);
}
