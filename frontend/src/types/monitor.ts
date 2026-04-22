export type NamespaceItem = {
  name: string;
};

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

export type WorkloadItem = {
  kind: WorkloadKind;
  name: string;
  namespace: string;
  selector: Record<string, string>;
};

export type LogEntry = {
  source: string;
  line: string;
  timestamp?: string | null;
};

export type EnvVar = {
  container: string;
  name: string;
  value: string;
};

export type PodStatusItem = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
};

export type WorkloadSpec = {
  kind: string;
  name: string;
  namespace: string;
  spec: Record<string, unknown> | null;
};

export type ParsedLogLine = {
  entry: LogEntry;
  isJson: boolean;
  parsedJson: Record<string, unknown> | null;
  oneLine: string;
  level: string | null;
};

export type ContextInfo = {
  kube_context?: string | null;
  cluster?: string | null;
  gcloud_project?: string | null;
  contexts?: string[];
};

export type ActiveTab = "logs" | "env" | "spec";
export type TimeMode = "preset" | "custom";

export type SinceOption = {
  label: string;
  value: number;
};
