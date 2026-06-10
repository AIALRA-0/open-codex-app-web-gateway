#!/usr/bin/env bash
set -euo pipefail

source_auth="${CODEXAPP_SOURCE_AUTH:-/srv/aialra/state/root-home/.codex/auth.json}"
target_auth="${CODEXAPP_TARGET_AUTH:-/home/aialra/.codex/auth.json}"
target_user="${CODEXAPP_TARGET_USER:-aialra}"
target_group="${CODEXAPP_TARGET_GROUP:-aialra}"
interval="${CODEXAPP_SYNC_INTERVAL:-2}"
target_process_pattern="${CODEXAPP_TARGET_PROCESS_PATTERN:-codex app-server .*--listen ws://127\\.0\\.0\\.1:12911}"
restart_on_change="${CODEXAPP_SYNC_RESTART_ON_CHANGE:-1}"

target_appserver_running() {
  pgrep -u "$target_user" -f "$target_process_pattern" >/dev/null 2>&1
}

hash_file() {
  local file="$1"
  [ -s "$file" ] || return 0
  sha256sum "$file" | awk '{print $1}'
}

stop_target_appserver() {
  target_appserver_running || return 0
  echo "stopping target app-server before auth.json sync at $(date -Is)"
  pkill -TERM -u "$target_user" -f "$target_process_pattern" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    target_appserver_running || return 0
    sleep 1
  done
  pkill -KILL -u "$target_user" -f "$target_process_pattern" >/dev/null 2>&1 || true
}

copy_once() {
  if [ ! -s "$source_auth" ]; then
    echo "source auth missing or empty: $source_auth" >&2
    return 1
  fi

  local target_dir tmp_file
  target_dir="$(dirname "$target_auth")"
  mkdir -p "$target_dir"
  tmp_file="${target_auth}.tmp.$$"
  install -m 0600 -o "$target_user" -g "$target_group" "$source_auth" "$tmp_file"
  mv -f "$tmp_file" "$target_auth"
  chown "$target_user:$target_group" "$target_auth"
  chmod 0600 "$target_auth"
}

last_skip_hash=""
while true; do
  if [ -s "$source_auth" ]; then
    current_hash="$(hash_file "$source_auth")"
    target_hash="$(hash_file "$target_auth")"
    if [ -n "$current_hash" ] && [ "$current_hash" != "$target_hash" ]; then
      if [ -s "$target_auth" ] && target_appserver_running && [ "$restart_on_change" != "1" ]; then
        if [ "$current_hash" != "$last_skip_hash" ]; then
          echo "deferred auth.json sync while target app-server is running at $(date -Is)"
          last_skip_hash="$current_hash"
        fi
      else
        if [ -s "$target_auth" ] && target_appserver_running; then
          stop_target_appserver
        fi
        copy_once
        last_skip_hash=""
        echo "synced auth.json at $(date -Is)"
      fi
    fi
  fi
  sleep "$interval"
done
