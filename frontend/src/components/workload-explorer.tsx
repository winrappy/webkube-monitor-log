import type { NamespaceItem, WorkloadItem } from "@/types/monitor";

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

function kindGlyph(kind: string): string {
  if (kind === "StatefulSet") return "S";
  if (kind === "DaemonSet") return "D";
  return "D";
}

export function WorkloadExplorer({
  currentWorkloadPage,
  displayedWorkloads,
  filteredNamespaces,
  filteredWorkloads,
  loadingNamespaces,
  loadingWorkloads,
  namespaceSearch,
  selectedNamespace,
  selectedWorkload,
  setNamespaceSearch,
  setSelectedNamespace,
  setSelectedWorkload,
  setWorkloadPage,
  setWorkloadSearch,
  totalWorkloadPages,
  workloadSearch,
}: WorkloadExplorerProps) {
  return (
    <aside
      style={{
        gridArea: "sidebar",
        background: "var(--ds-bg-1)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Namespace section */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={sectionLabelStyle}>
          Namespace
          <span style={countBadgeStyle}>{filteredNamespaces.length}</span>
        </div>

        <input
          style={inputStyle}
          placeholder="Search namespaces…"
          value={namespaceSearch}
          onChange={(e) => setNamespaceSearch(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ds-mint-d)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
        />

        <div
          className="ide-scroll"
          style={{ maxHeight: 160, overflowY: "auto" }}
        >
          {loadingNamespaces ? (
            <div style={emptyStyle}>Loading…</div>
          ) : filteredNamespaces.length === 0 ? (
            <div style={emptyStyle}>No namespaces matched.</div>
          ) : (
            filteredNamespaces.map((ns) => {
              const active = selectedNamespace === ns.name;
              return (
                <div
                  key={ns.name}
                  onClick={() => {
                    setSelectedNamespace(ns.name);
                    setWorkloadPage(() => 1);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    paddingLeft: active ? 6 : 8,
                    borderRadius: 5,
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: active ? "var(--ds-mint)" : "var(--muted)",
                    background: active ? "var(--ds-mint-bg)" : "transparent",
                    position: "relative",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--ds-bg-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                  }}
                >
                  {active && (
                    <div
                      style={{
                        position: "absolute",
                        left: -12,
                        top: 4,
                        bottom: 4,
                        width: 2,
                        background: "var(--ds-mint)",
                        borderRadius: 1,
                      }}
                    />
                  )}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ns.name}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Workload section */}
      <div
        style={{
          padding: "10px 12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={sectionLabelStyle}>
          Workloads
          <span style={countBadgeStyle}>{filteredWorkloads.length}</span>
        </div>

        <input
          style={inputStyle}
          placeholder="Filter workloads…"
          value={workloadSearch}
          onChange={(e) => {
            setWorkloadSearch(e.target.value);
            setWorkloadPage(() => 1);
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ds-mint-d)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
        />

        <div className="ide-scroll" style={{ flex: 1, overflowY: "auto" }}>
          {loadingWorkloads ? (
            <div style={emptyStyle}>Loading…</div>
          ) : filteredWorkloads.length === 0 ? (
            <div style={emptyStyle}>No workloads found.</div>
          ) : (
            displayedWorkloads.map((w) => {
              const active = selectedWorkload?.name === w.name;
              return (
                <div
                  key={`${w.kind}-${w.name}`}
                  onClick={() => setSelectedWorkload(w)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "16px 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "5px 8px",
                    borderRadius: 5,
                    cursor: "pointer",
                    background: active ? "var(--ds-bg-3)" : "transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--ds-bg-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      display: "grid",
                      placeItems: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      borderRadius: 3,
                      color: active ? "var(--ds-mint)" : "var(--ds-text-2)",
                      background: active ? "var(--ds-mint-bg)" : "var(--ds-bg-3)",
                      border: `1px solid ${active ? "var(--ds-mint-d)" : "var(--line)"}`,
                    }}
                    title={w.kind}
                  >
                    {kindGlyph(w.kind)}
                  </span>

                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--foreground)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {w.name}
                  </span>

                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--ds-text-2)",
                    }}
                  >
                    {w.kind === "StatefulSet"
                      ? "sts"
                      : w.kind === "DaemonSet"
                        ? "ds"
                        : "dep"}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {totalWorkloadPages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 0",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--ds-text-3)",
              }}
            >
              {currentWorkloadPage}/{totalWorkloadPages}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setWorkloadPage((p) => Math.max(p - 1, 1))}
                disabled={currentWorkloadPage === 1}
                style={paginateButtonStyle}
              >
                ‹
              </button>
              <button
                onClick={() =>
                  setWorkloadPage((p) => Math.min(p + 1, totalWorkloadPages))
                }
                disabled={currentWorkloadPage === totalWorkloadPages}
                style={paginateButtonStyle}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom hint */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div style={sectionLabelStyle}>Keys</div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--ds-text-2)",
            lineHeight: 1.7,
            marginTop: 4,
          }}
        >
          <Kbd>1</Kbd> tail &nbsp; <Kbd>2</Kbd> trace
        </div>
      </div>
    </aside>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--ds-text-3)",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const countBadgeStyle: React.CSSProperties = {
  background: "var(--ds-bg-3)",
  color: "var(--ds-text-2)",
  padding: "1px 5px",
  borderRadius: 3,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 28,
  background: "var(--ds-bg-2)",
  border: "1px solid var(--line)",
  color: "var(--foreground)",
  borderRadius: 6,
  padding: "0 10px",
  fontFamily: "inherit",
  fontSize: 12,
  outline: "none",
  transition: "border-color 0.12s",
};

const emptyStyle: React.CSSProperties = {
  color: "var(--ds-text-3)",
  fontSize: 12,
  padding: "10px 8px",
  textAlign: "center",
};

const paginateButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "grid",
  placeItems: "center",
  background: "var(--ds-bg-2)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 14,
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        background: "var(--ds-bg-3)",
        border: "1px solid var(--ds-line-2)",
        color: "var(--muted)",
      }}
    >
      {children}
    </span>
  );
}
