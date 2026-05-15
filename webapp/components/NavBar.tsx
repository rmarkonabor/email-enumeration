"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NavBar() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from("profiles")
        .select("api_key, verify_provider, zerobounce_api_key, reoon_api_key")
        .eq("id", user.id)
        .single();

      if (profile?.api_key) localStorage.setItem("ef_api_key", profile.api_key);
      if (profile?.verify_provider) localStorage.setItem("ef_verify_provider", profile.verify_provider);
      if (profile?.zerobounce_api_key !== undefined) localStorage.setItem("ef_zerobounce_key", profile.zerobounce_api_key ?? "");
      if (profile?.reoon_api_key !== undefined) localStorage.setItem("ef_reoon_key", profile.reoon_api_key ?? "");
    }
    loadUser();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("ef_api_key");
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight">Email Finder</Link>
        <div className="flex items-center gap-6">
          <div className="flex gap-6 text-sm font-medium text-gray-600">
            <Link href="/" className="hover:text-gray-900">Single</Link>
            <Link href="/batch" className="hover:text-gray-900">Batch / CSV</Link>
            <Link href="/history" className="hover:text-gray-900">History</Link>
            <Link href="/settings" className="hover:text-gray-900">Settings</Link>
          </div>
          <div className="flex items-center gap-3 pl-6 border-l border-gray-200">
            {email && <span className="text-xs text-gray-400 hidden sm:block">{email}</span>}
            <button
              onClick={signOut}
              className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2.5 py-1 hover:bg-gray-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
