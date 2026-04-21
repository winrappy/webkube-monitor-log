FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

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
COPY --from=builder /app/target/release/kubeweb-backend /usr/local/bin/kubeweb-backend
EXPOSE 8081
CMD ["/usr/local/bin/kubeweb-backend"]
