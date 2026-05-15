export interface FindRequest {
  first_name: string;
  last_name: string;
  domain: string;
  middle_name?: string;
  return_attempts?: boolean;
}

export interface FindResponse {
  email: string | null;
  status: "verified" | "catch_all" | "not_found" | "error";
  catch_all: boolean;
  candidates_tried: number;
  attempts?: { email: string; status: string; code?: number; cached?: boolean }[];
  message: string | null;
  fallback_recommended: boolean;
}

export interface BatchResponse {
  results: FindResponse[];
}

export interface HistoryEntry {
  id: string;
  ts: number;
  request: FindRequest;
  response: FindResponse;
}

const DEFAULT_API_URL = "https://verify1.mailcheckhq.com";

function getConfig() {
  if (typeof window === "undefined") return { baseUrl: "", apiKey: "", verifyProvider: "smtp", zerobounceKey: "", reoonKey: "" };
  return {
    baseUrl: localStorage.getItem("ef_base_url") || DEFAULT_API_URL,
    apiKey: localStorage.getItem("ef_api_key") || "",
    verifyProvider: localStorage.getItem("ef_verify_provider") || "smtp",
    zerobounceKey: localStorage.getItem("ef_zerobounce_key") || "",
    reoonKey: localStorage.getItem("ef_reoon_key") || "",
  };
}

async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  const { baseUrl, apiKey } = getConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data as T;
}

export async function findEmail(req: FindRequest): Promise<FindResponse> {
  const { verifyProvider, zerobounceKey, reoonKey } = getConfig();
  return apiFetch<FindResponse>("/find", { ...req, verify_provider: verifyProvider, zerobounce_api_key: zerobounceKey, reoon_api_key: reoonKey });
}

export async function findBatch(contacts: FindRequest[]): Promise<BatchResponse> {
  const { verifyProvider, zerobounceKey, reoonKey } = getConfig();
  return apiFetch<BatchResponse>("/find/batch", { contacts, verify_provider: verifyProvider, zerobounce_api_key: zerobounceKey, reoon_api_key: reoonKey });
}

// History stored in localStorage
const HISTORY_KEY = "ef_history";

export function getHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addHistory(request: FindRequest, response: FindResponse): void {
  const entries = getHistory();
  const entry: HistoryEntry = {
    id: Math.random().toString(36).slice(2),
    ts: Date.now(),
    request,
    response,
  };
  entries.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 500)));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
