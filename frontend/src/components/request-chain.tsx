"use client";

import { useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { apiBase, sinceOptions } from "@/constants/monitor";
import type {
  RequestChain as RequestChainResult,
  RequestChainItem,
} from "@/types/monitor";
import { normalizeLogJson } from "@/utils/monitor";

type Props = {
  namespace: string;
  context: string;
};

type EventFilter = "all" | "http" | "kafka" | "other";
type QueryMode = "auto" | "trace" | "span" | "correlation";
type TraceSpanRow = {
  spanId: string;
  workload: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  count: number;
  eventTypes: string[];
};

const EVENT_LABEL: Record<string, string> = {
  "http-request": "HTTP request",
  "http-call": "HTTP call",
  "kafka-publish": "Kafka publish",
  "kafka-consume": "Kafka consume",
  kafka: "Kafka",
  "request-log": "Request log",
  log: "Log",
};

const EVENT_CLASS: Record<string, string> = {
  "http-request": "border-sky-400/50 bg-sky-500/10 text-sky-200",
  "http-call": "border-cyan-400/50 bg-cyan-500/10 text-cyan-100",
  "kafka-publish": "border-amber-400/50 bg-amber-500/10 text-amber-100",
  "kafka-consume": "border-orange-400/50 bg-orange-500/10 text-orange-100",
  kafka: "border-amber-400/50 bg-amber-500/10 text-amber-100",
  "request-log": "border-accent/50 bg-accent/10 text-accent",
  log: "border-line bg-surface text-muted",
};

const FILTERS: Array<{ label: string; value: EventFilter }> = [
  { label: "All", value: "all" },
  { label: "HTTP", value: "http" },
  { label: "Kafka", value: "kafka" },
  { label: "Other", value: "other" },
];

function workloadId(item: RequestChainItem) {
  return `${item.workload_kind}/${item.workload_name}`;
}

function eventGroup(eventType: string): EventFilter {
  if (eventType.startsWith("http") || eventType === "request-log") return "http";
  if (eventType.startsWith("kafka")) return "kafka";
  return "other";
}

function formatTime(value?: string | null) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function elapsedFrom(first?: string | null, current?: string | null) {
  if (!first || !current) return null;
  const elapsed = new Date(current).getTime() - new Date(first).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  if (elapsed < 1000) return `+${elapsed}ms`;
  return `+${(elapsed / 1000).toFixed(1)}s`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function summarizeLine(line: string) {
  const trimmed = line.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const message =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.msg === "string"
            ? parsed.msg
            : typeof parsed.event === "string"
              ? parsed.event
              : trimmed;
      return message.length > 180 ? `${message.slice(0, 179)}...` : message;
    } catch {
      return trimmed.length > 180 ? `${trimmed.slice(0, 179)}...` : trimmed;
    }
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 179)}...` : trimmed;
}

function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-amber-300/30 px-0.5 text-amber-100">
        {text.slice(index, index + term.length)}
      </mark>
      {text.slice(index + term.length)}
    </>
  );
}

function formattedJsonFromLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    return JSON.stringify(normalizeLogJson(JSON.parse(trimmed)), null, 2);
  } catch {
    return null;
  }
}

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-accent hover:text-foreground"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function buildTraceStack(items: RequestChainItem[]): TraceSpanRow[] {
  const grouped = new Map<string, TraceSpanRow>();
  for (const item of items) {
    if (!item.span_id || !item.timestamp) continue;
    const timestamp = new Date(item.timestamp).getTime();
    if (!Number.isFinite(timestamp)) continue;

    const existing = grouped.get(item.span_id);
    if (!existing) {
      grouped.set(item.span_id, {
        spanId: item.span_id,
        workload: workloadId(item),
        startMs: timestamp,
        endMs: timestamp,
        durationMs: 0,
        count: 1,
        eventTypes: [item.event_type],
      });
      continue;
    }

    existing.startMs = Math.min(existing.startMs, timestamp);
    existing.endMs = Math.max(existing.endMs, timestamp);
    existing.durationMs = existing.endMs - existing.startMs;
    existing.count++;
    if (!existing.eventTypes.includes(item.event_type)) {
      existing.eventTypes.push(item.event_type);
    }
  }

  return Array.from(grouped.values())
    .map((row) => ({ ...row, durationMs: row.endMs - row.startMs }))
    .sort((a, b) => a.startMs - b.startMs || a.workload.localeCompare(b.workload));
}

function TraceStack({ spans }: { spans: TraceSpanRow[] }) {
  if (spans.length === 0) {
    return (
      <p className="text-xs text-muted">
        No span IDs found. Duration needs repeated timestamped logs with the same spanId.
      </p>
    );
  }

  const traceStart = Math.min(...spans.map((span) => span.startMs));
  const traceEnd = Math.max(...spans.map((span) => span.endMs));
  const totalMs = Math.max(traceEnd - traceStart, 1);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-background/40 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">approx trace duration</span>
          <span className="font-mono text-foreground">{formatDuration(totalMs)}</span>
        </div>
      </div>
      {spans.map((span) => {
        const offsetPct = ((span.startMs - traceStart) / totalMs) * 100;
        const widthPct = Math.max((span.durationMs / totalMs) * 100, 3);
        return (
          <div key={span.spanId} className="text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-words font-mono text-foreground">{span.workload}</div>
                <div className="font-mono text-muted">span: {span.spanId}</div>
              </div>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
                {formatDuration(span.durationMs)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-background">
              <div
                className="h-2 rounded-full bg-accent/70"
                style={{ marginLeft: `${offsetPct}%`, width: `${widthPct}%` }}
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="text-muted">{span.count} logs</span>
              {span.eventTypes.slice(0, 3).map((eventType) => (
                <span key={eventType} className="rounded border border-line px-1 text-[10px] text-muted">
                  {EVENT_LABEL[eventType] ?? eventType}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function uniquePath(items: RequestChainItem[]) {
  const path: string[] = [];
  for (const item of items) {
    const id = workloadId(item);
    if (path[path.length - 1] !== id) path.push(id);
  }
  return path;
}

function nodeParts(node: string) {
  const [kind, ...rest] = node.split("/");
  return { kind, name: rest.join("/") || node };
}

function wrapName(name: string, maxLineChars = 24) {
  const words = name.split(/([_-])/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = `${current}${word}`;
    if (current && next.length > maxLineChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [name];
}

function PathGraph({ path }: { path: string[] }) {
  const nodeRadius = 20;
  const width = Math.max(520, Math.min(960, 260 + path.length * 110));
  const centerX = width / 2;
  const graphY = 96;

  if (path.length === 0) {
    return <p className="text-sm text-muted">No observed workload path.</p>;
  }

  const nodes = Array.from(new Set(path));
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const wrappedNames = nodes.map((node) => wrapName(nodeParts(node).name));
  const maxNameLines = Math.max(
    ...wrappedNames.map((lines) => lines.length),
    1
  );
  const height = nodes.length <= 2 ? 168 + maxNameLines * 16 : 240 + maxNameLines * 16;
  const centerY = nodes.length <= 2 ? graphY : 118;
  const radiusX = Math.max(130, Math.min(300, width / 2 - 120));
  const radiusY = nodes.length <= 3 ? 62 : 82;

  const positions = new Map(
    nodes.map((node, index) => {
      if (nodes.length === 1) {
        return [node, { x: centerX, y: centerY }];
      }
      if (nodes.length === 2) {
        return [node, { x: centerX + (index === 0 ? -135 : 135), y: centerY }];
      }
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / nodes.length;
      return [
        node,
        {
          x: centerX + Math.cos(angle) * radiusX,
          y: centerY + Math.sin(angle) * radiusY,
        },
      ];
    })
  );

  const edgeCounts = new Map<string, { source: string; target: string; count: number }>();
  for (let index = 0; index < path.length - 1; index++) {
    const source = path[index];
    const target = path[index + 1];
    if (source === target) continue;
    const key = `${source}|${target}`;
    const existing = edgeCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      edgeCounts.set(key, { source, target, count: 1 });
    }
  }
  const graphEdges = Array.from(edgeCounts.values());

  return (
    <div className="overflow-x-auto pb-1">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        role="img"
        aria-label="Observed request path graph"
      >
        <defs>
          <marker
            id="observed-path-arrow"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="var(--accent)" opacity="0.75" />
          </marker>
        </defs>

        {graphEdges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;

          const reverseExists = edgeCounts.has(`${edge.target}|${edge.source}`);
          const sourceIndex = nodeIndex.get(edge.source) ?? 0;
          const targetIndex = nodeIndex.get(edge.target) ?? 0;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.max(Math.hypot(dx, dy), 1);
          const ux = dx / distance;
          const uy = dy / distance;
          const startX = source.x + ux * (nodeRadius + 8);
          const startY = source.y + uy * (nodeRadius + 8);
          const endX = target.x - ux * (nodeRadius + 10);
          const endY = target.y - uy * (nodeRadius + 10);
          const offset = reverseExists ? (sourceIndex < targetIndex ? 34 : -34) : 18;
          const midX = (startX + endX) / 2 - uy * offset;
          const midY = (startY + endY) / 2 + ux * offset;
          return (
            <g key={`${edge.source}-${edge.target}`}>
              <path
                d={`M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeOpacity={0.55}
                markerEnd="url(#observed-path-arrow)"
              />
              <text
                x={midX}
                y={midY - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted)"
                fontFamily="monospace"
              >
                {edge.count > 1 ? `x${edge.count}` : ""}
              </text>
            </g>
          );
        })}

        {nodes.map((node, index) => {
          const pos = positions.get(node);
          if (!pos) return null;
          const { kind, name } = nodeParts(node);
          const nameLines = wrappedNames[index];
          const firstSeen = path.indexOf(node) + 1;
          return (
            <g key={`${node}-${index}`}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius + 6}
                fill="rgba(70, 240, 194, 0.09)"
                stroke="rgba(70, 240, 194, 0.18)"
              />
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius}
                fill="var(--surface)"
                stroke="var(--accent)"
                strokeWidth={2}
              />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                fill="var(--accent)"
                fontFamily="monospace"
              >
                {firstSeen}
              </text>
              <text
                x={pos.x}
                y={pos.y + 42}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted)"
                fontFamily="monospace"
              >
                {kind}
              </text>
              <text
                x={pos.x}
                y={pos.y + 58}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--foreground)"
                fontFamily="monospace"
              >
                {nameLines.map((line, lineIndex) => (
                  <tspan key={`${name}-${lineIndex}`} x={pos.x} dy={lineIndex === 0 ? 0 : 16}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RequestChain({ namespace, context }: Props) {
  const [query, setQuery] = useState("");
  const [queryMode, setQueryMode] = useState<QueryMode>("auto");
  const [sinceMinutes, setSinceMinutes] = useState(60);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [showRaw, setShowRaw] = useState(false);
  const [result, setResult] = useState<RequestChainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const trimmed = query.trim();
    if (!namespace || !trimmed) {
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        namespace,
        query: trimmed,
        since_minutes: String(sinceMinutes),
      });
      if (queryMode !== "auto") params.set("mode", queryMode);
      if (context) params.set("context", context);

      const response = await fetch(`${apiBase}/api/request-chain?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load request chain");
      setResult((await response.json()) as RequestChainResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setQuery("");
    setQueryMode("auto");
    setResult(null);
    setError(null);
    setEventFilter("all");
    setShowRaw(false);
  };

  const items = result?.items ?? [];
  const edges = result?.edges ?? [];
  const summary = result?.summary;
  const firstTimestamp = items[0]?.timestamp;

  const filteredItems = useMemo(() => {
    if (eventFilter === "all") return items;
    return items.filter((item) => eventGroup(item.event_type) === eventFilter);
  }, [eventFilter, items]);

  const path = useMemo(() => uniquePath(items), [items]);
  const traceStack = useMemo(() => buildTraceStack(items), [items]);
  const targets = useMemo(
    () =>
      items
        .filter((item) => item.target)
        .map((item) => ({
          eventType: item.event_type,
          source: workloadId(item),
          target: item.target ?? "",
          confidence: item.confidence,
        })),
    [items]
  );

  return (
    <section className="glass-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <label className="text-xs uppercase tracking-[0.18em] text-muted">
            Correlation ID
          </label>
          <input
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-muted/60 focus:border-accent"
            placeholder="Search by trace, span, or correlation ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-muted">
            Mode
          </label>
          <select
            className="mt-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            value={queryMode}
            onChange={(event) => setQueryMode(event.target.value as QueryMode)}
          >
            <option value="auto">Auto</option>
            <option value="trace">Trace</option>
            <option value="span">Span</option>
            <option value="correlation">Correlation</option>
          </select>
        </div>

        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-muted">
            Window
          </label>
          <select
            className="mt-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            value={sinceMinutes}
            onChange={(event) => setSinceMinutes(Number(event.target.value))}
          >
            {sinceOptions.slice(0, 9).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void search()}
          disabled={loading || !namespace || !query.trim()}
          className="rounded-xl border border-accent bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Searching" : "Find chain"}
        </button>

        {(query || result) && (
          <button
            type="button"
            onClick={clear}
            className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-accent hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {result && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            {[
              ["Logs", summary?.total_logs ?? items.length],
              ["Workloads", summary?.workloads ?? 0],
              ["HTTP-ish", summary?.http ?? 0],
              ["Kafka-ish", summary?.kafka ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-surface-strong px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-line bg-surface px-2 py-1 text-muted">
              mode: {result.mode ?? queryMode}
            </span>
            <span className="rounded-full border border-line bg-surface px-2 py-1 text-muted">
              query: {result.query ?? result.correlation_id}
            </span>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted">No log lines matched this query.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-surface-strong p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                  Observed path
                </p>
                <PathGraph path={path} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((filter) => {
                    const active = eventFilter === filter.value;
                    return (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => setEventFilter(filter.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          active
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-line bg-surface text-muted hover:border-accent"
                        }`}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={showRaw}
                    onChange={(event) => setShowRaw(event.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  Raw log lines
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-3">
                  {filteredItems.map((item, index) => {
                    const elapsed = elapsedFrom(firstTimestamp, item.timestamp);
                    const formattedJson = formattedJsonFromLine(item.line);
                    return (
                      <article
                        key={`${item.id}-${index}`}
                        className="relative rounded-xl border border-line bg-surface-strong p-3 pl-5"
                      >
                        <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r bg-accent/70" />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-muted">
                            #{index + 1} {formatTime(item.timestamp)}
                          </span>
                          {elapsed && (
                            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
                              {elapsed}
                            </span>
                          )}
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              EVENT_CLASS[item.event_type] ?? EVENT_CLASS.log
                            }`}
                          >
                            {EVENT_LABEL[item.event_type] ?? item.event_type}
                          </span>
                          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">
                            {item.confidence}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="font-mono text-sm font-semibold text-foreground">
                            {workloadId(item)}
                          </h3>
                          <span className="font-mono text-[11px] text-muted">{item.source}</span>
                        </div>

                        {item.target && (
                          <p className="mt-1 font-mono text-xs text-accent">
                            target: {item.target}
                          </p>
                        )}
                        {(item.trace_id || item.span_id) && (
                          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
                            {item.trace_id && (
                              <span className="rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-sky-200">
                                trace: {item.trace_id}
                              </span>
                            )}
                            {item.span_id && (
                              <span className="rounded-md border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-violet-200">
                                span: {item.span_id}
                              </span>
                            )}
                          </div>
                        )}

                        <p className="mt-2 text-sm leading-relaxed text-foreground">
                          {summarizeLine(item.line)}
                        </p>

                        {showRaw && (
                          <div className="mt-3 rounded-lg border border-line bg-background">
                            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                              <span className="text-[10px] text-muted">
                                {formattedJson
                                  ? "Formatted JSON with embedded JSON decoded"
                                  : "Raw log line"}
                              </span>
                              {formattedJson && (
                                <CopyButton value={formattedJson} label="Copy formatted" />
                              )}
                              <CopyButton value={item.line} label="Copy raw" />
                            </div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-muted">
                              {formattedJson ?? highlight(item.line, query.trim())}
                            </pre>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <aside className="space-y-3">
                  <div className="rounded-xl border border-line bg-surface-strong p-3">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                      Trace stack
                    </p>
                    <TraceStack spans={traceStack} />
                  </div>

                  <div className="rounded-xl border border-line bg-surface-strong p-3">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                      Signals
                    </p>
                    {targets.length === 0 ? (
                      <p className="text-xs text-muted">No HTTP/Kafka targets found in matching logs.</p>
                    ) : (
                      <div className="space-y-2">
                        {targets.slice(0, 12).map((target, index) => (
                          <div key={`${target.source}-${target.target}-${index}`} className="text-xs">
                            <div className="font-mono text-foreground">{target.source}</div>
                            <div className="break-words font-mono text-accent">{target.target}</div>
                            <div className="text-muted">
                              {EVENT_LABEL[target.eventType] ?? target.eventType} · {target.confidence}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-line bg-surface-strong p-3">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                      Inferred edges
                    </p>
                    {edges.length === 0 ? (
                      <p className="text-xs text-muted">No edges inferred from the matching logs.</p>
                    ) : (
                      <div className="space-y-2">
                        {edges.map((edge) => (
                          <div
                            key={`${edge.source}-${edge.target}-${edge.edge_type}`}
                            className="border-b border-line pb-2 text-xs last:border-0 last:pb-0"
                          >
                            <div className="font-mono text-foreground">{edge.source}</div>
                            <div className="break-words font-mono text-muted">
                              {`-> ${edge.target}`}
                              <span className="ml-1 text-accent">x{edge.count}</span>
                            </div>
                            <div className="text-muted">{edge.edge_type}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
