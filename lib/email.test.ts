import { renderInvite, renderReminder, renderRecap, money, hoursUntil } from "./email.ts";
import type { PlayerResult } from "./scoring.ts";

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
}
const has = (s: string, sub: string) => s.includes(sub);

console.log("\nformatting");
check("positive money", money(1240), "$1,240");
check("negative money uses a real minus", money(-915), "−$915");
check("zero", money(0), "$0");

const now = new Date("2026-09-09T12:00:00Z");
check("hours until", hoursUntil("2026-09-12T12:00:00Z", now), 72);
check("past deadline clamps to zero", hoursUntil("2026-09-01T00:00:00Z", now), 0);

console.log("\ninvite");
const standard = { id: "x", mw_number: 4, quarter: 1, send_mode: "standard" as const, locks_at: "2026-09-12T11:30:00Z" };
const inv = renderInvite(standard, "Dev", "https://app/x");
check("plain subject for a normal week", inv.subject, "Matchweek 4 is open");
check("greets the player", has(inv.html, "Dev"), true);
check("warns about blanks", has(inv.html, "−$100"), true);
check("explains live pricing", has(inv.html, "locked in at whatever you see"), true);
check("carries the magic link", has(inv.html, "https://app/x"), true);
check("has a plain-text part", inv.text.length > 0, true);

const compressed = { ...standard, send_mode: "compressed" as const };
const rush = renderInvite(compressed, "Dev", "https://app/x");
check("midweek subject flags the turnaround", has(rush.subject, "quick turnaround"), true);
check("midweek body explains the short week", has(rush.html, "Short week"), true);

console.log("\nreminder");
const rem = renderReminder(standard, "Priya", 6, 10, "https://app/x");
check("subject counts what's left", has(rem.subject, "4 matches left"), true);
check("body shows progress", has(rem.html, "6 of 10"), true);
check("quantifies the worst case", has(rem.html, "−$1,000"), true);
check("mentions doubles expiring", has(rem.html, "roll over"), true);

const none = renderReminder(standard, "Tom", 0, 10, "https://app/x");
check("zero picks gets a sharper heading", has(none.html, "haven't picked yet"), true);
check("singular when one left", has(renderReminder(standard, "T", 9, 10, "u").subject, "1 match left"), true);

console.log("\nrecap");
const you: PlayerResult = {
  playerId: "p1", total: 341.5, lines: [], missedMatches: 2, voidedMatches: 1,
};
const board = [
  { name: "Priya", quarterTotal: 2010, seasonTotal: 2010 },
  { name: "Dev", quarterTotal: 1685, seasonTotal: 1685 },
  { name: "Tom", quarterTotal: -915, seasonTotal: -915 },
];
const rec = renderRecap(standard, "Dev", you, board, ["Priya"], false, "https://app/x");
check("subject names the matchweek", rec.subject, "Matchweek 4 results");
check("names the winner", has(rec.html, "Priya"), true);
check("reports your total", has(rec.html, "$342"), true);
check("calls out blanks", has(rec.html, "2 blanks"), true);
check("calls out voids", has(rec.html, "postponed and voided"), true);
check("renders every player", board.every((b) => has(rec.html, b.name)), true);
check("negative totals shown in red", has(rec.html, "−$915"), true);

const qEnd = renderRecap({ ...standard, mw_number: 9 }, "Dev", you, board, ["Dev"], true, "u");
check("quarter end changes the subject", has(qEnd.subject, "Quarter 1 is settled"), true);
check("quarter end explains the reset", has(qEnd.html, "reset next week"), true);

const noSlip = renderRecap(standard, "Tom", undefined, board, ["Priya"], false, "u");
check("still renders for a player with no result row", noSlip.subject, "Matchweek 4 results");

const tie = renderRecap(standard, "Dev", you, board, ["Dev", "Priya"], false, "u");
check("ties list both winners", has(tie.html, "Dev, Priya"), true);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
