import type { EnvVar, WorkloadItem } from "@/types/monitor";

type EnvGroup = {
  groupKey: string;
  items: Array<{
    fullName: string;
    subgroupKey: string;
    suffix: string;
    value: string;
  }>;
};

type EnvSubgroupItems = Record<string, EnvGroup["items"]>;

function groupEnvVars(vars: EnvVar[]): EnvGroup[] {
  const grouped = new Map<string, EnvGroup["items"]>();

  vars.forEach((entry) => {
    const parts = entry.name.split("_").filter(Boolean);
    const groupKey = parts[0] ?? "UNGROUPED";
    const suffix = parts.length > 1 ? parts[parts.length - 1] : entry.name;
    const subgroupKey =
      parts.length > 2 ? parts.slice(1, -1).join("_") : parts.length === 2 ? parts[1] : "GENERAL";
    const existing = grouped.get(groupKey);

    if (existing) {
      existing.push({ fullName: entry.name, subgroupKey, suffix, value: entry.value });
      return;
    }

    grouped.set(groupKey, [{ fullName: entry.name, subgroupKey, suffix, value: entry.value }]);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      if (left === "UNGROUPED") {
        return 1;
      }

      if (right === "UNGROUPED") {
        return -1;
      }

      return left.localeCompare(right);
    })
    .map(([groupKey, items]) => ({
      groupKey,
      items: items.sort((left, right) => left.fullName.localeCompare(right.fullName)),
    }));
}

type EnvTabProps = {
  envByContainer: Map<string, EnvVar[]>;
  envVars: EnvVar[];
  loadingEnv: boolean;
  selectedWorkload: WorkloadItem | null;
};

export function EnvTab({
  envByContainer,
  envVars,
  loadingEnv,
  selectedWorkload,
}: EnvTabProps) {
  if (loadingEnv) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (!selectedWorkload) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <p className="text-sm text-muted">
          Select a workload to see environment variables
        </p>
      </div>
    );
  }

  if (envVars.length === 0) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <p className="text-sm text-muted">No environment variables defined in pod spec</p>
      </div>
    );
  }

  return (
    <div className="mt-4 min-h-0 flex-1 overflow-auto">
      <div className="space-y-4">
        {Array.from(envByContainer.entries()).map(([container, vars]) => (
          <div key={container}>
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-accent">{container}</p>
            <div className="space-y-3">
              {groupEnvVars(vars).map((group) => (
                <details
                  key={`${container}-${group.groupKey}`}
                  className="overflow-hidden rounded-2xl border border-line bg-surface/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-strong">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-semibold text-foreground">
                        {group.groupKey === "UNGROUPED" ? "Ungrouped" : group.groupKey}
                      </p>
                      <p className="text-xs text-muted">
                        {group.items.length} variable{group.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-2 py-1 text-[10px] font-semibold text-muted">
                      expand
                    </span>
                  </summary>

                  <div className="space-y-3 border-t border-line p-3">
                    {Object.entries(
                      group.items.reduce<EnvSubgroupItems>((accumulator, item) => {
                        if (!accumulator[item.subgroupKey]) {
                          accumulator[item.subgroupKey] = [];
                        }

                        accumulator[item.subgroupKey].push(item);
                        return accumulator;
                      }, {})
                    )
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([subgroupKey, subgroupItems]) => {
                        const isLeafLevel = subgroupItems.every(
                          (item) => item.subgroupKey === item.suffix
                        );

                        if (isLeafLevel) {
                          return subgroupItems.map((item) => (
                            <div
                              key={item.fullName}
                              className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface/40 px-4 py-3"
                            >
                              <p className="min-w-0 break-all font-mono text-[11px] font-semibold text-foreground/90">
                                {item.suffix}
                              </p>
                              <p className="min-w-0 break-all text-right font-mono text-[11px] text-foreground/70">
                                {item.value}
                              </p>
                            </div>
                          ));
                        }

                        return (
                          <details
                            key={`${group.groupKey}-${subgroupKey}`}
                            className="overflow-hidden rounded-2xl border border-line bg-surface/40"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-strong">
                              <div className="min-w-0">
                                <p className="font-mono text-[11px] font-semibold text-foreground/90">
                                  {subgroupKey}
                                </p>
                                <p className="text-xs text-muted">
                                  {subgroupItems.length} value{subgroupItems.length === 1 ? "" : "s"}
                                </p>
                              </div>
                              <span className="rounded-full border border-line px-2 py-1 text-[10px] font-semibold text-muted">
                                expand
                              </span>
                            </summary>

                            <div className="overflow-auto border-t border-line">
                              <table className="w-full font-mono text-[11px]">
                                <thead>
                                  <tr className="border-b border-line bg-surface-strong/60">
                                    <th className="w-[35%] px-4 py-2 text-left font-semibold text-muted">
                                      NAME
                                    </th>
                                    <th className="px-4 py-2 text-left font-semibold text-muted">
                                      VALUE
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                  {subgroupItems.map((item) => (
                                    <tr
                                      key={item.fullName}
                                      className="transition-colors hover:bg-surface-strong"
                                    >
                                      <td className="break-all px-4 py-2 text-foreground/90">
                                        {item.suffix}
                                      </td>
                                      <td className="break-all px-4 py-2 text-foreground/70">
                                        {item.value}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        );
                      })}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
