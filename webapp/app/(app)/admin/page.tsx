"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

type IpStat = {
  source_ip: string;
  first_seen: string;
  last_activity: string | null;
  age_days: number;
  day_in_warmup: number;
  warmup_complete: boolean;
  cap: number;
  attempts: number;
  soft_blocks: number;
  soft_block_pct: number;
  remaining: number;
  paused: boolean;
  lifetime_attempts: number;
  lifetime_soft_blocks: number;
};

type ProviderStat = {
  source_ip: string;
  provider: string;
  attempts: number;
  soft_blocks: number;
  hard_blocks: number;
  soft_block_pct: number;
  hard_block_pct: number;
  latency_avg_ms: number;
  latency_max_ms: number;
};

type ScheduleStep = { days_upper_excl: number; cap: number };

type SystemData = {
  warmup: {
    day: string;
    attempts: number;
    soft_blocks: number;
    soft_block_pct: number;
    cap: number;
    remaining: number;
    paused: boolean;
    per_domain_cap: number;
    days_to_max: number;
    source_ip_count: number;
    per_ip: IpStat[];
    per_provider: ProviderStat[];
    schedule: ScheduleStep[];
    top_domains_today: { domain: string; attempts: number; soft_blocks: number }[];
  };
  volume_24h: { smtp: number; zerobounce: number; reoon: number; total: number };
  pool_exhausted: boolean;
};

type ServerEntry = {
  region: string;
  uptime_seconds?: number;
  uptime_human?: string;
  disk?: { total_gb: number; used_gb: number; free_gb: number; percent: number; db_size_mb: number };
  memory?: { total_mb: number; used_mb: number; available_mb: number; percent: number };
  cpu?: { load1: number; load5: number; load15: number; load1_pct: number; count: number };
  error?: string;
};

export default function AdminSystemPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  async function load() {
    const key = localStorage.getItem("ef_api_key") || "";
    try {
      const [sysRes, srvRes] = await Promise.all([
        fetch(`${API_BASE}/admin/system`, { headers: { "X-API-Key": key } }),
        fetch(`${API_BASE}/admin/server`, { headers: { "X-API-Key": key } }),
      ]);
      if (!sysRes.ok) { setErr(`HTTP ${sysRes.status}`); return; }
      setData(await sysRes.json());
      if (srvRes.ok) {
        const d = await srvRes.json();
        setServers(d.servers ?? []);
      }
      setErr(null);
    } catch (e: any) { setErr(e.message); }
  }

  if (err) return <div className="text-red-600 text-sm">Error: {err}</div>;
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;

  const { warmup, volume_24h, pool_exhausted } = data;

  return (
    <div className="space-y-6">
      {servers.length > 0 && (
        <div className="space-y-3">
          {servers.map(s => <ServerHealthCard key={s.region} s={s} />)}
        </div>
      )}
      {pool_exhausted && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          <strong>SMTP pool exhausted.</strong> All configured IPs are at cap or paused. New SMTP requests will be rejected (HTTP 503) until UTC midnight.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today's attempts" value={warmup.attempts.toLocaleString()} />
        <Stat
          label="Pool capacity"
          value={warmup.paused ? "Paused" : `${warmup.remaining.toLocaleString()} / ${warmup.cap.toLocaleString()}`}
          warn={warmup.paused}
        />
        <Stat label="Per-domain cap" value={warmup.per_domain_cap.toLocaleString()} />
        <Stat label="Soft-block rate" value={`${warmup.soft_block_pct}%`} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">IP pool ({warmup.source_ip_count})</h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">IP</th>
                <th className="text-left px-3 py-2 font-medium">Age</th>
                <th className="text-left px-3 py-2 font-medium">Cap</th>
                <th className="text-left px-3 py-2 font-medium">Today</th>
                <th className="text-left px-3 py-2 font-medium">Soft blocks</th>
                <th className="text-left px-3 py-2 font-medium">Lifetime</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {warmup.per_ip.map(ip => (
                <tr key={ip.source_ip} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-slate-700">{ip.source_ip}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {ip.age_days}d {ip.warmup_complete ? <span className="text-emerald-600">✓ warmed</span> : <span className="text-amber-600">day {ip.day_in_warmup}/{warmup.days_to_max}</span>}
                  </td>
                  <td className="px-3 py-2">{ip.cap.toLocaleString()}</td>
                  <td className="px-3 py-2">{ip.attempts} <span className="text-slate-400">({ip.remaining} left)</span></td>
                  <td className="px-3 py-2">{ip.soft_blocks} ({ip.soft_block_pct}%)</td>
                  <td className="px-3 py-2 text-slate-500">{ip.lifetime_attempts.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {ip.paused ? <span className="text-red-600">paused</span> : <span className="text-emerald-600">active</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">
          Per-provider signals today
          <span className="ml-2 text-xs font-normal text-slate-400">
            Observe-only — feeds the adaptive controller (Phase 2)
          </span>
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {warmup.per_provider.length === 0 ? (
            <div className="text-sm text-slate-400 p-4">No SMTP activity yet today</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">IP</th>
                  <th className="text-left px-3 py-2 font-medium">Provider</th>
                  <th className="text-left px-3 py-2 font-medium">Attempts</th>
                  <th className="text-left px-3 py-2 font-medium">Soft blocks</th>
                  <th className="text-left px-3 py-2 font-medium">Hard blocks</th>
                  <th className="text-left px-3 py-2 font-medium">Latency avg</th>
                  <th className="text-left px-3 py-2 font-medium">Latency max</th>
                </tr>
              </thead>
              <tbody>
                {warmup.per_provider.map(p => {
                  const softWarn = p.soft_block_pct >= 5;
                  const softCrit = p.soft_block_pct >= 10;
                  const hardAlert = p.hard_blocks > 0;
                  return (
                    <tr key={`${p.source_ip}-${p.provider}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-slate-700">{p.source_ip}</td>
                      <td className="px-3 py-2">{p.provider}</td>
                      <td className="px-3 py-2">{p.attempts.toLocaleString()}</td>
                      <td className={`px-3 py-2 ${softCrit ? "text-red-600 font-medium" : softWarn ? "text-amber-600" : ""}`}>
                        {p.soft_blocks} ({p.soft_block_pct}%)
                      </td>
                      <td className={`px-3 py-2 ${hardAlert ? "text-red-600 font-medium" : "text-slate-500"}`}>
                        {p.hard_blocks} ({p.hard_block_pct}%)
                      </td>
                      <td className="px-3 py-2 text-slate-600">{p.latency_avg_ms}ms</td>
                      <td className="px-3 py-2 text-slate-500">{p.latency_max_ms}ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">24h by provider</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">SMTP</span><span>{volume_24h.smtp}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">ZeroBounce</span><span>{volume_24h.zerobounce}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Reoon</span><span>{volume_24h.reoon}</span></div>
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Top domains today</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1 text-sm max-h-48 overflow-auto">
            {warmup.top_domains_today.length === 0 && <div className="text-slate-400">No activity yet today</div>}
            {warmup.top_domains_today.map(d => (
              <div key={d.domain} className="flex justify-between">
                <span className="font-mono text-slate-700">{d.domain}</span>
                <span className="text-slate-500">{d.attempts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {warmup.schedule.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Warmup schedule</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Days</th>
                  <th className="text-left px-3 py-2 font-medium">Daily cap / IP</th>
                </tr>
              </thead>
              <tbody>
                {warmup.schedule.map((step, i) => {
                  const from = i === 0 ? 0 : warmup.schedule[i - 1].days_upper_excl;
                  const isLast = i === warmup.schedule.length - 1;
                  const label = isLast ? `Day ${from}+` : `Day ${from}–${step.days_upper_excl - 1}`;
                  const isCurrent = warmup.per_ip.some(ip =>
                    ip.day_in_warmup >= from && (isLast || ip.day_in_warmup < step.days_upper_excl)
                  );
                  return (
                    <tr key={i} className={`border-t border-slate-100 ${isCurrent ? "bg-blue-50" : ""}`}>
                      <td className="px-3 py-2 text-slate-600">
                        {label}
                        {isCurrent && <span className="ml-2 text-xs text-blue-600">← current</span>}
                      </td>
                      <td className="px-3 py-2 font-medium">{step.cap.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function UsageBar({ pct, warn = 70, crit = 85 }: { pct: number; warn?: number; crit?: number }) {
  const color = pct >= crit ? "bg-red-500" : pct >= warn ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function ServerHealthCard({ s }: { s: ServerEntry }) {
  const label = s.region.toUpperCase();

  if (s.error || !s.disk || !s.memory || !s.cpu) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
          <span className="text-xs text-red-600">unreachable</span>
        </div>
        <div className="text-sm text-red-500">{s.error ?? "No data"}</div>
      </div>
    );
  }

  const diskWarn = s.disk.percent >= 85;
  const memWarn = s.memory.percent >= 85;
  const cpuWarn = s.cpu.load1_pct >= 80;

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900 mb-2">
        Server health — <span className="text-indigo-600">{label}</span>
        <span className="ml-2 text-xs font-normal text-slate-400">refreshes every 15s</span>
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Uptime</div>
          <div className="text-lg font-semibold text-slate-900 mt-0.5">{s.uptime_human}</div>
        </div>
        <div className={`bg-white border rounded-xl p-4 ${diskWarn ? "border-red-300" : "border-slate-200"}`}>
          <div className="text-xs text-slate-500">Disk ({s.disk.percent}%)</div>
          <div className={`text-lg font-semibold mt-0.5 ${diskWarn ? "text-red-600" : "text-slate-900"}`}>
            {s.disk.free_gb} GB free
          </div>
          <UsageBar pct={s.disk.percent} />
          <div className="text-xs text-slate-400 mt-1">{s.disk.used_gb} / {s.disk.total_gb} GB · DB {s.disk.db_size_mb} MB</div>
        </div>
        <div className={`bg-white border rounded-xl p-4 ${memWarn ? "border-red-300" : "border-slate-200"}`}>
          <div className="text-xs text-slate-500">Memory ({s.memory.percent}%)</div>
          <div className={`text-lg font-semibold mt-0.5 ${memWarn ? "text-red-600" : "text-slate-900"}`}>
            {s.memory.available_mb.toLocaleString()} MB free
          </div>
          <UsageBar pct={s.memory.percent} />
          <div className="text-xs text-slate-400 mt-1">{s.memory.used_mb.toLocaleString()} / {s.memory.total_mb.toLocaleString()} MB used</div>
        </div>
        <div className={`bg-white border rounded-xl p-4 ${cpuWarn ? "border-amber-300" : "border-slate-200"}`}>
          <div className="text-xs text-slate-500">CPU load ({s.cpu.count} cores)</div>
          <div className={`text-lg font-semibold mt-0.5 ${cpuWarn ? "text-amber-600" : "text-slate-900"}`}>
            {s.cpu.load1_pct}%
          </div>
          <UsageBar pct={s.cpu.load1_pct} warn={70} crit={80} />
          <div className="text-xs text-slate-400 mt-1">{s.cpu.load1} / {s.cpu.load5} / {s.cpu.load15} (1/5/15m)</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-4 ${warn ? "border-amber-300" : "border-slate-200"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${warn ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
