const styles: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  catch_all: "bg-amber-50 text-amber-700 border border-amber-200",
  not_found: "bg-red-50 text-red-600 border border-red-200",
  error: "bg-red-50 text-red-600 border border-red-200",
  throttled: "bg-orange-50 text-orange-600 border border-orange-200",
  skipped: "bg-slate-100 text-slate-500 border border-slate-200",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide ${styles[status] ?? "bg-slate-100 text-slate-600 border border-slate-200"}`}>
      {status.replace("_", " ")}
    </span>
  );
}
