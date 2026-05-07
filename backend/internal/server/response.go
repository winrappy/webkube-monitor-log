package server

import (
	"encoding/json"
	"errors"
	pb "go-kube-monitor/backend/proto/monitor/v1"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"net/http"
)

func writeJSON(w http.ResponseWriter, value interface{}) error {
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(value)
}

func status(code int, err error) error {
	return statusError{code: code, err: err}
}

func (e statusError) Error() string {
	return e.err.Error()
}

func kubeStatus(err error) error {
	if apierrors.IsNotFound(err) {
		return status(http.StatusNotFound, err)
	}
	return status(http.StatusBadGateway, err)
}

func ptr(value string) *string {
	return &value
}

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func toGRPCError(err error) error {
	if err == nil {
		return nil
	}
	var se statusError
	if !errors.As(err, &se) {
		return grpcstatus.Error(codes.Internal, err.Error())
	}
	switch se.code {
	case http.StatusBadRequest:
		return grpcstatus.Error(codes.InvalidArgument, se.err.Error())
	case http.StatusUnauthorized:
		return grpcstatus.Error(codes.Unauthenticated, se.err.Error())
	case http.StatusNotFound:
		return grpcstatus.Error(codes.NotFound, se.err.Error())
	case http.StatusServiceUnavailable:
		return grpcstatus.Error(codes.Unavailable, se.err.Error())
	case http.StatusBadGateway:
		return grpcstatus.Error(codes.FailedPrecondition, se.err.Error())
	default:
		return grpcstatus.Error(codes.Internal, se.err.Error())
	}
}

func toPBContextInfo(info ContextInfo) *pb.ContextInfo {
	return &pb.ContextInfo{
		KubeContext:   info.KubeContext,
		Cluster:       info.Cluster,
		GcloudProject: info.GcloudProject,
		Contexts:      info.Contexts,
	}
}

func toPBNamespaceItems(items []NamespaceItem) []*pb.NamespaceItem {
	out := make([]*pb.NamespaceItem, 0, len(items))
	for _, item := range items {
		out = append(out, &pb.NamespaceItem{Name: item.Name})
	}
	return out
}

func toPBWorkloadItems(items []WorkloadItem) []*pb.WorkloadItem {
	out := make([]*pb.WorkloadItem, 0, len(items))
	for _, item := range items {
		out = append(out, &pb.WorkloadItem{Kind: item.Kind, Name: item.Name, Namespace: item.Namespace, Selector: item.Selector})
	}
	return out
}

func toPBLogEntry(entry LogEntry) *pb.LogEntry {
	return &pb.LogEntry{Source: entry.Source, Line: entry.Line, Timestamp: entry.Timestamp}
}

func toPBLogEntries(items []LogEntry) []*pb.LogEntry {
	out := make([]*pb.LogEntry, 0, len(items))
	for _, item := range items {
		out = append(out, toPBLogEntry(item))
	}
	return out
}

func toPBGlobalLogEntries(items []GlobalLogEntry) []*pb.GlobalLogEntry {
	out := make([]*pb.GlobalLogEntry, 0, len(items))
	for _, item := range items {
		out = append(out, &pb.GlobalLogEntry{WorkloadKind: item.WorkloadKind, WorkloadName: item.WorkloadName, Source: item.Source, Line: item.Line, Timestamp: item.Timestamp})
	}
	return out
}

func toPBEnvVars(items []EnvVar) []*pb.EnvVar {
	out := make([]*pb.EnvVar, 0, len(items))
	for _, item := range items {
		out = append(out, &pb.EnvVar{Container: item.Container, Name: item.Name, Value: item.Value})
	}
	return out
}

func toPBPodStatusItems(items []PodStatusItem) []*pb.PodStatusItem {
	out := make([]*pb.PodStatusItem, 0, len(items))
	for _, item := range items {
		out = append(out, &pb.PodStatusItem{Name: item.Name, Phase: item.Phase, Ready: item.Ready, Restarts: item.Restarts})
	}
	return out
}

func toPBPodTimeline(timeline PodTimeline) *pb.PodTimeline {
	events := make([]*pb.PodEvent, 0, len(timeline.Events))
	for _, event := range timeline.Events {
		events = append(events, &pb.PodEvent{EventType: event.EventType, Reason: event.Reason, Source: event.Source, Message: event.Message, Timestamp: event.Timestamp, Count: event.Count})
	}
	return &pb.PodTimeline{Events: events}
}

func toPBCrashDiagnostics(diagnostics CrashDiagnostics) *pb.CrashDiagnostics {
	items := make([]*pb.CrashDiagnostic, 0, len(diagnostics.Items))
	for _, item := range diagnostics.Items {
		items = append(items, &pb.CrashDiagnostic{Pod: item.Pod, Container: item.Container, Severity: item.Severity, Reason: item.Reason, Message: item.Message, Restarts: item.Restarts})
	}
	return &pb.CrashDiagnostics{Items: items}
}

func toPBWorkloadMetrics(metrics WorkloadMetrics) *pb.WorkloadMetrics {
	items := make([]*pb.ContainerMetric, 0, len(metrics.Items))
	for _, item := range metrics.Items {
		items = append(items, &pb.ContainerMetric{Pod: item.Pod, Container: item.Container, CpuUsageNano: item.CPUUsageNano, MemoryUsageBytes: item.MemoryUsageByte})
	}
	return &pb.WorkloadMetrics{Available: metrics.Available, Message: metrics.Message, Items: items}
}

func toPBServiceMap(serviceMap ServiceMap) *pb.ServiceMap {
	nodes := make([]*pb.ServiceMapNode, 0, len(serviceMap.Nodes))
	for _, node := range serviceMap.Nodes {
		nodes = append(nodes, &pb.ServiceMapNode{Id: node.ID, Kind: node.Kind, Name: node.Name, Health: node.Health, TotalPods: int32(node.TotalPods), ReadyPods: int32(node.ReadyPods), RestartCount: node.RestartCount})
	}
	edges := make([]*pb.ServiceMapEdge, 0, len(serviceMap.Edges))
	for _, edge := range serviceMap.Edges {
		edges = append(edges, &pb.ServiceMapEdge{Source: edge.Source, Target: edge.Target, EdgeType: edge.Type})
	}
	return &pb.ServiceMap{Nodes: nodes, Edges: edges}
}

func toStructPB(value interface{}) (*structpb.Struct, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var mapped map[string]interface{}
	if err := json.Unmarshal(data, &mapped); err != nil {
		return nil, err
	}
	return structpb.NewStruct(mapped)
}
