"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  apiBase,
  LOG_PREVIEW_CHARS,
  MAX_SINCE_MINUTES,
  PLAIN_LOG_PREVIEW_CHARS,
  WORKLOADS_PER_PAGE,
} from "@/constants/monitor";
import {
  type ActiveTab,
  type ContextInfo,
  type CrashDiagnostics,
  type EnvVar,
  type LogEntry,
  type NamespaceItem,
  type ParsedLogLine,
  type PodStatusItem,
  type PodTimeline,
  type TimeMode,
  type WorkloadItem,
  type WorkloadMetrics,
  type WorkloadSpec,
} from "@/types/monitor";
import {
  detectLogLevel,
  normalizeLogJson,
  parseLogSearchQuery,
} from "@/utils/monitor";

export function useMonitorData() {
  const logsAbortRef = useRef<AbortController | null>(null);

  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadItem[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState("");
  const [namespaceSearch, setNamespaceSearch] = useState("");
  const [workloadSearch, setWorkloadSearch] = useState("");
  const [workloadPage, setWorkloadPage] = useState(1);
  const [selectedWorkload, setSelectedWorkload] = useState<WorkloadItem | null>(null);

  const [sinceMinutes, setSinceMinutes] = useState(15);
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedLogRows, setExpandedLogRows] = useState<Record<string, boolean>>({});

  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [podStatuses, setPodStatuses] = useState<PodStatusItem[]>([]);
  const [workloadSpec, setWorkloadSpec] = useState<WorkloadSpec | null>(null);
  const [timeline, setTimeline] = useState<PodTimeline | null>(null);
  const [diagnostics, setDiagnostics] = useState<CrashDiagnostics | null>(null);
  const [metrics, setMetrics] = useState<WorkloadMetrics | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("logs");
  const [timeMode, setTimeMode] = useState<TimeMode>("preset");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [loadingWorkloads, setLoadingWorkloads] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [loadingPodStatus, setLoadingPodStatus] = useState(false);
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [selectedContext, setSelectedContext] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const response = await fetch(`${apiBase}/api/context`);
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as ContextInfo;
        setContextInfo(data);
        if (data.kube_context) {
          setSelectedContext(data.kube_context);
        }
      } catch {
        setContextInfo(null);
      }
    };

    fetchContext();
  }, []);

  useEffect(() => {
    const fetchNamespaces = async () => {
      setLoadingNamespaces(true);
      setError(null);
      setNamespaces([]);
      setSelectedNamespace("");

      try {
        const params = new URLSearchParams();
        if (selectedContext) {
          params.set("context", selectedContext);
        }

        const response = await fetch(
          `${apiBase}/api/namespaces${params.toString() ? `?${params.toString()}` : ""}`
        );
        if (!response.ok) {
          throw new Error("Failed to load namespaces");
        }

        const data = (await response.json()) as NamespaceItem[];
        setNamespaces(data);

        if (data.length > 0) {
          const preferredNamespace = data.find((item) => item.name === "mfoa-sit");
          setSelectedNamespace(preferredNamespace?.name ?? data[0].name);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoadingNamespaces(false);
      }
    };

    fetchNamespaces();
  }, [selectedContext]);

  useEffect(() => {
    if (!selectedNamespace) {
      return;
    }

    const fetchWorkloads = async () => {
      setLoadingWorkloads(true);
      setError(null);
      setWorkloads([]);
      setWorkloadSearch("");
      setWorkloadPage(1);
      setSelectedWorkload(null);

      try {
        const response = await fetch(
          `${apiBase}/api/workloads?namespace=${encodeURIComponent(
            selectedNamespace
          )}${selectedContext ? `&context=${encodeURIComponent(selectedContext)}` : ""}`
        );

        if (!response.ok) {
          throw new Error("Failed to load workloads");
        }

        const data = ((await response.json()) as WorkloadItem[] | null) ?? [];
        setWorkloads(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoadingWorkloads(false);
      }
    };

    fetchWorkloads();
  }, [selectedNamespace, selectedContext]);

  const fetchLogs = async () => {
    if (!selectedWorkload) {
      return;
    }

    logsAbortRef.current?.abort();
    const controller = new AbortController();
    logsAbortRef.current = controller;

    setLoadingLogs(true);
    setError(null);
    setLogs([]);

    try {
      const parsedSearch = parseLogSearchQuery(search);
      const params = new URLSearchParams({
        namespace: selectedWorkload.namespace,
        kind: selectedWorkload.kind,
        name: selectedWorkload.name,
        search: parsedSearch.text,
      });

      if (timeMode === "custom") {
        if (customStart) {
          params.set("start_time", new Date(customStart).toISOString());
        }
        if (customEnd) {
          params.set("end_time", new Date(customEnd).toISOString());
        }
      } else {
        params.set(
          "since_minutes",
          String(Math.min(Math.max(sinceMinutes, 1), MAX_SINCE_MINUTES))
        );
      }

      if (selectedContext) {
        params.set("context", selectedContext);
      }

      const response = await fetch(
        `${apiBase}/api/logs/stream?${params.toString()}`,
        { signal: controller.signal }
      );

      if (!response.ok) {
        throw new Error("Failed to load logs");
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      const pending: LogEntry[] = [];

      const sortLogs = (entries: LogEntry[]) =>
        entries.sort((a, b) => {
          if (a.timestamp && b.timestamp)
            return b.timestamp.localeCompare(a.timestamp);
          if (a.timestamp) return -1;
          if (b.timestamp) return 1;
          return a.source.localeCompare(b.source);
        });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data) {
              try {
                pending.push(JSON.parse(data) as LogEntry);
              } catch {
                // skip malformed SSE data lines
              }
            }
          }
        }

        // Flush every chunk so logs appear as each pod responds.
        if (pending.length > 0) {
          const batch = pending.splice(0);
          setLogs((prev) => [...prev, ...batch]);
        }
      }

      // Final sort once the stream closes — all pods have responded.
      setLogs((prev) => sortLogs([...prev]));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (selectedWorkload) {
          fetchLogs();
        } else {
          setLogs([]);
        }
      },
      timeMode === "custom" ? 350 : 0
    );

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkload, sinceMinutes, selectedContext, timeMode, customStart, customEnd]);

  useEffect(() => {
    return () => {
      logsAbortRef.current?.abort();
    };
  }, []);

  const fetchEnv = async (workload: WorkloadItem) => {
    setLoadingEnv(true);
    setEnvVars([]);

    try {
      const params = new URLSearchParams({
        namespace: workload.namespace,
        kind: workload.kind,
        name: workload.name,
      });
      if (selectedContext) {
        params.set("context", selectedContext);
      }

      const response = await fetch(`${apiBase}/api/env?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load env vars");
      }

      const data = (await response.json()) as EnvVar[];
      setEnvVars(data);
    } catch {
      setEnvVars([]);
    } finally {
      setLoadingEnv(false);
    }
  };

  const fetchPodStatus = async (workload: WorkloadItem) => {
    setLoadingPodStatus(true);
    setPodStatuses([]);

    try {
      const params = new URLSearchParams({
        namespace: workload.namespace,
        kind: workload.kind,
        name: workload.name,
      });
      if (selectedContext) {
        params.set("context", selectedContext);
      }

      const response = await fetch(`${apiBase}/api/pod-status?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load pod status");
      }

      const data = (await response.json()) as PodStatusItem[];
      setPodStatuses(data);
    } catch {
      setPodStatuses([]);
    } finally {
      setLoadingPodStatus(false);
    }
  };

  const fetchWorkloadSpec = async (workload: WorkloadItem) => {
    setLoadingSpec(true);
    setWorkloadSpec(null);

    try {
      const params = new URLSearchParams({
        namespace: workload.namespace,
        kind: workload.kind,
        name: workload.name,
      });
      if (selectedContext) {
        params.set("context", selectedContext);
      }

      const response = await fetch(`${apiBase}/api/workload-spec?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load workload spec");
      }

      const data = (await response.json()) as WorkloadSpec;
      setWorkloadSpec(data);
    } catch {
      setWorkloadSpec(null);
    } finally {
      setLoadingSpec(false);
    }
  };

  const workloadParams = (workload: WorkloadItem) => {
    const params = new URLSearchParams({
      namespace: workload.namespace,
      kind: workload.kind,
      name: workload.name,
    });
    if (selectedContext) {
      params.set("context", selectedContext);
    }
    return params;
  };

  const fetchTimeline = async (workload: WorkloadItem) => {
    setLoadingTimeline(true);
    setTimeline(null);
    try {
      const response = await fetch(`${apiBase}/api/timeline?${workloadParams(workload).toString()}`);
      if (!response.ok) throw new Error("Failed to load timeline");
      setTimeline((await response.json()) as PodTimeline);
    } catch {
      setTimeline(null);
    } finally {
      setLoadingTimeline(false);
    }
  };

  const fetchDiagnostics = async (workload: WorkloadItem) => {
    setLoadingDiagnostics(true);
    setDiagnostics(null);
    try {
      const response = await fetch(`${apiBase}/api/diagnostics?${workloadParams(workload).toString()}`);
      if (!response.ok) throw new Error("Failed to load diagnostics");
      setDiagnostics((await response.json()) as CrashDiagnostics);
    } catch {
      setDiagnostics(null);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const fetchMetrics = async (workload: WorkloadItem) => {
    setLoadingMetrics(true);
    setMetrics(null);
    try {
      const response = await fetch(`${apiBase}/api/metrics?${workloadParams(workload).toString()}`);
      if (!response.ok) throw new Error("Failed to load metrics");
      setMetrics((await response.json()) as WorkloadMetrics);
    } catch {
      setMetrics({ available: false, message: "Metrics unavailable", items: [] });
    } finally {
      setLoadingMetrics(false);
    }
  };

  useEffect(() => {
    if (selectedWorkload) {
      fetchEnv(selectedWorkload);
      fetchPodStatus(selectedWorkload);
      fetchWorkloadSpec(selectedWorkload);
      fetchTimeline(selectedWorkload);
      fetchDiagnostics(selectedWorkload);
      fetchMetrics(selectedWorkload);
    } else {
      setEnvVars([]);
      setPodStatuses([]);
      setWorkloadSpec(null);
      setTimeline(null);
      setDiagnostics(null);
      setMetrics(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkload, selectedContext]);

  const filteredLogs = useMemo(() => {
    const parsedSearch = parseLogSearchQuery(search);
    if (!parsedSearch.text) {
      return logs;
    }

    const term = parsedSearch.text.toLowerCase();
    return logs.filter((entry) => entry.line.toLowerCase().includes(term));
  }, [logs, search]);

  const filteredWorkloads = useMemo(() => {
    const term = workloadSearch.trim().toLowerCase();
    if (!term) {
      return workloads;
    }

    return workloads.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        item.kind.toLowerCase().includes(term)
    );
  }, [workloads, workloadSearch]);

  const filteredNamespaces = useMemo(() => {
    const term = namespaceSearch.trim().toLowerCase();
    if (!term) {
      return namespaces;
    }

    return namespaces.filter((item) => item.name.toLowerCase().includes(term));
  }, [namespaces, namespaceSearch]);

  const namespaceSuggestions = useMemo(() => {
    const term = namespaceSearch.trim();
    if (!term) {
      return [] as NamespaceItem[];
    }

    return filteredNamespaces.slice(0, 5);
  }, [filteredNamespaces, namespaceSearch]);

  const totalWorkloadPages = Math.max(
    1,
    Math.ceil(filteredWorkloads.length / WORKLOADS_PER_PAGE)
  );

  const currentWorkloadPage = Math.min(workloadPage, totalWorkloadPages);

  const displayedWorkloads = useMemo(
    () =>
      filteredWorkloads.slice(
        (currentWorkloadPage - 1) * WORKLOADS_PER_PAGE,
        currentWorkloadPage * WORKLOADS_PER_PAGE
      ),
    [filteredWorkloads, currentWorkloadPage]
  );

  const envByContainer = useMemo(() => {
    const map = new Map<string, EnvVar[]>();
    for (const value of envVars) {
      const list = map.get(value.container) ?? [];
      list.push(value);
      map.set(value.container, list);
    }
    return map;
  }, [envVars]);

  const parsedLogs = useMemo<ParsedLogLine[]>(() => {
    return filteredLogs.map((entry) => {
      const trimmed = entry.line.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsedJson = JSON.parse(trimmed) as Record<string, unknown>;
          const normalizedJson = normalizeLogJson(parsedJson) as Record<string, unknown>;
          const message =
            typeof parsedJson.message === "string"
              ? parsedJson.message
              : typeof parsedJson.msg === "string"
                ? parsedJson.msg
                : trimmed;

          return {
            entry,
            isJson: true,
            parsedJson: normalizedJson,
            oneLine: message,
            level: detectLogLevel(parsedJson),
          };
        } catch {
          // Use plain text rendering when JSON parsing fails.
        }
      }

      return {
        entry,
        isJson: false,
        parsedJson: null,
        oneLine: entry.line,
        level: null,
      };
    });
  }, [filteredLogs]);

  const previewChars = {
    json: LOG_PREVIEW_CHARS,
    plain: PLAIN_LOG_PREVIEW_CHARS,
  };

  return {
    activeTab,
    contextInfo,
    currentWorkloadPage,
    customEnd,
    customStart,
    displayedWorkloads,
    envByContainer,
    envVars,
    error,
    expandedLogRows,
    filteredNamespaces,
    filteredWorkloads,
    loadingEnv,
    loadingDiagnostics,
    loadingLogs,
    loadingMetrics,
    loadingNamespaces,
    loadingPodStatus,
    loadingSpec,
    loadingTimeline,
    diagnostics,
    metrics,
    loadingWorkloads,
    namespaces,
    namespaceSearch,
    namespaceSuggestions,
    parsedLogs,
    podStatuses,
    previewChars,
    search,
    selectedContext,
    selectedNamespace,
    selectedWorkload,
    sinceMinutes,
    timeMode,
    timeline,
    totalWorkloadPages,
    workloads,
    workloadSpec,
    setActiveTab,
    setCustomEnd,
    setCustomStart,
    setExpandedLogRows,
    setNamespaceSearch,
    setSearch,
    setSelectedContext,
    setSelectedNamespace,
    setSelectedWorkload,
    setSinceMinutes,
    setTimeMode,
    setWorkloadPage,
    setWorkloadSearch,
    workloadSearch,
    fetchLogs,
  };
}
