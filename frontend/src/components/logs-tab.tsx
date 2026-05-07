"use client";

import { Fragment, useMemo, useState } from "react";
import type { MouseEvent } from "react";

import { sinceOptions } from "@/constants/monitor";
import type { ParsedLogLine, TimeMode, WorkloadItem } from "@/types/monitor";
import {
  escapeRegExp,
  parseLogSearchQuery,
  type FieldSearchToken,
} from "@/utils/monitor";

/* ── Field-filter helpers (unchanged from original) ─────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function directFieldValue(json: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(json, key)) return json[key];
  const wanted = key.toLowerCase();
  const matched = Object.keys(json).find((k) => k.toLowerCase() === wanted);
  return matched ? json[matched] : undefined;
}

function readFieldValue(json: Record<string, unknown>, key: string): unknown {
  const direct = directFieldValue(json, key);
  if (direct !== undefined) return direct;
  const parts = key.split(".").filter(Boolean);
  let current: unknown = json;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const idx = Number(part);
      current = Number.isInteger(idx) ? current[idx] : undefined;
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = directFieldValue(current, part);
  }
  return current;
}

function fieldValueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function matchesFieldFilter(
  json: Record<string, unknown>,
  key: string,
  value: string
): boolean {
  return fieldValueText(readFieldValue(json, key))
    .toLowerCase()
    .includes(value.toLowerCase());
}

function matchesFieldFilters(
  json: Record<string, unknown> | null,
  filters: FieldSearchToken[]
): boolean {
  if (filters.length === 0) return true;
  if (!json) return false;
  return filters.every((f) =>
    matchesFieldFilter(json, f.key.trim(), f.value.trim())
  );
}

/* ── Copy button ─────────────────────────────────────────────────── */

function CopyBtn({
  value,
  label = "copy",
}: {
  value: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        background: "transparent",
        border: "1px solid var(--line)",
        color: "var(--ds-text-2)",
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
        transition: "border-color 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--ds-line-2)";
        (e.currentTarget as HTMLElement).style.color = "var(--foreground)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--line)";
        (e.currentTarget as HTMLElement).style.color = "var(--ds-text-2)";
      }}
    >
      {done ? "✓" : label}
    </button>
  );
}

/* ── Level chip ──────────────────────────────────────────────────── */

const LEVEL_DS: Record<string, React.CSSProperties> = {
  error: {
    background: "var(--ds-rose-bg)",
    color: "var(--ds-rose)",
    border: "1px solid rgba(251,113,133,0.3)",
  },
  err: {
    background: "var(--ds-rose-bg)",
    color: "var(--ds-rose)",
    border: "1px solid rgba(251,113,133,0.3)",
  },
  fatal: {
    background: "var(--ds-rose-bg)",
    color: "var(--ds-rose)",
    border: "1px solid rgba(251,113,133,0.3)",
  },
  warn: {
    background: "var(--ds-amber-bg)",
    color: "var(--ds-amber)",
    border: "1px solid rgba(251,191,36,0.3)",
  },
  warning: {
    background: "var(--ds-amber-bg)",
    color: "var(--ds-amber)",
    border: "1px solid rgba(251,191,36,0.3)",
  },
  info: {
    background: "var(--ds-sky-bg)",
    color: "var(--ds-sky)",
    border: "1px solid rgba(96,165,250,0.3)",
  },
  debug: {
    background: "var(--ds-bg-3)",
    color: "var(--ds-text-2)",
    border: "1px solid var(--ds-line-2)",
  },
};

function levelChipStyle(level: string | null): React.CSSProperties {
  if (!level) return {};
  return (
    LEVEL_DS[level.toLowerCase()] ?? {
      background: "var(--ds-bg-3)",
      color: "var(--ds-text-2)",
      border: "1px solid var(--ds-line-2)",
    }
  );
}

function LevelChip({ level }: { level: string | null }) {
  if (!level) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 5px",
        borderRadius: 3,
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        fontWeight: 500,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        ...levelChipStyle(level),
      }}
    >
      {level.toUpperCase()}
    </span>
  );
}

/* ── Text highlight ──────────────────────────────────────────────── */

function highlight(text: string, term: string) {
  const t = term.trim();
  if (!t) return text;
  const regex = new RegExp(`(${escapeRegExp(t)})`, "ig");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    part.toLowerCase() === t.toLowerCase() ? (
      <mark
        key={i}
        style={{
          background: "rgba(251,191,36,0.25)",
          color: "var(--ds-amber)",
          borderRadius: 2,
          padding: "0 1px",
        }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/* ── Props ───────────────────────────────────────────────────────── */

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
  selectedLogIndex: number | null;
  setExpandedLogRows: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
  setSearch: (value: string) => void;
  setSinceMinutes: (value: number) => void;
  setTimeMode: (updater: (previous: TimeMode) => TimeMode) => void;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  setSelectedLogIndex: (index: number | null) => void;
  fetchLogs: () => Promise<void>;
};

/* ── Main component ──────────────────────────────────────────────── */

export function LogsTab({
  customEnd,
  customStart,
  expandedLogRows,
  fetchLogs,
  loadingLogs,
  parsedLogs,
  search,
  selectedLogIndex,
  selectedWorkload,
  setCustomEnd,
  setCustomStart,
  setExpandedLogRows,
  setSearch,
  setSinceMinutes,
  setSelectedLogIndex,
  setTimeMode,
  sinceMinutes,
  timeMode,
}: LogsTabProps) {
  /* ── tag / field filtering (carried over) ─────────────────── */
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of parsedLogs) {
      if (item.isJson) tags.add("json");
      tags.add(item.level?.toLowerCase() ?? "other");
    }
    return [...tags].sort();
  }, [parsedLogs]);

  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(["__all__"])
  );
  const [fieldKey, setFieldKey] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [isLive] = useState(true);

  const parsedSearch = useMemo(() => parseLogSearchQuery(search), [search]);

  const fieldFilters = useMemo(() => {
    const filters = [...parsedSearch.fields];
    const k = fieldKey.trim();
    const v = fieldValue.trim();
    if (k && v) filters.push({ key: k, value: v });
    return filters;
  }, [fieldKey, fieldValue, parsedSearch.fields]);

  const activeSelectedTags = useMemo(() => {
    if (selectedTags.has("__all__")) return selectedTags;

    const available = new Set(allTags);
    const selectedAvailableTags = [...selectedTags].filter((tag) =>
      available.has(tag)
    );
    return selectedAvailableTags.length
      ? new Set(selectedAvailableTags)
      : new Set(["__all__"]);
  }, [allTags, selectedTags]);

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
    return parsedLogs.filter((item) => {
      if (!activeSelectedTags.has("__all__")) {
        const itemTags = new Set<string>();
        if (item.isJson) itemTags.add("json");
        itemTags.add(item.level?.toLowerCase() ?? "other");
        if (![...activeSelectedTags].some((t) => itemTags.has(t))) return false;
      }
      if (!matchesFieldFilters(item.parsedJson, fieldFilters)) return false;
      return true;
    });
  }, [parsedLogs, activeSelectedTags, fieldFilters]);

  const jsonLogCount = useMemo(
    () => parsedLogs.filter((l) => l.parsedJson).length,
    [parsedLogs]
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Controls bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--ds-bg-1)",
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        {/* Live indicator */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 24,
            padding: "0 8px",
            borderRadius: 5,
            border: isLive
              ? "1px solid rgba(70,240,194,0.4)"
              : "1px solid var(--line)",
            background: isLive ? "var(--ds-mint-bg)" : "var(--ds-bg-2)",
            color: isLive ? "var(--ds-mint)" : "var(--muted)",
            fontSize: 11,
          }}
        >
          {isLive && (
            <span
              className="ds-live-pulse"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--ds-mint)",
                display: "inline-block",
              }}
            />
          )}
          {loadingLogs ? "Loading…" : isLive ? "Live" : "Paused"}
        </div>

        {/* Time range */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{
              fontSize: 10,
              color: "var(--ds-text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            Range
          </span>
          {timeMode === "preset" ? (
            <select
              style={controlSelectStyle}
              value={sinceMinutes}
              onChange={(e) => setSinceMinutes(Number(e.target.value))}
            >
              {sinceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="datetime-local"
                style={{ ...controlSelectStyle, padding: "0 6px" }}
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span style={{ color: "var(--ds-text-3)", fontSize: 11 }}>→</span>
              <input
                type="datetime-local"
                style={{ ...controlSelectStyle, padding: "0 6px" }}
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() =>
              setTimeMode((m) => (m === "preset" ? "custom" : "preset"))
            }
            style={controlBtnStyle}
          >
            {timeMode === "preset" ? "Custom" : "Preset"}
          </button>
        </div>

        {/* Field filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            style={{ ...controlSelectStyle, width: 100 }}
            placeholder="field"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
          />
          <span style={{ color: "var(--ds-text-3)", fontSize: 11 }}>:</span>
          <input
            style={{ ...controlSelectStyle, width: 120 }}
            placeholder="value"
            value={fieldValue}
            onChange={(e) => setFieldValue(e.target.value)}
          />
          {(fieldKey || fieldValue) && (
            <button
              type="button"
              onClick={() => {
                setFieldKey("");
                setFieldValue("");
              }}
              style={controlBtnStyle}
            >
              ✕
            </button>
          )}
        </div>

        {/* Search */}
        <input
          style={{ ...controlSelectStyle, width: 220, flex: 1, minWidth: 140 }}
          placeholder="Search text or field:value"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Tag pills */}
        {parsedLogs.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <TagPill
              active={activeSelectedTags.has("__all__")}
              onClick={() => toggleTag("__all__")}
            >
              All
            </TagPill>
            {allTags.map((tag) => (
              <TagPill
                key={tag}
                active={
                  !activeSelectedTags.has("__all__") &&
                  activeSelectedTags.has(tag)
                }
                onClick={() => toggleTag(tag)}
              >
                {tag === "json" ? "JSON" : tag.toUpperCase()}
              </TagPill>
            ))}
          </div>
        )}

        {/* Refresh */}
        <button
          type="button"
          onClick={fetchLogs}
          disabled={loadingLogs || !selectedWorkload}
          style={{
            ...controlBtnStyle,
            opacity: loadingLogs || !selectedWorkload ? 0.5 : 1,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Count row */}
      {parsedLogs.length > 0 && (
        <div
          style={{
            padding: "4px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--ds-text-3)",
            borderBottom: "1px solid var(--ds-bg-2)",
            flexShrink: 0,
            background: "var(--background)",
          }}
        >
          Showing {filteredLogs.length}/{parsedLogs.length} entries · {jsonLogCount} JSON searchable
          {parsedSearch.text && (
            <span
              style={{
                marginLeft: 8,
                background: "var(--ds-sky-bg)",
                color: "var(--ds-sky)",
                padding: "0 6px",
                borderRadius: 3,
                border: "1px solid rgba(96,165,250,0.3)",
              }}
            >
              text: {parsedSearch.text}
            </span>
          )}
          {fieldFilters.map((f, i) => (
            <span
              key={i}
              style={{
                marginLeft: 4,
                background: "var(--ds-mint-bg)",
                color: "var(--ds-mint)",
                padding: "0 6px",
                borderRadius: 3,
                border: "1px solid rgba(70,240,194,0.3)",
              }}
            >
              {f.key}:{f.value}
            </span>
          ))}
        </div>
      )}

      {/* Log list */}
      <div className="ide-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "var(--ds-text-3)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
            }}
          >
            {!selectedWorkload
              ? "Select a workload to load logs."
              : loadingLogs
                ? "Loading logs…"
                : "No logs or no matches."}
          </div>
        ) : (
          <div>
            {filteredLogs.map((item, index) => {
              const rowKey = `${item.entry.source}-${index}`;
              const isExpanded = Boolean(expandedLogRows[rowKey]);
              const isSelected = selectedLogIndex === index;
              const formattedJson = item.parsedJson
                ? JSON.stringify(item.parsedJson, null, 2)
                : "";

              const ts = item.entry.timestamp
                ? new Date(item.entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "—";

              return (
                <Fragment key={rowKey}>
                  <div
                    className={`ds-tail-row${isSelected ? " ds-selected" : ""}`}
                    onClick={() =>
                      setSelectedLogIndex(isSelected ? null : index)
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 60px 56px minmax(0, 1fr) auto",
                      gap: 10,
                      padding: "4px 14px",
                      alignItems: "center",
                      borderBottom: isExpanded
                        ? "1px solid var(--line)"
                        : "1px solid var(--ds-bg-2)",
                      cursor: "pointer",
                      fontSize: 11.5,
                      transition: "background 0.08s",
                    }}
                  >
                    {/* Timestamp */}
                    <span
                      style={{
                        color: "var(--ds-text-3)",
                        fontSize: 10.5,
                        fontFamily: "var(--font-mono)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ts}
                    </span>

                    {/* Level chip */}
                    <span>
                      <LevelChip level={item.level} />
                    </span>

                    {/* JSON / source badge */}
                    <span>
                      {item.isJson ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "1px 5px",
                            borderRadius: 3,
                            fontFamily: "var(--font-mono)",
                            fontSize: 9.5,
                            fontWeight: 500,
                            background: "var(--ds-violet-bg)",
                            color: "var(--ds-violet)",
                            border: "1px solid rgba(167,139,250,0.3)",
                          }}
                        >
                          JSON
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "1px 5px",
                            borderRadius: 3,
                            fontFamily: "var(--font-mono)",
                            fontSize: 9.5,
                            color: "var(--ds-text-3)",
                            border: "1px solid var(--line)",
                            overflow: "hidden",
                            maxWidth: 50,
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={item.entry.source}
                        >
                          {item.entry.source.split("-").slice(-1)[0].slice(0, 6)}
                        </span>
                      )}
                    </span>

                    {/* Message */}
                    <span
                      style={{
                        color: "var(--foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {highlight(item.oneLine, parsedSearch.text)}
                    </span>

                    {/* Actions (hover-reveal via CSS class) */}
                    <span
                      className="ds-row-actions"
                      style={{ display: "flex", gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CopyBtn value={item.entry.line} label="copy" />
                      {item.parsedJson && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedLogRows((prev) => ({
                              ...prev,
                              [rowKey]: !prev[rowKey],
                            }));
                          }}
                          style={{
                            background: "transparent",
                            border: "1px solid var(--line)",
                            color: "var(--ds-text-2)",
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {isExpanded ? "collapse" : "expand"}
                        </button>
                      )}
                    </span>
                  </div>

                  {isExpanded && item.parsedJson && (
                    <div
                      style={{
                        padding: "10px 14px 12px 150px",
                        borderBottom: "1px solid var(--line)",
                        background: "var(--ds-bg-2)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 6,
                          fontSize: 10,
                          color: "var(--ds-text-3)",
                        }}
                      >
                        <span>Formatted JSON</span>
                        <CopyBtn value={formattedJson} label="copy JSON" />
                        <CopyBtn value={item.entry.line} label="copy raw" />
                      </div>
                      <pre
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          color: "var(--foreground)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          margin: 0,
                        }}
                      >
                        {formattedJson}
                      </pre>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared control styles ───────────────────────────────────────── */

const controlSelectStyle: React.CSSProperties = {
  height: 24,
  background: "var(--ds-bg-2)",
  border: "1px solid var(--line)",
  color: "var(--foreground)",
  fontSize: 11,
  borderRadius: 6,
  padding: "0 8px",
  fontFamily: "inherit",
  cursor: "pointer",
  outline: "none",
};

const controlBtnStyle: React.CSSProperties = {
  height: 24,
  padding: "0 8px",
  border: "1px solid var(--line)",
  background: "var(--ds-bg-2)",
  color: "var(--muted)",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function TagPill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 8px",
        borderRadius: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 500,
        border: active
          ? "1px solid var(--ds-mint-d)"
          : "1px solid var(--line)",
        background: active ? "var(--ds-mint-bg)" : "transparent",
        color: active ? "var(--ds-mint)" : "var(--muted)",
        cursor: "pointer",
        transition: "all 0.1s",
      }}
    >
      {children}
    </button>
  );
}
