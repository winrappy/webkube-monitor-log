import type { ContextInfo } from "@/types/monitor";

type ContextSelectorProps = {
  contextInfo: ContextInfo | null;
  selectedContext: string;
  setSelectedContext: (value: string) => void;
  className?: string;
  selectClassName?: string;
};

export function ContextSelector({
  contextInfo,
  selectedContext,
  setSelectedContext,
  className,
  selectClassName,
}: ContextSelectorProps) {
  return (
    <div className={className ?? "rounded-2xl border border-line bg-surface px-4 py-2"}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Gcloud Context</p>
      <select
        className={
          selectClassName ??
          "mt-1 w-[360px] max-w-[70vw] bg-transparent text-sm font-semibold text-foreground outline-none"
        }
        value={selectedContext}
        onChange={(event) => setSelectedContext(event.target.value)}
      >
        {contextInfo?.contexts?.length ? (
          contextInfo.contexts.map((context) => (
            <option key={context} value={context}>
              {context}
            </option>
          ))
        ) : (
          <option value="">unknown</option>
        )}
      </select>
      {contextInfo?.gcloud_project ? (
        <p className="text-xs text-muted">project: {contextInfo.gcloud_project}</p>
      ) : null}
    </div>
  );
}