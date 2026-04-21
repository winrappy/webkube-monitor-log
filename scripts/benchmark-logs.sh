#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:18888}"
NAMESPACE=""
KIND=""
NAME=""
CONTEXT=""
SEARCH=""
SINCE_MINUTES="15"
RUNS="10"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") --namespace <ns> --kind <Deployment|StatefulSet|DaemonSet> --name <workload> [options]

Options:
  --api-base-url <url>   Backend base URL (default: ${API_BASE_URL})
  --namespace <name>     Namespace (required)
  --kind <kind>          Workload kind (required)
  --name <name>          Workload name (required)
  --context <context>    Optional kube context
  --search <text>        Optional search text
  --since-minutes <num>  Time range in minutes (default: 15)
  --runs <num>           Number of benchmark requests (default: 10)

Example:
  $(basename "$0") --namespace mfoa-sit --kind Deployment --name my-app --runs 20 --since-minutes 60
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base-url)
      API_BASE_URL="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --kind)
      KIND="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --context)
      CONTEXT="$2"
      shift 2
      ;;
    --search)
      SEARCH="$2"
      shift 2
      ;;
    --since-minutes)
      SINCE_MINUTES="$2"
      shift 2
      ;;
    --runs)
      RUNS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$NAMESPACE" || -z "$KIND" || -z "$NAME" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

query="namespace=${NAMESPACE}&kind=${KIND}&name=${NAME}&since_minutes=${SINCE_MINUTES}"
if [[ -n "$CONTEXT" ]]; then
  query+="&context=${CONTEXT}"
fi
if [[ -n "$SEARCH" ]]; then
  query+="&search=${SEARCH}"
fi

url="${API_BASE_URL}/api/logs?${query}"

echo "Benchmark URL: ${url}"
echo "Runs: ${RUNS}"

# Warm up request
curl -sS -o /dev/null "$url"

times_file="$(mktemp)"
trap 'rm -f "$times_file"' EXIT

for i in $(seq 1 "$RUNS"); do
  t=$(curl -sS -o /dev/null -w "%{time_total}" "$url")
  echo "$t" >> "$times_file"
  printf "Run %02d: %ss\n" "$i" "$t"
done

awk '
BEGIN { min=999999; max=0; sum=0; n=0 }
{
  val=$1+0;
  if (val < min) min=val;
  if (val > max) max=val;
  sum += val;
  n += 1;
}
END {
  if (n == 0) {
    print "No measurements.";
    exit 1;
  }
  printf "\nSummary\n";
  printf "Average: %.4fs\n", sum/n;
  printf "Min:     %.4fs\n", min;
  printf "Max:     %.4fs\n", max;
}
' "$times_file"
