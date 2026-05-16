"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ok" | "denied">("loading");
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
      setStatus(data?.is_admin ? "ok" : "denied");
    })();
  }, []);

  if (status === "loading") {
    return <div className="text-slate-400 text-sm">Checking access…</div>;
  }
  if (status === "denied") {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 max-w-lg">
        <h1 className="text-lg font-semibold text-red-700 mb-2">Access denied</h1>
        <p className="text-sm text-slate-600">This page is for administrators only.</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline mt-3 inline-block">← Back to app</Link>
      </div>
    );
  }

  const tabs = [
    { href: "/admin", label: "System" },
    { href: "/admin/users", label: "Users" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Admin</h1>
        <p className="text-slate-400 text-sm">System health and user management.</p>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => {
          const active = pathname === t.href || (t.href !== "/admin" && pathname.startsWith(t.href));
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
