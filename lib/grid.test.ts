import { buildGrid, consensus, type GridMatch, type GridPlayer, type GridPick } from "./pick-grid.ts";

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
}

const players: GridPlayer[] = [
  { id: "p1", name: "Dev" },
  { id: "p2", name: "Priya" },
  { id: "p3", name: "Tom" },
];

const matches: GridMatch[] = [
  { id: "m1", home: "Arsenal", away: "Forest", kickoff: "2026-08-21T14:00:00Z",
    result: "HOME", voided: false, status: "FINISHED" },
  { id: "m2", home: "Chelsea", away: "Everton", kickoff: "2026-08-22T14:00:00Z",
    result: null, voided: false, status: "SCHEDULED" },
  { id: "m3", home: "Leeds", away: "Wolves", kickoff: "2026-08-22T14:00:00Z",
    result: null, voided: true, status: "POSTPONED" },
];

const picks: GridPick[] = [
  { playerId: "p1", matchId: "m1", outcome: "HOME", multiplier: 1, priceTaken: -110, settledAmount: 90.91 },
  { playerId: "p2", matchId: "m1", outcome: "AWAY", multiplier: 2, priceTaken: 300, settledAmount: -200 },
  // p3 left m1 blank
  { playerId: "p1", matchId: "m2", outcome: "DRAW", multiplier: 1, priceTaken: 250, settledAmount: null },
  { playerId: "p2", matchId: "m3", outcome: "HOME", multiplier: 4, priceTaken: 150, settledAmount: null },
];

const g = buildGrid(matches, players, picks);

console.log("\nGrid shape");
check("a row per match", g.rows.length, 3);
check("a cell per player", g.rows[0].cells.length, 3);
check("counts finished matches", g.finished, 1);
check("counts all matches", g.total, 3);

console.log("\nPlayed match");
check("correct pick flagged", g.rows[0].cells[0].status, "correct");
check("correct pick labelled with the club", g.rows[0].cells[0].label, "Arsenal");
check("correct pick shows its amount", g.rows[0].cells[0].amount, 90.91);
check("wrong pick flagged", g.rows[0].cells[1].status, "wrong");
check("wrong pick keeps its multiplier", g.rows[0].cells[1].multiplier, 2);
check("wrong pick amount", g.rows[0].cells[1].amount, -200);
check("blank flagged once played", g.rows[0].cells[2].status, "blank");
check("blank costs a stake", g.rows[0].cells[2].amount, -100);
check("blank shows a dash", g.rows[0].cells[2].label, "—");

console.log("\nUnplayed match");
check("pick visible but unscored", g.rows[1].cells[0].status, "pending");
check("no amount yet", g.rows[1].cells[0].amount, null);
check("draw labelled", g.rows[1].cells[0].label, "Draw");
check("a blank isn't punished before kick-off", g.rows[1].cells[1].status, "pending");
check("no phantom penalty", g.rows[1].cells[1].amount, null);

console.log("\nVoided match");
check("void flagged", g.rows[2].cells[1].status, "void");
check("void scores nothing", g.rows[2].cells[1].amount, 0);
check("void keeps the quad visible", g.rows[2].cells[1].multiplier, 4);
check("blank on a void is still void", g.rows[2].cells[0].status, "void");

console.log("\nWeek totals");
const t = new Map(g.totals.map((x) => [x.playerId, x.total]));
check("winner's running total", t.get("p1"), 90.91);
check("loser's running total", t.get("p2"), -200);
check("no-show's running total", t.get("p3"), -100);
check("only settled matches counted", g.totals.find((x) => x.playerId === "p1")?.settledCount, 1);

console.log("\nUnsettled fallback");
// settled_amount is only written when the whole round closes, so a match that
// has finished mid-round must still score.
const midRound = buildGrid(
  [{ id: "x", home: "A", away: "B", kickoff: "", result: "HOME", voided: false, status: "FINISHED" }],
  [{ id: "p1", name: "Dev" }],
  [{ playerId: "p1", matchId: "x", outcome: "HOME", multiplier: 3, priceTaken: 250, settledAmount: null }]
);
check("scores from the stored price", midRound.rows[0].cells[0].amount, 750);
check("flagged correct", midRound.rows[0].cells[0].status, "correct");

console.log("\nConsensus");
check("most-picked side", consensus(g.rows[0]), { outcome: "HOME", count: 1 });
check("no picks means none", consensus({ match: matches[1], cells: [] }), null);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

/* ---- appended: club codes for column headers ---- */
import { abbrev } from "./pick-grid.ts";

console.log("\nClub codes");
check("Arsenal", abbrev("Arsenal"), "ARS");
check("Man City", abbrev("Man City"), "MCI");
check("Man United", abbrev("Man United"), "MUN");
check("City and United differ", abbrev("Man City") === abbrev("Man United"), false);
check("Nottingham", abbrev("Nottingham"), "NFO");
check("Nottingham Forest", abbrev("Nottingham Forest"), "NFO");
check("Nott'm Forest", abbrev("Nott'm Forest"), "NFO");
check("Brighton Hove", abbrev("Brighton Hove"), "BHA");
check("Brighton", abbrev("Brighton"), "BHA");
check("Wolves", abbrev("Wolves"), "WOL");
check("West Ham", abbrev("West Ham"), "WHU");
check("Crystal Palace", abbrev("Crystal Palace"), "CRY");
check("Coventry City", abbrev("Coventry City"), "COV");
check("Hull City", abbrev("Hull City"), "HUL");
check("Ipswich Town", abbrev("Ipswich Town"), "IPS");
check("unknown club falls back", abbrev("Barnsley"), "BAR");
check("Sheffield sides differ", abbrev("Sheffield United") === abbrev("Sheffield Wednesday"), false);

console.log("\nShort cell labels");
check("picked home side", g.rows[0].cells[0].short, "ARS");
check("draw is D", g.rows[1].cells[0].short, "D");
check("blank is a dash", g.rows[0].cells[2].short, "—");

console.log(`\nFINAL: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

/* ---- appended: per-match reveal ---- */
console.log("\nHidden until kick-off");

const future: GridMatch[] = [
  { id: "f1", home: "Arsenal", away: "Forest", kickoff: "2099-01-01T00:00:00Z",
    result: null, voided: false, status: "SCHEDULED", hidden: true },
];
const futurePicks: GridPick[] = [
  { playerId: "p1", matchId: "f1", outcome: "HOME", multiplier: 2, priceTaken: -110, settledAmount: null },
  { playerId: "p2", matchId: "f1", outcome: "AWAY", multiplier: 1, priceTaken: 300, settledAmount: null },
];

const mine = buildGrid(future, players, futurePicks, { meId: "p1" });
check("my own pick stays visible", mine.rows[0].cells[0].short, "ARS");
check("my multiplier stays visible", mine.rows[0].cells[0].multiplier, 2);
check("someone else's is concealed", mine.rows[0].cells[1].status, "hidden");
check("concealed cell shows a dot", mine.rows[0].cells[1].short, "·");
check("concealed cell leaks no side", mine.rows[0].cells[1].outcome, null);
check("concealed cell leaks no multiplier", mine.rows[0].cells[1].multiplier, 1);
check("a non-picker is concealed too", mine.rows[0].cells[2].status, "hidden");

const theirs = buildGrid(future, players, futurePicks, { meId: "p2" });
check("the other player sees their own", theirs.rows[0].cells[1].short, "FOR");
check("and not mine", theirs.rows[0].cells[0].status, "hidden");

const noViewer = buildGrid(future, players, futurePicks);
check("with no viewer everything is concealed", noViewer.rows[0].cells[0].status, "hidden");

// Once it kicks off, nothing is hidden.
const started = buildGrid(
  [{ ...future[0], hidden: false }], players, futurePicks, { meId: "p1" }
);
check("after kick-off others are visible", started.rows[0].cells[1].short, "FOR");

console.log(`\nFINAL: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
