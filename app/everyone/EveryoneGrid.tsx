"use client";
import { useEffect, useState, useCallback } from "react";
import { abbrev } from "@/lib/pick-grid";

const money = (n: number) => {
  const s = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `−$${s}` : `$${s}`;
};
const MULT: Record<number, string> = { 1: "", 2: "2×", 3: "3×", 4: "4×" };

interface Cell {
  playerId: string; outcome: string | null; multiplier: number;
  label: string; short: string; priceTaken: number | null;
  status: string; amount: number | null;
}
interface Match {
  id: string; home: string; away: string; kickoff: string;
  result: string | null; voided: boolean; status: string;
}
interface Row { match: Match; cells: Cell[] }

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

  // Results land every half hour during a round, so refresh quietly rather
  // than making people reload to watch a match turn green.
  useEffect(() => {
    const t = setInterval(() => load(mw ?? undefined), 60_000);
    return () => clearInterval(t);
  }, [load, mw]);

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
  const totalById = new Map(
    (data.totals as { playerId: string; total: number | null }[]).map((t) => [t.playerId, t.total])
  );


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
              <th className="stick">Player</th>
              {rows.map((r) => {
                // Result shown as a code too, so the header stays narrow.
                const winner =
                  r.match.result === "DRAW" ? "Draw"
                  : r.match.result === "HOME" ? abbrev(r.match.home)
                  : r.match.result === "AWAY" ? abbrev(r.match.away)
                  : null;
                return (
                  <th
                    key={r.match.id}
                    className="fxcol"
                    title={`${r.match.home} v ${r.match.away}`}
                  >
                    <div className="fxh">
                      {abbrev(r.match.home)}<i>v</i>{abbrev(r.match.away)}
                    </div>
                    <div className="fxsub">
                      {r.match.voided
                        ? "P–P"
                        : winner
                          ? `✓ ${winner}`
                          : new Date(r.match.kickoff).toLocaleString("en-GB", {
                              weekday: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </th>
                );
              })}
              <th className="totcol">Week</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const total = totalById.get(p.id);
              return (
                <tr key={p.id} data-me={p.id === data.meId}>
                  <th className="stick name">{p.name}</th>
                  {rows.map((r) => {
                    const c = r.cells[i];
                    return (
                      <td key={r.match.id} data-status={c.status} title={c.label}>
                        <div className="pk">
                          {c.short}
                          {c.multiplier > 1 && <span className="mx">{MULT[c.multiplier]}</span>}
                        </div>
                        {c.amount !== null && c.status !== "void" && (
                          <div className="amt">{money(c.amount)}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="wk">
                    {total === null || total === undefined ? "—" : money(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="note">
        Club codes are the side each player took; D is a draw, — is a blank.
        Everyone&apos;s slip stays hidden until the matchweek locks. Amounts fill in
        as matches finish; the leaderboard updates once the round is done.
      </p>
    </>
  );
}
