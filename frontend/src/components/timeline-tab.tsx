"use client";

import type { PodTimeline } from "@/types/monitor";

const REASON_ICON: Record<string, string> = {
  Scheduled: "◎",
  Pulling: "↓",
  Pulled: "↓",
  Created: "✦",
  Started: "▶",
  Killing: "■",
  BackOff: "↺",
  OOMKilling: "☠",
  Unhealthy: "⚠",
  FailedMount: "⊗",
  FailedScheduling: "⊗",
  ScalingReplicaSet: "⇅",
  SuccessfulCreate: "✦",
  SuccessfulDelete: "✕",
};

function reasonIcon(reason: string): string {
  return REASON_ICON[reason] ?? "•";
}

function eventColor(eventType: string, reason: string): string {
  if (eventType === "Warning") {
    if (reason === "OOMKilling") return "text-red-400";
    if (reason === "BackOff" || reason === "Unhealthy") return "text-yellow-400";
    return "text-orange-400";
  }
  if (reason === "Started" || reason === "Pulled") return "text-accent";
  if (reason === "ScalingReplicaSet") return "text-purple-400";
  if (reason === "Killing") return "text-muted";
  return "text-muted";
}

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function shortSource(source: string): string {
  const parts = source.split("/");
  const name = parts[parts.length - 1] ?? source;
  return name.length > 30 ? name.slice(0, 28) + "…" : name;
}

type Props = {
  timeline: PodTimeline | null;
  loading: boolean;
};

export function TimelineTab({ timeline, loading }: Props) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <span className="animate-pulse">Loading timeline…</span>
      </div>
    );
  }

  if (!timeline || timeline.events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        No events found for this workload.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Column headers */}
      <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-4 px-1 text-xs uppercase tracking-widest text-muted opacity-60">
        <span>Event</span>
        <span className="text-right">When</span>
        <span className="text-right">×</span>
      </div>

      <ul className="space-y-1">
        {timeline.events.map((ev, i) => {
          const isWarning = ev.event_type === "Warning";
          const color = eventColor(ev.event_type, ev.reason);

          return (
            <li
              key={i}
              className={`group relative rounded-xl border px-4 py-2.5 transition-colors ${
                isWarning
                  ? "border-yellow-900/40 bg-yellow-950/10 hover:bg-yellow-950/20"
                  : "border-line bg-surface/40 hover:bg-surface"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Icon column */}
                <span className={`mt-0.5 font-mono text-sm ${color}`} aria-hidden>
                  {reasonIcon(ev.reason)}
                </span>

                {/* Main content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={`text-sm font-semibold ${color}`}>{ev.reason}</span>
                    <span className="text-xs text-muted opacity-70">{shortSource(ev.source)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted leading-relaxed">{ev.message}</p>
                </div>

                {/* Right column: time + count */}
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted">{formatTimestamp(ev.timestamp)}</p>
                  {ev.count > 1 && (
                    <span
                      className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                        isWarning
                          ? "bg-yellow-900/40 text-yellow-300"
                          : "bg-surface-strong text-muted"
                      }`}
                    >
                      ×{ev.count}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
