"use client";

import type { CrashDiagnostics, PodTimeline, WorkloadItem, WorkloadMetrics } from "@/types/monitor";

import { TimelineTab } from "@/components/timeline-tab";

type Props = {
  diagnostics: CrashDiagnostics | null;
  loadingDiagnostics: boolean;
  loadingMetrics: boolean;
  loadingTimeline: boolean;
  metrics: WorkloadMetrics | null;
  selectedWorkload: WorkloadItem | null;
  timeline: PodTimeline | null;
};

function formatCpu(nano: number): string {
  if (nano >= 1_000_000_000) return `${(nano / 1_000_000_000).toFixed(2)} cores`;
  return `${Math.round(nano / 1_000_000)}m`;
}

function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

function severityClass(severity: string): string {
  if (severity === "critical") return "border-red-400/40 bg-red-500/10 text-red-200";
  if (severity === "warning") return "border-yellow-400/40 bg-yellow-500/10 text-yellow-200";
  return "border-line bg-surface text-muted";
}

export function HealthTab({
  diagnostics,
  loadingDiagnostics,
  loadingMetrics,
  loadingTimeline,
  metrics,
  selectedWorkload,
  timeline,
}: Props) {
  if (!selectedWorkload) {
    return <div className="flex flex-1 items-center justify-center text-muted">Select a workload.</div>;
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <section className="rounded-2xl border border-line bg-surface/50 p-4">
          <h3 className="text-sm font-semibold text-foreground">Metrics</h3>
          {loadingMetrics ? (
            <p className="mt-3 text-sm text-muted">Loading metrics...</p>
          ) : !metrics?.available ? (
            <p className="mt-3 text-sm text-muted">
              {metrics?.message || "Metrics are unavailable. metrics-server may not be installed."}
            </p>
          ) : metrics.items.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No pod metrics found.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-strong text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pod</th>
                    <th className="px-3 py-2 font-medium">Container</th>
                    <th className="px-3 py-2 font-medium">CPU</th>
                    <th className="px-3 py-2 font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.items.map((item) => (
                    <tr key={`${item.pod}/${item.container}`} className="border-t border-line">
                      <td className="px-3 py-2 text-foreground">{item.pod}</td>
                      <td className="px-3 py-2 text-muted">{item.container}</td>
                      <td className="px-3 py-2 text-foreground">{formatCpu(item.cpu_usage_nano)}</td>
                      <td className="px-3 py-2 text-foreground">{formatMemory(item.memory_usage_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface/50 p-4">
          <h3 className="text-sm font-semibold text-foreground">Crash Diagnostics</h3>
          {loadingDiagnostics ? (
            <p className="mt-3 text-sm text-muted">Checking pods...</p>
          ) : !diagnostics || diagnostics.items.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No crash or restart signals found.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {diagnostics.items.map((item, index) => (
                <li
                  key={`${item.pod}/${item.container}/${item.reason}/${index}`}
                  className={`rounded-xl border px-3 py-2 text-xs ${severityClass(item.severity)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.reason}</span>
                    <span>{item.pod}</span>
                    {item.container ? <span>{item.container}</span> : null}
                    {item.restarts > 0 ? <span>restart {item.restarts}</span> : null}
                  </div>
                  {item.message ? <p className="mt-1 text-muted">{item.message}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-surface/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Timeline</h3>
        <TimelineTab timeline={timeline} loading={loadingTimeline} />
      </section>
    </div>
  );
}
