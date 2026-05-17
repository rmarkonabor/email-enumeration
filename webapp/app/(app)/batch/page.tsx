"use client";

import { useState, useRef } from "react";
import { addHistory, generateRunId, type FindRequest, type FindResponse } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import ProviderPicker from "@/components/ProviderPicker";

interface Row extends FindRequest {
  _id: number;
}

interface ResultRow {
  request: FindRequest;
  response: FindResponse;
  state: "pending" | "running" | "done";
}

let rowCounter = 0;
function newRow(): Row {
  return { _id: ++rowCounter, first_name: "", last_name: "", domain: "", middle_name: "" };
}

function getConfig(): { baseUrl: string; apiKey: string; verifyProvider: string; zerobounceKey: string; reoonKey: string } {
  if (typeof window === "undefined") return { baseUrl: "", apiKey: "", verifyProvider: "smtp", zerobounceKey: "", reoonKey: "" };
  return {
    baseUrl: localStorage.getItem("ef_base_url") || "https://verify1.mailcheckhq.com",
    apiKey: localStorage.getItem("ef_api_key") || "",
    verifyProvider: localStorage.getItem("ef_verify_provider") || "smtp",
    zerobounceKey: localStorage.getItem("ef_zerobounce_key") || "",
    reoonKey: localStorage.getItem("ef_reoon_key") || "",
  };
}

const inputCls = "w-full border border-slate-200 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all";

function fmtSeconds(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export default function BatchPage() {
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [eta, setEta] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);

  function updateRow(id: number, field: keyof FindRequest, value: string) {
    setRows(rs => rs.map(r => r._id === id ? { ...r, [field]: value } : r));
  }
  function addRow() { setRows(rs => [...rs, newRow()]); }
  function removeRow(id: number) { setRows(rs => rs.filter(r => r._id !== id)); }

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
      if (!parsed.length) { setError("No valid rows found. CSV must have: first_name, last_name, domain"); return; }
      setRows(parsed.slice(0, 50));
      setError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  async function handleRun() {
    const valid = rows.filter(r => r.first_name.trim() && r.last_name.trim() && r.domain.trim());
    if (!valid.length) { setError("Add at least one complete row."); return; }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: valid.length });
    setEta(null);
    startTimeRef.current = Date.now();
    const batchRunId = generateRunId();

    const contacts: FindRequest[] = valid.map(({ _id, ...rest }) => ({
      ...rest,
      first_name: rest.first_name.trim(),
      last_name: rest.last_name.trim(),
      domain: rest.domain.trim(),
    }));

    const initialResults: ResultRow[] = contacts.map(req => ({
      request: req,
      response: {} as FindResponse,
      state: "pending",
    }));
    setResults(initialResults);
    localStorage.setItem("ef_active_batch", JSON.stringify({
      done: 0, total: valid.length, startedAt: startTimeRef.current,
    }));

    const { baseUrl, apiKey, verifyProvider, zerobounceKey, reoonKey } = getConfig();

    try {
      const res = await fetch(`${baseUrl}/find/batch/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ contacts, verify_provider: verifyProvider, zerobounce_api_key: zerobounceKey, reoon_api_key: reoonKey }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === "contact_start") {
            setResults(prev => prev.map((r, i) => i === event.index ? { ...r, state: "running" } : r));
          } else if (event.type === "contact_done") {
            const response: FindResponse = {
              email: event.email,
              status: event.status,
              catch_all: event.catch_all,
              candidates_tried: event.candidates_tried,
              message: event.message,
              fallback_recommended: event.fallback_recommended,
              mail_provider: event.mail_provider ?? null,
              credits_used: event.credits_used ?? 0,
            };
            setResults(prev => {
              const updated = prev.map((r, i) =>
                i === event.index ? { ...r, response, state: "done" as const } : r
              );
              return updated;
            });
            addHistory(contacts[event.index], response, batchRunId, "batch", verifyProvider);

            setProgress(p => {
              const done = p.done + 1;
              const elapsed = (Date.now() - startTimeRef.current) / 1000;
              const avgPerContact = elapsed / done;
              const remaining = (p.total - done) * avgPerContact;
              setEta(done < p.total ? fmtSeconds(remaining) : null);
              localStorage.setItem("ef_active_batch", JSON.stringify({
                done, total: p.total, startedAt: startTimeRef.current,
              }));
              return { ...p, done };
            });
          } else if (event.type === "done") {
            setLoading(false);
            setEta(null);
            localStorage.removeItem("ef_active_batch");
          }
        }
      }
    } catch (e: unknown) {
      localStorage.removeItem("ef_active_batch");
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Request failed");
      setLoading(false);
    }
  }

  function exportCSV() {
    const done = results.filter(r => r.state === "done");
    const header = "first_name,last_name,domain,email,status,mail_provider,credits_used,fallback_recommended";
    const lines = done.map(({ request: q, response: r }) =>
      [q.first_name, q.last_name, q.domain, r.email ?? "", r.status, r.mail_provider ?? "", r.credits_used ?? 0, r.fallback_recommended].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "email-finder-results.csv";
    a.click();
  }

  const validCount = rows.filter(r => r.first_name && r.last_name && r.domain).length;
  const doneResults = results.filter(r => r.state === "done");
  const totalCredits = doneResults.reduce((sum, r) => sum + (r.response.credits_used ?? 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-900">Batch / CSV lookup</h1>
        <ProviderPicker />
      </div>
      <p className="text-slate-400 text-sm mb-6">Upload a CSV or add rows manually. Max 50 contacts per run.</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => fileRef.current?.click()} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Upload CSV
          </button>
          <span className="text-xs text-slate-400">Columns: first_name, last_name, domain (middle_name optional)</span>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
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
                        className={inputCls}
                        value={row[f] ?? ""}
                        onChange={e => updateRow(row._id, f, e.target.value)}
                        placeholder={f === "first_name" ? "Jamie" : f === "last_name" ? "Lee" : f === "domain" ? "notion.so" : ""}
                      />
                    </td>
                  ))}
                  <td className="py-1">
                    <button onClick={() => removeRow(row._id)} className="text-slate-300 hover:text-red-400 px-2 text-lg leading-none transition-colors">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={addRow} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            + Add row
          </button>
          {loading ? (
            <button onClick={handleStop} className="px-6 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors">
              Stop
            </button>
          ) : (
            <button onClick={handleRun} disabled={!validCount} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Run {validCount} contact{validCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h2 className="font-semibold text-slate-900">
                Results{" "}
                <span className="text-slate-400 font-normal text-sm">
                  ({progress.done}/{progress.total})
                </span>
              </h2>
              {loading && eta && (
                <span className="text-xs text-slate-400">~{eta} remaining</span>
              )}
              {totalCredits > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-medium">
                  {totalCredits} API credit{totalCredits !== 1 ? "s" : ""} used
                </span>
              )}
            </div>
            {doneResults.length > 0 && (
              <button onClick={exportCSV} className="px-4 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                Export CSV
              </button>
            )}
          </div>

          {loading && (
            <div className="mb-4">
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{progress.done} of {progress.total} complete</p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="text-left pb-2 pr-4">Contact</th>
                  <th className="text-left pb-2 pr-4">Email found</th>
                  <th className="text-left pb-2 pr-4">Status</th>
                  <th className="text-left pb-2 pr-4">Provider</th>
                  <th className="text-left pb-2 pr-4">Credits</th>
                  <th className="text-left pb-2">Fallback?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {results.map(({ request: q, response: r, state }, i) => (
                  <tr key={i} className={state === "running" ? "bg-blue-50/40" : ""}>
                    <td className="py-2.5 pr-4 text-slate-700">
                      {q.first_name} {q.last_name}
                      <span className="text-slate-400"> · {q.domain}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono font-medium text-slate-800">
                      {state === "pending" && <span className="text-slate-300">—</span>}
                      {state === "running" && (
                        <span className="inline-flex items-center gap-1.5 text-blue-500">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
                          verifying…
                        </span>
                      )}
                      {state === "done" && (r.email ?? <span className="text-slate-300">—</span>)}
                    </td>
                    <td className="py-2.5 pr-4">
                      {state === "done" ? <StatusBadge status={r.status} /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs">
                      {state === "done" ? (r.mail_provider ?? "—") : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs">
                      {state === "done" ? (r.credits_used ?? 0) : "—"}
                    </td>
                    <td className="py-2.5 text-slate-500">
                      {state === "done" ? (r.fallback_recommended ? "Yes" : "No") : "—"}
                    </td>
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
