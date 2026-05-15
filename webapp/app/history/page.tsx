"use client";

import { useState, useEffect } from "react";
import { getHistory, clearHistory, type HistoryEntry } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setEntries(getHistory());
  }, []);

  function handleClear() {
    if (!confirm("Clear all history?")) return;
    clearHistory();
    setEntries([]);
  }

  function exportCSV() {
    const header = "date,first_name,last_name,domain,email,status,fallback_recommended";
    const lines = entries.map(e =>
      [
        new Date(e.ts).toISOString(),
        e.request.first_name,
        e.request.last_name,
        e.request.domain,
        e.response.email ?? "",
        e.response.status,
        e.response.fallback_recommended,
      ].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "email-finder-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">History</h1>
          <p className="text-slate-400 text-sm">All past lookups — stored locally in your browser.</p>
        </div>
        {entries.length > 0 && (
          <div className="flex gap-2">
            <button onClick={exportCSV} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Export CSV
            </button>
            <button onClick={handleClear} className="px-4 py-2 border border-red-200 text-red-500 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors">
              Clear all
            </button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-16 text-center text-slate-400 text-sm">
          No lookups yet. Run a search and it will appear here.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Email found</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {e.request.first_name} {e.request.last_name}
                    <span className="text-slate-400 ml-1">· {e.request.domain}</span>
                  </td>
                  <td className="px-4 py-3 font-mono font-medium text-slate-800">
                    {e.response.email ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.response.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
