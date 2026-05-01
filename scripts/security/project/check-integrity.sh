#!/bin/bash

set -u

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INTEGRITY_DIR="$PROJECT_ROOT/.security/project/hashes"
mkdir -p "$INTEGRITY_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️${NC} $1"; }
log_pass() { echo -e "${GREEN}✅${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠️${NC} $1"; }
log_fail() { echo -e "${RED}❌${NC} $1"; }

FILES_TO_CHECK=(
    "package.json"
    "package-lock.json"
    "yarn.lock"
    "pnpm-lock.yaml"
    "config/env.ts"
)

echo "════════════════════════════════════════════════════════════════"
echo "  FILE INTEGRITY CHECK"
echo "════════════════════════════════════════════════════════════════"

if [ "${1:-}" = "init" ]; then
    log_info "Initializing integrity baseline"
    for file in "${FILES_TO_CHECK[@]}"; do
        if [ -f "$PROJECT_ROOT/$file" ]; then
            sha256sum "$PROJECT_ROOT/$file" > "$INTEGRITY_DIR/${file//\//-}.sha256"
            log_pass "Hashed: $file"
        fi
    done
    log_pass "Baseline created"
    exit 0
fi

log_info "Checking file integrity"
CHANGES=0

for file in "${FILES_TO_CHECK[@]}"; do
    HASH_FILE="$INTEGRITY_DIR/${file//\//-}.sha256"

    if [ ! -f "$PROJECT_ROOT/$file" ]; then
        continue
    fi

    if [ ! -f "$HASH_FILE" ]; then
        log_info "No baseline for $file (run: scripts/security/project/check-integrity.sh init)"
        continue
    fi

    CURRENT_HASH=$(sha256sum "$PROJECT_ROOT/$file" | awk '{print $1}')
    STORED_HASH=$(awk '{print $1}' "$HASH_FILE")

    if [ "$CURRENT_HASH" = "$STORED_HASH" ]; then
        log_pass "Unchanged: $file"
    else
        log_fail "MODIFIED: $file"
        CHANGES=$((CHANGES + 1))
    fi
done

if [ "$CHANGES" -eq 0 ]; then
    log_pass "All monitored files verified"
    exit 0
else
    log_warn "Found $CHANGES modified files"
    exit 1
fi
