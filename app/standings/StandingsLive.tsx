"use client";
import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export interface Row {
  playerId: string;
  name: string;
  quarterTotal: number;
  seasonTotal: number;
  matchweeksWon: number;
}

export interface Progress {
  matchweek: number;
  finished: number;
  total: number;
  settled: boolean;
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

  const refresh = useCallback(async () => {
    const res = await fetch("/api/standings", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setRows(data.rows);
    setProgress(data.progress);
    setPulse(true);
    setTimeout(() => setPulse(false), 1200);
  }, []);

  useEffect(() => {
    const db = supabaseBrowser();
    let poll: ReturnType<typeof setInterval> | undefined;

    const channel = db
      .channel("standings")
      .on("postgres_changes", { event: "*", schema: "public", table: "matchweek_results" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" }, refresh)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          poll ??= setInterval(refresh, 60_000);
        }
      });

    return () => { db.removeChannel(channel); if (poll) clearInterval(poll); };
  }, [refresh]);

  const sorted = [...rows].sort((a, b) => b[scope] - a[scope]);

  return (
    <>
      <div className="ticker">
        <span className="dot" data-pulse={pulse} />
        {progress
          ? progress.settled
            ? `Matchweek ${progress.matchweek} settled · updates live`
            : `Matchweek ${progress.matchweek} in progress · ${progress.finished} of ${progress.total} played · the table moves when the round finishes`
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
            <th /><th>Player</th><th>Q{quarter}</th><th>Season</th><th>Weeks won</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.playerId} data-me={r.playerId === meId}>
              <td>{i + 1}</td>
              <td>{r.name}</td>
              <td className={scope === "quarterTotal" ? "sorted" : "unsorted"}>{money(r.quarterTotal)}</td>
              <td className={scope === "seasonTotal" ? "sorted" : "unsorted"}>{money(r.seasonTotal)}</td>
              <td className="unsorted">{r.matchweeksWon}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {sorted.length === 0 && (
        <p className="note">Nothing settled yet. The table fills in after the first matchweek finishes.</p>
      )}
    </>
  );
}
