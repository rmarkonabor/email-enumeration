"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = "smtp" | "zerobounce" | "reoon";

const OPTIONS: { id: Provider; label: string; keyStorage: string | null }[] = [
  { id: "smtp", label: "SMTP", keyStorage: null },
  { id: "zerobounce", label: "ZeroBounce", keyStorage: "ef_zerobounce_key" },
  { id: "reoon", label: "Reoon", keyStorage: "ef_reoon_key" },
];

export default function ProviderPicker() {
  const [provider, setProvider] = useState<Provider>("smtp");
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const supabase = createClient();

  function readKeys() {
    setProvider((localStorage.getItem("ef_verify_provider") as Provider) || "smtp");
    setKeys({
      ef_zerobounce_key: !!localStorage.getItem("ef_zerobounce_key"),
      ef_reoon_key: !!localStorage.getItem("ef_reoon_key"),
    });
  }

  useEffect(() => {
    readKeys();
    // Re-read when another tab or the Settings page writes to localStorage
    window.addEventListener("storage", readKeys);
    return () => window.removeEventListener("storage", readKeys);
  }, []);

  async function switchProvider(p: Provider) {
    setProvider(p);
    localStorage.setItem("ef_verify_provider", p);
    // Notify same-tab listeners (storage event only fires cross-tab).
    window.dispatchEvent(new CustomEvent("ef-provider-changed", { detail: p }));
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ verify_provider: p }).eq("id", user.id);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 font-medium">Verify via</span>
      <div className="flex rounded-lg border border-slate-200 text-xs font-medium bg-white">
        {OPTIONS.map((o, i) => {
          const hasKey = o.keyStorage === null || keys[o.keyStorage];
          const isActive = provider === o.id;
          const isFirst = i === 0;
          const isLast = i === OPTIONS.length - 1;
          return (
            <div key={o.id} className="relative group">
              <button
                type="button"
                onClick={() => hasKey && switchProvider(o.id)}
                disabled={!hasKey}
                tabIndex={hasKey ? 0 : -1}
                className={`px-3 py-1.5 transition-colors border-l border-slate-200 first:border-l-0 ${
                  isFirst ? "rounded-l-lg" : ""
                } ${isLast ? "rounded-r-lg" : ""} ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : hasKey
                    ? "text-slate-500 hover:bg-slate-50"
                    : "text-slate-300 bg-slate-50 cursor-not-allowed"
                }`}
              >
                {o.label}
              </button>
              {!hasKey && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  Add {o.label} API key in Settings
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
