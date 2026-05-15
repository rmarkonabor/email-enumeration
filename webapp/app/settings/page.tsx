"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [urlSaved, setUrlSaved] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const supabase = createClient();

  useEffect(() => {
    setBaseUrl(
      localStorage.getItem("ef_base_url") ||
      process.env.NEXT_PUBLIC_API_URL ||
      ""
    );
    loadApiKey();
  }, []);

  async function loadApiKey() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("api_key")
      .eq("id", user.id)
      .single();
    if (data?.api_key) {
      setApiKey(data.api_key);
      localStorage.setItem("ef_api_key", data.api_key);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function regenerate() {
    if (!confirm("Regenerate your API key? Your current key will stop working immediately.")) return;
    setRegenerating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const newKey = "ef_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("profiles").update({ api_key: newKey }).eq("id", user.id);
    if (!error) {
      setApiKey(newKey);
      localStorage.setItem("ef_api_key", newKey);
    }
    setRegenerating(false);
  }

  function saveBaseUrl() {
    localStorage.setItem("ef_base_url", baseUrl.trim().replace(/\/$/, ""));
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2000);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const url = (baseUrl.trim().replace(/\/$/, "") || localStorage.getItem("ef_base_url") || "");
    try {
      const res = await fetch(`${url}/health`);
      setTestResult(res.ok
        ? { ok: true, message: "Connected successfully." }
        : { ok: false, message: `Server returned HTTP ${res.status}` });
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-gray-500 text-sm mb-6">Your account and API configuration.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Your API Key</label>
          <div className="flex gap-2">
            <input
              readOnly
              type="password"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 outline-none"
              value={apiKey}
              placeholder="Loading…"
            />
            <button
              onClick={copy}
              disabled={!apiKey}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Use this as the <code>X-API-Key</code> header for external access.</p>
        </div>

        <div>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {regenerating ? "Regenerating…" : "Regenerate key"}
          </button>
          <p className="text-xs text-gray-400 mt-1">Invalidates your current key immediately.</p>
        </div>

        <div className="pt-4 border-t border-gray-100 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">API Server URL</label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://verify1.mailcheckhq.com"
              />
              <button
                onClick={saveBaseUrl}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                {urlSaved ? "Saved!" : "Save"}
              </button>
            </div>
          </div>
          <button
            onClick={testConnection}
            disabled={testing}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {testResult && (
            <div className={`px-4 py-3 rounded-lg text-sm ${testResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {testResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
