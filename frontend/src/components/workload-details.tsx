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
          sinceMinutes={sinceMinutes}
          timeMode={timeMode}
          customStart={customStart}
          customEnd={customEnd}
          setExpandedLogRows={setExpandedLogRows}
          setSearch={setSearch}
          setSinceMinutes={setSinceMinutes}
          setTimeMode={setTimeMode}
          setCustomStart={setCustomStart}
          setCustomEnd={setCustomEnd}
          fetchLogs={fetchLogs}
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
