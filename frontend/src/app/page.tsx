"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type NamespaceItem = {
  name: string;
};

type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

type WorkloadItem = {
  kind: WorkloadKind;
  name: string;
  namespace: string;
  selector: Record<string, string>;
};

type LogEntry = {
  source: string;
  line: string;
  timestamp?: string | null;
};

type EnvVar = {
  container: string;
  name: string;
  value: string;
};

type PodStatusItem = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
};

type ParsedLogLine = {
  entry: LogEntry;
  isJson: boolean;
  parsedJson: Record<string, unknown> | null;
  oneLine: string;
  level: string | null;
};

type ContextInfo = {
  kube_context?: string | null;
  cluster?: string | null;
  gcloud_project?: string | null;
  contexts?: string[];
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";
const WORKLOADS_PER_PAGE = 6;
const MAX_SINCE_MINUTES = 90 * 24 * 60;
const LOG_PREVIEW_CHARS = 240;
const PLAIN_LOG_PREVIEW_CHARS = 140;

const sinceOptions: Array<{ label: string; value: number }> = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "3 hours", value: 180 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "1 day", value: 1440 },
  { label: "3 days", value: 4320 },
  { label: "7 days", value: 10080 },
  { label: "14 days", value: 20160 },
  { label: "30 days", value: 43200 },
  { label: "60 days", value: 86400 },
  { label: "90 days", value: 129600 },
];

function detectLogLevel(data: Record<string, unknown>): string | null {
  const keys = ["level", "logLevel", "log_level", "severity", "lvl"];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

function levelBadgeClass(level: string): string {
  const upper = level.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FATAL")) {
    return "border-red-400/60 bg-red-500/15 text-red-200";
  }
  if (upper.includes("WARN")) {
    return "border-amber-400/60 bg-amber-500/15 text-amber-200";
  }
  if (upper.includes("DEBUG") || upper.includes("TRACE")) {
    return "border-sky-400/60 bg-sky-500/15 text-sky-200";
  }
  return "border-emerald-400/60 bg-emerald-500/15 text-emerald-200";
}

function podPhaseBadgeClass(phase: string): string {
  const upper = phase.toUpperCase();
  if (upper === "RUNNING") {
    return "border-emerald-400/60 bg-emerald-500/15 text-emerald-200";
  }
  if (upper === "PENDING") {
    return "border-amber-400/60 bg-amber-500/15 text-amber-200";
  }
  if (upper === "SUCCEEDED") {
    return "border-sky-400/60 bg-sky-500/15 text-sky-200";
  }
  if (upper === "FAILED") {
    return "border-red-400/60 bg-red-500/15 text-red-200";
  }
  return "border-slate-400/60 bg-slate-500/15 text-slate-200";
}

function podReadyBadgeClass(ready: string): string {
  const [readyCount, totalCount] = ready.split("/").map((value) => Number(value));
  const isReady =
    Number.isFinite(readyCount) &&
    Number.isFinite(totalCount) &&
    totalCount > 0 &&
    readyCount >= totalCount;
  return isReady
    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
    : "border-amber-400/60 bg-amber-500/15 text-amber-200";
}

function podRestartBadgeClass(restarts: number): string {
  if (restarts > 0) {
    return "border-rose-400/60 bg-rose-500/15 text-rose-200";
  }
  return "border-slate-400/60 bg-slate-500/15 text-slate-200";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(text: string, searchTerm: string) {
  const term = searchTerm.trim();
  if (!term) {
    return text;
  }

  const regex = new RegExp(`(${escapeRegExp(term)})`, "ig");
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.toLowerCase() === term.toLowerCase()) {
      return (
        <mark
          key={`hl-${index}`}
          className="rounded bg-amber-300/30 px-0.5 text-amber-100"
        >
          {part}
        </mark>
      );
    }
    return <span key={`txt-${index}`}>{part}</span>;
  });
}

function workloadKindLabel(kind: WorkloadKind): string {
  return kind === "Deployment" ? "" : kind;
}

export default function Home() {
  const logsAbortRef = useRef<AbortController | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadItem[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("");
  const [namespaceSearch, setNamespaceSearch] = useState("");
  const [workloadSearch, setWorkloadSearch] = useState("");
  const [workloadPage, setWorkloadPage] = useState(1);
  const [selectedWorkload, setSelectedWorkload] = useState<WorkloadItem | null>(
    null
  );
  const [sinceMinutes, setSinceMinutes] = useState(15);
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [podStatuses, setPodStatuses] = useState<PodStatusItem[]>([]);
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [loadingPodStatus, setLoadingPodStatus] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "env">("logs");
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [loadingWorkloads, setLoadingWorkloads] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [selectedContext, setSelectedContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<"preset" | "custom">("preset");
  const [expandedLogRows, setExpandedLogRows] = useState<Record<string, boolean>>({});
  // datetime-local string values e.g. "2026-04-21T10:00"
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  useEffect(() => {
    const fetchNamespaces = async () => {
      setLoadingNamespaces(true);
      setError(null);
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
          const preferredNamespace = data.find(
            (item) => item.name === "mfoa-sit"
          );
          setSelectedNamespace(
            (current) => current || preferredNamespace?.name || data[0].name
          );
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
    const fetchContext = async () => {
      try {
        const response = await fetch(`${apiBase}/api/context`);
        if (!response.ok) return;
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
        const data = (await response.json()) as WorkloadItem[];
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
    try {
      const params = new URLSearchParams({
        namespace: selectedWorkload.namespace,
        kind: selectedWorkload.kind,
        name: selectedWorkload.name,
        search: search.trim(),
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
      const response = await fetch(`${apiBase}/api/logs?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("Failed to load logs");
      }
      const data = (await response.json()) as LogEntry[];
      setLogs(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingLogs(false);
    }
  };

  // Fetch logs immediately when workload/time/context changes (no periodic polling).
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
      if (!response.ok) throw new Error("Failed to load env vars");
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
      if (!response.ok) throw new Error("Failed to load pod status");
      const data = (await response.json()) as PodStatusItem[];
      setPodStatuses(data);
    } catch {
      setPodStatuses([]);
    } finally {
      setLoadingPodStatus(false);
    }
  };

  useEffect(() => {
    if (selectedWorkload) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchEnv(selectedWorkload);
      fetchPodStatus(selectedWorkload);
    } else {
      setEnvVars([]);
      setPodStatuses([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkload, selectedContext]);

  const filteredLogs = useMemo(() => {
    if (!search.trim()) {
      return logs;
    }
    const term = search.toLowerCase();
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
    return filteredNamespaces.slice(0, 3);
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
    for (const v of envVars) {
      const list = map.get(v.container) ?? [];
      list.push(v);
      map.set(v.container, list);
    }
    return map;
  }, [envVars]);

  const parsedLogs = useMemo<ParsedLogLine[]>(() => {
    return filteredLogs.map((entry) => {
      const trimmed = entry.line.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsedJson = JSON.parse(trimmed) as Record<string, unknown>;
          const message =
            typeof parsedJson.message === "string"
              ? parsedJson.message
              : typeof parsedJson.msg === "string"
                ? parsedJson.msg
                : trimmed;
          return {
            entry,
            isJson: true,
            parsedJson,
            oneLine: message,
            level: detectLogLevel(parsedJson),
          };
        } catch {
          // Fall back to plain text rendering when JSON parsing fails.
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

  return (
    <div className="flex min-h-screen flex-col px-6 py-6 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted opacity-80">
            In-cluster Kubernetes
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Kubeweb Log Monitor
          </h1>
        </div>
        <div className="rounded-2xl border border-line bg-surface px-4 py-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Gcloud Context</p>
          <select
            className="mt-1 w-[360px] max-w-[70vw] bg-transparent text-sm font-semibold text-foreground outline-none"
            value={selectedContext}
            onChange={(event) => setSelectedContext(event.target.value)}
          >
            {contextInfo?.contexts?.length ? (
              contextInfo.contexts.map((ctx) => (
                <option key={ctx} value={ctx}>
                  {ctx}
                </option>
              ))
            ) : (
              <option value="">unknown</option>
            )}
          </select>
          {contextInfo?.gcloud_project ? (
            <p className="text-xs text-muted">project: {contextInfo.gcloud_project}</p>
          ) : null}
        </div>
      </header>

      <main
        className="mt-6 flex min-h-0 flex-1 flex-col gap-6"
        style={{ animation: "fadeIn 0.8s ease" }}
      >
        <section className="glass-panel grid-lines rounded-3xl p-6">
          <h2 className="text-lg font-semibold">Workload Explorer</h2>
          <p className="mt-2 text-sm text-muted">
            Select a namespace and workload to fetch pod logs from the cluster
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
            <div className="space-y-4">
              <label className="text-xs uppercase tracking-[0.25em] text-muted">
                Namespace
              </label>
              <input
                className="w-full rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none transition focus:border-accent"
                placeholder="Search namespace"
                value={namespaceSearch}
                onChange={(event) => setNamespaceSearch(event.target.value)}
              />
              {namespaceSuggestions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {namespaceSuggestions.map((item) => (
                    <button
                      key={`ns-suggest-${item.name}`}
                      className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-foreground"
                      onClick={() => {
                        setSelectedNamespace(item.name);
                        setWorkloadPage(1);
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="rounded-2xl border border-line bg-surface px-4 py-2">
                {loadingNamespaces ? (
                  <p className="text-sm text-muted">Loading...</p>
                ) : (
                  <>
                    <select
                      className="w-full bg-transparent text-sm outline-none"
                      value={selectedNamespace}
                      onChange={(event) => {
                        setSelectedNamespace(event.target.value);
                        setWorkloadPage(1);
                      }}
                    >
                      {filteredNamespaces.length > 0 ? (
                        filteredNamespaces.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name}
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>
                          No namespace matched
                        </option>
                      )}
                    </select>
                    {namespaceSearch.trim() && filteredNamespaces.length === 0 ? (
                      <p className="mt-2 text-xs text-muted">No namespace matched search text</p>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs uppercase tracking-[0.25em] text-muted">
                Workload
              </label>
              <input
                className="w-full rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none transition focus:border-accent"
                placeholder="Search workload"
                value={workloadSearch}
                onChange={(event) => {
                  setWorkloadSearch(event.target.value);
                  setWorkloadPage(1);
                }}
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {loadingWorkloads ? (
                  <p className="text-sm text-muted">Loading...</p>
                ) : filteredWorkloads.length === 0 ? (
                  <p className="text-sm text-muted">No workloads found</p>
                ) : (
                  <>
                    {displayedWorkloads.map((item) => (
                      <button
                        key={`${item.kind}-${item.name}`}
                        onClick={() => setSelectedWorkload(item)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          selectedWorkload?.name === item.name
                            ? "border-accent bg-chip text-foreground"
                            : "border-line bg-surface text-muted hover:border-accent"
                        }`}
                      >
                        <p className="text-sm font-semibold text-foreground">
                          {item.name}
                        </p>
                        {workloadKindLabel(item.kind) ? (
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">
                            {workloadKindLabel(item.kind)}
                          </p>
                        ) : null}
                      </button>
                    ))}
                  </>
                )}
              </div>
              {filteredWorkloads.length > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    Showing {(currentWorkloadPage - 1) * WORKLOADS_PER_PAGE + 1}-
                    {Math.min(currentWorkloadPage * WORKLOADS_PER_PAGE, filteredWorkloads.length)} of{" "}
                    {filteredWorkloads.length} workloads
                  </p>
                  {totalWorkloadPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setWorkloadPage((prev) => Math.max(prev - 1, 1))}
                        disabled={currentWorkloadPage === 1}
                      >
                        Prev
                      </button>
                      <span className="text-xs text-muted">
                        {currentWorkloadPage}/{totalWorkloadPages}
                      </span>
                      <button
                        className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() =>
                          setWorkloadPage((prev) =>
                            Math.min(prev + 1, totalWorkloadPages)
                          )
                        }
                        disabled={currentWorkloadPage === totalWorkloadPages}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="glass-panel flex min-h-0 flex-1 flex-col rounded-3xl p-6">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted">
                {selectedWorkload
                  ? workloadKindLabel(selectedWorkload.kind)
                    ? `${workloadKindLabel(selectedWorkload.kind)} / ${selectedWorkload.name}`
                    : selectedWorkload.name
                  : "No workload selected"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {loadingPodStatus ? (
                  <span className="text-xs text-muted">Loading pod status...</span>
                ) : podStatuses.length > 0 ? (
                  podStatuses.map((pod) => (
                    <span
                      key={pod.name}
                      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[10px] text-foreground/90"
                    >
                      <span className="font-semibold text-foreground">{pod.name}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${podPhaseBadgeClass(
                          pod.phase
                        )}`}
                      >
                        {pod.phase}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${podReadyBadgeClass(
                          pod.ready
                        )}`}
                      >
                        ready {pod.ready}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${podRestartBadgeClass(
                          pod.restarts
                        )}`}
                      >
                        restart {pod.restarts}
                      </span>
                    </span>
                  ))
                ) : selectedWorkload ? (
                  <span className="text-xs text-muted">No pods found</span>
                ) : null}
              </div>
            </div>
            {activeTab === "logs" ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* Time mode toggle */}
                <button
                  onClick={() =>
                    setTimeMode((m) => (m === "preset" ? "custom" : "preset"))
                  }
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                    timeMode === "custom"
                      ? "border-accent bg-chip text-accent"
                      : "border-line bg-surface text-muted hover:border-accent"
                  }`}
                  title={
                    timeMode === "preset"
                      ? "Switch to custom date range"
                      : "Switch to preset time range"
                  }
                >
                  {timeMode === "preset" ? "Custom range" : "Preset range"}
                </button>

                {timeMode === "preset" ? (
                  <select
                    className="rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none transition focus:border-accent"
                    value={sinceMinutes}
                    onChange={(event) =>
                      setSinceMinutes(Number(event.target.value))
                    }
                  >
                    {sinceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] uppercase tracking-[0.2em] text-muted">
                        From
                      </label>
                      <input
                        type="datetime-local"
                        className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent"
                        value={customStart}
                        max={customEnd || undefined}
                        onChange={(event) => setCustomStart(event.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] uppercase tracking-[0.2em] text-muted">
                        To
                      </label>
                      <input
                        type="datetime-local"
                        className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent"
                        value={customEnd}
                        min={customStart || undefined}
                        onChange={(event) => setCustomEnd(event.target.value)}
                      />
                    </div>
                  </div>
                )}

                <input
                  className="w-56 rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none transition focus:border-accent"
                  placeholder="Search logs"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button
                  className="rounded-full border border-line px-4 py-2 text-sm transition hover:border-accent"
                  onClick={fetchLogs}
                  disabled={loadingLogs || !selectedWorkload}
                >
                  {loadingLogs ? "Loading..." : "Refresh"}
                </button>
              </div>
            ) : null}
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-1 border-b border-line">
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-2 text-sm font-medium transition ${
                activeTab === "logs"
                  ? "border-b-2 border-accent text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Logs
            </button>
            <button
              onClick={() => setActiveTab("env")}
              className={`px-4 py-2 text-sm font-medium transition ${
                activeTab === "env"
                  ? "border-b-2 border-accent text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Environment{envVars.length > 0 ? ` (${envVars.length})` : ""}
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm">
              {error}
            </div>
          ) : null}

          {/* Logs tab */}
          {activeTab === "logs" ? (
            <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-2xl border border-line bg-surface-strong p-4 font-mono text-[11px]">
            {parsedLogs.length === 0 ? (
              <p className="text-muted">
                {!selectedWorkload
                  ? "Select a workload to load logs"
                  : loadingLogs
                  ? "Loading logs..."
                  : "No logs available or no matches"}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {parsedLogs.map((item, index) => {
                  const rowKey = `${item.entry.source}-${index}`;
                  const previewChars = item.isJson
                    ? LOG_PREVIEW_CHARS
                    : PLAIN_LOG_PREVIEW_CHARS;
                  const isLongLog = item.oneLine.length > previewChars;
                  const isExpanded = Boolean(expandedLogRows[rowKey]);
                  const displayLine =
                    isLongLog && !isExpanded
                      ? `${item.oneLine.slice(0, previewChars)}...`
                      : item.oneLine;

                  const expandButton = isLongLog ? (
                    <button
                      type="button"
                      className="ml-2 shrink-0 self-start rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-accent"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setExpandedLogRows((prev) => ({
                          ...prev,
                          [rowKey]: !prev[rowKey],
                        }));
                      }}
                    >
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  ) : null;

                  const timeBadge = item.entry.timestamp ? (
                    <span className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-foreground/80">
                      {new Date(item.entry.timestamp).toLocaleString()}
                    </span>
                  ) : null;

                  const levelBadge = item.level ? (
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] ${levelBadgeClass(
                        item.level
                      )}`}
                    >
                      {item.level}
                    </span>
                  ) : null;

                  return (
                    <li key={`${item.entry.source}-${index}`}>
                      {item.isJson && item.parsedJson ? (
                        <details className="bg-background/20">
                          <summary className="list-none cursor-pointer px-3 py-3">
                              <div className="flex items-start gap-2 text-[11px]">
                              {timeBadge}
                              {levelBadge}
                              <span className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-accent">
                                JSON
                              </span>
                              <span className="min-w-0 flex-1 text-foreground break-all">
                                {renderHighlightedText(displayLine, search)}
                              </span>
                              {expandButton}
                            </div>
                          </summary>
                            <pre className="border-t border-line px-3 py-3 whitespace-pre-wrap text-[10px] text-muted">
                            {JSON.stringify(item.parsedJson, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <div className="bg-background/20 px-3 py-3">
                            <div className="flex items-start gap-2 text-[11px]">
                            {timeBadge}
                            {levelBadge}
                            <span className="min-w-0 flex-1 text-foreground break-all">
                              {renderHighlightedText(displayLine, search)}
                            </span>
                            {expandButton}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          ) : null}

          {/* Env tab */}
          {activeTab === "env" ? (
            <div className="mt-4 min-h-0 flex-1 overflow-auto">
              {loadingEnv ? (
                <p className="text-sm text-muted">Loading...</p>
              ) : !selectedWorkload ? (
                <p className="text-sm text-muted">Select a workload to see environment variables</p>
              ) : envVars.length === 0 ? (
                <p className="text-sm text-muted">No environment variables defined in pod spec</p>
              ) : (
                <div className="space-y-4">
                  {Array.from(envByContainer.entries()).map(([container, vars]) => (
                    <div key={container}>
                      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-accent">{container}</p>
                      <div className="overflow-auto rounded-2xl border border-line">
                        <table className="w-full text-[11px] font-mono">
                          <thead>
                            <tr className="border-b border-line bg-surface-strong">
                              <th className="px-4 py-2 text-left font-semibold text-muted w-[40%]">NAME</th>
                              <th className="px-4 py-2 text-left font-semibold text-muted">VALUE</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {vars.map((v) => (
                              <tr key={v.name} className="hover:bg-surface-strong transition-colors">
                                <td className="px-4 py-2 text-foreground/90 break-all">{v.name}</td>
                                <td className="px-4 py-2 text-foreground/70 break-all">{v.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
