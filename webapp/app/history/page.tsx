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
          <h1 className="text-2xl font-bold mb-1">History</h1>
          <p className="text-gray-500 text-sm">All past lookups — stored locally in your browser.</p>
        </div>
        {entries.length > 0 && (
          <div className="flex gap-2">
            <button onClick={exportCSV} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Export CSV
            </button>
            <button onClick={handleClear} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors">
              Clear all
            </button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          No lookups yet. Run a search and it will appear here.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Email found</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap text-xs">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">
                    {e.request.first_name} {e.request.last_name}
                    <span className="text-gray-400 ml-1">· {e.request.domain}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono font-medium">
                    {e.response.email ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
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
