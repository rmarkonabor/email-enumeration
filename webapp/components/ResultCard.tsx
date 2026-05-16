import StatusBadge from "./StatusBadge";
import type { FindResponse, FindRequest } from "@/lib/api";

export default function ResultCard({ result, request }: { result: FindResponse; request: FindRequest }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge status={result.status} />
        {result.email && (
          <span className="font-mono font-bold text-base text-slate-900">{result.email}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Contact</span>
          <p className="text-slate-700 mt-0.5">{request.first_name} {request.last_name} · {request.domain}</p>
        </div>
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Mail provider</span>
          <p className="text-slate-700 mt-0.5">{result.mail_provider ?? "—"}</p>
        </div>
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Catch-all domain</span>
          <p className="text-slate-700 mt-0.5">{result.catch_all ? "Yes" : "No"}</p>
        </div>
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Candidates tried</span>
          <p className="text-slate-700 mt-0.5">{result.candidates_tried}</p>
        </div>
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Fallback needed</span>
          <p className="text-slate-700 mt-0.5">{result.fallback_recommended ? "Yes" : "No"}</p>
        </div>
        {result.credits_used !== undefined && result.credits_used > 0 && (
          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">API credits used</span>
            <p className="text-slate-700 mt-0.5">{result.credits_used}</p>
          </div>
        )}
      </div>

      {result.message && (
        <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">{result.message}</p>
      )}

      {result.attempts && result.attempts.length > 0 && (
        <details className="border-t border-slate-100 pt-3">
          <summary className="text-xs font-semibold text-slate-400 cursor-pointer uppercase tracking-wide hover:text-slate-600 transition-colors">
            Attempts ({result.attempts.length})
          </summary>
          <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.attempts.map((a, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono text-slate-700">{a.email}</td>
                    <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                    <td className="px-3 py-2 text-slate-400">{a.code ?? (a.cached ? "cached" : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
