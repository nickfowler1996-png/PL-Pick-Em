"use client";
import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { groupTotals } from "@/lib/scoring";

export interface Row {
  playerId: string;
  name: string;
  quarterTotal: number;
  seasonTotal: number;
  matchweeksWon: number;
  /** This week's running total, or null if the round hasn't started scoring. */
  weekTotal: number | null;
}

export interface Progress {
  matchweek: number;
  finished: number;
  total: number;
  settled: boolean;
  locked: boolean;
}

const money = (n: number) => {
  const s = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `−$${s}` : `$${s}`;
};

/**
 * Live standings.
 *
 * Subscribes to matchweek_results, so the table updates the instant the
 * settlement job writes — no refresh. Falls back to a 60s poll if the realtime
 * socket can't connect (corporate wifi, locked-down networks).
 */
export default function StandingsLive({
  initialRows, initialProgress, quarter, meId,
}: {
  initialRows: Row[]; initialProgress: Progress | null; quarter: number; meId: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [progress, setProgress] = useState(initialProgress);
  const [scope, setScope] = useState<"quarterTotal" | "seasonTotal">("seasonTotal");
  const [pulse, setPulse] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [provisional, setProvisional] = useState(false);
  const [liveMw, setLiveMw] = useState<number | null>(null);

  const refresh = useCallback(async (isInitial = false) => {
    try {
      const res = await fetch("/api/standings", { cache: "no-store" });
      if (!res.ok) { setFailed(true); setLoaded(true); return; }
      const data = await res.json();
      setRows(data.rows ?? []);
      setProgress(data.progress ?? null);
      setProvisional(Boolean(data.provisional));
      setLiveMw(data.liveMatchweek ?? null);
      setFailed(false);
      setLoaded(true);
      if (!isInitial) {
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
      }
    } catch {
      setFailed(true);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Load once on mount. The subscription below only reports *changes*, so
    // without this the table stays empty for a round that settled earlier.
    refresh(true);

    const db = supabaseBrowser();
    let poll: ReturnType<typeof setInterval> | undefined;

    // Results are written every 30 minutes during a round; poll as a backstop
    // so the table moves even where websockets are blocked.
    const tick = setInterval(() => refresh(), 60_000);

    const channel = db
      .channel("standings")
      .on("postgres_changes", { event: "*", schema: "public", table: "matchweek_results" }, () => refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" }, () => refresh())
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          poll ??= setInterval(() => refresh(), 60_000);
        }
      });

    return () => {
      clearInterval(tick);
      db.removeChannel(channel);
      if (poll) clearInterval(poll);
    };
  }, [refresh]);

  const sorted = [...rows].sort((a, b) => b[scope] - a[scope]);
  const group = groupTotals(rows);

  return (
    <>
      <div className="ticker">
        <span className="dot" data-pulse={pulse} />
        {progress
          ? progress.settled
            ? `Matchweek ${progress.matchweek} settled · updates live`
            : `Matchweek ${progress.matchweek} · ${progress.finished} of ${progress.total} played · totals update as matches finish`
          : "Updates live"}
      </div>

      <nav className="tabs">
        <button className="tab" data-on={scope === "quarterTotal"} onClick={() => setScope("quarterTotal")}>
          Quarter {quarter}
        </button>
        <button className="tab" data-on={scope === "seasonTotal"} onClick={() => setScope("seasonTotal")}>
          Full season
        </button>
      </nav>

      <table className="lb">
        <thead>
          <tr>
            <th /><th>Player</th>
            {provisional && <th>MW{liveMw}</th>}
            <th>Q{quarter}</th><th>Season</th><th>Weeks won</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.playerId} data-me={r.playerId === meId}>
              <td>{i + 1}</td>
              <td>{r.name}</td>
              {provisional && (
                <td className="live">
                  {r.weekTotal === null ? "—" : money(r.weekTotal)}
                </td>
              )}
              <td className={scope === "quarterTotal" ? "sorted" : "unsorted"}>{money(r.quarterTotal)}</td>
              <td className={scope === "seasonTotal" ? "sorted" : "unsorted"}>{money(r.seasonTotal)}</td>
              <td className="unsorted">{r.matchweeksWon}</td>
            </tr>
          ))}
        </tbody>

        {sorted.length > 0 && (
          <tfoot>
            <tr>
              <td />
              <td className="grpname">Group</td>
              {provisional && (
                <td className={`grp ${(group.week ?? 0) < 0 ? "down" : "up"}`}>
                  {group.week === null ? "—" : money(group.week)}
                </td>
              )}
              <td className={`grp ${group.quarter < 0 ? "down" : "up"}`}>
                {money(group.quarter)}
              </td>
              <td className={`grp ${group.season < 0 ? "down" : "up"}`}>
                {money(group.season)}
              </td>
              <td className="grp unsorted">{group.players}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {!loaded && <p className="note">Loading standings…</p>}

      {loaded && failed && (
        <div className="ticker" data-error="true">
          Couldn&apos;t load the standings. Refresh, or sign in again if that doesn&apos;t help.
        </div>
      )}

      {sorted.length > 0 && (
        <p className="note">
          The group is {group.season < 0 ? "down" : "up"}{" "}
          <strong className={group.season < 0 ? "down" : "up"}>
            {money(Math.abs(group.season))}
          </strong>{" "}
          on the season, {money(group.averageSeason)} a head across{" "}
          {group.players} player{group.players === 1 ? "" : "s"}. Since a pick at
          fair odds is worth nothing in the long run, a positive number means
          the group has collectively beaten the prices it was offered.
        </p>
      )}

      {provisional && (
        <p className="note">
          Matchweek {liveMw} is still being played, so quarter and season totals
          include a running score for it. They firm up when the round settles.
        </p>
      )}

      {loaded && !failed && sorted.length === 0 && (
        <p className="note">
          Nothing settled yet. The table fills in once the first matchweek finishes.
        </p>
      )}
    </>
  );
}
