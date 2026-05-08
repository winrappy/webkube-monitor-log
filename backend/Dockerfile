FROM golang:1.26.2-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/go-kube-monitor ./cmd/server

FROM debian:bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
		&& apt-get install -y --no-install-recommends ca-certificates curl gnupg \
		&& mkdir -p /etc/apt/keyrings \
		&& curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
			| gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg \
		&& echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
			> /etc/apt/sources.list.d/google-cloud-sdk.list \
		&& apt-get update \
		&& apt-get install -y --no-install-recommends google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin \
		&& rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/google-cloud-sdk/bin:${PATH}"
COPY --from=builder /out/go-kube-monitor /usr/local/bin/go-kube-monitor
EXPOSE 8081
EXPOSE 9090
CMD ["/usr/local/bin/go-kube-monitor"]
