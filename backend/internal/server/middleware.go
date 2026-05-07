package server

import (
	"context"
	"errors"
	"google.golang.org/api/idtoken"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	grpcstatus "google.golang.org/grpc/status"
	"log"
	"net/http"
	"strings"
)

type handlerFunc func(*appState, http.ResponseWriter, *http.Request) error

func wrap(state *appState, h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := h(state, w, r); err != nil {
			var se statusError
			if errors.As(err, &se) {
				http.Error(w, se.err.Error(), se.code)
				return
			}
			log.Printf("handler error: %v", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authMiddleware(state *appState, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !state.authRequired {
			next.ServeHTTP(w, r)
			return
		}
		if state.clientID == "" {
			http.Error(w, "missing GOOGLE_CLIENT_ID", http.StatusInternalServerError)
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" || token == r.Header.Get("Authorization") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if _, err := idtoken.Validate(r.Context(), token, state.clientID); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func grpcUnaryAuthInterceptor(state *appState) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if err := validateGRPCAuth(ctx, state); err != nil {
			return nil, err
		}
		return handler(ctx, req)
	}
}

func grpcStreamAuthInterceptor(state *appState) grpc.StreamServerInterceptor {
	return func(srv interface{}, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if err := validateGRPCAuth(stream.Context(), state); err != nil {
			return err
		}
		return handler(srv, stream)
	}
}

func validateGRPCAuth(ctx context.Context, state *appState) error {
	if !state.authRequired {
		return nil
	}
	if state.clientID == "" {
		return grpcstatus.Error(codes.Internal, "missing GOOGLE_CLIENT_ID")
	}
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return grpcstatus.Error(codes.Unauthenticated, "missing metadata")
	}
	values := md.Get("authorization")
	if len(values) == 0 {
		return grpcstatus.Error(codes.Unauthenticated, "missing authorization")
	}
	token := strings.TrimPrefix(values[0], "Bearer ")
	if token == "" || token == values[0] {
		return grpcstatus.Error(codes.Unauthenticated, "invalid authorization")
	}
	if _, err := idtoken.Validate(ctx, token, state.clientID); err != nil {
		return grpcstatus.Error(codes.Unauthenticated, "unauthorized")
	}
	return nil
}
