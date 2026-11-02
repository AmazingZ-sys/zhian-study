#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bash -n "$ROOT/deploy/deploy.sh" "$ROOT/deploy/rollback.sh"
if bash "$ROOT/deploy/deploy.sh" latest >/dev/null 2>&1; then echo 'latest must be rejected'; exit 1; fi
if bash "$ROOT/deploy/rollback.sh" v1.0.0 >/dev/null 2>&1; then echo 'Unconfirmed rollback must be rejected'; exit 1; fi
if [[ "$(uname -s)" == Linux && "$EUID" -eq 0 ]]; then
  bash "$ROOT/scripts/test-deploy-linux.sh"
else
  docker run --rm --network none -v "$ROOT:/workspace:ro" --entrypoint bash postgres:16-alpine /workspace/scripts/test-deploy-linux.sh
fi
