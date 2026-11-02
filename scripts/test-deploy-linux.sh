#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export MOCK_ROOT
MOCK_ROOT="$(mktemp -d /tmp/zhian-deploy-test.XXXXXXXX)"
trap 'rm -rf -- "$MOCK_ROOT"' EXIT
mkdir "$MOCK_ROOT/bin" "$MOCK_ROOT/deploy"
cp "$ROOT/deploy/deploy.sh" "$ROOT/deploy/rollback.sh" "$ROOT/deploy/docker-compose.prod.yml" "$MOCK_ROOT/deploy/"
cp "$ROOT/scripts/fixtures/deploy.env" "$MOCK_ROOT/deploy/.env.production"
chmod 600 "$MOCK_ROOT/deploy/.env.production"
chmod +x "$MOCK_ROOT/deploy/"*.sh
for name in docker nginx curl systemctl flock sleep; do
  cp "$ROOT/scripts/fixtures/deploy-command.sh" "$MOCK_ROOT/bin/$name"
  chmod +x "$MOCK_ROOT/bin/$name"
done
export PATH="$MOCK_ROOT/bin:$PATH"
DEPLOY="$MOCK_ROOT/deploy"
bash "$DEPLOY/deploy.sh" v1.0.0 > "$MOCK_ROOT/result" 2>&1
[[ "$(cat "$DEPLOY/state/current/version")" == v1.0.0 ]]
echo 'PASS first deployment and snapshot'
for scenario in migration health nginx reload lock; do
  rm -f "$MOCK_ROOT/switched" "$MOCK_ROOT/failed"
  if SCENARIO="$scenario" bash "$DEPLOY/deploy.sh" v1.1.0 > "$MOCK_ROOT/result" 2>&1; then
    cat "$MOCK_ROOT/result"; echo "Unexpected success: $scenario"; exit 1
  fi
  [[ "$(cat "$DEPLOY/state/current/version")" == v1.0.0 ]]
  [[ "$(cat "$MOCK_ROOT/running")" == *sha256:1111* ]]
  echo "PASS $scenario failure retains last successful version"
done
bash "$DEPLOY/deploy.sh" v1.2.0 > "$MOCK_ROOT/result" 2>&1
[[ "$(cat "$DEPLOY/state/current/version")" == v1.2.0 ]]
[[ "$(cat "$DEPLOY/state/previous/version")" == v1.0.0 ]]
echo 'PASS subsequent successful deployment'
: > "$MOCK_ROOT/commands"
CONFIRM_DB_COMPATIBLE=yes bash "$DEPLOY/rollback.sh" > "$MOCK_ROOT/result" 2>&1
[[ "$(cat "$DEPLOY/state/current/version")" == v1.0.0 ]]
if grep -q 'dist/db/migrate.js' "$MOCK_ROOT/commands"; then echo 'Rollback ran migrations'; exit 1; fi
echo 'PASS previous-version rollback without migration'
CONFIRM_DB_COMPATIBLE=yes bash "$DEPLOY/rollback.sh" v1.2.0 > "$MOCK_ROOT/result" 2>&1
[[ "$(cat "$DEPLOY/state/current/version")" == v1.2.0 ]]
echo 'PASS explicit-version rollback'
chmod 644 "$DEPLOY/.env.production"
if bash "$DEPLOY/deploy.sh" v1.3.0 > "$MOCK_ROOT/result" 2>&1; then echo 'Insecure permissions accepted'; exit 1; fi
echo 'PASS insecure env permissions rejected'
echo '10 isolated Linux mock scenarios passed; no production server was contacted.'
