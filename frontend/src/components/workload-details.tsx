import { sinceOptions } from "@/constants/monitor";
import type {
  ActiveTab,
  EnvVar,
  ParsedLogLine,
  PodStatusItem,
  TimeMode,
  WorkloadItem,
} from "@/types/monitor";
import {
  podPhaseBadgeClass,
  podReadyBadgeClass,
  podRestartBadgeClass,
  workloadKindLabel,
} from "@/utils/monitor";

import { EnvTab } from "@/components/env-tab";
import { LogsTab } from "@/components/logs-tab";
import { SpecTab } from "@/components/spec-tab";

type WorkloadDetailsProps = {
  activeTab: ActiveTab;
  customEnd: string;
  customStart: string;
  envByContainer: Map<string, EnvVar[]>;
  envVars: EnvVar[];
  error: string | null;
  expandedLogRows: Record<string, boolean>;
  loadingEnv: boolean;
  loadingLogs: boolean;
  loadingPodStatus: boolean;
  parsedLogs: ParsedLogLine[];
  podStatuses: PodStatusItem[];
  search: string;
  selectedWorkload: WorkloadItem | null;
  loadingSpec: boolean;
  workloadSpec: { kind: string; name: string; namespace: string; spec: Record<string, unknown> | null } | null;
  sinceMinutes: number;
  timeMode: TimeMode;
  setActiveTab: (value: ActiveTab) => void;
  setCustomEnd: (value: string) => void;
  setCustomStart: (value: string) => void;
  setExpandedLogRows: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
  setSearch: (value: string) => void;
  setSinceMinutes: (value: number) => void;
  setTimeMode: (updater: (previous: TimeMode) => TimeMode) => void;
  fetchLogs: () => Promise<void>;
};

export function WorkloadDetails({
  activeTab,
  customEnd,
  customStart,
  envByContainer,
  envVars,
  error,
  expandedLogRows,
  fetchLogs,
  loadingEnv,
  loadingLogs,
  loadingPodStatus,
  parsedLogs,
  podStatuses,
  search,
  selectedWorkload,
  loadingSpec,
  workloadSpec,
  setActiveTab,
  setCustomEnd,
  setCustomStart,
  setExpandedLogRows,
  setSearch,
  setSinceMinutes,
  setTimeMode,
  sinceMinutes,
  timeMode,
}: WorkloadDetailsProps) {
  return (
    <section className="glass-panel flex min-h-0 flex-1 flex-col rounded-3xl p-6">
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
            <button
              onClick={() =>
                setTimeMode((mode) => (mode === "preset" ? "custom" : "preset"))
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
                onChange={(event) => setSinceMinutes(Number(event.target.value))}
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
                  <label className="text-[10px] uppercase tracking-[0.2em] text-muted">From</label>
                  <input
                    type="datetime-local"
                    className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent"
                    value={customStart}
                    max={customEnd || undefined}
                    onChange={(event) => setCustomStart(event.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[10px] uppercase tracking-[0.2em] text-muted">To</label>
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
            <span
              className="rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold leading-none text-sky-200"
              title="Sorted latest to oldest"
              aria-label="Sorted latest to oldest"
            >
              Latest -&gt; Oldest
            </span>
          </div>
        ) : null}
      </div>

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
        <button
          onClick={() => setActiveTab("spec")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "spec"
              ? "border-b-2 border-accent text-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          Spec
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {activeTab === "logs" ? (
        <LogsTab
          parsedLogs={parsedLogs}
          selectedWorkload={selectedWorkload}
          loadingLogs={loadingLogs}
          search={search}
          expandedLogRows={expandedLogRows}
          setExpandedLogRows={setExpandedLogRows}
        />
      ) : null}

      {activeTab === "env" ? (
        <EnvTab
          envByContainer={envByContainer}
          envVars={envVars}
          loadingEnv={loadingEnv}
          selectedWorkload={selectedWorkload}
        />
      ) : null}

      {activeTab === "spec" ? (
        <SpecTab
          loadingSpec={loadingSpec}
          selectedWorkload={selectedWorkload}
          workloadSpec={workloadSpec}
        />
      ) : null}
    </section>
  );
}
