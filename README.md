# Kubeweb

Kubeweb is a Next.js frontend + Axum backend for browsing Kubernetes workloads and viewing pod logs.

## Docker compose

1. Copy env example:

```bash
cp .env.example .env
```

Get and replace value to `.env`

```
gcloud config get-value account
gcloud config get-value project

gcloud secrets versions access latest --secret=GOOGLE_CLIENT_ID
gcloud secrets versions access latest --secret=GOOGLE_CLIENT_SECRET
gcloud secrets versions access latest --secret=NEXTAUTH_SECRET
```

Fetch values and print them for manual copy to env files:

2. Start services:

```bash
docker compose up --build -d
```