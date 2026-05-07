"use client";

import { useEffect, useState } from "react";
import { apiBase } from "@/constants/monitor";
import type { ServiceMap } from "@/types/monitor";

export function useServiceMap(namespace: string, context: string) {
  const [data, setData] = useState<ServiceMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!namespace) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ namespace });
    if (context) params.set("context", context);

    fetch(`${apiBase}/api/service-map?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load service map");
        return res.json() as Promise<ServiceMap>;
      })
      .then((map) => {
        if (!cancelled) setData(map);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [namespace, context]);

  return { data, loading, error };
}
