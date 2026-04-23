import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  LOG_PREVIEW_CHARS,
  PLAIN_LOG_PREVIEW_CHARS,
  sinceOptions,
} from "@/constants/monitor";
import type { ParsedLogLine, TimeMode, WorkloadItem } from "@/types/monitor";
import { escapeRegExp, levelBadgeClass } from "@/utils/monitor";

type LogsTabProps = {
  parsedLogs: ParsedLogLine[];
  selectedWorkload: WorkloadItem | null;
  loadingLogs: boolean;
  search: string;
  expandedLogRows: Record<string, boolean>;
  sinceMinutes: number;
  timeMode: TimeMode;
  customStart: string;
  customEnd: string;
  setExpandedLogRows: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
  setSearch: (value: string) => void;
  setSinceMinutes: (value: number) => void;
  setTimeMode: (updater: (previous: TimeMode) => TimeMode) => void;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  fetchLogs: () => Promise<void>;
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
  sinceMinutes,
  timeMode,
  customStart,
  customEnd,
  setExpandedLogRows,
  setSearch,
  setSinceMinutes,
  setTimeMode,
  setCustomStart,
  setCustomEnd,
  fetchLogs,
}: LogsTabProps) {
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of parsedLogs) {
      if (item.isJson) {
        tags.add("json");
      }
      tags.add(item.level?.toLowerCase() ?? "other");
    }
    return [...tags].sort();
  }, [parsedLogs]);

  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(["__all__"])
  );

  // Reset to "all" when available tags change (new workload/log set loaded)
  const availableTagsKey = useMemo(() => allTags.join(","), [allTags]);
  useEffect(() => {
    setSelectedTags(new Set(["__all__"]));
  }, [availableTagsKey]);

  const toggleTag = (tag: string) => {
    if (tag === "__all__") {
      setSelectedTags(new Set(["__all__"]));
      return;
    }
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.delete("__all__");
      if (next.has(tag)) {
        next.delete(tag);
        if (next.size === 0) return new Set(["__all__"]);
      } else {
        next.add(tag);
        if (next.size === allTags.length) return new Set(["__all__"]);
      }
      return next;
    });
  };

  const filteredLogs = useMemo(() => {
    if (selectedTags.has("__all__")) return parsedLogs;
    return parsedLogs.filter((item) => {
      const itemTags = new Set<string>();
      if (item.isJson) {
        itemTags.add("json");
      }
      itemTags.add(item.level?.toLowerCase() ?? "other");

      for (const tag of selectedTags) {
        if (itemTags.has(tag)) {
          return true;
        }
      }
      return false;
    });
  }, [parsedLogs, selectedTags]);

  const showToolbar = true;

  return (
    <div className="mt-4 flex min-h-0 grow-[0.8] flex-col overflow-hidden rounded-2xl border border-line bg-surface-strong font-mono text-[10px]">
      {showToolbar && (
        <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
          {/* Row 1: Latest→Oldest + level filter (left) | time controls + search + refresh (right) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Left: sort badge + level filter */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="shrink-0 rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold leading-none text-sky-200"
                title="Sorted latest to oldest"
              >
                Latest → Oldest
              </span>
              {parsedLogs.length > 0 && (
                <>
                  <span className="text-[10px] text-muted">|</span>
                  <button
                    type="button"
                    onClick={() => toggleTag("__all__")}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                      selectedTags.has("__all__")
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line text-muted hover:border-accent"
                    }`}
                  >
                    All
                  </button>
                  {allTags.map((tag) => {
                    const label = tag === "json" ? "JSON" : tag === "other" ? "Other" : tag.toUpperCase();
                    const active = !selectedTags.has("__all__") && selectedTags.has(tag);
                    const activeClass =
                      tag === "json"
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : tag !== "other"
                          ? levelBadgeClass(tag)
                          : "border-line bg-surface text-foreground";
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                          active ? activeClass : "border-line text-muted hover:border-accent"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* Right: time controls + search + refresh */}
            <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTimeMode((mode) => (mode === "preset" ? "custom" : "preset"))}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                timeMode === "custom"
                  ? "border-accent bg-chip text-accent"
                  : "border-line bg-surface text-muted hover:border-accent"
              }`}
            >
              {timeMode === "preset" ? "Custom range" : "Preset range"}
            </button>

            {timeMode === "preset" ? (
              <select
                className="rounded-full border border-line bg-surface px-4 py-1.5 text-xs outline-none transition focus:border-accent"
                value={sinceMinutes}
                onChange={(event) => setSinceMinutes(Number(event.target.value))}
              >
                {sinceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <label className="text-[10px] uppercase tracking-[0.2em] text-muted">From</label>
                  <input
                    type="datetime-local"
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs outline-none transition focus:border-accent"
                    value={customStart}
                    max={customEnd || undefined}
                    onChange={(event) => setCustomStart(event.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[10px] uppercase tracking-[0.2em] text-muted">To</label>
                  <input
                    type="datetime-local"
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs outline-none transition focus:border-accent"
                    value={customEnd}
                    min={customStart || undefined}
                    onChange={(event) => setCustomEnd(event.target.value)}
                  />
                </div>
              </div>
            )}

            <input
              className="w-48 rounded-full border border-line bg-surface px-4 py-1.5 text-xs outline-none transition focus:border-accent"
              placeholder="Search logs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="rounded-full border border-line px-4 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
              onClick={fetchLogs}
              disabled={loadingLogs || !selectedWorkload}
            >
              {loadingLogs ? "Loading..." : "Refresh"}
            </button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-auto p-4">
      {filteredLogs.length === 0 ? (
        <p className="text-muted">
          {!selectedWorkload
            ? "Select a workload to load logs"
            : loadingLogs
              ? "Loading logs..."
              : "No logs available or no matches"}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {filteredLogs.map((item, index) => {
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
                className="shrink-0 self-start rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-accent"
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

            const jsonToggleIndicator = item.isJson && item.parsedJson ? (
              <span className="shrink-0 self-start rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted transition group-hover:border-accent group-open:border-accent group-open:text-foreground">
                <span className="inline-block transition-transform group-open:rotate-90">▶</span>{" "}
                JSON
              </span>
            ) : null;

            const combinedActions = jsonToggleIndicator && expandButton ? (
              <div className="ml-2 inline-flex shrink-0 self-start overflow-hidden rounded-full border border-line">
                <span className="min-w-[74px] flex-1 px-2 py-0.5 text-center text-[10px] font-semibold text-muted transition group-hover:border-accent group-open:text-foreground">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>{" "}
                  JSON
                </span>
                <span className="border-l border-line" />
                <button
                  type="button"
                  className="min-w-[74px] flex-1 px-2 py-0.5 text-center text-[10px] font-semibold text-muted transition hover:text-foreground"
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
              </div>
            ) : (
              <span className="ml-2 shrink-0 self-start">{jsonToggleIndicator ?? expandButton}</span>
            );

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
                  <details className="group bg-background/20">
                    <summary className="list-none cursor-pointer px-3 py-[0.432rem]">
                      <div className="flex items-start gap-2 text-[10px] leading-[0.744rem]">
                        {timeBadge}
                        {levelBadge}
                        <span className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-accent">
                          JSON
                        </span>
                        <span className="min-w-0 flex-1 break-all text-foreground">
                          {renderHighlightedText(displayLine, search)}
                        </span>
                        {combinedActions}
                      </div>
                    </summary>
                    <pre className="whitespace-pre-wrap border-t border-line px-3 py-3 text-[9px] leading-[0.84rem] text-muted">
                      {JSON.stringify(item.parsedJson, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <div className="bg-background/20 px-3 py-[0.432rem]">
                    <div className="flex items-start gap-2 text-[10px] leading-[0.744rem]">
                      {timeBadge}
                      {levelBadge}
                      <span className="min-w-0 flex-1 break-all text-foreground">
                        {renderHighlightedText(displayLine, search)}
                      </span>
                      {expandButton ? (
                        <span className="ml-2 shrink-0 self-start">{expandButton}</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </div>
  );
}
