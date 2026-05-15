"use client";

import { useState, useEffect } from "react";

export default function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    setBaseUrl(localStorage.getItem("ef_base_url") || "http://localhost:8000");
    setApiKey(localStorage.getItem("ef_api_key") || "");
  }, []);

  function save() {
    localStorage.setItem("ef_base_url", baseUrl.trim().replace(/\/$/, ""));
    localStorage.setItem("ef_api_key", apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${baseUrl.trim().replace(/\/$/, "")}/health`);
      if (res.ok) {
        setTestResult({ ok: true, message: "Connected successfully." });
      } else {
        setTestResult({ ok: false, message: `Server returned HTTP ${res.status}` });
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-gray-500 text-sm mb-6">Saved locally in your browser.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">API Base URL</label>
          <input
            className={inputCls}
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://5.78.84.39"
          />
          <p className="text-xs text-gray-400 mt-1">The URL of your Email Finder server.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">API Key</label>
          <input
            type="password"
            className={inputCls}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="your X-API-Key"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={save}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            {saved ? "Saved!" : "Save"}
          </button>
          <button
            onClick={testConnection}
            disabled={testing}
            className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>

        {testResult && (
          <div className={`px-4 py-3 rounded-lg text-sm ${testResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {testResult.message}
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors";
