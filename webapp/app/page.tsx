"use client";

import { useState, useRef } from "react";
import { addHistory, type FindRequest, type FindResponse } from "@/lib/api";
import ResultCard from "@/components/ResultCard";
import ProviderPicker from "@/components/ProviderPicker";

type ProgressEvent =
  | { type: "status"; message: string }
  | { type: "catch_all"; catch_all: boolean; cached: boolean }
  | { type: "candidates"; count: number }
  | { type: "trying"; email: string }
  | { type: "attempt"; email: string; status: string; code?: number; cached?: boolean }
  | { type: "done" } & FindResponse
  | { type: "error"; message: string };

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

export default function SinglePage() {
  const [form, setForm] = useState<FindRequest>({
    first_name: "",
    last_name: "",
    domain: "",
    middle_name: "",
    return_attempts: false,
  });
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<FindResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (esRef.current) esRef.current.close();

    setLoading(true);
    setResult(null);
    setError(null);
    setEvents([]);

    const { baseUrl, apiKey, verifyProvider, zerobounceKey, reoonKey } = getConfig();
    const params = new URLSearchParams({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      domain: form.domain.trim(),
      api_key: apiKey,
      verify_provider: verifyProvider,
      zerobounce_api_key: zerobounceKey,
      reoon_api_key: reoonKey,
    });
    if (form.middle_name?.trim()) params.set("middle_name", form.middle_name.trim());

    const es = new EventSource(`${baseUrl}/find/stream?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const event: ProgressEvent = JSON.parse(e.data);
      setEvents(prev => [...prev, event]);
      if (event.type === "done") {
        const res: FindResponse = {
          email: event.email,
          status: event.status,
          catch_all: event.catch_all,
          candidates_tried: event.candidates_tried,
          attempts: event.attempts,
          message: event.message,
          fallback_recommended: event.fallback_recommended,
        };
        setResult(res);
        const req: FindRequest = {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          domain: form.domain.trim(),
          return_attempts: true,
        };
        if (form.middle_name?.trim()) req.middle_name = form.middle_name.trim();
        addHistory(req, res);
        es.close();
        setLoading(false);
      } else if (event.type === "error") {
        setError(event.message);
        es.close();
        setLoading(false);
      }
    };

    es.onerror = () => {
      setError("Connection failed. Check your API Base URL and API Key in Settings.");
      es.close();
      setLoading(false);
    };
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-900">Single lookup</h1>
        <ProviderPicker />
      </div>
      <p className="text-slate-400 text-sm mb-6">Find a verified email for one contact.</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
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
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Searching…" : "Find email"}
        </button>
      </form>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {(loading || events.length > 0) && !result && (
        <div className="mt-4 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Live progress</p>
          <div className="space-y-1.5 text-sm font-mono">
            {events.map((ev, i) => <ProgressRow key={i} event={ev} />)}
            {loading && (
              <div className="flex items-center gap-2 text-slate-400">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span>Working…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4">
          <ResultCard result={result} request={form} />
        </div>
      )}
    </div>
  );
}

function ProgressRow({ event }: { event: ProgressEvent }) {
  if (event.type === "status") {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <span>⟳</span>
        <span>{event.message}</span>
      </div>
    );
  }
  if (event.type === "catch_all") {
    return (
      <div className="flex items-center gap-2">
        <span>{event.catch_all ? "✗" : "✓"}</span>
        <span className={event.catch_all ? "text-amber-600" : "text-emerald-600"}>
          Catch-all: {event.catch_all ? "yes (domain accepts all)" : "no"}
          {event.cached ? " (cached)" : ""}
        </span>
      </div>
    );
  }
  if (event.type === "candidates") {
    return (
      <div className="text-slate-400">
        → {event.count} candidates to try
      </div>
    );
  }
  if (event.type === "trying") {
    return (
      <div className="text-slate-300">
        ↳ {event.email}
      </div>
    );
  }
  if (event.type === "attempt") {
    const icon = event.status === "verified" ? "✓" : "✗";
    const cls = event.status === "verified" ? "text-emerald-600 font-semibold" : "text-red-400";
    return (
      <div className={`flex items-center gap-2 ${cls}`}>
        <span>{icon}</span>
        <span>{event.email}</span>
        <span className="text-xs opacity-70">
          {event.cached ? "cached" : event.code ? `SMTP ${event.code}` : event.status}
        </span>
      </div>
    );
  }
  return null;
}

const inputCls = "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}
