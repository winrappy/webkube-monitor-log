import type { WorkloadKind } from "@/types/monitor";

export function detectLogLevel(data: Record<string, unknown>): string | null {
  const keys = ["level", "logLevel", "log_level", "severity", "lvl"];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

export function levelBadgeClass(level: string): string {
  const upper = level.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FATAL")) {
    return "border-red-400/60 bg-red-500/15 text-red-700 dark:text-red-200";
  }
  if (upper.includes("WARN")) {
    return "border-amber-400/60 bg-amber-500/15 text-amber-700 dark:text-amber-200";
  }
  if (upper.includes("DEBUG") || upper.includes("TRACE")) {
    return "border-sky-400/60 bg-sky-500/15 text-sky-700 dark:text-sky-200";
  }
  return "border-emerald-400/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200";
}

export function podPhaseBadgeClass(phase: string): string {
  const upper = phase.toUpperCase();
  if (upper === "RUNNING") {
    return "border-emerald-400/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200";
  }
  if (upper === "PENDING") {
    return "border-amber-400/60 bg-amber-500/15 text-amber-700 dark:text-amber-200";
  }
  if (upper === "SUCCEEDED") {
    return "border-sky-400/60 bg-sky-500/15 text-sky-700 dark:text-sky-200";
  }
  if (upper === "FAILED") {
    return "border-red-400/60 bg-red-500/15 text-red-700 dark:text-red-200";
  }
  return "border-slate-400/60 bg-slate-500/15 text-slate-600 dark:text-slate-200";
}

export function podReadyBadgeClass(ready: string): string {
  const [readyCount, totalCount] = ready.split("/").map((value) => Number(value));
  const isReady =
    Number.isFinite(readyCount) &&
    Number.isFinite(totalCount) &&
    totalCount > 0 &&
    readyCount >= totalCount;

  return isReady
    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
    : "border-amber-400/60 bg-amber-500/15 text-amber-700 dark:text-amber-200";
}

export function podRestartBadgeClass(restarts: number): string {
  if (restarts > 0) {
    return "border-rose-400/60 bg-rose-500/15 text-rose-700 dark:text-rose-200";
  }
  return "border-slate-400/60 bg-slate-500/15 text-slate-600 dark:text-slate-200";
}

export function workloadKindLabel(kind: WorkloadKind): string {
  return kind === "Deployment" ? "" : kind;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
