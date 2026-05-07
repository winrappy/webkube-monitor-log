"use client";

import { useState } from "react";
import type { EnvVar, ParsedLogLine, PodStatusItem, WorkloadItem } from "@/types/monitor";

type InspectorTab = "pod" | "detail" | "env";

type Props = {
  selectedWorkload: WorkloadItem | null;
  podStatuses: PodStatusItem[];
  loadingPodStatus: boolean;
  parsedLogs: ParsedLogLine[];
  selectedLogIndex: number | null;
  envVars: EnvVar[];
  envByContainer: Map<string, EnvVar[]>;
  loadingEnv: boolean;
};

export function InspectorPanel({
  selectedWorkload,
  podStatuses,
  loadingPodStatus,
  parsedLogs,
  selectedLogIndex,
  envVars,
  envByContainer,
  loadingEnv,
}: Props) {
  const [tab, setTab] = useState<InspectorTab>("pod");

  const selectedLog =
    selectedLogIndex !== null ? (parsedLogs[selectedLogIndex] ?? null) : null;

  const tabs: { id: InspectorTab; label: string; badge?: string | number }[] =
    [
      {
        id: "pod",
        label: "Pods",
        badge: podStatuses.length || undefined,
      },
      { id: "detail", label: "Log detail" },
      {
        id: "env",
        label: "Env",
        badge: envVars.length || undefined,
      },
    ];

  return (
    <aside
      className="ide-scroll"
      style={{
        gridArea: "inspector",
        background: "var(--ds-bg-1)",
        borderLeft: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          padding: "0 12px",
          borderBottom: "1px solid var(--line)",
          height: 36,
          flexShrink: 0,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "0 10px",
              height: "100%",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color:
                tab === t.id ? "var(--foreground)" : "var(--ds-text-2)",
              cursor: "pointer",
              border: "none",
              background: "transparent",
              fontFamily: "inherit",
              borderBottom:
                tab === t.id
                  ? "2px solid var(--ds-mint)"
                  : "2px solid transparent",
              marginBottom: -1,
              transition: "color 0.12s",
            }}
          >
            {t.label}
            {t.badge != null && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  background: "var(--ds-bg-3)",
                  color: "var(--ds-text-2)",
                  padding: "0 5px",
                  borderRadius: 3,
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div
        className="ide-scroll"
        style={{ flex: 1, overflowY: "auto", padding: 12 }}
      >
        {tab === "pod" && (
          <PodTab
            podStatuses={podStatuses}
            loading={loadingPodStatus}
            selectedWorkload={selectedWorkload}
          />
        )}
        {tab === "detail" && <LogDetailTab log={selectedLog} />}
        {tab === "env" && (
          <EnvTabContent
            envByContainer={envByContainer}
            envVars={envVars}
            loading={loadingEnv}
          />
        )}
      </div>
    </aside>
  );
}

/* ── Sub-panels ─────────────────────────────────────────────────── */

function PodTab({
  podStatuses,
  loading,
  selectedWorkload,
}: {
  podStatuses: PodStatusItem[];
  loading: boolean;
  selectedWorkload: WorkloadItem | null;
}) {
  if (!selectedWorkload)
    return <EmptyState>Select a workload to see pod details.</EmptyState>;
  if (loading)
    return (
      <EmptyState style={{ color: "var(--muted)" }}>
        Loading pod status…
      </EmptyState>
    );
  if (!podStatuses.length)
    return <EmptyState>No pods found.</EmptyState>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {podStatuses.map((pod) => (
        <div
          key={pod.name}
          style={{
            padding: 10,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--ds-bg-2)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--foreground)",
              marginBottom: 6,
              wordBreak: "break-all",
            }}
          >
            {pod.name}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Chip variant={pod.phase === "Running" ? "running" : "warn"}>
              {pod.phase}
            </Chip>
            <Chip variant="sky">ready {pod.ready}</Chip>
            {pod.restarts > 0 && (
              <Chip variant="rose">↻ restart {pod.restarts}</Chip>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogDetailTab({ log }: { log: ParsedLogLine | null }) {
  if (!log)
    return (
      <EmptyState>
        Click a log row to inspect it here.
        <br />
        <span style={{ fontSize: 10, color: "var(--ds-text-3)" }}>
          JSON payloads will be pretty-printed below.
        </span>
      </EmptyState>
    );

  const formattedJson = log.parsedJson
    ? JSON.stringify(log.parsedJson, null, 2)
    : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {log.level && (
          <Chip variant={levelVariant(log.level)}>{log.level}</Chip>
        )}
        {log.isJson && <Chip variant="violet">JSON</Chip>}
      </div>

      {log.entry.timestamp && (
        <KV
          label="Time"
          value={new Date(log.entry.timestamp).toLocaleString()}
        />
      )}
      <KV label="Source" value={log.entry.source} />

      {formattedJson ? (
        <>
          <SectionTitle>JSON payload</SectionTitle>
          <pre
            className="ide-scroll"
            style={{
              background: "var(--ds-bg-2)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--foreground)",
              overflowX: "auto",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 480,
              margin: 0,
            }}
          >
            {formattedJson}
          </pre>
        </>
      ) : (
        <>
          <SectionTitle>Raw line</SectionTitle>
          <pre
            style={{
              background: "var(--ds-bg-2)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--foreground)",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {log.entry.line}
          </pre>
        </>
      )}
    </div>
  );
}

function EnvTabContent({
  envByContainer,
  envVars,
  loading,
}: {
  envByContainer: Map<string, EnvVar[]>;
  envVars: EnvVar[];
  loading: boolean;
}) {
  if (loading)
    return <EmptyState style={{ color: "var(--muted)" }}>Loading env vars…</EmptyState>;
  if (!envVars.length)
    return <EmptyState>No environment variables found.</EmptyState>;

  const containers = [...envByContainer.keys()];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {containers.map((container) => {
        const vars = envByContainer.get(container) ?? [];
        return (
          <div key={container}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--ds-text-3)",
                fontWeight: 600,
                marginBottom: 4,
                paddingBottom: 4,
                borderBottom: "1px solid var(--ds-bg-3)",
              }}
            >
              {container}
            </div>
            {vars.map((v) => (
              <KV key={v.name} label={v.name} value={v.value} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── Shared atoms ────────────────────────────────────────────────── */

const CHIP_STYLES: Record<string, React.CSSProperties> = {
  running: {
    background: "var(--ds-mint-bg)",
    color: "var(--ds-mint)",
    border: "1px solid rgba(70,240,194,0.3)",
  },
  sky: {
    background: "var(--ds-sky-bg)",
    color: "var(--ds-sky)",
    border: "1px solid rgba(96,165,250,0.3)",
  },
  rose: {
    background: "var(--ds-rose-bg)",
    color: "var(--ds-rose)",
    border: "1px solid rgba(251,113,133,0.3)",
  },
  warn: {
    background: "var(--ds-amber-bg)",
    color: "var(--ds-amber)",
    border: "1px solid rgba(251,191,36,0.3)",
  },
  error: {
    background: "var(--ds-rose-bg)",
    color: "var(--ds-rose)",
    border: "1px solid rgba(251,113,133,0.3)",
  },
  info: {
    background: "var(--ds-sky-bg)",
    color: "var(--ds-sky)",
    border: "1px solid rgba(96,165,250,0.3)",
  },
  violet: {
    background: "var(--ds-violet-bg)",
    color: "var(--ds-violet)",
    border: "1px solid rgba(167,139,250,0.3)",
  },
  default: {
    background: "var(--ds-bg-3)",
    color: "var(--muted)",
    border: "1px solid var(--ds-line-2)",
  },
};

function Chip({
  children,
  variant = "default",
  style,
}: {
  children: React.ReactNode;
  variant?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        borderRadius: 3,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        ...(CHIP_STYLES[variant] ?? CHIP_STYLES.default),
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 0.42fr) minmax(0, 0.58fr)",
        columnGap: 10,
        rowGap: 2,
        padding: "6px 0",
        borderBottom: "1px dashed var(--ds-bg-3)",
        fontSize: 11,
        alignItems: "start",
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: "var(--ds-text-3)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "var(--font-mono)",
          minWidth: 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          lineHeight: 1.45,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "var(--foreground)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.45,
          minWidth: 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--ds-text-3)",
        fontWeight: 600,
        padding: "10px 0 6px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {children}
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
    </div>
  );
}

function EmptyState({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        color: "var(--ds-text-3)",
        fontSize: 12,
        padding: 20,
        textAlign: "center",
        lineHeight: 1.6,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function levelVariant(level: string): string {
  const l = level.toLowerCase();
  if (l === "error" || l === "err" || l === "fatal" || l === "crit")
    return "error";
  if (l === "warn" || l === "warning") return "warn";
  if (l === "info") return "info";
  return "default";
}
