import { useState } from "react";

import type { WorkloadItem, WorkloadSpec } from "@/types/monitor";

type SpecTabProps = {
  loadingSpec: boolean;
  selectedWorkload: WorkloadItem | null;
  workloadSpec: WorkloadSpec | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "-";
}

type ViewMode = "resource" | "json";

export function SpecTab({ loadingSpec, selectedWorkload, workloadSpec }: SpecTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("resource");

  if (loadingSpec) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <p className="text-sm text-muted">Loading spec...</p>
      </div>
    );
  }

  if (!selectedWorkload) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <p className="text-sm text-muted">Select a workload to see spec</p>
      </div>
    );
  }

  if (!workloadSpec) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <p className="text-sm text-muted">No spec available</p>
      </div>
    );
  }

  const root = asRecord(workloadSpec.spec ?? {});
  const template = asRecord(root.template);
  const podSpec = asRecord(template.spec);

  const replicasValue = root.replicas;
  const replicas = typeof replicasValue === "number" ? String(replicasValue) : "-";

  const images = asArray<Record<string, unknown>>(podSpec.containers)
    .map((container) => asString(container.image))
    .filter((image) => image !== "-");

  const containerResources = asArray<Record<string, unknown>>(podSpec.containers).map(
    (container, index) => {
      const resources = asRecord(container.resources);
      const name = asString(container.name) === "-" ? `container-${index + 1}` : asString(container.name);

      return {
        name,
        requests: asRecord(resources.requests),
        limits: asRecord(resources.limits),
      };
    }
  );

  const imageText = images.length > 0 ? Array.from(new Set(images)).join(", ") : "-";
  const pretty = JSON.stringify(workloadSpec.spec ?? {}, null, 2);

  return (
    <div className="mt-4 min-h-0 flex-1 overflow-auto">
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <div className="inline-flex rounded-full border border-line bg-surface p-1 text-xs">
            <button
              className={`rounded-full px-3 py-1 transition ${
                viewMode === "resource"
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
              onClick={() => setViewMode("resource")}
            >
              Resource
            </button>
            <button
              className={`rounded-full px-3 py-1 transition ${
                viewMode === "json"
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
              onClick={() => setViewMode("json")}
            >
              JSON
            </button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-line/80 bg-surface/30 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">namespace</p>
            <p className="mt-1 break-all font-mono text-xs text-foreground/90">{workloadSpec.namespace}</p>
          </div>
          <div className="rounded-xl border border-line/80 bg-surface/30 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">replica</p>
            <p className="mt-1 break-all font-mono text-xs text-foreground/90">{replicas}</p>
          </div>
          <div className="rounded-xl border border-line/80 bg-surface/30 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">image</p>
            <p className="mt-1 break-all font-mono text-xs text-foreground/90">{imageText}</p>
          </div>
        </div>

        {viewMode === "resource" ? (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted">resource</p>
            <div className="space-y-2">
              {containerResources.length === 0 ? (
                <div className="rounded-2xl border border-line bg-surface/20 p-4">
                  <p className="text-xs text-muted">No container resource found</p>
                </div>
              ) : (
                containerResources.map((item) => (
                  <div key={item.name} className="rounded-2xl border border-line bg-surface/20 p-3">
                    <p className="mb-2 font-mono text-xs text-foreground/90">{item.name}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-xl border border-line/80 bg-[#0d1118] p-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted">requests</p>
                        <pre className="mt-1 overflow-auto font-mono text-[11px] text-foreground/90">
{JSON.stringify(item.requests, null, 2)}
                        </pre>
                      </div>
                      <div className="rounded-xl border border-line/80 bg-[#0d1118] p-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted">limits</p>
                        <pre className="mt-1 overflow-auto font-mono text-[11px] text-foreground/90">
{JSON.stringify(item.limits, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted">json</p>
            <pre className="max-h-full overflow-auto rounded-2xl border border-line bg-[#0d1118] p-4 font-mono text-[11px] leading-5 text-foreground/90">
              {pretty}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
