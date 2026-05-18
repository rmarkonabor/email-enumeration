"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://verify1.mailcheckhq.com";

export type PoolStatus = {
  pool_exhausted: boolean;
  loaded: boolean;
};

/**
 * Polls /smtp/stats every 30s and exposes pool_exhausted.
 * Only relevant when verify_provider === 'smtp' — third-party providers
 * bypass the warmup pool entirely.
 */
export function usePoolStatus(activeProvider: string): PoolStatus {
  const [state, setState] = useState<PoolStatus>({ pool_exhausted: false, loaded: false });

  useEffect(() => {
    if (activeProvider !== "smtp") {
      setState({ pool_exhausted: false, loaded: true });
      return;
    }
    let cancelled = false;
    async function load() {
      const apiKey = localStorage.getItem("ef_api_key") || "";
      if (!apiKey) {
        if (!cancelled) setState({ pool_exhausted: false, loaded: true });
        return;
      }
      try {
        const r = await fetch(`${API_BASE}/smtp/stats`, { headers: { "X-API-Key": apiKey } });
        if (!r.ok) {
          if (!cancelled) setState({ pool_exhausted: false, loaded: true });
          return;
        }
        const d = await r.json();
        if (!cancelled) setState({ pool_exhausted: !!d.pool_exhausted, loaded: true });
      } catch {
        if (!cancelled) setState({ pool_exhausted: false, loaded: true });
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeProvider]);

  return state;
}
