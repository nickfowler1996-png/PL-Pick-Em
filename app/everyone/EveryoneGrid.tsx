"use client";
import { useEffect, useState, useCallback } from "react";

const money = (n: number) => {
  const s = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `−$${s}` : `$${s}`;
};
const MULT: Record<number, string> = { 1: "", 2: "2×", 3: "3×", 4: "4×" };

interface Cell {
  playerId: string; outcome: string | null; multiplier: number;
  label: string; priceTaken: number | null; status: string; amount: number | null;
}
interface Row { match: { id: string; home: string; away: string; kickoff: string;
  result: string | null; voided: boolean; status: string }; cells: Cell[] }

export default function EveryoneGrid() {
  const [data, setData] = useState<any>(null);
  const [mw, setMw] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (n?: number) => {
    setLoading(true);
    const res = await fetch(`/api/everyone${n ? `?mw=${n}` : ""}`, { cache: "no-store" });
    const json = await res.json();
    setData(json);
    if (json.matchweek) setMw(json.matchweek);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <p className="note">Loading…</p>;

  if (data && !data.locked) {
    return (
      <div className="ticker" data-warn="true">
        {data.reason === "not_yet"
          ? `Hidden until Matchweek ${data.matchweek} locks — nobody sees anyone else's slip before the deadline.`
          : "Nothing to show yet. Picks appear here once the first matchweek locks."}
      </div>
    );
  }
  if (!data) return <p className="note">Couldn&apos;t load picks.</p>;

  const rows: Row[] = data.rows;
  const players: { id: string; name: string }[] = data.players;
  const totals: { playerId: string; total: number | null }[] = data.totals;
  const totalById = new Map(totals.map((t) => [t.playerId, t.total]));

  return (
    <>
      <div className="ticker">
        <span className="dot" />
        {data.settled
          ? `Matchweek ${data.matchweek} settled`
          : `Matchweek ${data.matchweek} · ${data.finished} of ${data.total} played`}
      </div>

      {data.availableMatchweeks?.length > 1 && (
        <div className="mwpick">
          {data.availableMatchweeks.map((n: number) => (
            <button key={n} className="mwbtn" data-on={n === mw} onClick={() => load(n)}>
              {n}
            </button>
          ))}
        </div>
      )}

      <div className="gridscroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="stick">Match</th>
              {players.map((p) => (
                <th key={p.id} data-me={p.id === data.meId}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.match.id}>
                <th className="stick">
                  <div className="fx">{r.match.home} <i>v</i> {r.match.away}</div>
                  <div className="fxsub">
                    {r.match.voided
                      ? "Postponed"
                      : r.match.result
                        ? r.match.result === "DRAW" ? "Draw"
                          : r.match.result === "HOME" ? r.match.home : r.match.away
                        : new Date(r.match.kickoff).toLocaleString("en-GB", {
                            weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </th>
                {r.cells.map((c) => (
                  <td key={c.playerId} data-status={c.status}>
                    <div className="pk">
                      {c.label}
                      {c.multiplier > 1 && <span className="mx">{MULT[c.multiplier]}</span>}
                    </div>
                    {c.amount !== null && c.status !== "void" && (
                      <div className="amt">{money(c.amount)}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="stick">Week</th>
              {players.map((p) => {
                const t = totalById.get(p.id);
                return (
                  <td key={p.id} className="wk">
                    {t === null || t === undefined ? "—" : money(t)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="note">
        Everyone&apos;s slip is hidden until the matchweek locks. Amounts fill in as
        matches finish; the leaderboard updates once the whole round is done.
      </p>
    </>
  );
}
