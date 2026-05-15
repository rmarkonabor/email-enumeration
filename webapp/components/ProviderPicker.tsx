"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = "smtp" | "zerobounce" | "reoon";

const OPTIONS: { id: Provider; label: string }[] = [
  { id: "smtp", label: "SMTP" },
  { id: "zerobounce", label: "ZeroBounce" },
  { id: "reoon", label: "Reoon" },
];

export default function ProviderPicker() {
  const [provider, setProvider] = useState<Provider>("smtp");
  const supabase = createClient();

  useEffect(() => {
    setProvider((localStorage.getItem("ef_verify_provider") as Provider) || "smtp");
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
        {OPTIONS.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => switchProvider(o.id)}
            className={`px-3 py-1.5 transition-colors ${
              provider === o.id
                ? "bg-blue-600 text-white"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
