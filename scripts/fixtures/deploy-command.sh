#!/usr/bin/env bash
set -eu
name="$(basename "$0")"
printf '%s %s\n' "$name" "$*" >> "$MOCK_ROOT/commands"
case "$name" in
  flock) [[ "${SCENARIO:-}" != lock ]];;
  sleep) exit 0;;
  nginx)
    if [[ "${SCENARIO:-}" == nginx && -f "$MOCK_ROOT/switched" ]]; then rm "$MOCK_ROOT/switched"; exit 1; fi;;
  systemctl)
    if [[ "${SCENARIO:-}" == reload && "$1" == reload && ! -f "$MOCK_ROOT/failed" ]]; then touch "$MOCK_ROOT/failed"; exit 1; fi;;
  curl)
    if [[ "${SCENARIO:-}" == health && "$(cat "$MOCK_ROOT/running")" == *sha256:2222* ]]; then exit 1; fi;;
  docker)
    if [[ "$*" == *' run '* && "${SCENARIO:-}" == migration ]]; then exit 1; fi
    if [[ "$*" == *' up '* ]]; then printf '%s' "$API_IMAGE" > "$MOCK_ROOT/running"; touch "$MOCK_ROOT/switched"; fi
    if [[ "$*" == 'image inspect '* ]]; then
      if [[ "$API_IMAGE" == *@sha256:* ]]; then printf '%s\n' "$API_IMAGE";
      else
        case "$API_IMAGE" in *v1.0.0) digit=1;; *v1.1.0) digit=2;; *) digit=3;; esac
        digest="$(printf '%064d' 0 | tr 0 "$digit")"
        printf 'ghcr.io/example/zhian-api@sha256:%s\n' "$digest"
      fi
    fi;;
esac
