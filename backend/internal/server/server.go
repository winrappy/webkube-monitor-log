package server

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func Run() {
	state := &appState{
		authRequired: envBoolDefault("AUTH_REQUIRED", true),
		clientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		cache: &apiCache{
			namespaces: map[string]cacheEntry[[]NamespaceItem]{},
			workloads:  map[string]cacheEntry[[]WorkloadItem]{},
			logs:       map[string]cacheEntry[[]LogEntry]{},
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	api := http.NewServeMux()
	api.HandleFunc("/api/context", wrap(state, handleContext))
	api.HandleFunc("/api/namespaces", wrap(state, handleNamespaces))
	api.HandleFunc("/api/workloads", wrap(state, handleWorkloads))
	api.HandleFunc("/api/logs", wrap(state, handleLogs))
	api.HandleFunc("/api/logs/stream", wrap(state, handleLogStream))
	api.HandleFunc("/api/logs/search", wrap(state, handleGlobalLogSearch))
	api.HandleFunc("/api/request-chain", wrap(state, handleRequestChain))
	api.HandleFunc("/api/env", wrap(state, handleEnv))
	api.HandleFunc("/api/pod-status", wrap(state, handlePodStatus))
	api.HandleFunc("/api/workload-spec", wrap(state, handleWorkloadSpec))
	api.HandleFunc("/api/service-map", wrap(state, handleServiceMap))
	api.HandleFunc("/api/timeline", wrap(state, handleTimeline))
	api.HandleFunc("/api/diagnostics", wrap(state, handleDiagnostics))
	api.HandleFunc("/api/metrics", wrap(state, handleMetrics))
	mux.Handle("/api/", authMiddleware(state, api))

	grpcServer, grpcListener, err := newGRPCServer(state)
	if err != nil {
		log.Printf("grpc listen failed: %v", err)
	} else {
		go serveGRPC(grpcServer, grpcListener)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	addr := "0.0.0.0:" + port
	httpServer := &http.Server{
		Addr:    addr,
		Handler: corsMiddleware(mux),
	}

	errs := make(chan error, 1)
	go func() {
		errs <- httpServer.ListenAndServe()
	}()

	log.Printf("starting server on %s", addr)
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errs:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case sig := <-shutdown:
		log.Printf("shutdown signal received: %s", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := httpServer.Shutdown(ctx); err != nil {
			log.Printf("http graceful shutdown failed: %v", err)
		}
		if grpcServer != nil {
			stopped := make(chan struct{})
			go func() {
				grpcServer.GracefulStop()
				close(stopped)
			}()
			select {
			case <-stopped:
			case <-ctx.Done():
				grpcServer.Stop()
			}
		}
		log.Print("server shutdown complete")
	}
}
