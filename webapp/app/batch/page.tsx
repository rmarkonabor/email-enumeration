"use client";

import { useState, useRef } from "react";
import { findBatch, addHistory, type FindRequest, type FindResponse } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

interface Row extends FindRequest {
  _id: number;
}

interface ResultRow {
  request: FindRequest;
  response: FindResponse;
}

let rowCounter = 0;

function newRow(): Row {
  return { _id: ++rowCounter, first_name: "", last_name: "", domain: "", middle_name: "" };
}

export default function BatchPage() {
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function updateRow(id: number, field: keyof FindRequest, value: string) {
    setRows(rs => rs.map(r => r._id === id ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(rs => [...rs, newRow()]);
  }

  function removeRow(id: number) {
    setRows(rs => rs.filter(r => r._id !== id));
  }

  function parseCSV(text: string): Row[] {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return lines.slice(1).map(line => {
      const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      return {
        _id: ++rowCounter,
        first_name: obj.first_name || obj.firstname || obj.first || "",
        last_name: obj.last_name || obj.lastname || obj.last || "",
        domain: obj.domain || obj.company_domain || "",
        middle_name: obj.middle_name || obj.middle || "",
      };
    }).filter(r => r.first_name && r.last_name && r.domain);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCSV(ev.target?.result as string);
      if (parsed.length === 0) {
        setError("No valid rows found. CSV must have columns: first_name, last_name, domain");
        return;
      }
      setRows(parsed.slice(0, 50));
      setError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleRun() {
    const valid = rows.filter(r => r.first_name.trim() && r.last_name.trim() && r.domain.trim());
    if (!valid.length) { setError("Add at least one complete row."); return; }
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const contacts: FindRequest[] = valid.map(({ _id, ...rest }) => ({
        ...rest,
        first_name: rest.first_name.trim(),
        last_name: rest.last_name.trim(),
        domain: rest.domain.trim(),
      }));
      const res = await findBatch(contacts);
      const paired: ResultRow[] = contacts.map((req, i) => ({ request: req, response: res.results[i] }));
      setResults(paired);
      paired.forEach(({ request, response }) => addHistory(request, response));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    const header = "first_name,last_name,domain,email,status,fallback_recommended";
    const lines = results.map(({ request: q, response: r }) =>
      [q.first_name, q.last_name, q.domain, r.email ?? "", r.status, r.fallback_recommended].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "email-finder-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Batch / CSV lookup</h1>
      <p className="text-gray-500 text-sm mb-6">Upload a CSV or add rows manually. Max 50 contacts per run.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Upload CSV
          </button>
          <span className="text-xs text-gray-400">Columns: first_name, last_name, domain (middle_name optional)</span>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="text-left pb-2 pr-2">First name</th>
                <th className="text-left pb-2 pr-2">Last name</th>
                <th className="text-left pb-2 pr-2">Domain</th>
                <th className="text-left pb-2 pr-2">Middle (opt)</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => (
                <tr key={row._id}>
                  {(["first_name", "last_name", "domain", "middle_name"] as const).map(f => (
                    <td key={f} className="py-1 pr-2">
                      <input
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                        value={row[f] ?? ""}
                        onChange={e => updateRow(row._id, f, e.target.value)}
                        placeholder={f === "first_name" ? "Jamie" : f === "last_name" ? "Lee" : f === "domain" ? "notion.so" : ""}
                      />
                    </td>
                  ))}
                  <td className="py-1">
                    <button onClick={() => removeRow(row._id)} className="text-gray-300 hover:text-red-400 px-2 text-lg leading-none">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={addRow} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
            + Add row
          </button>
          <button
            onClick={handleRun}
            disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Running…" : `Run ${rows.filter(r => r.first_name && r.last_name && r.domain).length} contacts`}
          </button>
        </div>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Results <span className="text-gray-400 font-normal text-sm">({results.length})</span></h2>
            <button onClick={exportCSV} className="px-4 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left pb-2 pr-4">Contact</th>
                  <th className="text-left pb-2 pr-4">Email found</th>
                  <th className="text-left pb-2 pr-4">Status</th>
                  <th className="text-left pb-2">Fallback?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {results.map(({ request: q, response: r }, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 text-gray-700">{q.first_name} {q.last_name} · <span className="text-gray-400">{q.domain}</span></td>
                    <td className="py-2 pr-4 font-mono font-medium">{r.email ?? <span className="text-gray-300">—</span>}</td>
                    <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                    <td className="py-2 text-gray-500">{r.fallback_recommended ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
