import type { EnvVar, WorkloadItem } from "@/types/monitor";

type ValueKind = "secret" | "configmap" | "fieldref" | "ref" | "plain";
type EnvItem = { fullName: string; value: string };
type EnvSubgroup = { subKey: string; items: EnvItem[] };
type EnvGroup = { groupKey: string; subgroups: EnvSubgroup[] };

function classifyValue(value: string): ValueKind {
  if (value.startsWith("(secret:")) return "secret";
  if (value.startsWith("(configMap:")) return "configmap";
  if (value === "(fieldRef)") return "fieldref";
  if (value === "(valueFrom)") return "ref";
  return "plain";
}

const VALUE_CLASS: Record<ValueKind, string> = {
  secret: "text-amber-300/90",
  configmap: "text-sky-300/90",
  fieldref: "text-violet-300/80",
  ref: "text-violet-300/80",
  plain: "text-emerald-300/90",
};

const VALUE_BADGE: Record<ValueKind, string | null> = {
  secret: "secret",
  configmap: "cm",
  fieldref: "field",
  ref: "ref",
  plain: null,
};

const BADGE_CLASS: Record<ValueKind, string> = {
  secret: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  configmap: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  fieldref: "border-violet-400/30 bg-violet-500/10 text-violet-300",
  ref: "border-violet-400/30 bg-violet-500/10 text-violet-300",
  plain: "",
};

function groupEnvVars(vars: EnvVar[]): EnvGroup[] {
  const grouped = new Map<string, Map<string, EnvItem[]>>();

  for (const entry of vars) {
    const parts = entry.name.split("_").filter(Boolean);
    const groupKey = parts[0] ?? "OTHER";
    const subKey = parts.length > 2
      ? parts.slice(1, -1).join("_")
      : parts.length === 2
        ? parts[1]
        : "__leaf__";

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, new Map());
    }

    const subgroupMap = grouped.get(groupKey)!;
    if (!subgroupMap.has(subKey)) {
      subgroupMap.set(subKey, []);
    }

    subgroupMap.get(subKey)!.push({
      fullName: entry.name,
      value: entry.value,
    });
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupKey, subgroupMap]) => ({
      groupKey,
      subgroups: Array.from(subgroupMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subKey, items]) => ({
          subKey,
          items: items.sort((a, b) => a.fullName.localeCompare(b.fullName)),
        })),
    }));
}

function EnvRow({ item }: { item: EnvItem }) {
  const kind = classifyValue(item.value);
  const badge = VALUE_BADGE[kind];

  return (
    <div className="flex min-w-0 items-baseline gap-2 border-b border-[#1a2236] px-2 py-0.5 last:border-b-0 hover:bg-[#1a2236]/60">
      <span className="w-[42%] shrink-0 break-all font-mono text-[11px] font-semibold text-foreground/78">
        {item.fullName}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {badge && (
          <span className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wider ${BADGE_CLASS[kind]}`}>
            {badge}
          </span>
        )}
        <span className={`break-all font-mono text-[11px] ${VALUE_CLASS[kind]}`}>
          {item.value || <span className="italic text-muted/60">empty</span>}
        </span>
      </span>
    </div>
  );
}

function SubgroupBlock({ sub, singleSub }: { sub: EnvSubgroup; singleSub: boolean }) {
  if (singleSub || sub.subKey === "__leaf__") {
    return (
      <div>
        {sub.items.map((item) => (
          <EnvRow key={item.fullName} item={item} />
        ))}
      </div>
    );
  }

  return (
    <details className="group/sub">
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-[#1a2236] bg-[#131b28] px-3 py-1 hover:bg-[#19243a]">
        <svg className="size-3 shrink-0 text-muted/50 transition-transform group-open/sub:rotate-90" viewBox="0 0 6 10" fill="currentColor">
          <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-mono text-[10px] font-semibold text-sky-300/85">{sub.subKey}</span>
        <span className="ml-auto font-mono text-[9px] text-muted/50">{sub.items.length}</span>
      </summary>
      <div>
        {sub.items.map((item) => (
          <EnvRow key={item.fullName} item={item} />
        ))}
      </div>
    </details>
  );
}

function GroupBlock({ group }: { group: EnvGroup }) {
  const totalItems = group.subgroups.reduce((n, s) => n + s.items.length, 0);
  const singleSub = group.subgroups.length === 1;

  return (
    <details className="group/g overflow-hidden rounded-lg border border-[#243043]">
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-[#0f1d20] px-3 py-1.5 hover:bg-[#152628]">
        <svg className="size-3 shrink-0 text-accent/60 transition-transform group-open/g:rotate-90" viewBox="0 0 6 10" fill="currentColor">
          <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-accent/90">
          {group.groupKey}
        </span>
        <span className="ml-auto rounded-full border border-[#243043] bg-[#141922] px-2 py-px font-mono text-[9px] text-muted">
          {totalItems}
        </span>
      </summary>
      <div className="bg-[#0d1118]">
        {group.subgroups.map((sub) => (
          <SubgroupBlock key={sub.subKey} sub={sub} singleSub={singleSub} />
        ))}
      </div>
    </details>
  );
}

type EnvTabProps = {
  envByContainer: Map<string, EnvVar[]>;
  envVars: EnvVar[];
  loadingEnv: boolean;
  selectedWorkload: WorkloadItem | null;
};

export function EnvTab({ envByContainer, envVars, loadingEnv, selectedWorkload }: EnvTabProps) {
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
        <p className="text-sm text-muted">Select a workload to see environment variables</p>
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
    <div className="mt-4 min-h-0 flex-1 overflow-auto space-y-3">
      <div className="flex flex-wrap items-center gap-2 pb-0.5">
        <span className="text-[10px] uppercase tracking-widest text-muted">Value type</span>
        {(["plain", "secret", "configmap", "fieldref"] as ValueKind[]).map((kind) => (
          <span key={kind} className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${BADGE_CLASS[kind]}`}>
            {kind === "plain" ? "value" : VALUE_BADGE[kind]}
          </span>
        ))}
      </div>

      {Array.from(envByContainer.entries()).map(([container, vars]) => (
        <div key={container} className="space-y-1.5">
          <div className="flex items-center gap-2 pb-0.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
              {container}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] text-muted">
              {vars.length}
            </span>
          </div>

          <div className="space-y-1">
            {groupEnvVars(vars).map((group) => (
              <GroupBlock key={group.groupKey} group={group} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
