# Kubeweb

Kubeweb is a Next.js frontend + Axum backend for browsing Kubernetes workloads and viewing pod logs.

## Structure

- frontend: Next.js App Router UI with Google login
- backend: Axum API that talks to the in-cluster Kubernetes API

## Docker compose

1. Copy env example:

```bash
cp .env.example .env
```

Fetch values and print them for manual copy to env files:

Option A: Google Secret Manager (recommended)

```bash
# 1) Check active account and project
gcloud auth list
gcloud config get-value project

# 2) List candidate secrets
gcloud secrets list --format='value(name)' | grep -E 'GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|NEXTAUTH_SECRET'

# 3) Print values
gcloud secrets versions access latest --secret=GOOGLE_CLIENT_ID
gcloud secrets versions access latest --secret=GOOGLE_CLIENT_SECRET
gcloud secrets versions access latest --secret=NEXTAUTH_SECRET
```

Option B: Kubernetes Secret

```bash
# 1) Confirm current context
kubectl config current-context

# 2) Find secrets containing target keys (namespace/name will be shown)
kubectl get secrets -A -o go-template='{{range .items}}{{.metadata.namespace}}/{{.metadata.name}} {{range $k, $v := .data}}{{$k}},{{end}}{{"\n"}}{{end}}' \
| grep -E 'GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|NEXTAUTH_SECRET'

# 3) Print values (replace <namespace> and <secret-name> from step 2)
kubectl -n <namespace> get secret <secret-name> -o jsonpath='{.data.GOOGLE_CLIENT_ID}' | base64 --decode; echo
kubectl -n <namespace> get secret <secret-name> -o jsonpath='{.data.GOOGLE_CLIENT_SECRET}' | base64 --decode; echo
kubectl -n <namespace> get secret <secret-name> -o jsonpath='{.data.NEXTAUTH_SECRET}' | base64 --decode; echo
```

2. Start services:

```bash
docker compose up --build -d
```

Prerequisite for Docker backend on GKE auth:

- The host machine must have `gcloud` logged in (`gcloud auth login` and `gcloud auth application-default login` when required).
- `~/.kube/config` should use `gke-gcloud-auth-plugin`.
- Compose mounts `~/.kube` and `~/.config/gcloud` into backend container.

3. Open apps:

- Frontend: http://localhost:3000
- Backend health: http://localhost:8081/health

4. Stop services:

```bash
docker compose down
```

## Frontend setup

1. Copy env example:

```
cp frontend/.env.local.example frontend/.env.local
```

2. Install deps and run:

```
cd frontend
npm install
npm run dev
```

## Backend setup

1. Copy env example:

```
cp backend/.env.example backend/.env
```

2. Run the backend (Rust toolchain required):

```
cd backend
cargo run
```

## Notes

- Docker backend uses your current host `gcloud` login via mounted `~/.kube` and `~/.config/gcloud`.
- Default compose sets `AUTH_REQUIRED=false` so frontend can call backend without app login.
