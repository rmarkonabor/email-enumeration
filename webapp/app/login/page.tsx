"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import { useRouter } from "next/navigation";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else { router.push("/"); router.refresh(); }

    } else if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage("Account created! Check your email to confirm, then sign in.");

    } else {
      const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) setError(error.message);
      else setMessage("Check your email for a password reset link.");
    }

    setLoading(false);
  }

  const subtitle = mode === "login"
    ? "Sign in to your account"
    : mode === "signup"
    ? "Create a new account"
    : "Reset your password";

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <Logo size={72} />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Email Finder</h1>
          <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {mode !== "forgot" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Password</label>
                  {mode === "login" && (
                    <button type="button" onClick={() => switchMode("forgot")} className="text-xs text-blue-600 hover:underline">
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={6}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2"
            >
              {loading
                ? "Please wait…"
                : mode === "login"
                ? "Sign in"
                : mode === "signup"
                ? "Create account"
                : "Send reset link"}
            </button>
          </form>

          {error && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
          )}
          {message && (
            <div className="mt-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">{message}</div>
          )}

          <p className="mt-5 text-center text-sm text-slate-500">
            {mode === "forgot" ? (
              <>
                Remember it?{" "}
                <button onClick={() => switchMode("login")} className="text-blue-600 font-medium hover:underline">
                  Sign in
                </button>
              </>
            ) : mode === "login" ? (
              <>
                No account?{" "}
                <button onClick={() => switchMode("signup")} className="text-blue-600 font-medium hover:underline">
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have one?{" "}
                <button onClick={() => switchMode("login")} className="text-blue-600 font-medium hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
