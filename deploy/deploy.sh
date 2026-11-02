#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
MODE="${2:-deploy}"
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Usage: ./deploy.sh vX.Y.Z' >&2
  exit 2
fi
[[ "$MODE" == deploy || "$MODE" == rollback ]] || { echo 'Invalid mode' >&2; exit 2; }
if [[ "$MODE" == rollback && "${CONFIRM_DB_COMPATIBLE:-}" != yes ]]; then
  echo 'Application rollback does not roll back the database. Review compatibility, then set CONFIRM_DB_COMPATIBLE=yes.' >&2
  exit 2
fi
for cmd in docker nginx curl flock systemctl stat tee; do
  command -v "$cmd" >/dev/null || { echo "Required command unavailable: $cmd" >&2; exit 1; }
done
[[ "$EUID" -eq 0 ]] || { echo 'Run as root with restricted deployment-directory access (Nginx reload requires it).' >&2; exit 1; }
ENV_FILE="$ROOT/.env.production"
COMPOSE_FILE="$ROOT/docker-compose.prod.yml"
if [[ "$MODE" == rollback ]]; then
  TARGET_SNAPSHOT="$(readlink -f "${ZH_ROLLBACK_SNAPSHOT:-/nonexistent}")"
  [[ "$TARGET_SNAPSHOT" == "$ROOT/state/snapshots/"* && -f "$TARGET_SNAPSHOT/version" && "$(<"$TARGET_SNAPSHOT/version")" == "$VERSION" && -f "$TARGET_SNAPSHOT/image" ]] || { echo 'A matching successful rollback snapshot is required' >&2; exit 1; }
  ENV_FILE="$TARGET_SNAPSHOT/env"
  COMPOSE_FILE="$TARGET_SNAPSHOT/compose.yml"
fi
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo 'Missing production configuration' >&2; exit 1; }
[[ "$(stat -c '%a' "$ENV_FILE")" == 600 ]] || { echo '.env.production must have mode 600' >&2; exit 1; }
[[ "$(stat -c '%u' "$ENV_FILE")" == 0 ]] || { echo '.env.production must be owned by root' >&2; exit 1; }
IMAGE_REPO="$(sed -n 's/^IMAGE_REPO=//p' "$ENV_FILE")"
[[ "$IMAGE_REPO" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+$ ]] || { echo 'IMAGE_REPO must be a lowercase GHCR repository' >&2; exit 1; }
for key in DATABASE_URL JWT_SECRET CORS_ORIGINS COOKIE_SECURE; do
  grep -Eq "^${key}=.+" "$ENV_FILE" || { echo "Missing $key" >&2; exit 1; }
done
grep -Eq '^COOKIE_SECURE=true$' "$ENV_FILE" || { echo 'Secure cookies required' >&2; exit 1; }
if grep -Eq 'REPLACE_|development-only' "$ENV_FILE"; then echo 'Replace example secrets before deployment' >&2; exit 1; fi
mkdir -p "$ROOT/state/snapshots" "$ROOT/logs"
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || { echo 'Another deployment holds the lock' >&2; exit 1; }
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG="$ROOT/logs/$RUN_ID-$VERSION.log"
exec > >(tee -a "$LOG") 2>&1
echo "[$RUN_ID] Starting $MODE for $VERSION"
docker info >/dev/null
docker compose version >/dev/null
systemctl is-active --quiet nginx || { echo 'Host Nginx is not active'; exit 1; }
nginx -t
export ZH_ENV_FILE="$ENV_FILE"
export API_IMAGE="$IMAGE_REPO:$VERSION"
if [[ "$MODE" == rollback ]]; then export API_IMAGE="$(<"$TARGET_SNAPSHOT/image")"; fi
compose() { docker compose --project-name zhian-api --env-file "$ZH_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
ready() {
  local i
  for ((i=0;i<30;i++)); do
    if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3000/ready >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
OLD_SNAPSHOT=''
if [[ -L "$ROOT/state/current" ]]; then
  OLD_SNAPSHOT="$(readlink -f "$ROOT/state/current")"
  [[ "$OLD_SNAPSHOT" == "$ROOT/state/snapshots/"* && -f "$OLD_SNAPSHOT/version" && -f "$OLD_SNAPSHOT/compose.yml" && -f "$OLD_SNAPSHOT/env" && -f "$OLD_SNAPSHOT/image" ]] || { echo 'Invalid successful-deployment snapshot'; exit 1; }
  echo "Last successful version: $(<"$OLD_SNAPSHOT/version")"
fi
SWITCHED=0
recover() {
  local code=$?
  trap - ERR INT TERM
  set +e
  echo "Deployment failed (exit $code). Log: $LOG"
  if [[ "$SWITCHED" == 1 ]]; then
    compose logs --no-color --tail 100 api
    if [[ -n "$OLD_SNAPSHOT" ]]; then
      export API_IMAGE="$(<"$OLD_SNAPSHOT/image")"
      export ZH_ENV_FILE="$OLD_SNAPSHOT/env"
      COMPOSE_FILE="$OLD_SNAPSHOT/compose.yml"
      if compose up -d --no-deps --force-recreate api && ready && nginx -t && systemctl reload nginx; then
        echo "Recovered previous API: $(<"$OLD_SNAPSHOT/version"). Database was NOT rolled back."
      else
        echo 'CRITICAL: automatic recovery failed; inspect retained logs and container state.'
      fi
    else
      echo 'First deployment: no successful snapshot exists. Stopping failed API; database is retained.'
      compose stop api
    fi
  else
    echo 'API was not switched; existing service is retained.'
  fi
  printf '%s\t%s\t%s\tfailed\n' "$RUN_ID" "$VERSION" "$MODE" >> "$ROOT/state/history.tsv"
  exit 1
}
trap recover ERR INT TERM
compose config --quiet
compose pull api
PINNED_IMAGE="$(docker image inspect --format '{{index .RepoDigests 0}}' "$API_IMAGE")"
[[ "$PINNED_IMAGE" == "$IMAGE_REPO@sha256:"* ]] || { echo 'Cannot resolve immutable GHCR image digest'; false; }
export API_IMAGE="$PINNED_IMAGE"
if [[ "$MODE" == deploy ]]; then
  echo 'Applying forward-compatible Drizzle migrations before replacing API'
  compose run --rm --no-deps api node dist/db/migrate.js
else
  echo 'Application-only rollback; no database migration is executed.'
fi
SWITCHED=1
compose up -d --no-deps --force-recreate api
ready
nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx
SNAPSHOT="$ROOT/state/snapshots/$RUN_ID-$VERSION"
mkdir "$SNAPSHOT"
cp "$COMPOSE_FILE" "$SNAPSHOT/compose.yml"
cp "$ZH_ENV_FILE" "$SNAPSHOT/env"
printf '%s\n' "$VERSION" > "$SNAPSHOT/version"
printf '%s\n' "$API_IMAGE" > "$SNAPSHOT/image"
chmod 600 "$SNAPSHOT/"*
if [[ -n "$OLD_SNAPSHOT" ]]; then
  ln -s "$OLD_SNAPSHOT" "$ROOT/state/previous.next"
  mv -Tf "$ROOT/state/previous.next" "$ROOT/state/previous"
fi
ln -s "$SNAPSHOT" "$ROOT/state/current.next"
printf '%s\t%s\t%s\tsuccess\n' "$RUN_ID" "$VERSION" "$MODE" >> "$ROOT/state/history.tsv"
mv -Tf "$ROOT/state/current.next" "$ROOT/state/current"
trap - ERR INT TERM
echo "SUCCESS: $VERSION ready; host Nginx reloaded. Snapshot: $SNAPSHOT"
echo 'Database migrations remain applied. Keep encrypted backups outside this server.'
