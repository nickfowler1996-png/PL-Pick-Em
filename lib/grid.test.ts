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
