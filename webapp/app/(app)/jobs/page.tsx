"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

type JobSummary = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  total: number;
  done_count: number;
  verify_provider: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

const STATUS_BADGE: Record<JobSummary["status"], string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-800",
};

export default function JobsListPage() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      const apiKey = localStorage.getItem("ef_api_key") || "";
      try {
        const r = await fetch(`${API_BASE}/jobs`, { headers: { "X-API-Key": apiKey } });
        if (!r.ok) { if (!cancelled) setErr(`HTTP ${r.status}`); return; }
        if (cancelled) return;
        const data = await r.json();
        setJobs(data.jobs);
        setErr(null);
        if (data.jobs.some((j: JobSummary) => j.status === "queued" || j.status === "running")) {
          timer = setTimeout(load, 3000);
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load jobs");
      }
    }
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  if (err) return <div className="text-red-600 text-sm">Error: {err}</div>;
  if (!jobs) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Background jobs</h1>
        <p className="text-slate-400 text-sm">
          Batches over 25 contacts are processed in the background. Jobs survive page reloads and tab closes.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {jobs.length === 0 ? (
          <div className="text-sm text-slate-400 p-6 text-center">
            No background jobs yet. Submit a batch with more than 25 contacts to queue one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Job</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Progress</th>
                <th className="text-left px-3 py-2 font-medium">Provider</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="text-left px-3 py-2 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => {
                const pct = j.total > 0 ? Math.round((j.done_count / j.total) * 100) : 0;
                return (
                  <tr key={j.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link href={`/jobs/${j.id}`} className="text-blue-600 hover:underline font-mono text-xs">
                        {j.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[j.status]}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-32">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full ${j.status === "done" ? "bg-emerald-500" : j.status === "running" ? "bg-blue-500" : "bg-slate-300"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums w-20 text-right">
                          {j.done_count}/{j.total}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{j.verify_provider}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(j.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{j.completed_at ? new Date(j.completed_at).toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
