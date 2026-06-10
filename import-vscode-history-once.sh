#!/usr/bin/env bash
set -euo pipefail

src_home="${CODEXAPP_IMPORT_SOURCE_HOME:-/srv/aialra/state/root-home/.codex}"
dst_home="${CODEXAPP_IMPORT_TARGET_HOME:-/home/aialra/.codex}"
dst_owner="${CODEXAPP_IMPORT_TARGET_OWNER:-aialra:aialra}"
lock_path="${CODEXAPP_IMPORT_LOCK:-/run/aialra-codexapp-import-vscode-history.lock}"
unarchive_imported="${CODEXAPP_IMPORT_UNARCHIVE:-1}"

log() {
  printf '%s %s\n' "$(date -Is)" "$*"
}

owner_user() {
  printf '%s' "$1" | cut -d: -f1
}

owner_group() {
  printf '%s' "$1" | cut -d: -f2
}

set_owner_mode() {
  local owner="$1"
  shift
  for path in "$@"; do
    [ -e "$path" ] || continue
    chown -R "$owner" "$path"
    if [ -d "$path" ]; then
      find "$path" -type d -exec chmod 0750 {} +
      find "$path" -type f -exec chmod 0640 {} +
    else
      chmod 0640 "$path"
    fi
  done
}

ensure_layout() {
  install -d -m 0750 -o "$(owner_user "$dst_owner")" -g "$(owner_group "$dst_owner")" "$dst_home"
  install -d -m 0750 -o "$(owner_user "$dst_owner")" -g "$(owner_group "$dst_owner")" "$dst_home/sessions"
  install -d -m 0750 -o "$(owner_user "$dst_owner")" -g "$(owner_group "$dst_owner")" "$dst_home/archived_sessions"
}

sqlite_table_exists() {
  local db="$1"
  local table="$2"
  sqlite3 "$db" "select 1 from sqlite_master where type='table' and name='$table';" 2>/dev/null | grep -q 1
}

sqlite_column_exists() {
  local db="$1"
  local table="$2"
  local column="$3"
  sqlite3 "$db" "pragma table_info('$table');" 2>/dev/null | cut -d'|' -f2 | grep -Fxq "$column"
}

sqlite_common_columns_csv() {
  local src="$1"
  local dst="$2"
  local table="$3"
  local src_cols dst_col cols=()

  src_cols="$(sqlite3 "$src" "pragma table_info('$table');" | cut -d'|' -f2 | tr '\n' ' ')"
  while IFS= read -r dst_col; do
    if [[ " $src_cols " == *" $dst_col "* ]]; then
      cols+=("\"$dst_col\"")
    fi
  done < <(sqlite3 "$dst" "pragma table_info('$table');" | cut -d'|' -f2)

  local IFS=,
  printf '%s' "${cols[*]}"
}

sqlite_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

copy_rollouts_one_way() {
  local subdir
  for subdir in sessions archived_sessions; do
    [ -d "$src_home/$subdir" ] || continue
    rsync -rtu --chown="$dst_owner" --chmod=D750,F640 \
      "$src_home/$subdir/" "$dst_home/$subdir/"
  done
}

merge_state_one_way() {
  local src="$1"
  local dst="$2"

  [ -s "$src" ] || return 0
  if [ ! -s "$dst" ]; then
    install -m 0640 -o "$(owner_user "$dst_owner")" -g "$(owner_group "$dst_owner")" "$src" "$dst"
  fi

  sqlite3 "$src" "PRAGMA wal_checkpoint(PASSIVE);" >/dev/null 2>&1 || true
  sqlite3 "$dst" "PRAGMA wal_checkpoint(PASSIVE);" >/dev/null 2>&1 || true

  local sql_file
  sql_file="$(mktemp)"
  {
    printf 'PRAGMA busy_timeout=10000;\n'
    printf "ATTACH '%s' AS src;\n" "$(sqlite_quote "$src")"

    if sqlite_table_exists "$src" "threads" && sqlite_table_exists "$dst" "threads"; then
      local cols update_set
      cols="$(sqlite_common_columns_csv "$src" "$dst" "threads")"
      update_set="$(printf '%s\n' "$cols" | tr ',' '\n' | sed '/"id"/d' | awk '{printf "%s=excluded.%s,", $0, $0}' | sed 's/,$//')"
      if [ -n "$cols" ] && [ -n "$update_set" ]; then
        cat <<SQL
INSERT INTO main.threads ($cols)
SELECT $cols FROM src.threads WHERE true
ON CONFLICT(id) DO UPDATE SET $update_set
WHERE COALESCE(excluded.updated_at_ms, excluded.updated_at * 1000, 0)
  >= COALESCE(main.threads.updated_at_ms, main.threads.updated_at * 1000, 0);
SQL
      fi
    fi

    for table in thread_spawn_edges thread_dynamic_tools device_key_bindings remote_control_enrollments agent_jobs agent_job_items jobs stage1_outputs backfill_state thread_goals; do
      if sqlite_table_exists "$src" "$table" && sqlite_table_exists "$dst" "$table"; then
        local cols
        cols="$(sqlite_common_columns_csv "$src" "$dst" "$table")"
        if [ -n "$cols" ]; then
          printf 'INSERT OR IGNORE INTO main.%s (%s) SELECT %s FROM src.%s;\n' "$table" "$cols" "$cols" "$table"
        fi
      fi
    done

    if [ "$unarchive_imported" = "1" ] && sqlite_table_exists "$src" "threads" && sqlite_table_exists "$dst" "threads"; then
      cat <<SQL
UPDATE main.threads
SET archived = 0, archived_at = NULL
WHERE id IN (SELECT id FROM src.threads);
SQL
    fi

    printf 'DETACH src;\n'
  } > "$sql_file"

  sqlite3 "$dst" < "$sql_file" >/dev/null
  rm -f "$sql_file"
}

normalize_state_for_target_home() {
  local db="$1"
  [ -s "$db" ] || return 0
  sqlite_table_exists "$db" "threads" || return 0

  local src_sql dst_sql
  src_sql="$(sqlite_quote "$src_home")"
  dst_sql="$(sqlite_quote "$dst_home")"

  sqlite3 "$db" <<SQL >/dev/null
PRAGMA busy_timeout=10000;
UPDATE threads
SET rollout_path = '${dst_sql}' || substr(rollout_path, length('${src_sql}') + 1)
WHERE rollout_path = '${src_sql}'
   OR rollout_path LIKE '${src_sql}/%';
SQL
}

refresh_thread_times_from_rollouts() {
  local db="$1"
  [ -s "$db" ] || return 0
  sqlite_table_exists "$db" "threads" || return 0

  local sql_file id path mtime_s mtime_ms id_sql
  sql_file="$(mktemp)"
  {
    printf 'PRAGMA busy_timeout=10000;\n'
    printf 'BEGIN;\n'
    while IFS=$'\t' read -r id path; do
      [ -n "$id" ] || continue
      [ -f "$path" ] || continue
      mtime_s="$(stat -c %Y "$path" 2>/dev/null || true)"
      [[ "$mtime_s" =~ ^[0-9]+$ ]] || continue
      mtime_ms=$((mtime_s * 1000))
      id_sql="$(sqlite_quote "$id")"
      printf "UPDATE threads SET updated_at = CASE WHEN updated_at < %s THEN %s ELSE updated_at END, updated_at_ms = CASE WHEN COALESCE(updated_at_ms, updated_at * 1000, 0) < %s THEN %s ELSE updated_at_ms END WHERE id = '%s';\n" \
        "$mtime_s" "$mtime_s" "$mtime_ms" "$mtime_ms" "$id_sql"
    done < <(sqlite3 -separator $'\t' "$db" "SELECT id, rollout_path FROM threads;")
    printf 'COMMIT;\n'
  } > "$sql_file"

  sqlite3 "$db" < "$sql_file" >/dev/null
  rm -f "$sql_file"
}

refresh_session_index_from_state() {
  local db="$dst_home/state_5.sqlite"
  local index="$dst_home/session_index.jsonl"
  [ -s "$db" ] || return 0
  sqlite_table_exists "$db" "threads" || return 0

  local tmp fallback_expr
  tmp="$(mktemp)"
  if sqlite_column_exists "$db" "threads" "preview"; then
    fallback_expr="WHEN preview IS NOT NULL AND length(trim(preview)) > 0 THEN preview"
  else
    fallback_expr="WHEN first_user_message IS NOT NULL AND length(trim(first_user_message)) > 0 THEN first_user_message"
  fi

  sqlite3 -cmd ".timeout 10000" "$db" <<SQL > "$tmp"
SELECT json_object(
  'id', id,
  'thread_name', CASE
    WHEN title IS NOT NULL AND length(trim(title)) > 0 THEN title
    ${fallback_expr}
    ELSE id
  END,
  'updated_at', strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(updated_at_ms, updated_at * 1000, created_at * 1000) / 1000.0, 'unixepoch')
)
FROM threads
WHERE archived = 0
ORDER BY COALESCE(updated_at_ms, updated_at * 1000, created_at * 1000) DESC, id DESC;
SQL
  mv "$tmp" "$index"
  set_owner_mode "$dst_owner" "$index"
}

main() {
  install -d -m 0755 "$(dirname "$lock_path")"
  exec 9>"$lock_path"
  flock -n 9 || {
    log "another import is already running"
    exit 0
  }

  ensure_layout
  copy_rollouts_one_way
  merge_state_one_way "$src_home/state_5.sqlite" "$dst_home/state_5.sqlite"
  normalize_state_for_target_home "$dst_home/state_5.sqlite"
  refresh_thread_times_from_rollouts "$dst_home/state_5.sqlite"
  refresh_session_index_from_state
  set_owner_mode "$dst_owner" "$dst_home/state_5.sqlite" "$dst_home/state_5.sqlite-wal" "$dst_home/state_5.sqlite-shm" "$dst_home/sessions" "$dst_home/archived_sessions"
  log "imported vscode/root Codex history into CodexApp once"
}

main "$@"
