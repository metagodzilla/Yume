#!/usr/bin/env bash
# Prints a Salad container-group create body.
# Sends it only when you pass --apply. This file does not contain credentials.
set -euo pipefail

if [[ -z "${SALAD_ORGANIZATION:-}" || -z "${SALAD_PROJECT:-}" || -z "${YUME_IMAGE:-}" || -z "${GPU_CLASS_ID:-}" ]]; then
  echo "Set SALAD_ORGANIZATION, SALAD_PROJECT, YUME_IMAGE, and GPU_CLASS_ID." >&2
  echo "GPU_CLASS_ID comes from:" >&2
  echo "  curl --header \"Salad-Api-Key: \$SALAD_API_KEY\" \\" >&2
  echo "    https://api.salad.com/api/public/organizations/\$SALAD_ORGANIZATION/gpu-classes" >&2
  exit 1
fi

NAME="${CONTAINER_GROUP_NAME:-yume}"
KEY="${YUME_API_KEY:-${SALAD_API_KEY:-}}"

BODY="$(cat <<EOF
{
  "name": "${NAME}",
  "display_name": "Yume",
  "autostart_policy": false,
  "restart_policy": "always",
  "replicas": 1,
  "container": {
    "image": "${YUME_IMAGE}",
    "priority": "low",
    "environment_variables": {
      "YUME_API_KEY": "${KEY}",
      "YUME_MODEL_ID": "cagliostrolab/animagine-xl-4.0",
      "YUME_LORA_DIR": "/loras",
      "HF_HOME": "/models"
    },
    "resources": {
      "cpu": 4,
      "memory": 16384,
      "storage_amount": 26843545600,
      "gpu_classes": ["${GPU_CLASS_ID}"]
    }
  },
  "networking": {
    "protocol": "http",
    "auth": true,
    "port": 8080,
    "load_balancer": "least_number_of_connections",
    "client_request_timeout": 100000,
    "server_response_timeout": 100000
  },
  "startup_probe": {
    "http": { "path": "/ready", "port": 8080, "scheme": "http", "headers": [] },
    "initial_delay_seconds": 60,
    "period_seconds": 60,
    "timeout_seconds": 10,
    "success_threshold": 1,
    "failure_threshold": 20
  },
  "readiness_probe": {
    "http": { "path": "/ready", "port": 8080, "scheme": "http", "headers": [] },
    "initial_delay_seconds": 0,
    "period_seconds": 10,
    "timeout_seconds": 5,
    "success_threshold": 1,
    "failure_threshold": 3
  },
  "liveness_probe": {
    "http": { "path": "/health", "port": 8080, "scheme": "http", "headers": [] },
    "initial_delay_seconds": 30,
    "period_seconds": 30,
    "timeout_seconds": 5,
    "success_threshold": 1,
    "failure_threshold": 3
  }
}
EOF
)"

echo "$BODY"

if [[ "${1:-}" != "--apply" ]]; then
  echo >&2
  echo "Not sent. Re-run with --apply after SALAD_API_KEY is set if you really want to create the group." >&2
  exit 0
fi

if [[ -z "${SALAD_API_KEY:-}" ]]; then
  echo "SALAD_API_KEY is required for --apply." >&2
  exit 1
fi

curl --fail-with-body --silent --show-error \
  --request POST \
  --url "https://api.salad.com/api/public/organizations/${SALAD_ORGANIZATION}/projects/${SALAD_PROJECT}/containers" \
  --header "Salad-Api-Key: ${SALAD_API_KEY}" \
  --header "accept: application/json" \
  --header "content-type: application/json" \
  --data "$BODY"

echo >&2
echo "Created stopped. Start it with:" >&2
echo "curl --request POST --header \"Salad-Api-Key: \$SALAD_API_KEY\" \\" >&2
echo "  https://api.salad.com/api/public/organizations/${SALAD_ORGANIZATION}/projects/${SALAD_PROJECT}/containers/${NAME}/start" >&2
