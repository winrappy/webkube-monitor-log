"use client";

import { useEffect, useRef, useState } from "react";

import type { NamespaceItem, WorkloadItem } from "@/types/monitor";
import { workloadKindLabel } from "@/utils/monitor";

type Props = {
  namespaces: NamespaceItem[];
  workloads: WorkloadItem[];
  setSelectedNamespace: (ns: string) => void;
  setSelectedWorkload: (workload: WorkloadItem) => void;
};

export function GlobalSearch({ namespaces, workloads, setSelectedNamespace, setSelectedWorkload }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const term = query.toLowerCase().trim();
  const nsResults = term
    ? namespaces.filter((ns) => ns.name.toLowerCase().includes(term)).slice(0, 5)
    : [];
  const wlResults = term
    ? workloads
        .filter(
          (w) =>
            w.name.toLowerCase().includes(term) ||
            w.kind.toLowerCase().includes(term)
        )
        .slice(0, 8)
    : [];
  const totalResults = nsResults.length + wlResults.length;
  const hasResults = totalResults > 0;

  // Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        close();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function close() {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function selectNamespace(ns: NamespaceItem) {
    setSelectedNamespace(ns.name);
    close();
  }

  function selectWorkload(wl: WorkloadItem) {
    setSelectedWorkload(wl);
    close();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!hasResults) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, totalResults - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex < nsResults.length) {
        selectNamespace(nsResults[focusedIndex]);
      } else {
        selectWorkload(wlResults[focusedIndex - nsResults.length]);
      }
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <div
        className={`flex items-center gap-2 rounded-full border px-4 py-2 transition ${
          open ? "border-accent" : "border-line"
        } bg-surface`}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(e.target.value.length > 0);
            setFocusedIndex(0);
          }}
          onFocus={() => { if (query) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search resources…  ⌘K"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="shrink-0 text-muted transition hover:text-foreground"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {open && hasResults && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_32px_var(--shadow)]">
          {nsResults.length > 0 && (
            <div>
              <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                Namespaces
              </p>
              {nsResults.map((ns, i) => (
                <button
                  key={ns.name}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                    focusedIndex === i
                      ? "bg-chip text-foreground"
                      : "text-muted hover:bg-chip hover:text-foreground"
                  }`}
                  onMouseEnter={() => setFocusedIndex(i)}
                  onClick={() => selectNamespace(ns)}
                >
                  <NamespaceIcon />
                  <span>{ns.name}</span>
                </button>
              ))}
            </div>
          )}

          {wlResults.length > 0 && (
            <div className={nsResults.length > 0 ? "border-t border-line" : ""}>
              <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                Workloads
              </p>
              {wlResults.map((wl, i) => {
                const idx = nsResults.length + i;
                const kindLabel = workloadKindLabel(wl.kind);
                return (
                  <button
                    key={`${wl.kind}-${wl.name}`}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                      focusedIndex === idx
                        ? "bg-chip text-foreground"
                        : "text-muted hover:bg-chip hover:text-foreground"
                    }`}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    onClick={() => selectWorkload(wl)}
                  >
                    <WorkloadIcon />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{wl.name}</p>
                      <p className="text-xs text-muted">
                        {wl.namespace}{kindLabel ? ` · ${kindLabel}` : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <p className="px-4 py-2 text-[10px] text-muted border-t border-line">
            ↑↓ navigate · Enter select · Esc close
          </p>
        </div>
      )}

      {open && !hasResults && query.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted shadow-[0_8px_32px_var(--shadow)]">
          No results for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="shrink-0 text-muted" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function NamespaceIcon() {
  return (
    <svg className="shrink-0 text-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  );
}

function WorkloadIcon() {
  return (
    <svg className="shrink-0 text-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
