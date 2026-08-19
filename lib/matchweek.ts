/**
 * Matchweek, quarter, and email-scheduling logic.
 *
 * Everything keys off the official Premier League matchday number supplied by
 * football-data.org, never off calendar weeks.
 */

export interface Quarter {
  q: 1 | 2 | 3 | 4;
  start: number;
  end: number;
}

export const QUARTERS: Quarter[] = [
  { q: 1, start: 1, end: 9 },
  { q: 2, start: 10, end: 18 },
  { q: 3, start: 19, end: 28 },
  { q: 4, start: 29, end: 38 },
];

export const TOTAL_MATCHWEEKS = 38;

export function quarterOf(matchweek: number): Quarter {
  const found = QUARTERS.find((x) => matchweek >= x.start && matchweek <= x.end);
  if (!found) throw new Error(`Matchweek ${matchweek} is outside 1-${TOTAL_MATCHWEEKS}`);
  return found;
}

export function quarterRange(matchweek: number): [number, number] {
  const q = quarterOf(matchweek);
  return [q.start, q.end];
}

/** True if this matchweek is the last of its quarter — quarter payout time. */
export function isQuarterEnd(matchweek: number): boolean {
  return quarterOf(matchweek).end === matchweek;
}

/* ------------------------------------------------------------------ */
/* Send timing                                                         */
/* ------------------------------------------------------------------ */

const HOURS = 60 * 60 * 1000;
export const STANDARD_LEAD_HOURS = 72;
export const COMPRESSED_LEAD_HOURS = 24;

export interface SendWindow {
  sendAt: Date;
  /** "standard" = 3 days out. "compressed" = midweek round, 1 day out. */
  mode: "standard" | "compressed";
  /** Picks close here — the first kickoff of the matchweek, for everyone. */
  locksAt: Date;
}

/**
 * Work out when this matchweek's invite email goes out.
 *
 * Default is 72 hours before the first kickoff. If that would land before the
 * previous matchweek has even finished playing — which is what a midweek round
 * looks like — fall back to 24 hours. No manual flagging of midweek rounds.
 *
 * @param firstKickoff        earliest kickoff in this matchweek
 * @param previousLastKickoff latest kickoff in the previous matchweek, or null for MW1
 */
export function computeSendWindow(
  firstKickoff: Date,
  previousLastKickoff: Date | null
): SendWindow {
  const standard = new Date(firstKickoff.getTime() - STANDARD_LEAD_HOURS * HOURS);

  if (previousLastKickoff && standard.getTime() < previousLastKickoff.getTime()) {
    return {
      sendAt: new Date(firstKickoff.getTime() - COMPRESSED_LEAD_HOURS * HOURS),
      mode: "compressed",
      locksAt: firstKickoff,
    };
  }

  return { sendAt: standard, mode: "standard", locksAt: firstKickoff };
}

/** Nudge anyone with an incomplete slip this long before lock. */
export const REMINDER_LEAD_HOURS = 6;

export function computeReminderAt(locksAt: Date): Date {
  return new Date(locksAt.getTime() - REMINDER_LEAD_HOURS * HOURS);
}

/**
 * Group fixtures into matchweeks using the feed's own matchday field.
 * Returns matchweeks sorted by number, each with its kickoff bounds.
 */
export function groupIntoMatchweeks<T extends { matchday: number; kickoff: Date }>(
  fixtures: T[]
): { matchweek: number; firstKickoff: Date; lastKickoff: Date; fixtures: T[] }[] {
  const map = new Map<number, T[]>();
  for (const f of fixtures) {
    if (!map.has(f.matchday)) map.set(f.matchday, []);
    map.get(f.matchday)!.push(f);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matchweek, fs]) => {
      const times = fs.map((f) => f.kickoff.getTime());
      return {
        matchweek,
        firstKickoff: new Date(Math.min(...times)),
        lastKickoff: new Date(Math.max(...times)),
        fixtures: fs.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime()),
      };
    });
}
