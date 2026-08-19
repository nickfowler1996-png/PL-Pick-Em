import { mapFixture, deriveResult, normaliseStatus } from "./football-data.ts";
import { mapEvent, teamKey, matchKey, isBetter, classifyOutcome, sameTeam, findEventFor } from "./odds-api.ts";
import { evaluateMatchweek, settleAllPlayers, matchweekWinners, VOID_GRACE_HOURS } from "./settle.ts";
import { computeReminderAt, REMINDER_LEAD_HOURS } from "./matchweek.ts";
import type { StoredPick } from "./scoring.ts";

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
}

console.log("\nfootball-data mapping");
check("home win", deriveResult(2, 1), "HOME");
check("away win", deriveResult(0, 3), "AWAY");
check("draw", deriveResult(1, 1), "DRAW");
check("no score yet", deriveResult(null, null), null);
check("POSTPONED normalises", normaliseStatus("POSTPONED"), "POSTPONED");
check("CANCELLED counts as postponed", normaliseStatus("CANCELLED"), "POSTPONED");
check("PAUSED counts as in play", normaliseStatus("PAUSED"), "IN_PLAY");
check("TIMED counts as scheduled", normaliseStatus("TIMED"), "SCHEDULED");

const finished = mapFixture({
  id: 497001, matchday: 4, utcDate: "2026-09-12T11:30:00Z", status: "FINISHED",
  homeTeam: { shortName: "Arsenal", name: "Arsenal FC" },
  awayTeam: { shortName: "Nott'm Forest", name: "Nottingham Forest FC" },
  score: { fullTime: { home: 3, away: 0 } },
});
check("finished fixture has a result", finished.result, "HOME");
check("prefers shortName", finished.awayTeam, "Nott'm Forest");
check("keeps official matchday", finished.matchday, 4);

const pp = mapFixture({
  id: 497002, matchday: 4, utcDate: "2026-09-13T13:00:00Z", status: "POSTPONED",
  homeTeam: { shortName: "Everton", name: "Everton FC" },
  awayTeam: { shortName: "Palace", name: "Crystal Palace FC" },
  score: { fullTime: { home: null, away: null } },
});
check("postponed fixture has no result", pp.result, null);

console.log("\nodds mapping");
check("best of two positive prices", isBetter(250, 180), true);
check("best of two negative prices", isBetter(-110, -150), true);
check("negative loses to positive", isBetter(-110, 120), false);
check("draw classified", classifyOutcome("Draw", "Arsenal", "Chelsea"), "DRAW");
check("home classified", classifyOutcome("Arsenal", "Arsenal", "Chelsea"), "HOME");
check("unknown name rejected", classifyOutcome("Spurs", "Arsenal", "Chelsea"), null);

const ev = mapEvent({
  id: "abc123", commence_time: "2026-09-12T11:30:00Z",
  home_team: "Arsenal", away_team: "Nottingham Forest",
  bookmakers: [
    { key: "b1", markets: [{ key: "h2h", outcomes: [
      { name: "Arsenal", price: -250 }, { name: "Draw", price: 340 }, { name: "Nottingham Forest", price: 600 },
    ]}]},
    { key: "b2", markets: [{ key: "h2h", outcomes: [
      { name: "Arsenal", price: -230 }, { name: "Draw", price: 360 }, { name: "Nottingham Forest", price: 650 },
    ]}]},
  ],
});
check("takes the best price per outcome", ev?.prices, { HOME: -230, DRAW: 360, AWAY: 650 });

const incomplete = mapEvent({
  id: "x", commence_time: "2026-09-12T11:30:00Z",
  home_team: "Arsenal", away_team: "Forest",
  bookmakers: [{ key: "b1", markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: -250 }] }] }],
});
check("half-priced market is dropped", incomplete, null);

console.log("\nreminder timing");
check("lead is 24h", REMINDER_LEAD_HOURS, 24);

const stdLock = new Date("2026-08-21T14:00:00Z");
const stdSend = new Date("2026-08-18T14:00:00Z");   // 72h window
check("standard round nudges 24h out",
  computeReminderAt(stdLock, stdSend).toISOString(), "2026-08-20T14:00:00.000Z");

const midLock = new Date("2026-12-16T19:30:00Z");
const midSend = new Date("2026-12-15T19:30:00Z");   // 24h window
check("compressed round nudges at the midpoint",
  computeReminderAt(midLock, midSend).toISOString(), "2026-12-16T07:30:00.000Z");
check("compressed reminder lands after the invite",
  computeReminderAt(midLock, midSend) > midSend, true);
check("compressed reminder lands before lock",
  computeReminderAt(midLock, midSend) < midLock, true);
check("without a send time it falls back to 24h",
  computeReminderAt(stdLock).toISOString(), "2026-08-20T14:00:00.000Z");

console.log("\nclub name matching");
check("dropped suffix: Nottingham", sameTeam("Nottingham", "Nottingham Forest"), true);
check("dropped suffix: Brighton Hove", sameTeam("Brighton Hove", "Brighton and Hove Albion"), true);
check("Man City", sameTeam("Man City", "Manchester City"), true);
check("Nott'm Forest", sameTeam("Nott'm Forest", "Nottingham Forest"), true);
check("Wolves", sameTeam("Wolves", "Wolverhampton Wanderers"), true);
check("Spurs", sameTeam("Spurs", "Tottenham Hotspur"), true);
check("AFC Bournemouth", sameTeam("Bournemouth", "AFC Bournemouth"), true);
check("Newcastle", sameTeam("Newcastle", "Newcastle United"), true);
check("promoted club, exact", sameTeam("Coventry City", "Coventry City"), true);
check("City is not United", sameTeam("Manchester City", "Manchester United"), false);
check("Forest is not County", sameTeam("Nottingham Forest", "Nottingham County"), false);
check("West Ham is not West Brom", sameTeam("West Ham", "West Bromwich Albion"), false);
check("Sheffield sides differ", sameTeam("Sheffield United", "Sheffield Wednesday"), false);

const events = [
  { oddsEventId: "e1", homeTeam: "Nottingham Forest", awayTeam: "Leeds United",
    commenceTime: new Date(), prices: { HOME: -110, DRAW: 250, AWAY: 300 } },
  { oddsEventId: "e2", homeTeam: "Brighton and Hove Albion", awayTeam: "Aston Villa",
    commenceTime: new Date(), prices: { HOME: 120, DRAW: 240, AWAY: 220 } },
];
check("pairs Nottingham v Leeds United", findEventFor("Nottingham", "Leeds United", events)?.oddsEventId, "e1");
check("pairs Brighton Hove v Aston Villa", findEventFor("Brighton Hove", "Aston Villa", events)?.oddsEventId, "e2");
check("won't pair a reversed fixture", findEventFor("Leeds United", "Nottingham", events), undefined);
check("won't pair an absent fixture", findEventFor("Arsenal", "Chelsea", events), undefined);

console.log("\nsettlement readiness");
const lastKO = new Date("2026-09-14T19:00:00Z");
const during = new Date("2026-09-14T21:00:00Z");
const afterGrace = new Date(lastKO.getTime() + (VOID_GRACE_HOURS + 1) * 3600_000);

const allDone = evaluateMatchweek([
  { matchId: "a", status: "FINISHED", result: "HOME", kickoff: new Date() },
  { matchId: "b", status: "FINISHED", result: "DRAW", kickoff: new Date() },
], { lastKickoff: lastKO, alreadySettled: false, now: during });
check("settles when every match is done", allDone.ready, true);

const midRound = evaluateMatchweek([
  { matchId: "a", status: "FINISHED", result: "HOME", kickoff: new Date() },
  { matchId: "b", status: "SCHEDULED", result: null, kickoff: lastKO },
], { lastKickoff: lastKO, alreadySettled: false, now: new Date("2026-09-13T10:00:00Z") });
check("waits for the Monday night game", midRound.ready, false);
check("reports what it is waiting on", midRound.ready === false && midRound.waitingOn, 1);

const withPostponed = evaluateMatchweek([
  { matchId: "a", status: "FINISHED", result: "HOME", kickoff: new Date() },
  { matchId: "b", status: "POSTPONED", result: null, kickoff: new Date() },
], { lastKickoff: lastKO, alreadySettled: false, now: during });
check("a postponed match does not block the week", withPostponed.ready, true);
check("postponed match is voided", withPostponed.ready === true && withPostponed.voidedCount, 1);

const stalled = evaluateMatchweek([
  { matchId: "a", status: "FINISHED", result: "HOME", kickoff: new Date() },
  { matchId: "b", status: "SCHEDULED", result: null, kickoff: lastKO },
], { lastKickoff: lastKO, alreadySettled: false, now: afterGrace });
check("grace expiry forces the week closed", stalled.ready, true);
check("unplayed fixture voided after grace", stalled.ready === true && stalled.voidedCount, 1);

check("will not settle twice", evaluateMatchweek(
  [{ matchId: "a", status: "FINISHED", result: "HOME", kickoff: new Date() }],
  { lastKickoff: lastKO, alreadySettled: true, now: during }
).ready, false);

console.log("\nsettling the whole pool");
const matches = allDone.ready ? allDone.matches : [];
const picks = new Map<string, StoredPick[]>([
  ["p1", [
    { matchId: "a", outcome: "HOME", multiplier: 1, priceTaken: -110 },
    { matchId: "b", outcome: "DRAW", multiplier: 2, priceTaken: 250 },
  ]],
  ["p2", [{ matchId: "a", outcome: "AWAY", multiplier: 1, priceTaken: 300 }]],
]);
const results = settleAllPlayers(["p1", "p2", "p3"], matches, picks);
check("everyone gets a row, even the no-show", results.length, 3);
check("p1 total", results[0].total, 590.91);
check("p2 loses one and blanks one", results[1].total, -200);
check("p3 never opened the email", results[2].total, -200);
check("p3 flagged as missing both", results[2].missedMatches, 2);
check("winner is p1", matchweekWinners(results), ["p1"]);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

/* ---- appended: snapshot scheduling and price store ---- */
import { shouldSnapshot, snapshotIntervalMinutes, projectCalls, QUOTA_FLOOR } from "./odds-schedule.ts";
import { latestPrices, ageMinutes, describeAge } from "./odds-store.ts";

console.log("\nsnapshot cadence");
check("far out is every 2h", snapshotIntervalMinutes(70), 120);
check("last day is hourly", snapshotIntervalMinutes(20), 60);
check("final 2h is every 15m", snapshotIntervalMinutes(1.5), 15);
check("72h window costs 54 calls", projectCalls(72), 54);
check("24h window costs 30 calls", projectCalls(24), 30);
check("busiest month stays under 500", 3 * projectCalls(72) + 3 * projectCalls(24) < 500, true);

const locks = new Date("2026-09-12T11:30:00Z");
const sends = new Date("2026-09-09T11:30:00Z");

check("no fetch before the invite goes out",
  shouldSnapshot(locks, sends, null, 400, new Date("2026-09-08T00:00:00Z")),
  { fetch: false, reason: "window_not_open" });

check("no fetch once locked",
  shouldSnapshot(locks, sends, null, 400, new Date("2026-09-12T12:00:00Z")),
  { fetch: false, reason: "locked" });

check("first run in the window fetches",
  shouldSnapshot(locks, sends, null, 400, new Date("2026-09-09T12:00:00Z")).fetch, true);

check("too soon after the last one",
  shouldSnapshot(locks, sends, new Date("2026-09-09T12:00:00Z"), 400, new Date("2026-09-09T12:30:00Z")),
  { fetch: false, reason: "too_soon" });

check("2h later it fetches again",
  shouldSnapshot(locks, sends, new Date("2026-09-09T12:00:00Z"), 400, new Date("2026-09-09T14:00:00Z")).fetch,
  true);

check("hourly inside the last day",
  shouldSnapshot(locks, sends, new Date("2026-09-11T18:00:00Z"), 400, new Date("2026-09-11T19:00:00Z")).fetch,
  true);

check("but not half-hourly there",
  shouldSnapshot(locks, sends, new Date("2026-09-11T18:00:00Z"), 400, new Date("2026-09-11T18:30:00Z")).fetch,
  false);

check("every 15m in the final stretch",
  shouldSnapshot(locks, sends, new Date("2026-09-12T10:00:00Z"), 400, new Date("2026-09-12T10:15:00Z")).fetch,
  true);

check("stops when quota runs low",
  shouldSnapshot(locks, sends, null, QUOTA_FLOOR, new Date("2026-09-09T12:00:00Z")),
  { fetch: false, reason: "quota_low" });

check("unknown quota does not block",
  shouldSnapshot(locks, sends, null, null, new Date("2026-09-09T12:00:00Z")).fetch, true);

console.log("\nstored price lookup");
const snapRows = [
  { match_id: "m1", outcome: "HOME" as const, american: -110, fetched_at: "2026-09-10T10:00:00Z" },
  { match_id: "m1", outcome: "DRAW" as const, american: 250, fetched_at: "2026-09-10T10:00:00Z" },
  { match_id: "m1", outcome: "AWAY" as const, american: 300, fetched_at: "2026-09-10T10:00:00Z" },
  { match_id: "m1", outcome: "HOME" as const, american: -130, fetched_at: "2026-09-10T12:00:00Z" },
  { match_id: "m1", outcome: "DRAW" as const, american: 260, fetched_at: "2026-09-10T12:00:00Z" },
  { match_id: "m1", outcome: "AWAY" as const, american: 330, fetched_at: "2026-09-10T12:00:00Z" },
  { match_id: "m2", outcome: "HOME" as const, american: 150, fetched_at: "2026-09-10T12:00:00Z" },
];
const latest = latestPrices(snapRows);
check("takes the newest generation", latest.get("m1")?.prices, { HOME: -130, DRAW: 260, AWAY: 330 });
check("drops a match missing outcomes", latest.has("m2"), false);
check("reports when it was priced", latest.get("m1")?.fetchedAt, "2026-09-10T12:00:00Z");

const t0 = new Date("2026-09-10T12:00:00Z");
check("fresh reads as just now", describeAge(ageMinutes("2026-09-10T11:59:00Z", t0)), "just now");
check("minutes", describeAge(ageMinutes("2026-09-10T11:20:00Z", t0)), "40 min ago");
check("an hour", describeAge(ageMinutes("2026-09-10T11:00:00Z", t0)), "an hour ago");
check("hours", describeAge(ageMinutes("2026-09-10T09:00:00Z", t0)), "3 hours ago");

console.log(`\nFINAL: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
