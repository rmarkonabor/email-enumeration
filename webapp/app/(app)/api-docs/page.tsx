"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const API_BASE = "https://verify1.mailcheckhq.com";

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative group">
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 text-xs px-2 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

function Endpoint({ method, path, description }: { method: string; path: string; description: string }) {
  const colors: Record<string, string> = {
    GET: "bg-emerald-50 text-emerald-700 border-emerald-200",
    POST: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${colors[method] || "bg-slate-100"}`}>
        {method}
      </span>
      <code className="font-mono text-sm font-semibold text-slate-800">{path}</code>
      <span className="text-xs text-slate-400">— {description}</span>
    </div>
  );
}

export default function ApiDocsPage() {
  const [apiKey, setApiKey] = useState("");
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("api_key").eq("id", user.id).single();
      if (data?.api_key) setApiKey(data.api_key);
    })();
  }, []);

  const displayKey = apiKey || "YOUR_API_KEY";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">API Documentation</h1>
          <p className="text-slate-400 text-sm">Use the Email Finder API directly from your code, automations, or workflows.</p>
        </div>
        <Link
          href="/settings"
          className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
        >
          ← Settings
        </Link>
      </div>

      {/* Quick nav */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">On this page</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <a href="#auth" className="text-blue-600 hover:underline">Authentication</a>
          <span className="text-slate-300">·</span>
          <a href="#providers" className="text-blue-600 hover:underline">Providers</a>
          <span className="text-slate-300">·</span>
          <a href="#find" className="text-blue-600 hover:underline">POST /find</a>
          <span className="text-slate-300">·</span>
          <a href="#batch" className="text-blue-600 hover:underline">POST /find/batch</a>
          <span className="text-slate-300">·</span>
          <a href="#stream" className="text-blue-600 hover:underline">GET /find/stream</a>
          <span className="text-slate-300">·</span>
          <a href="#health" className="text-blue-600 hover:underline">GET /health</a>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-8">
        <Section id="base" title="Base URL">
          <CodeBlock>{API_BASE}</CodeBlock>
        </Section>

        <Section id="auth" title="Authentication">
          <p>All endpoints (except <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">/health</code>) require your API key. Pass it as the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">X-API-Key</code> header, or as the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">api_key</code> query parameter for SSE.</p>
          <p>You can find and regenerate your key on the <Link href="/settings" className="text-blue-600 hover:underline font-medium">Settings page</Link>.</p>
        </Section>

        <Section id="providers" title="Verification providers">
          <p>Every request to <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">/find</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">/find/batch</code>, and <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">/find/stream</code> accepts a <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">verify_provider</code> field.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Value</th>
                  <th className="text-left px-3 py-2 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-3 py-2 font-mono text-xs">smtp</td>
                  <td className="px-3 py-2 text-slate-600">Free SMTP RCPT-TO check (default). Cannot verify catch-all domains.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono text-xs">zerobounce</td>
                  <td className="px-3 py-2 text-slate-600">ZeroBounce API. Pass key in <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">zerobounce_api_key</code>. Handles catch-all.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono text-xs">reoon</td>
                  <td className="px-3 py-2 text-slate-600">Reoon API (power mode). Pass key in <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">reoon_api_key</code>. Handles catch-all.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="find" title="Find a single email">
          <Endpoint method="POST" path="/find" description="returns the verified email when found" />

          <p className="font-semibold text-slate-700 mt-4">Request body</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Field</th>
                  <th className="text-left px-3 py-2 font-semibold">Type</th>
                  <th className="text-left px-3 py-2 font-semibold">Default</th>
                  <th className="text-left px-3 py-2 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                <tr><td className="px-3 py-2 font-mono">first_name</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-red-500">required</td><td className="px-3 py-2 text-slate-600"></td></tr>
                <tr><td className="px-3 py-2 font-mono">last_name</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-red-500">required</td><td className="px-3 py-2 text-slate-600"></td></tr>
                <tr><td className="px-3 py-2 font-mono">domain</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-red-500">required</td><td className="px-3 py-2 text-slate-600">e.g. notion.so</td></tr>
                <tr><td className="px-3 py-2 font-mono">middle_name</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-slate-400">""</td><td className="px-3 py-2 text-slate-600">Optional, adds extra permutations</td></tr>
                <tr><td className="px-3 py-2 font-mono">verify_provider</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-slate-400">smtp</td><td className="px-3 py-2 text-slate-600">smtp | zerobounce | reoon</td></tr>
                <tr><td className="px-3 py-2 font-mono">zerobounce_api_key</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-slate-400">""</td><td className="px-3 py-2 text-slate-600">Required when provider is zerobounce</td></tr>
                <tr><td className="px-3 py-2 font-mono">reoon_api_key</td><td className="px-3 py-2">string</td><td className="px-3 py-2 text-slate-400">""</td><td className="px-3 py-2 text-slate-600">Required when provider is reoon</td></tr>
                <tr><td className="px-3 py-2 font-mono">return_attempts</td><td className="px-3 py-2">bool</td><td className="px-3 py-2 text-slate-400">false</td><td className="px-3 py-2 text-slate-600">Include every candidate tried</td></tr>
              </tbody>
            </table>
          </div>

          <p className="font-semibold text-slate-700 mt-4">SMTP (default)</p>
          <CodeBlock>{`curl -X POST ${API_BASE}/find \\
  -H "X-API-Key: ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "first_name": "Jamie",
    "last_name": "Lee",
    "domain": "notion.so"
  }'`}</CodeBlock>

          <p className="font-semibold text-slate-700 mt-4">ZeroBounce</p>
          <CodeBlock>{`curl -X POST ${API_BASE}/find \\
  -H "X-API-Key: ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "first_name": "Jamie",
    "last_name": "Lee",
    "domain": "notion.so",
    "verify_provider": "zerobounce",
    "zerobounce_api_key": "YOUR_ZEROBOUNCE_KEY"
  }'`}</CodeBlock>

          <p className="font-semibold text-slate-700 mt-4">Reoon</p>
          <CodeBlock>{`curl -X POST ${API_BASE}/find \\
  -H "X-API-Key: ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "first_name": "Jamie",
    "last_name": "Lee",
    "domain": "notion.so",
    "verify_provider": "reoon",
    "reoon_api_key": "YOUR_REOON_KEY"
  }'`}</CodeBlock>

          <p className="font-semibold text-slate-700 mt-4">Response</p>
          <CodeBlock>{`{
  "email": "jamie.lee@notion.so",
  "status": "verified",
  "catch_all": false,
  "candidates_tried": 1,
  "fallback_recommended": false,
  "message": null
}`}</CodeBlock>

          <p>Possible <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">status</code> values: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">verified</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">catch_all</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">not_found</code>, <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">error</code>.</p>
        </Section>

        <Section id="batch" title="Find multiple emails in one call">
          <Endpoint method="POST" path="/find/batch" description="up to 50 contacts, concurrency capped at 5" />

          <p>Same body shape as <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">/find</code>, with contacts wrapped in an array. Provider settings apply to all contacts in the batch.</p>

          <CodeBlock>{`curl -X POST ${API_BASE}/find/batch \\
  -H "X-API-Key: ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contacts": [
      {"first_name": "Jamie", "last_name": "Lee", "domain": "notion.so"},
      {"first_name": "Sarah", "last_name": "Chen", "domain": "stripe.com"}
    ],
    "verify_provider": "zerobounce",
    "zerobounce_api_key": "YOUR_ZEROBOUNCE_KEY"
  }'`}</CodeBlock>

          <p className="font-semibold text-slate-700 mt-4">Response</p>
          <CodeBlock>{`{
  "results": [
    { "email": "jamie.lee@notion.so", "status": "verified", ... },
    { "email": "sarah.chen@stripe.com", "status": "verified", ... }
  ]
}`}</CodeBlock>
        </Section>

        <Section id="stream" title="Stream live progress (SSE)">
          <Endpoint method="GET" path="/find/stream" description="single contact, server-sent events" />

          <p>Same single-contact lookup as <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-xs">/find</code>, but delivers progress events as they happen. Parameters go in the query string. Useful when building UIs with live feedback.</p>

          <CodeBlock>{`curl -N "${API_BASE}/find/stream?\\
first_name=Jamie&last_name=Lee&domain=notion.so&\\
api_key=${displayKey}&\\
verify_provider=zerobounce&\\
zerobounce_api_key=YOUR_ZEROBOUNCE_KEY"`}</CodeBlock>

          <p className="font-semibold text-slate-700 mt-4">Event types</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">type</th>
                  <th className="text-left px-3 py-2 font-semibold">Fields</th>
                  <th className="text-left px-3 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                <tr><td className="px-3 py-2 font-mono">status</td><td className="px-3 py-2 font-mono">message</td><td className="px-3 py-2 text-slate-600">General progress text</td></tr>
                <tr><td className="px-3 py-2 font-mono">catch_all</td><td className="px-3 py-2 font-mono">catch_all, cached</td><td className="px-3 py-2 text-slate-600">After catch-all probe</td></tr>
                <tr><td className="px-3 py-2 font-mono">candidates</td><td className="px-3 py-2 font-mono">count</td><td className="px-3 py-2 text-slate-600">Number of permutations to try</td></tr>
                <tr><td className="px-3 py-2 font-mono">trying</td><td className="px-3 py-2 font-mono">email</td><td className="px-3 py-2 text-slate-600">About to attempt a candidate</td></tr>
                <tr><td className="px-3 py-2 font-mono">attempt</td><td className="px-3 py-2 font-mono">email, status, code?, cached?</td><td className="px-3 py-2 text-slate-600">Result of each attempt</td></tr>
                <tr><td className="px-3 py-2 font-mono">done</td><td className="px-3 py-2 font-mono">email, status, catch_all, …</td><td className="px-3 py-2 text-slate-600">Terminal — final result</td></tr>
                <tr><td className="px-3 py-2 font-mono">error</td><td className="px-3 py-2 font-mono">message</td><td className="px-3 py-2 text-slate-600">Terminal — something failed</td></tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="health" title="Health check">
          <Endpoint method="GET" path="/health" description="no auth required" />
          <CodeBlock>{`curl ${API_BASE}/health
# {"status": "ok"}`}</CodeBlock>
        </Section>
      </div>
    </div>
  );
}
