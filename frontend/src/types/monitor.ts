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

export type ActiveTab = "logs" | "health" | "env" | "spec";
export type TimeMode = "preset" | "custom";

export type NodePosition = {
  x: number;
  y: number;
};

export type ServiceMapNode = {
  id: string;
  kind: string;
  name: string;
  health: "healthy" | "degraded" | "failing" | "unknown";
  total_pods: number;
  ready_pods: number;
  restart_count: number;
};

export type ServiceMapEdge = {
  source: string;
  target: string;
  edge_type: "ingress" | "service-selector" | "env-ref";
};

export type ServiceMap = {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
};

export type RequestChainItem = {
  id: string;
  workload_kind: string;
  workload_name: string;
  source: string;
  timestamp?: string | null;
  event_type:
    | "http-request"
    | "http-call"
    | "kafka-publish"
    | "kafka-consume"
    | "kafka"
    | "request-log"
    | "log";
  target?: string | null;
  confidence: "low" | "medium" | "high";
  trace?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
  line: string;
};

export type RequestChainEdge = {
  source: string;
  target: string;
  edge_type: string;
  count: number;
};

export type RequestChainSummary = {
  total_logs: number;
  workloads: number;
  kafka: number;
  http: number;
};

export type RequestChain = {
  correlation_id: string;
  query?: string;
  mode?: "auto" | "trace" | "span" | "correlation";
  items: RequestChainItem[] | null;
  edges: RequestChainEdge[] | null;
  summary?: RequestChainSummary;
};

export type PodEvent = {
  event_type: string;
  reason: string;
  source: string;
  message: string;
  timestamp: string;
  count: number;
};

export type PodTimeline = {
  events: PodEvent[];
};

export type CrashDiagnostic = {
  pod: string;
  container: string;
  severity: "critical" | "warning" | "info";
  reason: string;
  message: string;
  restarts: number;
};

export type CrashDiagnostics = {
  items: CrashDiagnostic[];
};

export type ContainerMetric = {
  pod: string;
  container: string;
  cpu_usage_nano: number;
  memory_usage_bytes: number;
};

export type WorkloadMetrics = {
  available: boolean;
  message?: string;
  items: ContainerMetric[];
};

export type SinceOption = {
  label: string;
  value: number;
};
