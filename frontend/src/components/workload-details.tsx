"use client";

import { useEffect } from "react";

import type {
  ParsedLogLine,
  PodStatusItem,
  TimeMode,
  WorkloadItem,
} from "@/types/monitor";

import { LogsTab } from "@/components/logs-tab";
import { RequestChain } from "@/components/request-chain";

export type ViewMode = "tail" | "trace";

type WorkloadDetailsProps = {
  customEnd: string;
  customStart: string;
  error: string | null;
  expandedLogRows: Record<string, boolean>;
  loadingLogs: boolean;
  parsedLogs: ParsedLogLine[];
  podStatuses: PodStatusItem[];
  search: string;
  selectedWorkload: WorkloadItem | null;
  sinceMinutes: number;
  timeMode: TimeMode;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedLogIndex: number | null;
  setSelectedLogIndex: (index: number | null) => void;
  namespace: string;
  selectedContext: string;
  filteredWorkloadsCount: number;
  setExpandedLogRows: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
  setCustomEnd: (value: string) => void;
  setCustomStart: (value: string) => void;
  setSearch: (value: string) => void;
  setSinceMinutes: (value: number) => void;
  setTimeMode: (updater: (previous: TimeMode) => TimeMode) => void;
  fetchLogs: () => Promise<void>;
};

const VIEW_MODES: { id: ViewMode; label: string; icon: string }[] = [
  { id: "tail", label: "Live tail", icon: "≡" },
  { id: "trace", label: "Trace", icon: "⋯" },
];

export function WorkloadDetails({
  customEnd,
  customStart,
  error,
  expandedLogRows,
  fetchLogs,
  filteredWorkloadsCount,
  loadingLogs,
  namespace,
  parsedLogs,
  podStatuses,
  search,
  selectedContext,
  selectedLogIndex,
  selectedWorkload,
  setCustomEnd,
  setCustomStart,
  setExpandedLogRows,
  setSearch,
  setSinceMinutes,
  setTimeMode,
  setViewMode,
  setSelectedLogIndex,
  sinceMinutes,
  timeMode,
  viewMode,
}: WorkloadDetailsProps) {
  /* ── stats ──────────────────────────────────────────────────── */
  const totalLogs = parsedLogs.length;
  const jsonCount = parsedLogs.filter((l) => l.isJson).length;
  const errorCount = parsedLogs.filter((l) => {
    const lv = l.level?.toLowerCase() ?? "";
    return lv === "error" || lv === "err" || lv === "fatal" || lv === "crit";
  }).length;
  const podCount = podStatuses.length;

  const stats = [
    { id: "total", k: "Total logs", v: totalLogs, color: "var(--ds-mint)" },
    { id: "workloads", k: "Workloads", v: filteredWorkloadsCount, color: "var(--ds-violet)" },
    { id: "json", k: "JSON logs", v: jsonCount, color: "var(--ds-sky)" },
    {
      id: "errors",
      k: "Errors",
      v: errorCount,
      color: errorCount > 0 ? "var(--ds-rose)" : "var(--ds-text-2)",
    },
    { id: "pods", k: "Pods", v: podCount, color: "var(--ds-amber)" },
  ];

  /* ── keyboard shortcuts ─────────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === "1") setViewMode("tail");
      else if (e.key === "2") setViewMode("trace");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setViewMode]);

  return (
    <main
      style={{
        gridArea: "main",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Mode bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          borderBottom: "1px solid var(--line)",
          background: "var(--ds-bg-1)",
          height: 44,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--ds-bg-2)",
            padding: 2,
            borderRadius: 7,
            border: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          {VIEW_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setViewMode(m.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 5,
                fontSize: 12,
                fontWeight: 500,
                color:
                  viewMode === m.id ? "var(--foreground)" : "var(--muted)",
                cursor: "pointer",
                border: "none",
                background:
                  viewMode === m.id ? "var(--ds-bg-3)" : "transparent",
                fontFamily: "inherit",
                transition: "background 0.12s, color 0.12s",
              }}
            >
              <span
                style={{
                  color:
                    viewMode === m.id ? "var(--ds-mint)" : "var(--ds-text-2)",
                  fontSize: 13,
                }}
              >
                {m.icon}
              </span>
              {m.label}
            </button>
          ))}
        </div>

        {/* Workload pill */}
        {selectedWorkload && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px 0 4px",
              height: 26,
              background: "var(--ds-violet-bg)",
              border: "1px solid rgba(167, 139, 250, 0.3)",
              borderRadius: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ds-violet)",
              flexShrink: 0,
              overflow: "hidden",
              maxWidth: 280,
            }}
          >
            <span
              style={{
                background: "rgba(167, 139, 250, 0.2)",
                padding: "1px 5px",
                borderRadius: 3,
                fontSize: 9.5,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--ds-violet)",
                flexShrink: 0,
              }}
            >
              {selectedWorkload.kind.toLowerCase()}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedWorkload.name}
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Refresh + live toggle */}
        <button
          onClick={fetchLogs}
          disabled={loadingLogs || !selectedWorkload}
          style={{
            height: 26,
            padding: "0 10px",
            border: "1px solid var(--ds-line-2)",
            background: "var(--ds-bg-2)",
            color: "var(--foreground)",
            borderRadius: 6,
            fontSize: 12,
            fontFamily: "inherit",
            fontWeight: 500,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            opacity: loadingLogs || !selectedWorkload ? 0.5 : 1,
          }}
        >
          {loadingLogs ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--line)",
          background: "var(--ds-bg-1)",
          flexShrink: 0,
        }}
      >
        {stats.map((s, i) => (
          <div
            key={s.id}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRight: i < stats.length - 1 ? "1px solid var(--line)" : "none",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--ds-text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 2,
                  background: s.color,
                  display: "inline-block",
                }}
              />
              {s.k}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: s.v > 0 ? "var(--foreground)" : "var(--ds-text-3)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "-0.01em",
              }}
            >
              {s.v}
            </div>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 14px",
            background: "var(--ds-rose-bg)",
            borderBottom: "1px solid rgba(251,113,133,0.3)",
            fontSize: 12,
            color: "var(--ds-rose)",
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* Canvas — switchable view */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: viewMode === "tail" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <LogsTab
            parsedLogs={parsedLogs}
            selectedWorkload={selectedWorkload}
            loadingLogs={loadingLogs}
            search={search}
            expandedLogRows={expandedLogRows}
            sinceMinutes={sinceMinutes}
            timeMode={timeMode}
            customStart={customStart}
            customEnd={customEnd}
            selectedLogIndex={selectedLogIndex}
            setExpandedLogRows={setExpandedLogRows}
            setSearch={setSearch}
            setSinceMinutes={setSinceMinutes}
            setTimeMode={setTimeMode}
            setCustomStart={setCustomStart}
            setCustomEnd={setCustomEnd}
            setSelectedLogIndex={setSelectedLogIndex}
            fetchLogs={fetchLogs}
          />
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: viewMode === "trace" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <RequestChain namespace={namespace} context={selectedContext} />
        </div>
      </div>
    </main>
  );
}
