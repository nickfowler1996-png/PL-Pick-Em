"use client";
import { useEffect, useState, useCallback } from "react";
import type { Multiplier, Outcome, Allowance } from "@/lib/scoring";
import { ageMinutes, describeAge } from "@/lib/odds-store";
import Nav from "@/app/components/Nav";

interface Match {
  id: string; home: string; away: string; kickoff: string;
  status: string; voided: boolean;
}
interface Pick { outcome: Outcome; multiplier: Multiplier; priceTaken: number }

const fmtOdds = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const money = (n: number) => {
  const s = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `−$${s}` : `$${s}`;
};
const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
const profit = (a: number, m: number) => Math.round(100 * m * (decimal(a) - 1));

const LABEL: Record<number, string> = { 1: "", 2: "2×", 3: "3×", 4: "4×" };

export default function PickBoard({
  matchweek, matchweeks, matches, initialPicks, allowance, limits,
}: {
  matchweek: { number: number; quarter: number; locksAt: string; compressed: boolean };
  matchweeks?: number[];
  matches: Match[];
  initialPicks: Record<string, Pick>;
  allowance: Allowance;
  limits: { doublesPerMatchweek: number; tripleUpgradesPerQuarter: number; quadsPerSeason: number };
}) {
  const [picks, setPicks] = useState(initialPicks);
  const [live, setLive] = useState<Record<string, Record<Outcome, number>>>({});
  const [pricedAt, setPricedAt] = useState<string | null>(null);
  const [oddsLoaded, setOddsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Matches lock one at a time now, so track the clock rather than a single
  // round-wide flag.
  const [clock, setClock] = useState(() => Date.now());
  const started = (m: Match) => clock >= new Date(m.kickoff).getTime();

  const loadOdds = useCallback(async () => {
    const res = await fetch(`/api/odds?mw=${matchweek.number}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setLive(data.prices);
    setPricedAt(data.fetchedAt);
    setOddsLoaded(true);
  }, [matchweek.number]);

  useEffect(() => {
    loadOdds();
    const t = setInterval(loadOdds, 60_000);
    const l = setInterval(() => setClock(Date.now()), 10_000);
    return () => { clearInterval(t); clearInterval(l); };
  }, [loadOdds]);

  // Three independent pools — a triple doesn't consume a double.
  const used = {
    doubles: Object.values(picks).filter((p) => p.multiplier === 2).length,
    triples: Object.values(picks).filter((p) => p.multiplier === 3).length
             + allowance.tripleUpgradesUsedThisQuarter,
    quads: Object.values(picks).filter((p) => p.multiplier === 4).length
           + (allowance.quadUsedThisSeason ? 1 : 0),
  };

  /** Could this match be set to `target`, given what's already spent? */
  function available(target: Multiplier, current: Multiplier): boolean {
    if (target === 1) return true;
    const alreadyMine = current === target ? 1 : 0;
    if (target === 2) return used.doubles - alreadyMine < limits.doublesPerMatchweek;
    if (target === 3) return used.triples - alreadyMine < limits.tripleUpgradesPerQuarter;
    return used.quads - alreadyMine < limits.quadsPerSeason;
  }

  async function save(matchId: string, outcome: Outcome, multiplier: Multiplier) {
    setSaving(matchId);
    setError(null);
    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, outcome, multiplier }),
    });
    const data = await res.json();
    setSaving(null);

    if (!res.ok) { setError(data.error); return; }
    // The server decides the price. Store what it returned, not what we showed.
    setPicks((p) => ({ ...p, [matchId]: { outcome, multiplier, priceTaken: data.priceTaken } }));
  }

  function cycle(m: Match) {
    const cur = picks[m.id]?.multiplier ?? 1;
    const order: Multiplier[] = [1, 2, 3, 4];

    for (let i = 1; i <= 4; i++) {
      const next = order[(order.indexOf(cur) + i) % 4];
      if (next === cur) break;
      if (!available(next, cur)) continue;
      setError(null);
      save(m.id, picks[m.id].outcome, next);
      return;
    }

    // Nothing else is affordable. Say so rather than ignoring the tap.
    setError(
      cur === 1
        ? "No multipliers left — your doubles, triples and quad are all spent."
        : `Nothing left to switch to. Tap again once you free up a slot, or leave it at ${LABEL[cur]}.`
    );
  }

  const made = Object.keys(picks).length;
  const playable = matches.filter((m) => !m.voided);
  const openCount = playable.filter((m) => clock < new Date(m.kickoff).getTime()).length;

  return (
    <main className="wrap">
      <header className="mast">
        <div>
          <div className="eyebrow">Premier League · Quarter {matchweek.quarter}</div>
          <h1 className="display">Matchweek {String(matchweek.number).padStart(2, "0")}</h1>
        </div>
        <div className="lock">
          {openCount === 0
            ? "Every match has kicked off"
            : `${openCount} match${openCount === 1 ? "" : "es"} still open`}
          <br />Each locks at its own kick-off
        </div>
      </header>

      <Nav active="slip" />

      {matchweeks && matchweeks.length > 1 && (
        <div className="mwpick">
          {matchweeks.map((n) => (
            <a key={n} className="mwbtn" data-on={n === matchweek.number}
               href={`/matchweek/${n}`}>{n}</a>
          ))}
        </div>
      )}

      {openCount > 0 && (
        <div className="ticker">
          <span className="dot" />
          {pricedAt
            ? `Prices as of ${describeAge(ageMinutes(pricedAt))} · they refresh more often as kick-off nears`
            : oddsLoaded
              ? "No prices stored yet · run the snapshot-odds job, then refresh"
              : "Loading prices…"}
        </div>
      )}

      {matchweek.compressed && openCount > 0 && (
        <div className="ticker" data-warn="true">
          Short week — this round follows straight on from the last one.
        </div>
      )}

      {error && <div className="ticker" data-error="true">{error}</div>}

      <div className="allow">
        <div className="pill">
          <div className="k">Doubles · this week</div>
          <div className={`v ${used.doubles >= limits.doublesPerMatchweek ? "out" : "live"}`}>
            {limits.doublesPerMatchweek - used.doubles} left
          </div>
        </div>
        <div className="pill">
          <div className="k">Triples · quarter {matchweek.quarter}</div>
          <div className={`v ${used.triples >= limits.tripleUpgradesPerQuarter ? "out" : "live"}`}>
            {limits.tripleUpgradesPerQuarter - used.triples} left
          </div>
        </div>
        <div className="pill">
          <div className="k">Quad · season</div>
          <div className={`v ${used.quads >= limits.quadsPerSeason ? "out" : "live"}`}>
            {limits.quadsPerSeason - used.quads} left
          </div>
        </div>
      </div>

      {matches.map((m) => {
        const pk = picks[m.id];
        const mult = pk?.multiplier ?? 1;
        const prices = live[m.id];

        if (m.voided) {
          return (
            <div key={m.id} className="match" data-voided="true">
              <div className="mhead">
                <div className="teams">{m.home} <i>v</i> {m.away}</div>
                <div className="ko">Postponed — voided</div>
              </div>
            </div>
          );
        }

        return (
          <div key={m.id} className="match" data-picked={!!pk} data-saving={saving === m.id}>
            {mult > 1 && <div className="stamp">{LABEL[mult]}</div>}
            <div className="mhead">
              <div className="teams">{m.home} <i>v</i> {m.away}</div>
              <div className="ko" data-locked={started(m)}>
                {started(m) ? "Locked · " : ""}
                {new Date(m.kickoff).toLocaleString("en-GB", {
                  weekday: "short", day: "numeric", month: "short",
                  hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>

            <div className="opts">
              {([["HOME", m.home], ["DRAW", "Draw"], ["AWAY", m.away]] as [Outcome, string][]).map(
                ([slot, label]) => {
                  const on = pk?.outcome === slot;
                  const price = on ? pk.priceTaken : prices?.[slot];
                  return (
                    <button
                      key={slot}
                      className="opt"
                      data-on={on}
                      aria-pressed={on}
                      disabled={started(m) || price === undefined}
                      onClick={() => save(m.id, slot, mult)}
                    >
                      <div className="lbl">{label}</div>
                      <div className="num">{price === undefined ? "—" : fmtOdds(price)}</div>
                      <div className="ret">
                        {price === undefined ? "" : money(profit(price, mult))}
                      </div>
                    </button>
                  );
                }
              )}
            </div>

            {pk && !started(m) && (
              <button className="multbtn" onClick={() => cycle(m)}>
                {mult === 1 ? "Add multiplier" : `Staked ${LABEL[mult]} — tap to change`}
              </button>
            )}
          </div>
        );
      })}

      <div className="totals">
        <div className="tot">
          <div className="k">Picks made</div>
          <div className="v">{made}/{playable.length}</div>
        </div>
        <div className="tot">
          <div className="k">Blanks would cost</div>
          <div className="v down">{money(-100 * (playable.length - made))}</div>
        </div>
      </div>

      <p className="note">
        Picks save the moment you tap — there&apos;s no submit button. Each match
        closes at its own kick-off, so a Monday fixture stays open all weekend.
        You&apos;re locked in at the price shown on your selection. Anything left
        blank when its match starts scores −$100.
      </p>
    </main>
  );
}
