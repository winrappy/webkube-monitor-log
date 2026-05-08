"use client";

import type { ContextInfo, NamespaceItem, WorkloadItem } from "@/types/monitor";
import { GlobalSearch } from "./global-search";

type Props = {
  contextInfo: ContextInfo | null;
  selectedContext: string;
  setSelectedContext: (v: string) => void;
  namespaces: NamespaceItem[];
  workloads: WorkloadItem[];
  setSelectedNamespace: (v: string) => void;
  setSelectedWorkload: (v: WorkloadItem) => void;
  theme: string;
  onToggleTheme: () => void;
};

export function AppTopbar({
  contextInfo,
  selectedContext,
  setSelectedContext,
  namespaces,
  workloads,
  setSelectedNamespace,
  setSelectedWorkload,
  theme,
  onToggleTheme,
}: Props) {
  const projectLabel = contextInfo?.gcloud_project ?? "";

  return (
    <header
      style={{
        gridArea: "topbar",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px",
        background: "var(--ds-bg-1)",
        borderBottom: "1px solid var(--line)",
        height: 44,
        flexShrink: 0,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingRight: 12,
          borderRight: "1px solid var(--line)",
          height: "100%",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "linear-gradient(135deg, var(--ds-mint) 0%, var(--ds-mint-d) 100%)",
            display: "grid",
            placeItems: "center",
            color: "#06231a",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          kw
        </div>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: "-0.01em",
            color: "var(--foreground)",
          }}
        >
          Kubeweb
        </span>
        <span
          style={{ color: "var(--ds-text-3)", fontWeight: 400, fontSize: 13 }}
        >
          Log Monitor
        </span>
      </div>

      {/* Context pill */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px 4px 6px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 999,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          flexShrink: 0,
          maxWidth: 320,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--ds-mint)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            background: "var(--ds-bg-3)",
            padding: "2px 6px",
            borderRadius: 4,
            color: "var(--foreground)",
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {projectLabel ? "gke" : "ctx"}
        </span>
        <select
          style={{
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            outline: "none",
            cursor: "pointer",
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          value={selectedContext}
          onChange={(e) => setSelectedContext(e.target.value)}
        >
          {contextInfo?.contexts?.length ? (
            contextInfo.contexts.map((ctx) => (
              <option key={ctx} value={ctx}>
                {ctx}
              </option>
            ))
          ) : (
            <option value={selectedContext}>{selectedContext || "unknown"}</option>
          )}
        </select>
        {projectLabel ? (
          <>
            <span style={{ color: "var(--ds-text-3)", flexShrink: 0 }}>·</span>
            <span
              style={{
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
              }}
            >
              {projectLabel}
            </span>
          </>
        ) : null}
      </div>

      {/* Global search */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 440 }}>
        <GlobalSearch
          namespaces={namespaces}
          workloads={workloads}
          setSelectedNamespace={setSelectedNamespace}
          setSelectedWorkload={setSelectedWorkload}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggleTheme}
          title="Toggle theme"
          style={{
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 6,
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 14,
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--line)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "transparent")
          }
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #1e293b, #334155)",
            border: "1px solid var(--ds-line-2)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            color: "var(--foreground)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          K
        </div>
      </div>
    </header>
  );
}
