"use client";

import { useState, useEffect } from "react";
import { getHistoryRuns, clearHistory, type HistoryRun } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

const PROVIDER_LABEL: Record<string, string> = {
  smtp: "SMTP",
  zerobounce: "ZeroBounce",
  reoon: "Reoon",
};

function exportRunCSV(run: HistoryRun) {
  const header = "date,first_name,last_name,domain,email,status,fallback_recommended,verified_via";
  const lines = run.entries.map(e => [
    new Date(e.ts).toISOString(),
    e.request.first_name,
    e.request.last_name,
    e.request.domain,
    e.response.email ?? "",
    e.response.status,
    e.response.fallback_recommended,
    e.provider ?? "smtp",
  ].join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `email-finder-${run.type}-${new Date(run.ts).toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function RunCard({ run }: { run: HistoryRun }) {
  const [expanded, setExpanded] = useState(true);
  const verified = run.entries.filter(e => e.response.status === "verified").length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Group header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-slate-400 hover:text-slate-600 transition-colors text-xs font-mono"
          >
            {expanded ? "▾" : "▸"}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">
              {run.type === "batch"
                ? `Batch run — ${run.entries.length} contact${run.entries.length !== 1 ? "s" : ""}`
                : "Single lookup"}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-medium">
              {PROVIDER_LABEL[run.provider] ?? run.provider}
            </span>
            {run.type === "batch" && (
              <span className="text-xs text-slate-400">{verified} verified</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{new Date(run.ts).toLocaleString()}</span>
          <button
            onClick={() => exportRunCSV(run)}
            className="text-xs px-3 py-1 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-100 transition-colors font-medium"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Entries */}
      {expanded && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
              <th className="text-left px-5 py-2">Contact</th>
              <th className="text-left px-5 py-2">Email found</th>
              <th className="text-left px-5 py-2">Status</th>
              <th className="text-left px-5 py-2">Fallback?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {run.entries.map(e => (
              <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-2.5 text-slate-700">
                  {e.request.first_name} {e.request.last_name}
                  <span className="text-slate-400 ml-1 text-xs">· {e.request.domain}</span>
                </td>
                <td className="px-5 py-2.5 font-mono font-medium text-slate-800 text-xs">
                  {e.response.email ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="px-5 py-2.5">
                  <StatusBadge status={e.response.status} />
                </td>
                <td className="px-5 py-2.5 text-slate-500 text-xs">
                  {e.response.fallback_recommended ? "Yes" : "No"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<HistoryRun[]>([]);

  useEffect(() => {
    setRuns(getHistoryRuns());
  }, []);

  function handleClear() {
    if (!confirm("Clear all history?")) return;
    clearHistory();
    setRuns([]);
  }

  const totalRuns = runs.length;
  const totalEntries = runs.reduce((sum, r) => sum + r.entries.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">History</h1>
          <p className="text-slate-400 text-sm">
            {totalRuns > 0
              ? `${totalRuns} run${totalRuns !== 1 ? "s" : ""} · ${totalEntries} lookup${totalEntries !== 1 ? "s" : ""} — stored locally in your browser`
              : "All past lookups — stored locally in your browser."}
          </p>
        </div>
        {runs.length > 0 && (
          <button
            onClick={handleClear}
            className="px-4 py-2 border border-red-200 text-red-500 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-16 text-center text-slate-400 text-sm">
          No lookups yet. Run a search and it will appear here.
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map(run => (
            <RunCard key={run.runId} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
