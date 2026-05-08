package server

import (
	"context"
	"log"
	"net"
	"os"
	"sort"
	"strings"

	pb "go-kube-monitor/backend/proto/monitor/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

func newGRPCServer(state *appState) (*grpc.Server, net.Listener, error) {
	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = defaultGRPCPort
	}
	addr := "0.0.0.0:" + port
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, nil, err
	}
	server := grpc.NewServer(
		grpc.UnaryInterceptor(grpcUnaryAuthInterceptor(state)),
		grpc.StreamInterceptor(grpcStreamAuthInterceptor(state)),
	)
	pb.RegisterMonitorServiceServer(server, &monitorGRPCServer{state: state})
	return server, listener, nil
}

func serveGRPC(server *grpc.Server, listener net.Listener) {
	addr := listener.Addr().String()
	log.Printf("starting grpc server on %s", addr)
	if err := server.Serve(listener); err != nil {
		log.Printf("grpc server stopped: %v", err)
	}
}

type monitorGRPCServer struct {
	pb.UnimplementedMonitorServiceServer
	state *appState
}

func (s *monitorGRPCServer) GetContext(ctx context.Context, req *pb.GetContextRequest) (*pb.ContextInfo, error) {
	return toPBContextInfo(getContextInfo(s.state)), nil
}

func (s *monitorGRPCServer) ListNamespaces(ctx context.Context, req *pb.ListNamespacesRequest) (*pb.ListNamespacesResponse, error) {
	items, err := listNamespacesCached(ctx, s.state, stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return &pb.ListNamespacesResponse{Namespaces: toPBNamespaceItems(items)}, nil
}

func (s *monitorGRPCServer) ListWorkloads(ctx context.Context, req *pb.ListWorkloadsRequest) (*pb.ListWorkloadsResponse, error) {
	items, err := listWorkloadsCached(ctx, s.state, req.GetNamespace(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return &pb.ListWorkloadsResponse{Workloads: toPBWorkloadItems(items)}, nil
}

func (s *monitorGRPCServer) GetLogs(ctx context.Context, req *pb.GetLogsRequest) (*pb.GetLogsResponse, error) {
	logs, err := getLogsCached(ctx, s.state, req.GetNamespace(), req.GetKind(), req.GetName(), req.GetSearch(), normalizeSinceMinutes(req.GetSinceMinutes(), maxLogSinceMin), stringPtrIfNotEmpty(req.GetStartTime()), stringPtrIfNotEmpty(req.GetEndTime()), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return &pb.GetLogsResponse{Logs: toPBLogEntries(logs)}, nil
}

func (s *monitorGRPCServer) StreamLogs(req *pb.GetLogsRequest, stream pb.MonitorService_StreamLogsServer) error {
	return toGRPCError(streamLiveLogs(stream.Context(), req.GetNamespace(), req.GetKind(), req.GetName(), req.GetSearch(), normalizeSinceMinutes(req.GetSinceMinutes(), maxLogSinceMin), stringPtrIfNotEmpty(req.GetStartTime()), stringPtrIfNotEmpty(req.GetEndTime()), stringPtrIfNotEmpty(req.GetContext()), func(entry LogEntry) error {
		return stream.Send(toPBLogEntry(entry))
	}))
}

func (s *monitorGRPCServer) SearchLogsGlobal(ctx context.Context, req *pb.SearchLogsGlobalRequest) (*pb.SearchLogsGlobalResponse, error) {
	if req.GetNamespace() == "" || req.GetSearch() == "" {
		return &pb.SearchLogsGlobalResponse{}, nil
	}
	workloads, err := listWorkloadsCached(ctx, s.state, req.GetNamespace(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	var all []GlobalLogEntry
	term := strings.ToLower(req.GetSearch())
	for _, workload := range workloads {
		logs, err := getLogsCached(ctx, s.state, req.GetNamespace(), workload.Kind, workload.Name, "", normalizeSinceMinutes(req.GetSinceMinutes(), maxFanoutSinceMin), nil, nil, stringPtrIfNotEmpty(req.GetContext()))
		if err != nil {
			continue
		}
		for _, entry := range logs {
			if strings.Contains(strings.ToLower(entry.Line), term) {
				all = append(all, GlobalLogEntry{WorkloadKind: workload.Kind, WorkloadName: workload.Name, Source: entry.Source, Line: entry.Line, Timestamp: entry.Timestamp})
			}
		}
	}
	sort.Slice(all, func(i, j int) bool {
		return newerFirst(all[i].Timestamp, all[j].Timestamp, all[i].WorkloadName, all[j].WorkloadName)
	})
	return &pb.SearchLogsGlobalResponse{Logs: toPBGlobalLogEntries(all)}, nil
}

func (s *monitorGRPCServer) GetEnv(ctx context.Context, req *pb.GetWorkloadRequest) (*pb.GetEnvResponse, error) {
	client, snap, err := clientAndSnapshot(ctx, req.GetNamespace(), req.GetKind(), req.GetName(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	var vars []EnvVar
	for _, c := range snap.containers {
		for _, e := range c.Env {
			vars = append(vars, EnvVar{Container: c.Name, Name: e.Name, Value: envValue(e)})
		}
		for _, from := range c.EnvFrom {
			vars = append(vars, fetchEnvFrom(ctx, client, req.GetNamespace(), c.Name, from)...)
		}
	}
	sort.Slice(vars, func(i, j int) bool {
		if vars[i].Container == vars[j].Container {
			return vars[i].Name < vars[j].Name
		}
		return vars[i].Container < vars[j].Container
	})
	return &pb.GetEnvResponse{Env: toPBEnvVars(vars)}, nil
}

func (s *monitorGRPCServer) GetPodStatus(ctx context.Context, req *pb.GetWorkloadRequest) (*pb.GetPodStatusResponse, error) {
	items, err := podStatuses(ctx, req.GetNamespace(), req.GetKind(), req.GetName(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return &pb.GetPodStatusResponse{Pods: toPBPodStatusItems(items)}, nil
}

func (s *monitorGRPCServer) GetTimeline(ctx context.Context, req *pb.GetWorkloadRequest) (*pb.PodTimeline, error) {
	timeline, err := workloadTimeline(ctx, req.GetNamespace(), req.GetKind(), req.GetName(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return toPBPodTimeline(timeline), nil
}

func (s *monitorGRPCServer) GetDiagnostics(ctx context.Context, req *pb.GetWorkloadRequest) (*pb.CrashDiagnostics, error) {
	diagnostics, err := crashDiagnostics(ctx, req.GetNamespace(), req.GetKind(), req.GetName(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return toPBCrashDiagnostics(diagnostics), nil
}

func (s *monitorGRPCServer) GetMetrics(ctx context.Context, req *pb.GetWorkloadRequest) (*pb.WorkloadMetrics, error) {
	metrics, err := workloadMetrics(ctx, req.GetNamespace(), req.GetKind(), req.GetName(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return toPBWorkloadMetrics(metrics), nil
}

func (s *monitorGRPCServer) GetWorkloadSpec(ctx context.Context, req *pb.GetWorkloadRequest) (*pb.WorkloadSpecItem, error) {
	client, err := kubeClient(stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	spec, err := workloadSpec(ctx, client, req.GetNamespace(), req.GetKind(), req.GetName())
	if err != nil {
		return nil, toGRPCError(err)
	}
	specStruct, err := toStructPB(spec)
	if err != nil {
		return nil, grpcstatus.Error(codes.Internal, err.Error())
	}
	return &pb.WorkloadSpecItem{Kind: req.GetKind(), Name: req.GetName(), Namespace: req.GetNamespace(), Spec: specStruct}, nil
}

func (s *monitorGRPCServer) GetServiceMap(ctx context.Context, req *pb.GetServiceMapRequest) (*pb.ServiceMap, error) {
	serviceMap, err := buildServiceMap(ctx, s.state, req.GetNamespace(), stringPtrIfNotEmpty(req.GetContext()))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return toPBServiceMap(serviceMap), nil
}
