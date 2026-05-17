"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { addHistory, generateRunId } from "@/lib/api";

const HISTORY_SYNCED_KEY = "ef_job_history_synced";

function alreadySynced(jobId: string): boolean {
  try {
    const raw = localStorage.getItem(HISTORY_SYNCED_KEY);
    if (!raw) return false;
    const set = JSON.parse(raw) as string[];
    return set.includes(jobId);
  } catch { return false; }
}

function markSynced(jobId: string): void {
  try {
    const raw = localStorage.getItem(HISTORY_SYNCED_KEY);
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(jobId)) {
      set.push(jobId);
      // Cap at 500 to avoid unbounded growth
      localStorage.setItem(HISTORY_SYNCED_KEY, JSON.stringify(set.slice(-500)));
    }
  } catch { /* ignore */ }
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

type JobResult = {
  request: { first_name: string; last_name: string; domain: string; middle_name?: string };
  email: string | null;
  status: string;
  catch_all: boolean;
  candidates_tried: number;
  mail_provider: string | null;
  credits_used: number;
  error?: string;
  reason?: string;
};

function summariseThrottles(results: JobResult[]): { count: number; perDomain: { domain: string; count: number }[]; otherReasons: { reason: string; count: number }[] } {
  const perDomain: Record<string, number> = {};
  const otherReasons: Record<string, number> = {};
  let count = 0;
  for (const r of results) {
    if (r.status !== "throttled" || !r.reason) continue;
    count++;
    if (r.reason.startsWith("smtp_per_domain_cap_reached:")) {
      const d = r.reason.split(":", 2)[1] || r.request.domain;
      perDomain[d] = (perDomain[d] || 0) + 1;
    } else if (r.reason.startsWith("smtp_per_domain_soft_block:")) {
      const d = r.reason.split(":", 2)[1] || r.request.domain;
      perDomain[d] = (perDomain[d] || 0) + 1;
    } else {
      otherReasons[r.reason] = (otherReasons[r.reason] || 0) + 1;
    }
  }
  return {
    count,
    perDomain: Object.entries(perDomain).map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count),
    otherReasons: Object.entries(otherReasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

type Job = {
  id: string;
  user_id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  total: number;
  done_count: number;
  results: JobResult[];
  verify_provider: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  cancel_requested: boolean;
  queue_position?: number;
};

const STATUS_BADGE: Record<Job["status"], string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-800",
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const reloadRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      if (timer) { clearTimeout(timer); timer = null; }
      const apiKey = localStorage.getItem("ef_api_key") || "";
      try {
        const r = await fetch(`${API_BASE}/jobs/${jobId}`, { headers: { "X-API-Key": apiKey } });
        if (!r.ok) {
          if (cancelled) return;
          setErr(`HTTP ${r.status}`);
          return;
        }
        if (cancelled) return;
        const data = (await r.json()) as Job;
        setJob(data);
        setErr(null);
        if (data.status === "queued" || data.status === "running") {
          timer = setTimeout(load, 1500);
        } else if (
          (data.status === "done" || data.status === "cancelled" || data.status === "failed")
          && data.results.length > 0
          && !alreadySynced(data.id)
        ) {
          // Fold completed job results into local history so they show up in
          // /history alongside synchronously-run batches.
          const runId = generateRunId();
          for (const r of data.results) {
            addHistory(
              {
                first_name: r.request.first_name,
                last_name: r.request.last_name,
                domain: r.request.domain,
                middle_name: r.request.middle_name ?? "",
              },
              {
                email: r.email,
                status: (["verified", "catch_all", "not_found", "error"].includes(r.status)
                          ? r.status
                          : "error") as "verified" | "catch_all" | "not_found" | "error",
                catch_all: r.catch_all,
                candidates_tried: r.candidates_tried,
                mail_provider: r.mail_provider,
                credits_used: r.credits_used,
                fallback_recommended: r.status === "catch_all" || r.status === "not_found" || r.status === "throttled",
                message: r.error ?? null,
              },
              runId,
              "batch",
              data.verify_provider,
            );
          }
          markSynced(data.id);
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load job");
      }
    }
    reloadRef.current = load;
    load();
    return () => {
      cancelled = true;
      reloadRef.current = null;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  async function handleCancel() {
    if (!confirm("Cancel this job? Already-processed contacts are kept.")) return;
    setCancelling(true);
    const apiKey = localStorage.getItem("ef_api_key") || "";
    await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
    });
    // Immediately re-fetch so the UI reflects cancel_requested without
    // waiting for the next scheduled poll.
    reloadRef.current?.();
    setCancelling(false);
  }

  const pct = useMemo(() => {
    if (!job || job.total === 0) return 0;
    return Math.round((job.done_count / job.total) * 100);
  }, [job]);

  function exportCSV() {
    if (!job) return;
    const header = "first_name,last_name,domain,email,status,mail_provider,catch_all,credits_used";
    const lines = job.results.map(r =>
      [
        r.request.first_name,
        r.request.last_name,
        r.request.domain,
        r.email ?? "",
        r.status,
        r.mail_provider ?? "",
        r.catch_all ? "true" : "false",
        r.credits_used,
      ].map(v => `${v}`.replaceAll(",", " ")).join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `batch-${jobId.slice(0, 8)}.csv`;
    a.click();
  }

  if (err) {
    return (
      <div className="text-red-600 text-sm">
        Error: {err}
        <div className="mt-2"><Link href="/jobs" className="text-blue-600 hover:underline">← All jobs</Link></div>
      </div>
    );
  }
  if (!job) return <div className="text-slate-400 text-sm">Loading…</div>;

  const isActive = job.status === "queued" || job.status === "running";

  return (
    <div className="space-y-5">
      <Link href="/jobs" className="text-sm text-blue-600 hover:underline">← All jobs</Link>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Job ID</div>
            <div className="font-mono text-sm text-slate-800">{job.id}</div>
          </div>
          <span className={`text-xs font-medium px-2 py-1 rounded ${STATUS_BADGE[job.status]}`}>
            {job.status}
            {job.status === "queued" && job.queue_position !== undefined && (
              <span className="ml-1 text-slate-500">(position {job.queue_position})</span>
            )}
          </span>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{job.done_count.toLocaleString()} / {job.total.toLocaleString()} done</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all ${isActive ? "bg-blue-500" : job.status === "done" ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">Provider</div>
            <div>{job.verify_provider}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Created</div>
            <div>{new Date(job.created_at).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Started</div>
            <div>{job.started_at ? new Date(job.started_at).toLocaleString() : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Completed</div>
            <div>{job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"}</div>
          </div>
        </div>

        {job.error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
            {job.error}
          </div>
        )}

        <div className="flex gap-2">
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelling || job.cancel_requested}
              className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
            >
              {job.cancel_requested ? "Cancelling…" : "Cancel job"}
            </button>
          )}
          {job.results.length > 0 && (
            <button
              onClick={exportCSV}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded hover:bg-slate-50"
            >
              Export CSV ({job.results.length})
            </button>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Results ({job.results.length})</h2>
        {(() => {
          const t = summariseThrottles(job.results);
          if (t.count === 0) return null;
          return (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              <div className="font-medium mb-1">{t.count} contact{t.count === 1 ? "" : "s"} throttled</div>
              {t.perDomain.length > 0 && (
                <div>
                  Per-domain cap reached on:{" "}
                  {t.perDomain.slice(0, 5).map((d, i) => (
                    <span key={d.domain} className="font-mono">
                      {i > 0 && ", "}{d.domain} ({d.count})
                    </span>
                  ))}
                  {t.perDomain.length > 5 && <span> +{t.perDomain.length - 5} more</span>}
                  <span className="block mt-0.5 text-amber-700">These will retry after the daily counters reset at 00:00 UTC.</span>
                </div>
              )}
              {t.otherReasons.length > 0 && (
                <div className="mt-1">
                  Other: {t.otherReasons.map(r => `${r.reason} (${r.count})`).join(", ")}
                </div>
              )}
            </div>
          );
        })()}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {job.results.length === 0 ? (
            <div className="text-sm text-slate-400 p-4">No results yet — refreshing…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Domain</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Provider</th>
                </tr>
              </thead>
              <tbody>
                {job.results.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.request.first_name} {r.request.last_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.request.domain}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.email ?? "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                      {r.reason && (
                        <div className="mt-0.5 text-xs text-slate-400 font-mono" title={r.reason}>
                          {r.reason.length > 40 ? r.reason.slice(0, 40) + "…" : r.reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.mail_provider ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
