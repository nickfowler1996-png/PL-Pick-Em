import {
  computeAllowance,
  MAX_BOOSTED_PER_WEEK,
  settlePick, settlePlayerMatchweek, validateSlip, buildStandings,
  toDecimal, toAmerican, type StoredPick, type SettledMatch,
} from "./scoring.ts";
import {
  quarterOf, computeSendWindow, groupIntoMatchweeks, isQuarterEnd,
} from "./matchweek.ts";

let pass = 0, fail = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

function check(name: string, got: unknown, want: unknown) {
  const ok = typeof got === "number" && typeof want === "number"
    ? near(got, want)
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
}

console.log("\nOdds conversion");
check("-110 -> decimal", toDecimal(-110), 1.909090909);
check("+250 -> decimal", toDecimal(250), 3.5);
check("round-trips through American", toAmerican(toDecimal(-110)), -110);

console.log("\nNet scoring (the rule you picked)");
check("-110 correct at 1x", settlePick(-110, 1, true), 90.91);
check("+250 correct at 1x", settlePick(250, 1, true), 250);
check("-110 wrong at 1x", settlePick(-110, 1, false), -100);
check("+250 correct at 2x", settlePick(250, 2, true), 500);
check("+250 correct at 3x", settlePick(250, 3, true), 750);
check("-600 correct at 4x (big favourite, small pay)", settlePick(-600, 4, true), 66.67);
check("wrong at 4x costs 4 stakes", settlePick(250, 4, false), -400);

console.log("\nNo-show penalty: -$100 per match");
const matches: SettledMatch[] = [
  { matchId: "m1", result: "HOME" },
  { matchId: "m2", result: "DRAW" },
  { matchId: "m3", result: "AWAY" },
];

const fullSlip: StoredPick[] = [
  { matchId: "m1", outcome: "HOME", multiplier: 1, priceTaken: -110 },
  { matchId: "m2", outcome: "HOME", multiplier: 1, priceTaken: 130 },
  { matchId: "m3", outcome: "AWAY", multiplier: 2, priceTaken: 200 },
];
const full = settlePlayerMatchweek("p1", matches, fullSlip);
check("full slip total", full.total, 90.91 - 100 + 400);
check("full slip misses nothing", full.missedMatches, 0);

const noSlip = settlePlayerMatchweek("p2", matches, []);
check("no slip at all = -100 x 3", noSlip.total, -300);
check("no slip counts 3 misses", noSlip.missedMatches, 3);
check("no-pick lines are flagged", noSlip.lines.every((l) => l.reason === "no_pick"), true);

const partial = settlePlayerMatchweek("p3", matches, [fullSlip[0]]);
check("partial slip penalises the gaps", partial.total, 90.91 - 100 - 100);
check("partial slip counts 2 misses", partial.missedMatches, 2);

console.log("\nMultipliers");
check("2 doubles is fine", validateSlip(
  [{ multiplier: 2 }, { multiplier: 2 }, { multiplier: 1 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

check("3 doubles is rejected", validateSlip(
  [{ multiplier: 2 }, { multiplier: 2 }, { multiplier: 2 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
)[0]?.code, "TOO_MANY_DOUBLES");

check("a triple does NOT eat a double slot", validateSlip(
  [{ multiplier: 3 }, { multiplier: 2 }, { multiplier: 2 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

check("the maximum week: 2 doubles + 2 triples + 1 quad", validateSlip(
  [{ multiplier: 2 }, { multiplier: 2 }, { multiplier: 3 }, { multiplier: 3 }, { multiplier: 4 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

check("a 6th boost is rejected", validateSlip(
  [{ multiplier: 2 }, { multiplier: 2 }, { multiplier: 2 },
   { multiplier: 3 }, { multiplier: 3 }, { multiplier: 4 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
)[0]?.code, "TOO_MANY_DOUBLES");

check("pools are checked independently", validateSlip(
  [{ multiplier: 3 }, { multiplier: 3 }, { multiplier: 4 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

check("doubles spent don't block a triple", validateSlip(
  [{ multiplier: 2 }, { multiplier: 2 }, { multiplier: 3 }],
  { tripleUpgradesUsedThisQuarter: 1, quadUsedThisSeason: false }
).length, 0);

check("3rd triple in a quarter is rejected", validateSlip(
  [{ multiplier: 3 }],
  { tripleUpgradesUsedThisQuarter: 2, quadUsedThisSeason: false }
)[0]?.code, "TOO_MANY_TRIPLES");

check("2nd quad of the season is rejected", validateSlip(
  [{ multiplier: 4 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: true }
)[0]?.code, "QUAD_ALREADY_USED");

check("quad does not consume a triple", validateSlip(
  [{ multiplier: 4 }, { multiplier: 3 }],
  { tripleUpgradesUsedThisQuarter: 1, quadUsedThisSeason: false }
).length, 0);

check("max boosted per week", MAX_BOOSTED_PER_WEEK, 5);

console.log("\nQuarters");
check("MW9 is Q1", quarterOf(9).q, 1);
check("MW10 is Q2", quarterOf(10).q, 2);
check("MW19 is Q3", quarterOf(19).q, 3);
check("MW29 is Q4", quarterOf(29).q, 4);
check("MW38 is Q4", quarterOf(38).q, 4);
check("MW9 ends a quarter", isQuarterEnd(9), true);
check("MW10 does not", isQuarterEnd(10), false);
check("all 38 weeks are covered", [...Array(38)].map((_, i) => quarterOf(i + 1).q).length, 38);

console.log("\nSend timing");
const satKO = new Date("2026-09-12T12:30:00Z");
const prevSun = new Date("2026-09-06T16:30:00Z");   // normal week's gap
const normal = computeSendWindow(satKO, prevSun);
check("normal week sends 72h early", normal.mode, "standard");
check("normal week send date", normal.sendAt.toISOString(), "2026-09-09T12:30:00.000Z");

const tueKO = new Date("2026-09-15T19:00:00Z");     // midweek round
const midweek = computeSendWindow(tueKO, new Date("2026-09-14T20:00:00Z"));
check("midweek round compresses to 24h", midweek.mode, "compressed");
check("midweek send date", midweek.sendAt.toISOString(), "2026-09-14T19:00:00.000Z");
check("MW1 has no previous week", computeSendWindow(satKO, null).mode, "standard");
check("picks lock at first kickoff", midweek.locksAt.toISOString(), tueKO.toISOString());

console.log("\nGrouping by official matchday");
const grouped = groupIntoMatchweeks([
  { matchday: 4, kickoff: new Date("2026-09-14T19:00:00Z") },
  { matchday: 3, kickoff: new Date("2026-09-06T13:00:00Z") },
  { matchday: 4, kickoff: new Date("2026-09-12T11:30:00Z") },
]);
check("groups by matchday not calendar", grouped.map((g) => g.matchweek), [3, 4]);
check("MW4 spans Sat to Mon", grouped[1].firstKickoff.toISOString(), "2026-09-12T11:30:00.000Z");
check("MW4 last kickoff", grouped[1].lastKickoff.toISOString(), "2026-09-14T19:00:00.000Z");

console.log("\nStandings");
const standings = buildStandings([
  { playerId: "a", matchweek: 9,  total: 300 },
  { playerId: "b", matchweek: 9,  total: 100 },
  { playerId: "a", matchweek: 10, total: -200 },
  { playerId: "b", matchweek: 10, total: 400 },
], [10, 18]);
const a = standings.find((r) => r.playerId === "a")!;
const b = standings.find((r) => r.playerId === "b")!;
check("season carries across the quarter line", a.seasonTotal, 100);
check("quarter total resets to Q2 only", a.quarterTotal, -200);
check("b season", b.seasonTotal, 500);
check("b quarter", b.quarterTotal, 400);
check("a won MW9", a.matchweeksWon, 1);
check("b won MW10", b.matchweeksWon, 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

/* ---- appended: voided fixtures ---- */
console.log("\nPostponed fixtures are voided");

const withVoid: SettledMatch[] = [
  { matchId: "m1", result: "HOME" },
  { matchId: "m2", result: null, voided: true },
  { matchId: "m3", result: "AWAY" },
];

const voidedWithPick = settlePlayerMatchweek("v1", withVoid, [
  { matchId: "m1", outcome: "HOME", multiplier: 1, priceTaken: -110 },
  { matchId: "m2", outcome: "HOME", multiplier: 4, priceTaken: 150 },
  { matchId: "m3", outcome: "AWAY", multiplier: 1, priceTaken: 200 },
]);
check("void scores zero, quad included", voidedWithPick.total, 90.91 + 200);
check("void is flagged on the line", voidedWithPick.lines[1].reason, "void");
check("void line pays nothing", voidedWithPick.lines[1].amount, 0);
check("void counted", voidedWithPick.voidedMatches, 1);

const voidedNoPick = settlePlayerMatchweek("v2", withVoid, [
  { matchId: "m1", outcome: "HOME", multiplier: 1, priceTaken: -110 },
  { matchId: "m3", outcome: "AWAY", multiplier: 1, priceTaken: 200 },
]);
check("blank on a voided match is not penalised", voidedNoPick.total, 90.91 + 200);
check("blank on a voided match is not a miss", voidedNoPick.missedMatches, 0);

const voidedAndMissed = settlePlayerMatchweek("v3", withVoid, []);
check("void excluded, real blanks still cost", voidedAndMissed.total, -200);
check("only real blanks count as misses", voidedAndMissed.missedMatches, 2);

console.log("\nMultipliers refunded from voids");
check("quad on a voided match is handed back", computeAllowance(
  [{ multiplier: 4, voided: true }],
  [{ multiplier: 4, voided: true }]
).quadUsedThisSeason, false);

check("quad on a played match stays spent", computeAllowance(
  [{ multiplier: 4, voided: false }],
  [{ multiplier: 4, voided: false }]
).quadUsedThisSeason, true);

check("triple on a voided match is handed back", computeAllowance(
  [{ multiplier: 3, voided: true }, { multiplier: 3, voided: false }],
  []
).tripleUpgradesUsedThisQuarter, 1);

check("refunded quad can be replayed", validateSlip(
  [{ multiplier: 4 }],
  computeAllowance([], [{ multiplier: 4, voided: true }])
).length, 0);

check("refunded triple can be replayed", validateSlip(
  [{ multiplier: 3 }, { multiplier: 2 }],
  computeAllowance(
    [{ multiplier: 3, voided: false }, { multiplier: 3, voided: true }],
    []
  )
).length, 0);

console.log(`\nFINAL: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

/* ---- appended: allowance must not double-count the current week ---- */
console.log("\nAllowance excludes the current matchweek");

// A quad played THIS week appears in the slip. If it also appeared in the
// allowance, this would wrongly report QUAD_ALREADY_USED.
check("quad in this week's slip is not also 'already used'", validateSlip(
  [{ multiplier: 4 }, { multiplier: 2 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

check("adding a double alongside this week's quad still works", validateSlip(
  [{ multiplier: 4 }, { multiplier: 2 }, { multiplier: 2 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

check("adding a triple alongside this week's quad still works", validateSlip(
  [{ multiplier: 4 }, { multiplier: 3 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: false }
).length, 0);

// A quad played in an EARLIER week does block a new one.
check("quad spent in an earlier week blocks a second", validateSlip(
  [{ multiplier: 4 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: true }
)[0]?.code, "QUAD_ALREADY_USED");

check("earlier quad doesn't block this week's doubles", validateSlip(
  [{ multiplier: 2 }, { multiplier: 2 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: true }
).length, 0);

check("earlier quad doesn't block this week's triples", validateSlip(
  [{ multiplier: 3 }, { multiplier: 3 }],
  { tripleUpgradesUsedThisQuarter: 0, quadUsedThisSeason: true }
).length, 0);

console.log(`\nFINAL: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
