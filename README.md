# Go Kube Monitor

Go Kube Monitor is a Next.js frontend and Go backend for inspecting Kubernetes workloads, pod logs, runtime health, environment configuration, and inferred request chains.

The backend exposes:

- HTTP browser API on `8081`
- gRPC monitor API on `9090`
- protobuf contract at `backend/proto/monitor/v1/monitor.proto`

## Features

- Browse Kubernetes contexts, namespaces, and workloads.
- Stream pod logs with text search, time windows, and JSON field filtering.
- Format JSON logs and decode embedded JSON strings for easier reading.
- Copy raw and formatted logs from the UI.
- View environment variables, workload specs, pod status, events, crash diagnostics, and metrics.
- Build a service map from Kubernetes services, ingresses, and selectors.
- Infer request chains from log data using correlation IDs, Google Cloud trace IDs, or span IDs.
- Visualize observed request paths as a directional network graph.
- Show an approximate trace stack grouped by `logging.googleapis.com/spanId`.

## Project Layout

```text
backend/
  cmd/server/main.go              # thin entrypoint
  internal/server/                # server implementation
  proto/monitor/v1/               # protobuf and generated Go code

frontend/
  src/app/                        # Next.js app shell
  src/components/                 # monitor views
  src/hooks/                      # API/data hooks
  src/types/                      # frontend data contracts
```

`cmd/server/main.go` intentionally only calls `server.Run()`. Backend implementation lives under `backend/internal/server`.

## Requirements

- Docker and Docker Compose, or:
- Go `1.26.x`
- Node.js `20+`
- A kubeconfig with permission to read the target cluster resources
- For GKE user-auth kubeconfigs, Google Cloud SDK auth plugin support

The backend reads Kubernetes configuration from:

- `KUBECONFIG`, defaulting to `/root/.kube/config`
- in-cluster config if kubeconfig cannot be loaded

## Docker Compose

Copy the environment example:

```bash
cp .env.example .env
```

Default `.env.example` values:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:18888
FRONTEND_PORT=30001
BACKEND_PORT=18888
GRPC_PORT=19090
```

Start the stack:

```bash
docker compose up --build -d
```

Open:

```text
http://localhost:30001
```

The compose backend mounts:

- `${HOME}/.kube` as read-only
- `${HOME}/.config/gcloud`

Treat this as a privileged local operator tool. Do not expose it publicly without authentication and network controls.

## Local Development

Backend:

```bash
cd backend
go test ./...
go run ./cmd/server
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

By default, the frontend uses:

```text
http://localhost:8081
```

Override with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8081 npm run dev
```

## Authentication

The backend supports Google ID token validation.

Environment variables:

```env
AUTH_REQUIRED=true
GOOGLE_CLIENT_ID=<oauth-client-id>
```

When `AUTH_REQUIRED=true`, HTTP and gRPC requests must include:

```http
Authorization: Bearer <google-id-token>
```

Current authorization is audience validation only. If this is deployed beyond local use, add user, domain, or group allowlisting.

## Logs And Search

The log viewer supports:

- plain text search
- structured field search with `field:value`
- nested JSON field search with dot notation, for example `serviceContext.service:my-service`
- formatted JSON expansion
- embedded JSON decoding

Example log search:

```text
correlationId:abc123 severity:INFO
```

or:

```text
serviceContext.service:XYZ
```

## Request Chain And Trace View

The request-chain panel can search by:

- correlation ID
- full Google trace path, for example `projects/my-project/traces/<trace-id>`
- raw trace ID
- span ID

Supported log fields include:

```json
{
  "logging.googleapis.com/trace": "projects/<project>/traces/<trace-id>",
  "logging.googleapis.com/spanId": "<span-id>"
}
```

The monitor uses matching log lines to infer:

- observed directional workload graph
- HTTP-ish events
- Kafka-ish events
- trace/span metadata
- approximate trace stack duration

The trace stack is best-effort. It groups logs by `spanId` and calculates duration from the first and last timestamped log for each span. It is not a full Jaeger/OpenTelemetry span tree unless parent span IDs and exported spans are available.

## API Overview

HTTP routes:

```text
GET /health
GET /api/context
GET /api/namespaces
GET /api/workloads
GET /api/logs
GET /api/logs/stream
GET /api/logs/search
GET /api/request-chain
GET /api/env
GET /api/pod-status
GET /api/workload-spec
GET /api/service-map
GET /api/timeline
GET /api/diagnostics
GET /api/metrics
```

The same monitor capabilities are exposed through gRPC in `MonitorService`.

## Shutdown

The backend handles graceful shutdown:

- listens for `SIGINT` and `SIGTERM`
- shuts down HTTP with `http.Server.Shutdown`
- stops gRPC with `GracefulStop`
- falls back to gRPC `Stop` after timeout

## Operational Notes

- Log reads are server-side bounded to reduce Kubernetes API pressure.
- Normal log reads are capped to the configured maximum window.
- Fanout requests such as global log search and request-chain scans use a tighter time window.
- Pod log reads also use tail line and byte limits.

## Security Notes

This tool can expose sensitive cluster data:

- pod logs
- environment variables
- workload specs
- Kubernetes contexts and namespaces
- inferred traffic relationships

Recommended before shared or remote deployment:

- set `AUTH_REQUIRED=true`
- restrict `Access-Control-Allow-Origin`
- do not expose gRPC publicly unless needed
- avoid mounting broad host kubeconfigs into shared environments
- avoid returning decoded Kubernetes Secret values
- add explicit user/domain/group authorization

## Verification

Backend:

```bash
cd backend
go test ./...
```

Frontend:

```bash
cd frontend
npm run build
```
