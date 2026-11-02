#!/usr/bin/env bash
set -Eeuo pipefail
IMAGE="${1:-zhian-study-api:local}"
NETWORK="${TEST_CONTAINER_NETWORK:-zhian-study_default}"
DB="${TEST_CONTAINER_DATABASE_URL:-postgresql://zhian:local-development-only@db:5432/zhian_test}"
[[ "$DB" == */*_test ]] || { echo 'Container smoke tests require a dedicated _test database'; exit 2; }
[[ "$(docker image inspect "$IMAGE" --format '{{.Config.User}}')" == node ]]
docker run --rm --entrypoint sh "$IMAGE" -c 'test "$(id -u)" != 0; test ! -f /app/.env; test ! -e /app/node_modules/typescript; test -f /app/dist/db/migrate.js'
docker run --rm --network "$NETWORK" -e NODE_ENV=test -e DATABASE_URL="$DB" "$IMAGE" node dist/db/migrate.js
CONTAINER="zhian-api-smoke-$$"
trap 'docker stop "$CONTAINER" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$CONTAINER" --network "$NETWORK" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges:true -p 127.0.0.1:3300:3000 -e NODE_ENV=production -e DATABASE_URL="$DB" -e JWT_SECRET=container-smoke-unique-test-key-1234567890 -e CORS_ORIGINS=https://study.example.com -e COOKIE_SECURE=true "$IMAGE" >/dev/null
for ((i=0;i<30;i++)); do
  if curl --fail --silent http://127.0.0.1:3300/ready >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:3300/health
curl --fail --silent http://127.0.0.1:3300/ready
curl --fail --silent http://127.0.0.1:3300/api/v1/question-categories >/dev/null
docker logs "$CONTAINER" --tail 5
echo 'PASS non-root image, production runtime dependencies, migrations, read-only filesystem, real database readiness and API read'
