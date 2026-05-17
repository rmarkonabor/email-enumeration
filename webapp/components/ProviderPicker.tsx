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

  useEffect(() => {
    setProvider((localStorage.getItem("ef_verify_provider") as Provider) || "smtp");
    setKeys({
      ef_zerobounce_key: !!localStorage.getItem("ef_zerobounce_key"),
      ef_reoon_key: !!localStorage.getItem("ef_reoon_key"),
    });
  }, []);

  async function switchProvider(p: Provider) {
    setProvider(p);
    localStorage.setItem("ef_verify_provider", p);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ verify_provider: p }).eq("id", user.id);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 font-medium">Verify via</span>
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium bg-white">
        {OPTIONS.map(o => {
          const hasKey = o.keyStorage === null || keys[o.keyStorage];
          const isActive = provider === o.id;
          return (
            <div key={o.id} className="relative group">
              <button
                type="button"
                onClick={() => hasKey && switchProvider(o.id)}
                disabled={!hasKey}
                className={`px-3 py-1.5 transition-colors ${
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
