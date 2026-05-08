"use client";

import { useState } from "react";

import { WORKLOADS_PER_PAGE } from "@/constants/monitor";
import { AppTopbar } from "@/components/app-topbar";
import { InspectorPanel } from "@/components/inspector-panel";
import { WorkloadDetails, type ViewMode } from "@/components/workload-details";
import { WorkloadExplorer } from "@/components/workload-explorer";
import { useMonitorData } from "@/hooks/use-monitor-data";
import { useTheme } from "@/hooks/use-theme";

export default function Home() {
  const monitor = useMonitorData();
  const { theme, toggle } = useTheme();

  const [viewMode, setViewMode] = useState<ViewMode>("tail");
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);

  return (
    <div className="ide-app">
      {/* Top bar */}
      <AppTopbar
        contextInfo={monitor.contextInfo}
        selectedContext={monitor.selectedContext}
        setSelectedContext={monitor.setSelectedContext}
        namespaces={monitor.namespaces}
        workloads={monitor.workloads}
        setSelectedNamespace={monitor.setSelectedNamespace}
        setSelectedWorkload={monitor.setSelectedWorkload}
        theme={theme}
        onToggleTheme={toggle}
      />

      {/* Left sidebar — namespace + workload tree */}
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

      {/* Main canvas — mode bar + stats + switchable view */}
      <WorkloadDetails
        customEnd={monitor.customEnd}
        customStart={monitor.customStart}
        error={monitor.error}
        expandedLogRows={monitor.expandedLogRows}
        filteredWorkloadsCount={monitor.filteredWorkloads.length}
        loadingLogs={monitor.loadingLogs}
        namespace={monitor.selectedNamespace}
        parsedLogs={monitor.parsedLogs}
        podStatuses={monitor.podStatuses}
        search={monitor.search}
        selectedContext={monitor.selectedContext}
        selectedLogIndex={selectedLogIndex}
        selectedWorkload={monitor.selectedWorkload}
        setCustomEnd={monitor.setCustomEnd}
        setCustomStart={monitor.setCustomStart}
        setExpandedLogRows={monitor.setExpandedLogRows}
        setSearch={monitor.setSearch}
        setSelectedLogIndex={setSelectedLogIndex}
        setSinceMinutes={monitor.setSinceMinutes}
        setTimeMode={monitor.setTimeMode}
        setViewMode={setViewMode}
        sinceMinutes={monitor.sinceMinutes}
        timeMode={monitor.timeMode}
        viewMode={viewMode}
        fetchLogs={monitor.fetchLogs}
      />

      {/* Right inspector panel */}
      <InspectorPanel
        selectedWorkload={monitor.selectedWorkload}
        podStatuses={monitor.podStatuses}
        loadingPodStatus={monitor.loadingPodStatus}
        parsedLogs={monitor.parsedLogs}
        selectedLogIndex={selectedLogIndex}
        envVars={monitor.envVars}
        envByContainer={monitor.envByContainer}
        loadingEnv={monitor.loadingEnv}
      />
    </div>
  );
}
