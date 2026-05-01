#!/bin/bash

###############################################################################
#                  SUPPLY CHAIN SECURITY CHECK SCRIPT
#              Focused scanning for dependency vulnerabilities
#         Runs on package.json/package-lock.json changes via git hook
###############################################################################

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

FAILED=0
WARNINGS=0

TMP_DIR="$(mktemp -d /tmp/biblelm-supply-check.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

inc_failed() { FAILED=$((FAILED + 1)); }
inc_warnings() { WARNINGS=$((WARNINGS + 1)); }

log_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    inc_failed
}

log_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
    inc_warnings
}

log_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
}

log_info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1"
}

log_check() {
    echo -e "${CYAN}🔍 CHECKING${NC}: $1"
}

log_section() {
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  $1"
    echo "════════════════════════════════════════════════════════════════"
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

log_section "SUPPLY CHAIN SECURITY CHECK"
log_info "Trigger: package.json or package-lock.json changed"
log_info "Time: $(date)"

###############################################################################
# SECTION 1: NPM AUDIT - KNOWN VULNERABILITIES
###############################################################################

log_section "1. NPM AUDIT - KNOWN VULNERABILITIES"

if [ ! -f "package.json" ]; then
    log_info "No package.json found, skipping npm checks"
else
    log_check "Running npm audit with detailed output..."

    if ! command -v npm >/dev/null 2>&1; then
        log_fail "npm not installed"
    else
        npm audit --json > "$TMP_DIR/npm-audit.json" 2>"$TMP_DIR/npm-audit.err"
        AUDIT_EXIT=$?

        if [ -s "$TMP_DIR/npm-audit.json" ]; then
            TOTAL=$(jq -r '.metadata.vulnerabilities.total // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)
            CRITICAL=$(jq -r '.metadata.vulnerabilities.critical // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)
            HIGH=$(jq -r '.metadata.vulnerabilities.high // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)
            MEDIUM=$(jq -r '.metadata.vulnerabilities.medium // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)
            LOW=$(jq -r '.metadata.vulnerabilities.low // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)

            log_info "Vulnerability summary:"
            echo "  • Critical: $CRITICAL"
            echo "  • High: $HIGH"
            echo "  • Medium: $MEDIUM"
            echo "  • Low: $LOW"
            echo "  • Total: $TOTAL"

            if [ "$CRITICAL" -gt 0 ]; then
                log_fail "Critical vulnerabilities detected"
            elif [ "$HIGH" -gt 0 ]; then
                log_warn "High-severity vulnerabilities found"
            else
                log_pass "No critical/high vulnerabilities detected"
            fi

            if [ "$TOTAL" -gt 0 ]; then
                log_info "Top vulnerable packages:"
                jq -r '.vulnerabilities | to_entries[] | "  • \(.key): \(.value.severity)"' "$TMP_DIR/npm-audit.json" 2>/dev/null | head -10
            fi
        else
            if [ "$AUDIT_EXIT" -ne 0 ]; then
                log_fail "npm audit failed and returned no JSON output"
            else
                log_warn "npm audit produced no JSON output"
            fi
        fi
    fi
fi

###############################################################################
# SECTION 2: SNYK MALWARE DETECTION (If available)
###############################################################################

log_section "2. SNYK MALWARE DETECTION"

if command -v snyk >/dev/null 2>&1; then
    log_check "Running Snyk for malware and behavioral threats..."

    if snyk test --json > "$TMP_DIR/snyk-test.json" 2>/dev/null; then
        STATUS=$(jq -r '.ok' "$TMP_DIR/snyk-test.json" 2>/dev/null || echo "null")

        if [ "$STATUS" = "false" ]; then
            ISSUES=$(jq -r '.vulnerabilities | length' "$TMP_DIR/snyk-test.json" 2>/dev/null || echo 0)
            log_warn "Snyk found $ISSUES security issues"
            jq -r '.vulnerabilities[0:3] | .[] | "  • \(.packageName): \(.title)"' "$TMP_DIR/snyk-test.json" 2>/dev/null
        else
            log_pass "Snyk scan passed - no known issues detected"
        fi
    else
        log_warn "Snyk test failed or not configured"
    fi
else
    log_info "Snyk not installed - install with: npm install -g snyk"
fi

###############################################################################
# SECTION 3: PACKAGE AUTHENTICITY & METADATA
###############################################################################

log_section "3. PACKAGE AUTHENTICITY & METADATA CHECKING"

if [ -f "package.json" ]; then
    log_check "Analyzing package metadata for suspicious patterns..."

    WARN_COUNT=0
    DEPS=$(jq -r '[(.dependencies // {}), (.devDependencies // {})] | add | keys[]' package.json 2>/dev/null || true)

    for dep in $DEPS; do
        if [[ "$dep" =~ [0-9]{4,} ]]; then
            log_warn "Suspicious package name contains long numeric sequence: $dep"
            WARN_COUNT=$((WARN_COUNT + 1))
        fi

        HYPHENS=$(tr -cd '-' <<< "$dep" | wc -c)
        if [ "$HYPHENS" -gt 4 ]; then
            log_warn "Suspicious package name pattern (many hyphens): $dep"
            WARN_COUNT=$((WARN_COUNT + 1))
        fi
    done

    if [ -f "package-lock.json" ]; then
        UNUSUAL_SOURCES=$(jq -r '.packages[]?.resolved // empty' package-lock.json 2>/dev/null | rg -v 'registry\.npmjs\.org|github\.com|gitlab\.com|^git\+' | wc -l)
        if [ "$UNUSUAL_SOURCES" -gt 0 ]; then
            log_warn "Found $UNUSUAL_SOURCES packages from non-standard sources"
            jq -r '.packages[]?.resolved // empty' package-lock.json 2>/dev/null | rg -v 'registry\.npmjs\.org|github\.com|gitlab\.com|^git\+' | head -5 | sed 's/^/  • /'
        fi
    fi

    if [ "$WARN_COUNT" -eq 0 ]; then
        log_pass "No obvious suspicious package-name patterns found"
    fi
fi

###############################################################################
# SECTION 4: LOCK FILE INTEGRITY
###############################################################################

log_section "4. LOCK FILE INTEGRITY"

if [ ! -f "package-lock.json" ] && [ ! -f "yarn.lock" ] && [ ! -f "pnpm-lock.yaml" ]; then
    log_fail "No lock file found. Dependencies are not pinned."
    log_info "Create lock file with: npm install"
else
    if [ -f "package-lock.json" ]; then
        LOCK_SIZE=$(wc -c < package-lock.json)
        log_pass "package-lock.json exists ($LOCK_SIZE bytes)"

        INTEGRITY_COUNT=$(jq -r '[.packages[]? | select(.integrity != null)] | length' package-lock.json 2>/dev/null || echo 0)
        if [ "$INTEGRITY_COUNT" -gt 0 ]; then
            log_pass "Lock file contains integrity metadata entries ($INTEGRITY_COUNT)"
        else
            log_warn "No integrity metadata entries found in package-lock.json"
        fi
    elif [ -f "yarn.lock" ]; then
        log_pass "yarn.lock exists"
    elif [ -f "pnpm-lock.yaml" ]; then
        log_pass "pnpm-lock.yaml exists"
    fi
fi

###############################################################################
# SECTION 5: DEPENDENCY GRAPH ANALYSIS
###############################################################################

log_section "5. DEPENDENCY GRAPH ANALYSIS"

if [ -f "package.json" ]; then
    log_check "Analyzing dependency tree for suspicious patterns..."

    DIRECT_DEPS=$(jq '.dependencies // {} | length' package.json 2>/dev/null || echo 0)
    DEV_DEPS=$(jq '.devDependencies // {} | length' package.json 2>/dev/null || echo 0)

    log_info "Dependency count:"
    echo "  • Direct dependencies: $DIRECT_DEPS"
    echo "  • Dev dependencies: $DEV_DEPS"

    if command -v npm >/dev/null 2>&1; then
        SCRIPTS_WITH_INSTALL=$(npm ls --depth=0 --json 2>/dev/null | jq -r '.dependencies | keys[]?' 2>/dev/null | while read -r pkg; do
            POSTINSTALL=$(npm view "$pkg" scripts.postinstall --json 2>/dev/null || echo "")
            INSTALL=$(npm view "$pkg" scripts.install --json 2>/dev/null || echo "")
            PREINSTALL=$(npm view "$pkg" scripts.preinstall --json 2>/dev/null || echo "")
            if [ -n "$POSTINSTALL$INSTALL$PREINSTALL" ] && [ "$POSTINSTALL$INSTALL$PREINSTALL" != "nullnullnull" ]; then
                echo "$pkg"
            fi
        done | wc -l)

        if [ "$SCRIPTS_WITH_INSTALL" -gt 0 ]; then
            log_warn "Found $SCRIPTS_WITH_INSTALL direct packages with install/preinstall/postinstall scripts"
        else
            log_pass "No direct packages with install lifecycle scripts"
        fi
    else
        log_warn "npm not installed, skipping lifecycle-script analysis"
    fi
fi

###############################################################################
# SECTION 6: RECENT CHANGES
###############################################################################

log_section "6. RECENT PACKAGE CHANGES"

if [ -d ".git" ]; then
    log_check "Checking git history for dependency changes..."

    RECENT_CHANGES=$(git log -5 --oneline -- package.json package-lock.json 2>/dev/null | wc -l)

    if [ "$RECENT_CHANGES" -gt 0 ]; then
        log_info "Recent dependency file changes:"
        git log -5 --oneline -- package.json package-lock.json 2>/dev/null | sed 's/^/  /'
    else
        log_info "No recent dependency-file commits found"
    fi
fi

###############################################################################
# SECTION 7: TRANSITIVE DEPENDENCY RISKS
###############################################################################

log_section "7. TRANSITIVE DEPENDENCY RISKS"

if [ -f "package-lock.json" ]; then
    log_check "Analyzing transitive dependency volume..."

    TOTAL_PACKAGES=$(jq '.packages | length' package-lock.json 2>/dev/null || echo 0)
    DIRECT_PACKAGES=$((DIRECT_DEPS + DEV_DEPS))
    TRANSITIVE=$((TOTAL_PACKAGES - DIRECT_PACKAGES - 1))
    if [ "$TRANSITIVE" -lt 0 ]; then
        TRANSITIVE=0
    fi

    log_info "Package tree estimate:"
    echo "  • Direct: ~$DIRECT_PACKAGES"
    echo "  • Transitive: ~$TRANSITIVE"
    echo "  • Total lock entries: ~$TOTAL_PACKAGES"

    if [ "$TRANSITIVE" -gt 100 ]; then
        log_warn "Large transitive dependency tree ($TRANSITIVE entries)"
    fi
fi

###############################################################################
# SECTION 8: LICENSE CHECK
###############################################################################

log_section "8. LICENSE COMPLIANCE CHECK"

if command -v license-check >/dev/null 2>&1; then
    log_check "License tool detected (custom policy checks can be added)"
else
    log_info "License checking tool not installed (optional)"
fi

###############################################################################
# SUMMARY & RECOMMENDATIONS
###############################################################################

log_section "SUPPLY CHAIN CHECK SUMMARY"

echo ""
if [ "$FAILED" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    echo -e "${GREEN}✅ EXCELLENT: Supply chain baseline checks passed${NC}"
    echo ""
    echo "Recommendations for ongoing security:"
    echo "  • Run this check with every dependency update"
    echo "  • Keep Dependabot enabled for automated scanning"
    echo "  • Review package.json/package-lock.json changes in code review"
    echo "  • Add Snyk monitor if your org uses it"
    exit 0
elif [ "$FAILED" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  PROCEED WITH CAUTION: Warnings detected${NC}"
    echo ""
    echo "Review warnings above before merging dependency changes."
    exit 0
else
    echo -e "${RED}🚨 STOP: Critical issues detected${NC}"
    echo ""
    echo "Fix options:"
    echo "  1. Run: npm audit fix"
    echo "  2. Update vulnerable packages manually"
    echo "  3. Replace risky packages"
    exit 1
fi
