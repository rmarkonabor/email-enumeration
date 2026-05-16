"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

type Detail = {
  profile: {
    id: string;
    api_key: string | null;
    is_admin: boolean;
    disabled: boolean;
    created_at: string | null;
    verify_provider: string | null;
  };
  activity: {
    lifetime_lookups?: number;
    lookups_24h?: number;
    lookups_7d?: number;
    lookups_30d?: number;
    last_activity?: string | null;
  };
  recent: {
    ts: string;
    method: string;
    email: string;
    status: string;
    smtp_code: number | null;
    response_ms: number | null;
  }[];
};

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); }, [userId]);

  async function load() {
    const key = localStorage.getItem("ef_api_key") || "";
    try {
      const r = await fetch(`${API_BASE}/admin/users/${userId}`, { headers: { "X-API-Key": key } });
      if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
      setData(await r.json());
    } catch (e: any) { setErr(e.message); }
  }

  if (err) return <div className="text-red-600 text-sm">Error: {err}</div>;
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;

  const { profile, activity, recent } = data;
  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">← All users</Link>
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div>
          <div className="text-xs text-slate-500">User ID</div>
          <div className="font-mono text-sm text-slate-800">{profile.id}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">Status</div>
            <div>{profile.disabled ? <span className="text-red-600">disabled</span> : <span className="text-emerald-600">active</span>}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Role</div>
            <div>{profile.is_admin ? <span className="text-amber-700">admin</span> : "user"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Created</div>
            <div>{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Provider preference</div>
            <div>{profile.verify_provider || "smtp"}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">API key (full, admin view)</div>
          <div className="font-mono text-xs text-slate-700 break-all">{profile.api_key || "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="24h" value={(activity.lookups_24h ?? 0).toLocaleString()} />
        <Stat label="7d" value={(activity.lookups_7d ?? 0).toLocaleString()} />
        <Stat label="30d" value={(activity.lookups_30d ?? 0).toLocaleString()} />
        <Stat label="Lifetime" value={(activity.lifetime_lookups ?? 0).toLocaleString()} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Recent activity ({recent.length})</h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {recent.length === 0 ? (
            <div className="text-sm text-slate-400 p-4">No activity yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Time (UTC)</th>
                  <th className="text-left px-3 py-2 font-medium">Method</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Code</th>
                  <th className="text-left px-3 py-2 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500 text-xs">{r.ts.replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-2">{r.method}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-slate-500">{r.smtp_code ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{r.response_ms ? `${r.response_ms}ms` : "—"}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}
