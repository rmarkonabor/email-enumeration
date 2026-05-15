const styles: Record<string, string> = {
  verified: "bg-green-100 text-green-800",
  catch_all: "bg-yellow-100 text-yellow-800",
  not_found: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${styles[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status.replace("_", " ")}
    </span>
  );
}
