import type { NamespaceItem, WorkloadItem } from "@/types/monitor";
import { workloadKindLabel } from "@/utils/monitor";

type WorkloadExplorerProps = {
  namespaceSearch: string;
  setNamespaceSearch: (value: string) => void;
  namespaceSuggestions: NamespaceItem[];
  selectedNamespace: string;
  setSelectedNamespace: (value: string) => void;
  filteredNamespaces: NamespaceItem[];
  loadingNamespaces: boolean;
  workloadSearch: string;
  setWorkloadSearch: (value: string) => void;
  loadingWorkloads: boolean;
  filteredWorkloads: WorkloadItem[];
  displayedWorkloads: WorkloadItem[];
  selectedWorkload: WorkloadItem | null;
  setSelectedWorkload: (value: WorkloadItem | null) => void;
  currentWorkloadPage: number;
  totalWorkloadPages: number;
  setWorkloadPage: (updater: (previous: number) => number) => void;
  workloadsPerPage: number;
};

export function WorkloadExplorer({
  currentWorkloadPage,
  displayedWorkloads,
  filteredNamespaces,
  filteredWorkloads,
  loadingNamespaces,
  loadingWorkloads,
  namespaceSearch,
  namespaceSuggestions,
  selectedNamespace,
  selectedWorkload,
  setNamespaceSearch,
  setSelectedNamespace,
  setSelectedWorkload,
  setWorkloadPage,
  setWorkloadSearch,
  totalWorkloadPages,
  workloadSearch,
  workloadsPerPage,
}: WorkloadExplorerProps) {
  return (
    <section className="glass-panel grid-lines rounded-3xl p-6">
      <h2 className="text-lg font-semibold">Workload Explorer</h2>
      <p className="mt-2 text-sm text-muted">
        Select a namespace and workload to fetch pod logs from the cluster
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <label className="text-xs uppercase tracking-[0.25em] text-muted">
            Namespace
          </label>
          <input
            className="w-full rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none transition focus:border-accent"
            placeholder="Search namespace"
            value={namespaceSearch}
            onChange={(event) => setNamespaceSearch(event.target.value)}
          />

          {namespaceSuggestions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {namespaceSuggestions.map((item) => (
                <button
                  key={`ns-suggest-${item.name}`}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    selectedNamespace === item.name
                      ? "border-accent bg-chip text-foreground"
                      : "border-line bg-surface text-muted hover:border-accent hover:text-foreground"
                  }`}
                  onClick={() => {
                    setSelectedNamespace(item.name);
                    setWorkloadPage(() => 1);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rounded-2xl border border-line bg-surface px-4 py-2">
            {loadingNamespaces ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : (
              <>
                <select
                  className="w-full bg-transparent text-sm outline-none"
                  value={selectedNamespace}
                  onChange={(event) => {
                    setSelectedNamespace(event.target.value);
                    setWorkloadPage(() => 1);
                  }}
                >
                  {filteredNamespaces.length > 0 ? (
                    filteredNamespaces.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>
                      No namespace matched
                    </option>
                  )}
                </select>
                {namespaceSearch.trim() && filteredNamespaces.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">No namespace matched search text</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-xs uppercase tracking-[0.25em] text-muted">
            Workload
          </label>
          <input
            className="w-full rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none transition focus:border-accent"
            placeholder="Search workload"
            value={workloadSearch}
            onChange={(event) => {
              setWorkloadSearch(event.target.value);
              setWorkloadPage(() => 1);
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loadingWorkloads ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : filteredWorkloads.length === 0 ? (
              <p className="text-sm text-muted">No workloads found</p>
            ) : (
              displayedWorkloads.map((item) => (
                <button
                  key={`${item.kind}-${item.name}`}
                  onClick={() => setSelectedWorkload(item)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedWorkload?.name === item.name
                      ? "border-accent bg-chip text-foreground"
                      : "border-line bg-surface text-muted hover:border-accent"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">{item.name}</p>
                  {workloadKindLabel(item.kind) ? (
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">
                      {workloadKindLabel(item.kind)}
                    </p>
                  ) : null}
                </button>
              ))
            )}
          </div>

          {filteredWorkloads.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                Showing {(currentWorkloadPage - 1) * workloadsPerPage + 1}-
                {Math.min(currentWorkloadPage * workloadsPerPage, filteredWorkloads.length)} of{" "}
                {filteredWorkloads.length} workloads
              </p>

              {totalWorkloadPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setWorkloadPage((previous) => Math.max(previous - 1, 1))}
                    disabled={currentWorkloadPage === 1}
                  >
                    Prev
                  </button>
                  <span className="text-xs text-muted">
                    {currentWorkloadPage}/{totalWorkloadPages}
                  </span>
                  <button
                    className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      setWorkloadPage((previous) =>
                        Math.min(previous + 1, totalWorkloadPages)
                      )
                    }
                    disabled={currentWorkloadPage === totalWorkloadPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
