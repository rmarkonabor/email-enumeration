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
    top_domains_today: { domain: string; attempts: number; soft_blocks: number }[];
  };
  volume_24h: { smtp: number; zerobounce: number; reoon: number; total: number };
  pool_exhausted: boolean;
};

export default function AdminSystemPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  async function load() {
    const key = localStorage.getItem("ef_api_key") || "";
    try {
      const r = await fetch(`${API_BASE}/admin/system`, { headers: { "X-API-Key": key } });
      if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
      setData(await r.json());
      setErr(null);
    } catch (e: any) { setErr(e.message); }
  }

  if (err) return <div className="text-red-600 text-sm">Error: {err}</div>;
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;

  const { warmup, volume_24h, pool_exhausted } = data;

  return (
    <div className="space-y-6">
      {pool_exhausted && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          <strong>SMTP pool exhausted.</strong> All configured IPs are at cap or paused. New SMTP requests will be rejected (HTTP 503) until UTC midnight.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today's attempts" value={warmup.attempts.toLocaleString()} />
        <Stat label="Pool capacity" value={`${warmup.remaining.toLocaleString()} / ${warmup.cap.toLocaleString()}`} />
        <Stat label="Soft-block rate" value={`${warmup.soft_block_pct}%`} />
        <Stat label="24h volume" value={volume_24h.total.toLocaleString()} />
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}
