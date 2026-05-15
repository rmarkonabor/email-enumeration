import StatusBadge from "./StatusBadge";
import type { FindResponse, FindRequest } from "@/lib/api";

export default function ResultCard({ result, request }: { result: FindResponse; request: FindRequest }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
      <div className="flex items-center gap-3">
        <StatusBadge status={result.status} />
        {result.email && (
          <span className="font-mono font-bold text-base">{result.email}</span>
        )}
      </div>
      <div className="text-sm text-gray-500 space-y-1">
        <p><span className="font-medium text-gray-700">Contact:</span> {request.first_name} {request.last_name} · {request.domain}</p>
        <p><span className="font-medium text-gray-700">Candidates tried:</span> {result.candidates_tried}</p>
        <p><span className="font-medium text-gray-700">Catch-all domain:</span> {result.catch_all ? "Yes" : "No"}</p>
        <p><span className="font-medium text-gray-700">Fallback recommended:</span> {result.fallback_recommended ? "Yes" : "No"}</p>
        {result.message && <p className="text-gray-500 italic">{result.message}</p>}
      </div>
      {result.attempts && result.attempts.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs font-semibold text-gray-500 cursor-pointer uppercase tracking-wide">
            SMTP attempts ({result.attempts.length})
          </summary>
          <div className="mt-2 border rounded-lg overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.attempts.map((a, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-mono">{a.email}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={a.status} /></td>
                    <td className="px-3 py-1.5 text-gray-400">{a.code ?? (a.cached ? "cached" : "—")}</td>
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
