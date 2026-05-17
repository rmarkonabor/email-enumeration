"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

type ActiveBatch = { done: number; total: number; startedAt: number };

export default function NavBar() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeBatch, setActiveBatch] = useState<ActiveBatch | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    const tick = () => {
      const raw = localStorage.getItem("ef_active_batch");
      if (!raw) { setActiveBatch(null); return; }
      try {
        const parsed = JSON.parse(raw) as ActiveBatch;
        if (parsed.done >= parsed.total) {
          localStorage.removeItem("ef_active_batch");
          setActiveBatch(null);
        } else {
          setActiveBatch(parsed);
        }
      } catch { setActiveBatch(null); }
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from("profiles")
        .select("api_key, verify_provider, zerobounce_api_key, reoon_api_key, is_admin")
        .eq("id", user.id)
        .single();

      if (profile?.api_key) localStorage.setItem("ef_api_key", profile.api_key);
      if (profile?.verify_provider) localStorage.setItem("ef_verify_provider", profile.verify_provider);
      if (profile?.zerobounce_api_key !== undefined) localStorage.setItem("ef_zerobounce_key", profile.zerobounce_api_key ?? "");
      if (profile?.reoon_api_key !== undefined) localStorage.setItem("ef_reoon_key", profile.reoon_api_key ?? "");
      setIsAdmin(!!profile?.is_admin);
    }
    loadUser();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("ef_api_key");
    router.push("/login");
    router.refresh();
  }

  const navLinks = [
    { href: "/", label: "Single" },
    { href: "/batch", label: "Batch" },
    { href: "/jobs", label: "Jobs" },
    { href: "/history", label: "History" },
    { href: "/settings", label: "Settings" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="bg-slate-900 border-b border-slate-800">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="text-white font-bold text-sm tracking-tight">Email Finder</span>
          </Link>
          <div className="flex items-center gap-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {activeBatch && (
            <Link
              href="/history"
              title="A batch is running. Click to view completed results."
              className="flex items-center gap-2 text-xs font-medium text-amber-200 bg-amber-900/40 border border-amber-700/60 hover:bg-amber-900/60 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
              </span>
              Batch running: {activeBatch.done}/{activeBatch.total}
            </Link>
          )}
          {email && (
            <>
              <span className="text-xs text-slate-500 hidden sm:block">{email}</span>
              <button
                onClick={signOut}
                className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-md px-3 py-1.5 transition-colors"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
