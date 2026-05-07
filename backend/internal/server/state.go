package server

import (
	corev1 "k8s.io/api/core/v1"
	"regexp"
	"sync"
	"time"
)

const (
	apiCacheTTL        = 15 * time.Second
	logCacheTTL        = 30 * time.Second
	logCacheMaxEntries = 10
	defaultLogSinceMin = 15
	maxLogSinceMin     = 90 * 24 * 60
	maxFanoutSinceMin  = 24 * 60
	maxPodLogTailLines = 5000
	maxPodLogBytes     = 4 * 1024 * 1024
	defaultPort        = "8081"
	defaultGRPCPort    = "9090"
)

var (
	httpURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)
	pathPattern    = regexp.MustCompile(`(?i)\b(?:GET|POST|PUT|PATCH|DELETE)\s+(/[^\s"'<>]+)`)
	topicPattern   = regexp.MustCompile(`(?i)\btopic(?:Name)?\s*[:=]?\s*["']?([A-Za-z0-9._-]+)`)
	traceIDPattern = regexp.MustCompile(`(?i)(?:^|/)traces/([a-f0-9]{16,32})$`)
)

type appState struct {
	authRequired bool
	clientID     string
	cache        *apiCache
}

type apiCache struct {
	mu         sync.RWMutex
	context    *cacheEntry[ContextInfo]
	namespaces map[string]cacheEntry[[]NamespaceItem]
	workloads  map[string]cacheEntry[[]WorkloadItem]
	logs       map[string]cacheEntry[[]LogEntry]
}

type cacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

type NamespaceItem struct {
	Name string `json:"name"`
}

type WorkloadItem struct {
	Kind      string            `json:"kind"`
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Selector  map[string]string `json:"selector"`
}

type LogEntry struct {
	Source    string  `json:"source"`
	Line      string  `json:"line"`
	Timestamp *string `json:"timestamp,omitempty"`
}

type GlobalLogEntry struct {
	WorkloadKind string  `json:"workload_kind"`
	WorkloadName string  `json:"workload_name"`
	Source       string  `json:"source"`
	Line         string  `json:"line"`
	Timestamp    *string `json:"timestamp,omitempty"`
}

type RequestChain struct {
	CorrelationID string              `json:"correlation_id"`
	Query         string              `json:"query"`
	Mode          string              `json:"mode"`
	Items         []RequestChainItem  `json:"items"`
	Edges         []RequestChainEdge  `json:"edges"`
	Summary       RequestChainSummary `json:"summary"`
}

type RequestChainItem struct {
	ID           string  `json:"id"`
	WorkloadKind string  `json:"workload_kind"`
	WorkloadName string  `json:"workload_name"`
	Source       string  `json:"source"`
	Timestamp    *string `json:"timestamp,omitempty"`
	EventType    string  `json:"event_type"`
	Target       *string `json:"target,omitempty"`
	Confidence   string  `json:"confidence"`
	Trace        *string `json:"trace,omitempty"`
	TraceID      *string `json:"trace_id,omitempty"`
	SpanID       *string `json:"span_id,omitempty"`
	Line         string  `json:"line"`
}

type RequestChainEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"edge_type"`
	Count  int    `json:"count"`
}

type RequestChainSummary struct {
	TotalLogs int `json:"total_logs"`
	Workloads int `json:"workloads"`
	Kafka     int `json:"kafka"`
	HTTP      int `json:"http"`
}

type EnvVar struct {
	Container string `json:"container"`
	Name      string `json:"name"`
	Value     string `json:"value"`
}

type PodStatusItem struct {
	Name     string `json:"name"`
	Phase    string `json:"phase"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
}

type PodEvent struct {
	EventType string `json:"event_type"`
	Reason    string `json:"reason"`
	Source    string `json:"source"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
	Count     int32  `json:"count"`
}

type PodTimeline struct {
	Events []PodEvent `json:"events"`
}

type CrashDiagnostic struct {
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Severity  string `json:"severity"`
	Reason    string `json:"reason"`
	Message   string `json:"message"`
	Restarts  int32  `json:"restarts"`
}

type CrashDiagnostics struct {
	Items []CrashDiagnostic `json:"items"`
}

type ContainerMetric struct {
	Pod             string `json:"pod"`
	Container       string `json:"container"`
	CPUUsageNano    int64  `json:"cpu_usage_nano"`
	MemoryUsageByte int64  `json:"memory_usage_bytes"`
}

type WorkloadMetrics struct {
	Available bool              `json:"available"`
	Message   string            `json:"message,omitempty"`
	Items     []ContainerMetric `json:"items"`
}

type WorkloadSpecItem struct {
	Kind      string      `json:"kind"`
	Name      string      `json:"name"`
	Namespace string      `json:"namespace"`
	Spec      interface{} `json:"spec"`
}

type ContextInfo struct {
	KubeContext   *string  `json:"kube_context"`
	Cluster       *string  `json:"cluster"`
	GcloudProject *string  `json:"gcloud_project"`
	Contexts      []string `json:"contexts"`
}

type ServiceMap struct {
	Nodes []ServiceMapNode `json:"nodes"`
	Edges []ServiceMapEdge `json:"edges"`
}

type ServiceMapNode struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Health       string `json:"health"`
	TotalPods    int    `json:"total_pods"`
	ReadyPods    int    `json:"ready_pods"`
	RestartCount int32  `json:"restart_count"`
}

type ServiceMapEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"edge_type"`
}

type workloadSnapshot struct {
	selector   map[string]string
	containers []corev1.Container
}

type statusError struct {
	code int
	err  error
}
