"use client";

import { useEffect, useState, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

type Range = "today" | "7d" | "30d" | "90d" | "all";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d",    label: "7 days" },
  { id: "30d",   label: "30 days" },
  { id: "90d",   label: "90 days" },
  { id: "all",   label: "All time" },
];

type DailyRow = {
  date: string;
  total: number;
  verified: number;
  enumerations: number;
  credits: number;
};

type Stats = {
  total: number;
  verified: number;
  catch_all: number;
  not_found: number;
  total_enumerations: number;
  total_credits: number;
  avg_enumerations_per_verified: number;
  daily: DailyRow[];
};

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function fmt(n: number) {
  return n.toLocaleString();
}

function MetricCard({
  label, value, sub, color,
}: { label: string; value: string | number; sub?: string; color?: string }) {
  const display = typeof value === "number" && !Number.isInteger(value)
    ? value.toFixed(2)
    : fmt(Number(value));
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="text-xs text-slate-500 font-medium mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color ?? "text-slate-900"}`}>{display}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BarChart({ daily, range }: { daily: DailyRow[]; range: Range }) {
  if (!daily || daily.length === 0) return null;
  if (range === "today" && daily.length < 2) return null;

  const maxTotal = Math.max(...daily.map(d => d.total), 1);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900">Daily volume</h2>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-200 inline-block" /> Total
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Verified
          </span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-32">
        {daily.map(d => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="w-full flex flex-col justify-end h-28 gap-0.5">
              <div
                className="w-full bg-blue-100 rounded-t relative"
                style={{ height: `${(d.total / maxTotal) * 100}%` }}
              >
                <div
                  className="absolute bottom-0 left-0 right-0 bg-emerald-500 rounded-t"
                  style={{ height: `${d.total ? (d.verified / d.total) * 100 : 0}%` }}
                />
              </div>
            </div>
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              <div className="font-medium">{d.date}</div>
              <div>Total: {d.total}</div>
              <div>Verified: {d.verified}</div>
              {d.enumerations > 0 && <div>Enumerations: {d.enumerations}</div>}
              {d.credits > 0 && <div>Credits: {d.credits}</div>}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
            </div>
          </div>
        ))}
      </div>
      {/* X-axis labels — show first, middle, last only */}
      {daily.length > 0 && (
        <div className="flex justify-between text-xs text-slate-400 mt-1 px-0.5">
          <span>{daily[0].date.slice(5)}</span>
          {daily.length > 2 && <span>{daily[Math.floor(daily.length / 2)].date.slice(5)}</span>}
          <span>{daily[daily.length - 1].date.slice(5)}</span>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    setErr(null);
    const apiKey = localStorage.getItem("ef_api_key") || "";
    try {
      const res = await fetch(`${API_BASE}/stats?range=${r}`, {
        headers: { "X-API-Key": apiKey },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      setStats(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Your verification activity and enumeration stats.</p>
        </div>
        {/* Range selector */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium bg-white">
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 transition-colors ${
                range === r.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">{err}</div>
      )}

      {loading && !stats && (
        <div className="text-slate-400 text-sm">Loading…</div>
      )}

      {stats && (
        <>
          {/* Metric cards */}
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 transition-opacity ${loading ? "opacity-50" : ""}`}>
            <MetricCard
              label="Total requests"
              value={stats.total}
            />
            <MetricCard
              label="Verified"
              value={stats.verified}
              sub={pct(stats.verified, stats.total)}
              color="text-emerald-600"
            />
            <MetricCard
              label="Catch-all"
              value={stats.catch_all}
              sub={pct(stats.catch_all, stats.total)}
              color="text-amber-600"
            />
            <MetricCard
              label="Not found"
              value={stats.not_found}
              sub={pct(stats.not_found, stats.total)}
              color="text-slate-600"
            />
            <MetricCard
              label="Total enumerations"
              value={stats.total_enumerations}
              sub="email formats tried"
            />
            <MetricCard
              label="Avg enumerations / verified"
              value={stats.avg_enumerations_per_verified}
              sub="formats tried per hit"
            />
            <MetricCard
              label="Credits used"
              value={stats.total_credits}
              sub="ZeroBounce / Reoon"
              color={stats.total_credits > 0 ? "text-blue-600" : "text-slate-400"}
            />
          </div>

          {/* Status breakdown bar */}
          {stats.total > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Status breakdown</h2>
              <div className="flex h-3 rounded-full overflow-hidden gap-px">
                {stats.verified  > 0 && <div className="bg-emerald-500" style={{ flex: stats.verified }} title={`Verified: ${stats.verified}`} />}
                {stats.catch_all > 0 && <div className="bg-amber-400"  style={{ flex: stats.catch_all }} title={`Catch-all: ${stats.catch_all}`} />}
                {stats.not_found > 0 && <div className="bg-slate-300"  style={{ flex: stats.not_found }} title={`Not found: ${stats.not_found}`} />}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 text-xs text-slate-500">
                <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />Verified {pct(stats.verified, stats.total)}</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1" />Catch-all {pct(stats.catch_all, stats.total)}</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-300 mr-1" />Not found {pct(stats.not_found, stats.total)}</span>
              </div>
            </div>
          )}

          <BarChart daily={stats.daily ?? []} range={range} />
        </>
      )}
    </div>
  );
}
