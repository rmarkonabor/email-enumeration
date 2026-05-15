"use client";

import { useState } from "react";
import { findEmail, addHistory, type FindRequest, type FindResponse } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import ResultCard from "@/components/ResultCard";

export default function SinglePage() {
  const [form, setForm] = useState<FindRequest>({
    first_name: "",
    last_name: "",
    domain: "",
    middle_name: "",
    return_attempts: false,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FindResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const req: FindRequest = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        domain: form.domain.trim(),
        return_attempts: form.return_attempts,
      };
      if (form.middle_name?.trim()) req.middle_name = form.middle_name.trim();
      const res = await findEmail(req);
      setResult(res);
      addHistory(req, res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-1">Single lookup</h1>
      <p className="text-gray-500 text-sm mb-6">Find a verified email for one contact.</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name">
            <input
              required
              className={inputCls}
              placeholder="Jamie"
              value={form.first_name}
              onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
            />
          </Field>
          <Field label="Last name">
            <input
              required
              className={inputCls}
              placeholder="Lee"
              value={form.last_name}
              onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Domain">
            <input
              required
              className={inputCls}
              placeholder="notion.so"
              value={form.domain}
              onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
            />
          </Field>
          <Field label="Middle name (optional)">
            <input
              className={inputCls}
              value={form.middle_name}
              onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={form.return_attempts}
            onChange={e => setForm(f => ({ ...f, return_attempts: e.target.checked }))}
          />
          Show all SMTP attempts (debug)
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Searching…" : "Find email"}
        </button>
      </form>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {result && (
        <div className="mt-4">
          <ResultCard result={result} request={form} />
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}
