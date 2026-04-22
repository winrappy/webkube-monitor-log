import type { ReactNode } from "react";

import {
  LOG_PREVIEW_CHARS,
  PLAIN_LOG_PREVIEW_CHARS,
} from "@/constants/monitor";
import type { ParsedLogLine, WorkloadItem } from "@/types/monitor";
import { escapeRegExp, levelBadgeClass } from "@/utils/monitor";

type LogsTabProps = {
  parsedLogs: ParsedLogLine[];
  selectedWorkload: WorkloadItem | null;
  loadingLogs: boolean;
  search: string;
  expandedLogRows: Record<string, boolean>;
  setExpandedLogRows: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
};

function renderHighlightedText(text: string, searchTerm: string): ReactNode {
  const term = searchTerm.trim();
  if (!term) {
    return text;
  }

  const regex = new RegExp(`(${escapeRegExp(term)})`, "ig");
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.toLowerCase() === term.toLowerCase()) {
      return (
        <mark
          key={`hl-${index}`}
          className="rounded bg-amber-300/30 px-0.5 text-amber-100"
        >
          {part}
        </mark>
      );
    }

    return <span key={`txt-${index}`}>{part}</span>;
  });
}

export function LogsTab({
  expandedLogRows,
  loadingLogs,
  parsedLogs,
  search,
  selectedWorkload,
  setExpandedLogRows,
}: LogsTabProps) {
  return (
    <div className="mt-4 min-h-0 grow-[0.8] overflow-auto rounded-2xl border border-line bg-surface-strong p-4 font-mono text-[10px]">
      {parsedLogs.length === 0 ? (
        <p className="text-muted">
          {!selectedWorkload
            ? "Select a workload to load logs"
            : loadingLogs
              ? "Loading logs..."
              : "No logs available or no matches"}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {parsedLogs.map((item, index) => {
            const rowKey = `${item.entry.source}-${index}`;
            const previewChars = item.isJson ? LOG_PREVIEW_CHARS : PLAIN_LOG_PREVIEW_CHARS;
            const isLongLog = item.oneLine.length > previewChars;
            const isExpanded = Boolean(expandedLogRows[rowKey]);
            const displayLine =
              isLongLog && !isExpanded
                ? `${item.oneLine.slice(0, previewChars)}...`
                : item.oneLine;

            const expandButton = isLongLog ? (
              <button
                type="button"
                className="ml-2 shrink-0 self-start rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-accent"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setExpandedLogRows((previous) => ({
                    ...previous,
                    [rowKey]: !previous[rowKey],
                  }));
                }}
              >
                {isExpanded ? "Collapse" : "Expand"}
              </button>
            ) : null;

            const timeBadge = item.entry.timestamp ? (
              <span className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-foreground/80">
                {new Date(item.entry.timestamp).toLocaleString()}
              </span>
            ) : null;

            const levelBadge = item.level ? (
              <span
                className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] ${levelBadgeClass(
                  item.level
                )}`}
              >
                {item.level}
              </span>
            ) : null;

            return (
              <li key={`${item.entry.source}-${index}`}>
                {item.isJson && item.parsedJson ? (
                  <details className="bg-background/20">
                    <summary className="list-none cursor-pointer px-3 py-[0.54rem]">
                      <div className="flex items-start gap-2 text-[10px] leading-[0.93rem]">
                        {timeBadge}
                        {levelBadge}
                        <span className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-accent">
                          JSON
                        </span>
                        <span className="min-w-0 flex-1 break-all text-foreground">
                          {renderHighlightedText(displayLine, search)}
                        </span>
                        {expandButton}
                      </div>
                    </summary>
                    <pre className="whitespace-pre-wrap border-t border-line px-3 py-3 text-[9px] leading-[0.84rem] text-muted">
                      {JSON.stringify(item.parsedJson, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <div className="bg-background/20 px-3 py-[0.54rem]">
                    <div className="flex items-start gap-2 text-[10px] leading-[0.93rem]">
                      {timeBadge}
                      {levelBadge}
                      <span className="min-w-0 flex-1 break-all text-foreground">
                        {renderHighlightedText(displayLine, search)}
                      </span>
                      {expandButton}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
