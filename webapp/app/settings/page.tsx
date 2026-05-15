"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = "smtp" | "zerobounce" | "reoon";

const PROVIDERS: { id: Provider; label: string; description: string; docsUrl: string }[] = [
  { id: "smtp", label: "SMTP (built-in)", description: "Free, direct SMTP verification. Requires port 25 open on your server.", docsUrl: "" },
  { id: "zerobounce", label: "ZeroBounce", description: "Paid API — ~$0.004/email. 100 free/month.", docsUrl: "https://www.zerobounce.net/members/apikeys" },
  { id: "reoon", label: "Reoon", description: "Paid API — ~$0.001/email. 100 free/month.", docsUrl: "https://emailverifier.reoon.com/dashboard" },
];

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [provider, setProvider] = useState<Provider>("smtp");
  const [zerobounceKey, setZerobounceKey] = useState("");
  const [reoonKey, setReoonKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("api_key, verify_provider, zerobounce_api_key, reoon_api_key")
      .eq("id", user.id)
      .single();
    if (!data) return;
    if (data.api_key) { setApiKey(data.api_key); localStorage.setItem("ef_api_key", data.api_key); }
    if (data.verify_provider) { setProvider(data.verify_provider as Provider); localStorage.setItem("ef_verify_provider", data.verify_provider); }
    if (data.zerobounce_api_key !== undefined) { setZerobounceKey(data.zerobounce_api_key ?? ""); localStorage.setItem("ef_zerobounce_key", data.zerobounce_api_key ?? ""); }
    if (data.reoon_api_key !== undefined) { setReoonKey(data.reoon_api_key ?? ""); localStorage.setItem("ef_reoon_key", data.reoon_api_key ?? ""); }
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
    if (!error) { setApiKey(newKey); localStorage.setItem("ef_api_key", newKey); }
    setRegenerating(false);
  }

  async function saveVerification() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("profiles")
      .update({ verify_provider: provider, zerobounce_api_key: zerobounceKey, reoon_api_key: reoonKey })
      .eq("id", user.id);
    if (!error) {
      localStorage.setItem("ef_verify_provider", provider);
      localStorage.setItem("ef_zerobounce_key", zerobounceKey);
      localStorage.setItem("ef_reoon_key", reoonKey);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-gray-500 text-sm">Your account and verification configuration.</p>
      </div>

      {/* Verification method */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-sm">Verification Method</h2>
        <div className="space-y-2">
          {PROVIDERS.map(p => (
            <label key={p.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${provider === p.id ? "border-indigo-500 bg-indigo-50/50" : "border-gray-200 hover:bg-gray-50"}`}>
              <input
                type="radio"
                name="provider"
                value={p.id}
                checked={provider === p.id}
                onChange={() => setProvider(p.id)}
                className="mt-0.5 accent-indigo-600"
              />
              <div>
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{p.description}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="space-y-3 pt-1">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">ZeroBounce API Key</label>
            <input
              type="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
              value={zerobounceKey}
              onChange={e => setZerobounceKey(e.target.value)}
              placeholder="Paste your ZeroBounce key"
            />
            <a href="https://www.zerobounce.net/members/apikeys" target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline mt-1 inline-block">
              Get your ZeroBounce API key →
            </a>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Reoon API Key</label>
            <input
              type="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
              value={reoonKey}
              onChange={e => setReoonKey(e.target.value)}
              placeholder="Paste your Reoon key"
            />
            <a href="https://emailverifier.reoon.com/dashboard" target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline mt-1 inline-block">
              Get your Reoon API key →
            </a>
          </div>
        </div>

        <button
          onClick={saveVerification}
          disabled={saving || (provider === "zerobounce" && !zerobounceKey) || (provider === "reoon" && !reoonKey)}
          className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : saved ? "Saved!" : "Save"}
        </button>
      </div>

      {/* API key */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-sm">Your API Key</h2>
        <div>
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
          <p className="text-xs text-gray-400 mt-1">Use as <code>X-API-Key</code> header for external access.</p>
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
      </div>
    </div>
  );
}
