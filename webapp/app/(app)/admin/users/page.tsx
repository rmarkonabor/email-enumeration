"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

type AdminUser = {
  id: string;
  email: string;
  api_key_preview: string;
  is_admin: boolean;
  disabled: boolean;
  created_at: string | null;
  lifetime_lookups: number;
  lookups_24h: number;
  lookups_7d: number;
  lookups_30d: number;
  last_activity: string | null;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const key = localStorage.getItem("ef_api_key") || "";
    try {
      const r = await fetch(`${API_BASE}/admin/users`, { headers: { "X-API-Key": key } });
      if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
      const data = await r.json();
      setUsers(data.users);
      setErr(null);
    } catch (e: any) { setErr(e.message); }
  }

  async function toggleDisabled(u: AdminUser) {
    if (!confirm(`${u.disabled ? "Re-enable" : "Disable"} user ${u.email || u.id.slice(0,8)}…?`)) return;
    setBusyId(u.id);
    const key = localStorage.getItem("ef_api_key") || "";
    const r = await fetch(`${API_BASE}/admin/users/${u.id}/disable`, {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !u.disabled }),
    });
    if (!r.ok) {
      const body = await r.text();
      alert(`Failed: ${body}`);
    }
    setBusyId(null);
    load();
  }

  async function regenerate(u: AdminUser) {
    if (!confirm(`Regenerate API key for ${u.id.slice(0,8)}…? The old key stops working immediately.`)) return;
    setBusyId(u.id);
    const key = localStorage.getItem("ef_api_key") || "";
    const r = await fetch(`${API_BASE}/admin/users/${u.id}/regenerate-key`, {
      method: "POST",
      headers: { "X-API-Key": key },
    });
    if (r.ok) {
      const data = await r.json();
      alert(`New API key for ${u.id.slice(0,8)}:\n\n${data.api_key}\n\n(Stored — admin only sees this once)`);
    }
    setBusyId(null);
    load();
  }

  async function deleteUser(u: AdminUser) {
    if (!confirm(`DELETE user ${u.id}?\n\nThis purges their profile, verification logs, and auth record. Irreversible.`)) return;
    if (!confirm("Are you absolutely sure? Type-confirm by clicking OK.")) return;
    setBusyId(u.id);
    const key = localStorage.getItem("ef_api_key") || "";
    const r = await fetch(`${API_BASE}/admin/users/${u.id}`, {
      method: "DELETE",
      headers: { "X-API-Key": key },
    });
    if (!r.ok) {
      const body = await r.text();
      alert(`Failed: ${body}`);
    }
    setBusyId(null);
    load();
  }

  if (err) return <div className="text-red-600 text-sm">Error: {err}</div>;
  if (!users) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="text-left px-3 py-2 font-medium">User</th>
            <th className="text-left px-3 py-2 font-medium">Email</th>
            <th className="text-left px-3 py-2 font-medium">API key</th>
            <th className="text-left px-3 py-2 font-medium">24h</th>
            <th className="text-left px-3 py-2 font-medium">7d</th>
            <th className="text-left px-3 py-2 font-medium">30d</th>
            <th className="text-left px-3 py-2 font-medium">Lifetime</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No users yet</td></tr>
          )}
          {users.map(u => (
            <tr key={u.id} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <Link href={`/admin/users/${u.id}`} className="text-blue-600 hover:underline font-mono text-xs">
                  {u.id.slice(0,8)}…
                </Link>
                {u.is_admin && <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">admin</span>}
              </td>
              <td className="px-3 py-2 text-xs text-slate-700">{u.email || <span className="text-slate-400">—</span>}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{u.api_key_preview}</td>
              <td className="px-3 py-2">{u.lookups_24h}</td>
              <td className="px-3 py-2">{u.lookups_7d}</td>
              <td className="px-3 py-2">{u.lookups_30d}</td>
              <td className="px-3 py-2">{u.lifetime_lookups.toLocaleString()}</td>
              <td className="px-3 py-2">
                {u.disabled
                  ? <span className="text-red-600">disabled</span>
                  : <span className="text-emerald-600">active</span>}
              </td>
              <td className="px-3 py-2 text-right space-x-1">
                <button
                  onClick={() => toggleDisabled(u)}
                  disabled={busyId === u.id}
                  className="text-xs px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  {u.disabled ? "Enable" : "Disable"}
                </button>
                <button
                  onClick={() => regenerate(u)}
                  disabled={busyId === u.id}
                  className="text-xs px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  Rotate key
                </button>
                <button
                  onClick={() => deleteUser(u)}
                  disabled={busyId === u.id || u.is_admin}
                  className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-30"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
