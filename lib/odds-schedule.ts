/**
 * Odds snapshot cadence.
 *
 * The Odds API bills per call, so the way to stay inside the 500/month free
 * tier is to stop fetching on demand and fetch on a schedule instead. Prices
 * barely move three days out, so the cadence tightens as the deadline nears.
 *
 * Per matchweek, over a 72-hour pick window:
 *
 *   72h -> 24h   every 2 hours    24 calls
 *   24h ->  2h   every hour       22 calls
 *    2h ->  0h   every 15 min      8 calls
 *                                 -- 54 calls
 *
 * Even a congested six-round month lands around 250 calls against the 500
 * ceiling. A compressed midweek round has a 24-hour window, so it costs about
 * 30 rather than 54.
 */

export const SNAPSHOT_TIERS = [
  { withinHours: 2, everyMinutes: 15 },
  { withinHours: 24, everyMinutes: 60 },
  { withinHours: Infinity, everyMinutes: 120 },
] as const;

/** Refuse to spend the last few credits, so a bug can't drain the month. */
export const QUOTA_FLOOR = 25;

export function hoursToLock(locksAt: Date, now: Date): number {
  return (locksAt.getTime() - now.getTime()) / 3_600_000;
}

/** How often to snapshot, given how close the deadline is. */
export function snapshotIntervalMinutes(hoursLeft: number): number {
  for (const tier of SNAPSHOT_TIERS) {
    if (hoursLeft <= tier.withinHours) return tier.everyMinutes;
  }
  return SNAPSHOT_TIERS[SNAPSHOT_TIERS.length - 1].everyMinutes;
}

export type SkipReason =
  | "locked"
  | "window_not_open"
  | "too_soon"
  | "quota_low";

export type SnapshotDecision =
  | { fetch: true; hoursLeft: number; intervalMinutes: number }
  | { fetch: false; reason: SkipReason };

/**
 * Decide whether this run should spend a credit.
 *
 * The cron itself runs every 15 minutes — that part is free. This function is
 * what actually controls spend.
 *
 * @param locksAt        when picks close for the matchweek
 * @param sendAt         when the invite goes out; no point pricing before then
 * @param lastSnapshotAt when we last called the odds feed, or null
 * @param quotaRemaining credits left this month, or null if unknown
 */
export function shouldSnapshot(
  locksAt: Date,
  sendAt: Date,
  lastSnapshotAt: Date | null,
  quotaRemaining: number | null,
  now = new Date()
): SnapshotDecision {
  if (now >= locksAt) return { fetch: false, reason: "locked" };
  if (now < sendAt) return { fetch: false, reason: "window_not_open" };
  if (quotaRemaining !== null && quotaRemaining <= QUOTA_FLOOR) {
    return { fetch: false, reason: "quota_low" };
  }

  const hoursLeft = hoursToLock(locksAt, now);
  const intervalMinutes = snapshotIntervalMinutes(hoursLeft);

  if (lastSnapshotAt) {
    const minutesSince = (now.getTime() - lastSnapshotAt.getTime()) / 60_000;
    // Half a minute of slack so a cron firing at 3:59:58 isn't rejected.
    if (minutesSince < intervalMinutes - 0.5) {
      return { fetch: false, reason: "too_soon" };
    }
  }

  return { fetch: true, hoursLeft, intervalMinutes };
}

/** Projected calls for one pick window. Used by the budget report. */
export function projectCalls(windowHours: number): number {
  let calls = 0;
  let h = windowHours;
  while (h > 0) {
    calls++;
    h -= snapshotIntervalMinutes(h) / 60;
  }
  return calls;
}
