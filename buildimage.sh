#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

image=jslog/ledger-api:${1:-latest}

docker build -t "$image" -f Dockerfile .
docker push "$image"
