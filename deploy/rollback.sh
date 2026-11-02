#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  [[ -f "$ROOT/state/previous/version" ]] || { echo 'No previous successful deployment is recorded' >&2; exit 2; }
  VERSION="$(<"$ROOT/state/previous/version")"
fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid version' >&2; exit 2; }
[[ "${CONFIRM_DB_COMPATIBLE:-}" == yes ]] || { echo 'Review target-version compatibility with the current database, then run CONFIRM_DB_COMPATIBLE=yes ./rollback.sh [vX.Y.Z]. No database downgrade is performed.' >&2; exit 2; }
ZH_ROLLBACK_SNAPSHOT=''
for candidate in "$ROOT/state/snapshots/"*; do
  if [[ -f "$candidate/version" && "$(<"$candidate/version")" == "$VERSION" ]]; then ZH_ROLLBACK_SNAPSHOT="$candidate"; fi
done
[[ -n "$ZH_ROLLBACK_SNAPSHOT" ]] || { echo 'No saved successful snapshot for this version. Restore the matching configuration before redeployment.' >&2; exit 2; }
export ZH_ROLLBACK_SNAPSHOT
exec "$ROOT/deploy.sh" "$VERSION" rollback
