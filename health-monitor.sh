#!/usr/bin/env bash
# Codex App Health Monitor
# Prevents service from getting stuck when auth token expires

set -euo pipefail

LOG_FILE="/srv/aialra/logs/codexapp/health-monitor.log"
ACTIVE_AUTH="/srv/aialra/state/root-home/.codex/auth.json"
SWITCHER_DB="/srv/aialra/state/codex-switcher/codex-switcher.db"
BOOTSTRAP_DIR="/srv/aialra/state/codex-switcher/bootstrap"

log() {
    echo "$(date -Iseconds) $*" | tee -a "$LOG_FILE"
}

# Check if auth.json is empty or invalid
check_auth_valid() {
    if [ ! -s "$ACTIVE_AUTH" ]; then
        log "ERROR: Active auth.json is empty or missing"
        return 1
    fi
    
    # Check if auth.json contains valid tokens
    if ! python3 -c "
import json
with open('$ACTIVE_AUTH') as f:
    data = json.load(f)
if not data.get('tokens', {}).get('account_id'):
    exit(1)
" 2>/dev/null; then
        log "ERROR: Active auth.json has no valid account_id"
        return 1
    fi
    
    return 0
}

# Find most recent valid bootstrap auth
find_valid_bootstrap_auth() {
    local latest_auth=""
    local latest_time=0
    
    for auth_file in "$BOOTSTRAP_DIR"/*/.codex/auth.json; do
        if [ -f "$auth_file" ]; then
            local has_account
            has_account=$(python3 -c "
import json
try:
    with open('$auth_file') as f:
        data = json.load(f)
    if data.get('tokens', {}).get('account_id'):
        print('1')
    else:
        print('0')
except:
    print('0')
" 2>/dev/null)
            
            if [ "$has_account" = "1" ]; then
                local mtime
                mtime=$(stat -c %Y "$auth_file" 2>/dev/null || echo "0")
                if [ "$mtime" -gt "$latest_time" ]; then
                    latest_time="$mtime"
                    latest_auth="$auth_file"
                fi
            fi
        fi
    done
    
    echo "$latest_auth"
}

# Check if there's an active slot in DB
check_active_slot() {
    local active_count
    active_count=$(sqlite3 "$SWITCHER_DB" "SELECT COUNT(*) FROM account_slots WHERE is_active = 1;" 2>/dev/null || echo "0")
    [ "$active_count" -gt 0 ]
}

# Main check
main() {
    log "Starting health check..."
    
    if ! check_auth_valid; then
        log "Attempting to restore valid auth from bootstrap..."
        valid_auth=$(find_valid_bootstrap_auth)
        
        if [ -n "$valid_auth" ]; then
            log "Found valid auth at: $valid_auth"
            cp "$valid_auth" "$ACTIVE_AUTH"
            chmod 600 "$ACTIVE_AUTH"
            log "Restored valid auth.json"
            
            # Also ensure aialra user's auth is synced
            if [ -d "/home/aialra/.codex" ]; then
                cp "$valid_auth" "/home/aialra/.codex/auth.json"
                chown aialra:aialra "/home/aialra/.codex/auth.json"
                chmod 600 "/home/aialra/.codex/auth.json"
                log "Synced auth to aialra user"
            fi
        else
            log "ERROR: No valid bootstrap auth found!"
            exit 1
        fi
    fi
    
    if ! check_active_slot; then
        log "WARNING: No active slot found in database"
        # The reconcileActiveSlotFromAgent should fix this on next run
        # But we can trigger it by pinging the agent
        curl -s --connect-timeout 5 --unix-socket /run/aialra-codex-switcher/agent.sock \
            -H "x-agent-token: ${CODEX_AGENT_SHARED_SECRET:-}" \
            http://localhost/login_status >/dev/null 2>&1 || true
    fi
    
    log "Health check completed"
}

main "$@"
