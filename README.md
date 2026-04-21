# Kubeweb

Kubeweb is a Next.js frontend + Axum backend for browsing Kubernetes workloads and viewing pod logs.

## Docker compose

1. Copy env example:

```bash
cp .env.example .env
```

Fetch values and print them for manual copy to env files:

2. Start services:

```bash
docker compose up --build -d
```