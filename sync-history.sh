#!/usr/bin/env bash
set -euo pipefail

vscode_home="${CODEX_HISTORY_VSCODE_HOME:-/srv/aialra/state/root-home/.codex}"
codexapp_home="${CODEX_HISTORY_CODEXAPP_HOME:-/home/aialra/.codex}"
interval="${CODEX_HISTORY_SYNC_INTERVAL:-5}"
verbose="${CODEX_HISTORY_SYNC_VERBOSE:-0}"
vscode_owner="${CODEX_HISTORY_VSCODE_OWNER:-root:codexmgr}"
codexapp_owner="${CODEX_HISTORY_CODEXAPP_OWNER:-aialra:aialra}"
lock_path="${CODEX_HISTORY_SYNC_LOCK:-/run/aialra-codex-history-sync.lock}"
min_free_mb="${CODEX_HISTORY_SYNC_MIN_FREE_MB:-10240}"
group_script="${CODEX_HISTORY_GROUP_SCRIPT:-/srv/aialra/apps/codexapp/group-codexapp-history.js}"

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

require_free_space() {
  local path="$1"
  local available
  available="$(df -Pm "$path" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "$available" || ! "$available" =~ ^[0-9]+$ ]]; then
    log "ERROR: unable to determine free disk space for $path"
    return 1
  fi
  if [ "$available" -lt "$min_free_mb" ]; then
    log "ERROR: refusing history sync with only ${available}MB free at $path; need at least ${min_free_mb}MB"
    return 1
  fi
}

ensure_layout() {
  install -d -m 0750 -o "$(owner_user "$vscode_owner")" -g "$(owner_group "$vscode_owner")" "$vscode_home/sessions"
  install -d -m 0750 -o "$(owner_user "$codexapp_owner")" -g "$(owner_group "$codexapp_owner")" "$codexapp_home/sessions"
  install -d -m 0750 -o "$(owner_user "$vscode_owner")" -g "$(owner_group "$vscode_owner")" "$vscode_home/archived_sessions"
  install -d -m 0750 -o "$(owner_user "$codexapp_owner")" -g "$(owner_group "$codexapp_owner")" "$codexapp_home/archived_sessions"
}

sync_sessions() {
  local subdir
  for subdir in sessions archived_sessions; do
    rsync -rtu \
      --chown="$codexapp_owner" --chmod=D750,F640 \
      "$vscode_home/$subdir/" "$codexapp_home/$subdir/"
    rsync -rtu \
      --chown="$vscode_owner" --chmod=D750,F640 \
      "$codexapp_home/$subdir/" "$vscode_home/$subdir/"
  done
}

merge_jsonl_pair() {
  local mode="$1"
  local left="$2"
  local right="$3"

  node - "$mode" "$left" "$right" <<'NODE'
const fs = require("fs");
const path = require("path");

const [mode, left, right] = process.argv.slice(2);

function readLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function recordFor(line, order) {
  const json = parseLine(line);
  if (mode === "session_index" && json && json.id) {
    return {
      key: `id:${json.id}`,
      score: timestamp(json.updated_at),
      order,
      line: JSON.stringify(json),
    };
  }
  if (mode === "history" && json) {
    const key = `${json.session_id || ""}|${json.ts || ""}|${json.text || ""}`;
    return {
      key: `history:${key}`,
      score: timestamp(json.ts),
      order,
      line: JSON.stringify(json),
    };
  }
  return {
    key: `raw:${line}`,
    score: 0,
    order,
    line,
  };
}

const records = [];
let order = 0;
for (const line of [...readLines(left), ...readLines(right)]) {
  records.push(recordFor(line, order++));
}

const byKey = new Map();
for (const record of records) {
  const existing = byKey.get(record.key);
  if (!existing || record.score > existing.score || (record.score === existing.score && record.order > existing.order)) {
    byKey.set(record.key, record);
  }
}

let merged = [...byKey.values()];
if (mode === "session_index") {
  merged.sort((a, b) => (b.score - a.score) || (a.order - b.order));
} else {
  merged.sort((a, b) => (a.score - b.score) || (a.order - b.order));
}

const output = merged.map((record) => record.line).join("\n") + (merged.length ? "\n" : "");

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w", 0o600);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
  } catch (error) {
    try { if (fd !== null) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

for (const file of [left, right]) {
  writeAtomic(file, output);
}
NODE

  set_owner_mode "$vscode_owner" "$left"
  set_owner_mode "$codexapp_owner" "$right"
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

merge_state_one_way() {
  local src="$1"
  local dst="$2"
  [ -s "$src" ] || return 0
  [ -s "$dst" ] || cp -a "$src" "$dst"

  sqlite3 "$src" "PRAGMA wal_checkpoint(PASSIVE);" >/dev/null 2>&1 || true
  sqlite3 "$dst" "PRAGMA wal_checkpoint(PASSIVE);" >/dev/null 2>&1 || true

  local sql_file
  sql_file="$(mktemp)"
  {
    printf 'PRAGMA busy_timeout=5000;\n'
    printf "ATTACH '%s' AS src;\n" "$src"

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
  > COALESCE(main.threads.updated_at_ms, main.threads.updated_at * 1000, 0);
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

    printf 'DETACH src;\n'
  } > "$sql_file"

  sqlite3 "$dst" < "$sql_file" >/dev/null
  rm -f "$sql_file"
}

normalize_state_for_home() {
  local db="$1"
  local home="$2"
  local other_home="$3"
  [ -s "$db" ] || return 0
  sqlite_table_exists "$db" "threads" || return 0

  local home_sql other_sql
  home_sql="$(sqlite_quote "$home")"
  other_sql="$(sqlite_quote "$other_home")"

  sqlite3 "$db" <<SQL >/dev/null
PRAGMA busy_timeout=5000;
UPDATE threads
SET rollout_path = '${home_sql}' || substr(rollout_path, length('${other_sql}') + 1)
WHERE rollout_path = '${other_sql}'
   OR rollout_path LIKE '${other_sql}/%';
SQL
}

refresh_thread_times_from_rollouts() {
  local db="$1"
  [ -s "$db" ] || return 0
  sqlite_table_exists "$db" "threads" || return 0
  sqlite_column_exists "$db" "threads" "updated_at_ms" || return 0

  local sql_file rows_file body_file
  sql_file="$(mktemp)"
  rows_file="$(mktemp)"
  body_file="$(mktemp)"
  sqlite3 -separator $'\t' "$db" "SELECT id, rollout_path FROM threads;" > "$rows_file"

  if ! node - "$rows_file" > "$body_file" <<'NODE'
const fs = require("fs");
const rowsFile = process.argv[2];

function sqlQuote(value) {
  return String(value).replace(/'/g, "''");
}

for (const row of fs.readFileSync(rowsFile, "utf8").split(/\r?\n/)) {
  if (!row.trim()) continue;
  const tab = row.indexOf("\t");
  if (tab < 1) continue;
  const id = row.slice(0, tab);
  const file = row.slice(tab + 1);
  if (!file || !fs.existsSync(file)) continue;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || !Number.isFinite(stat.mtimeMs) || stat.mtimeMs <= 0) continue;
  const rolloutMs = Math.trunc(stat.mtimeMs);
  const rolloutS = Math.trunc(rolloutMs / 1000);
  process.stdout.write(`UPDATE threads SET updated_at = ${rolloutS}, updated_at_ms = ${rolloutMs} WHERE id = '${sqlQuote(id)}';\n`);
}
NODE
  then
    rm -f "$sql_file" "$rows_file" "$body_file"
    return 1
  fi

  {
    printf 'PRAGMA busy_timeout=5000;\n'
    printf 'BEGIN;\n'
    cat "$body_file"
    printf 'COMMIT;\n'
  } > "$sql_file"

  sqlite3 "$db" < "$sql_file" >/dev/null
  rm -f "$sql_file" "$rows_file" "$body_file"
}

refresh_session_index_from_state() {
  local home="$1"
  local owner="$2"
  local db="$home/state_5.sqlite"
  local index="$home/session_index.jsonl"
  [ -s "$db" ] || return 0
  sqlite_table_exists "$db" "threads" || return 0

  local tmp fallback_expr updated_expr
  tmp="$(mktemp)"
  fallback_expr=""
  if sqlite_column_exists "$db" "threads" "preview"; then
    fallback_expr="${fallback_expr}
    WHEN preview IS NOT NULL AND length(trim(preview)) > 0 THEN preview"
  fi
  if sqlite_column_exists "$db" "threads" "first_user_message"; then
    fallback_expr="${fallback_expr}
    WHEN first_user_message IS NOT NULL AND length(trim(first_user_message)) > 0 THEN first_user_message"
  fi
  if sqlite_column_exists "$db" "threads" "updated_at_ms"; then
    updated_expr="COALESCE(updated_at_ms, updated_at * 1000, created_at * 1000)"
  else
    updated_expr="COALESCE(updated_at * 1000, created_at * 1000)"
  fi
  sqlite3 -cmd ".timeout 5000" "$db" <<SQL > "$tmp"
SELECT json_object(
  'id', id,
  'thread_name', CASE
    WHEN title IS NOT NULL AND length(trim(title)) > 0 THEN title
    ${fallback_expr}
    ELSE id
  END,
  'updated_at', strftime('%Y-%m-%dT%H:%M:%fZ', ${updated_expr} / 1000.0, 'unixepoch')
)
FROM threads
WHERE archived = 0
ORDER BY ${updated_expr} DESC, id DESC;
SQL
  mv "$tmp" "$index"
  set_owner_mode "$owner" "$index"
}

refresh_host_state_groups() {
  command -v node >/dev/null 2>&1 || return 0
  [ -f "$group_script" ] || return 0
  CODEXAPP_HOME="$vscode_home" node "$group_script" >/dev/null
}

merge_state_sqlite() {
  local left="$vscode_home/state_5.sqlite"
  local right="$codexapp_home/state_5.sqlite"
  if [ -s "$left" ] || [ -s "$right" ]; then
    merge_state_one_way "$left" "$right"
    merge_state_one_way "$right" "$left"
    normalize_state_for_home "$left" "$vscode_home" "$codexapp_home"
    normalize_state_for_home "$right" "$codexapp_home" "$vscode_home"
    refresh_thread_times_from_rollouts "$left"
    refresh_thread_times_from_rollouts "$right"
    refresh_session_index_from_state "$vscode_home" "$vscode_owner"
    refresh_session_index_from_state "$codexapp_home" "$codexapp_owner"
    set_owner_mode "$vscode_owner" "$left" "$left-wal" "$left-shm"
    set_owner_mode "$codexapp_owner" "$right" "$right-wal" "$right-shm"
  fi
}

sync_once() {
  require_free_space "$vscode_home"
  require_free_space "$codexapp_home"
  ensure_layout
  sync_sessions
  merge_jsonl_pair session_index "$vscode_home/session_index.jsonl" "$codexapp_home/session_index.jsonl"
  merge_jsonl_pair history "$vscode_home/history.jsonl" "$codexapp_home/history.jsonl"
  merge_state_sqlite
  refresh_host_state_groups
}

main() {
  install -d -m 0755 "$(dirname "$lock_path")"
  exec 9>"$lock_path"
  flock -n 9 || exit 0

  if [ "${1:-}" = "--once" ]; then
    sync_once
    log "history sync completed once"
    return 0
  fi

  while true; do
    if sync_once; then
      if [ "$verbose" = "1" ]; then
        log "history sync completed"
      fi
    else
      log "history sync failed"
    fi
    sleep "$interval"
  done
}

main "$@"
