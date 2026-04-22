"use client";

import { WORKLOADS_PER_PAGE } from "@/constants/monitor";
import { ContextSelector } from "@/components/context-selector";
import { WorkloadDetails } from "@/components/workload-details";
import { WorkloadExplorer } from "@/components/workload-explorer";
import { useMonitorData } from "@/hooks/use-monitor-data";

export default function Home() {
  const monitor = useMonitorData();

  return (
    <div className="flex min-h-screen flex-col px-6 py-6 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted opacity-80">
            In-cluster Kubernetes
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Kubeweb Log Monitor</h1>
        </div>

        <ContextSelector
          contextInfo={monitor.contextInfo}
          selectedContext={monitor.selectedContext}
          setSelectedContext={monitor.setSelectedContext}
          className="w-full max-w-[420px] rounded-2xl border border-line bg-surface px-4 py-2 sm:ml-auto sm:w-auto"
          selectClassName="mt-1 w-full bg-transparent text-sm font-semibold text-foreground outline-none sm:w-[360px]"
        />
      </header>

      <main
        className="mt-6 flex min-h-0 flex-1 flex-col gap-6"
        style={{ animation: "fadeIn 0.8s ease" }}
      >
        <WorkloadExplorer
          namespaceSearch={monitor.namespaceSearch}
          setNamespaceSearch={monitor.setNamespaceSearch}
          namespaceSuggestions={monitor.namespaceSuggestions}
          selectedNamespace={monitor.selectedNamespace}
          setSelectedNamespace={monitor.setSelectedNamespace}
          filteredNamespaces={monitor.filteredNamespaces}
          loadingNamespaces={monitor.loadingNamespaces}
          workloadSearch={monitor.workloadSearch}
          setWorkloadSearch={monitor.setWorkloadSearch}
          loadingWorkloads={monitor.loadingWorkloads}
          filteredWorkloads={monitor.filteredWorkloads}
          displayedWorkloads={monitor.displayedWorkloads}
          selectedWorkload={monitor.selectedWorkload}
          setSelectedWorkload={monitor.setSelectedWorkload}
          currentWorkloadPage={monitor.currentWorkloadPage}
          totalWorkloadPages={monitor.totalWorkloadPages}
          setWorkloadPage={monitor.setWorkloadPage}
          workloadsPerPage={WORKLOADS_PER_PAGE}
        />

        <WorkloadDetails
          activeTab={monitor.activeTab}
          customEnd={monitor.customEnd}
          customStart={monitor.customStart}
          envByContainer={monitor.envByContainer}
          envVars={monitor.envVars}
          error={monitor.error}
          expandedLogRows={monitor.expandedLogRows}
          loadingEnv={monitor.loadingEnv}
          loadingLogs={monitor.loadingLogs}
          loadingPodStatus={monitor.loadingPodStatus}
          loadingSpec={monitor.loadingSpec}
          parsedLogs={monitor.parsedLogs}
          podStatuses={monitor.podStatuses}
          search={monitor.search}
          selectedWorkload={monitor.selectedWorkload}
          sinceMinutes={monitor.sinceMinutes}
          timeMode={monitor.timeMode}
          workloadSpec={monitor.workloadSpec}
          setActiveTab={monitor.setActiveTab}
          setCustomEnd={monitor.setCustomEnd}
          setCustomStart={monitor.setCustomStart}
          setExpandedLogRows={monitor.setExpandedLogRows}
          setSearch={monitor.setSearch}
          setSinceMinutes={monitor.setSinceMinutes}
          setTimeMode={monitor.setTimeMode}
          fetchLogs={monitor.fetchLogs}
        />
      </main>
    </div>
  );
}
