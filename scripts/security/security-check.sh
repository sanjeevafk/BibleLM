#!/bin/bash

###############################################################################
#                    GENERAL SECURITY CHECKUP SCRIPT
#                  For bibleLM Project Security Audit
###############################################################################

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0
WARNINGS=0

TMP_DIR="$(mktemp -d /tmp/biblelm-security-check.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

inc_passed() { PASSED=$((PASSED + 1)); }
inc_failed() { FAILED=$((FAILED + 1)); }
inc_warnings() { WARNINGS=$((WARNINGS + 1)); }

log_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    inc_passed
}

log_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    inc_failed
}

log_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
    inc_warnings
}

log_info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1"
}

log_section() {
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  $1"
    echo "════════════════════════════════════════════════════════════════"
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

log_section "SECURITY CHECKUP - bibleLM Project"

###############################################################################
# SECTION 1: DEPENDENCY SECURITY
###############################################################################

log_section "1. DEPENDENCY SECURITY CHECKS"

if [ ! -f "package.json" ]; then
    log_warn "No package.json found, skipping npm checks"
else
    log_info "Running npm audit..."
    if command -v npm >/dev/null 2>&1; then
        npm audit --json > "$TMP_DIR/npm-audit.json" 2>"$TMP_DIR/npm-audit.err"
        AUDIT_EXIT=$?

        if [ -s "$TMP_DIR/npm-audit.json" ]; then
            VULN_COUNT=$(jq -r '.metadata.vulnerabilities.total // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)
            CRITICAL=$(jq -r '.metadata.vulnerabilities.critical // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)
            HIGH=$(jq -r '.metadata.vulnerabilities.high // 0' "$TMP_DIR/npm-audit.json" 2>/dev/null || echo 0)

            if [ "$VULN_COUNT" -eq 0 ]; then
                log_pass "No npm vulnerabilities detected (0 total)"
            elif [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
                log_fail "Critical/High vulnerabilities found: $VULN_COUNT total ($CRITICAL CRITICAL, $HIGH HIGH)"
            else
                log_warn "Medium/Low vulnerabilities found: $VULN_COUNT total"
            fi
        else
            if [ "$AUDIT_EXIT" -ne 0 ]; then
                log_fail "npm audit failed and returned no JSON output"
            else
                log_warn "npm audit produced no JSON output"
            fi
        fi
    else
        log_fail "npm is not installed"
    fi
fi

if [ -f "package-lock.json" ] || [ -f "yarn.lock" ] || [ -f "pnpm-lock.yaml" ]; then
    log_pass "Dependency lock file exists (reproducible builds)"
else
    log_fail "No lock file found - dependencies not pinned!"
fi

###############################################################################
# SECTION 2: HARDCODED SECRETS DETECTION
###############################################################################

log_section "2. HARDCODED SECRETS DETECTION"

SECRETS_FOUND=0
SEARCH_PATHS=("app" "lib" "components" "scripts" "config" "middleware.ts" "next.config.ts")
EXCLUDES=("--glob=!**/node_modules/**" "--glob=!**/*.test.*" "--glob=!**/*.spec.*" "--glob=!**/__tests__/**" "--glob=!**/*.example.*")

if command -v rg >/dev/null 2>&1; then
    if rg -n -i "(api[_-]?key|secret|token)\\s*[:=]\\s*['\"][A-Za-z0-9_\\-]{16,}['\"]" "${SEARCH_PATHS[@]}" "${EXCLUDES[@]}" > "$TMP_DIR/api-keys.txt" 2>/dev/null; then
        log_fail "Possible hardcoded API keys/secrets found:"
        head -3 "$TMP_DIR/api-keys.txt" | sed 's/^/  /'
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi

    if rg -n "-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----" "${SEARCH_PATHS[@]}" "${EXCLUDES[@]}" > "$TMP_DIR/private-keys.txt" 2>/dev/null; then
        log_fail "Possible private key material found in source:"
        head -2 "$TMP_DIR/private-keys.txt" | sed 's/^/  /'
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi

    if rg -n -i "password\\s*[:=]\\s*['\"][^'\"]{6,}['\"]" "${SEARCH_PATHS[@]}" "${EXCLUDES[@]}" > "$TMP_DIR/passwords.txt" 2>/dev/null; then
        log_warn "Possible hardcoded passwords found:"
        head -2 "$TMP_DIR/passwords.txt" | sed 's/^/  /'
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi
else
    log_warn "ripgrep (rg) not installed; using fallback grep patterns"
fi

if [ "$SECRETS_FOUND" -eq 0 ]; then
    log_pass "No obvious hardcoded secrets detected"
fi

###############################################################################
# SECTION 3: ENVIRONMENT CONFIGURATION
###############################################################################

log_section "3. ENVIRONMENT & CONFIGURATION"

if [ -f ".env" ]; then
    log_warn ".env file found in repo root (should be .gitignored)"
    if grep -Eq '(^|/)\.env($|\.|\*)' .gitignore 2>/dev/null; then
        log_pass ".env appears to be covered by .gitignore"
    else
        log_fail ".env NOT in .gitignore - RISK OF EXPOSING SECRETS"
    fi
fi

IMPORTANT_IGNORES=(".env" ".env.local" "*.pem" "*.key" "secrets" ".aws" ".ssh")
MISSING_IGNORE_COUNT=0
for pattern in "${IMPORTANT_IGNORES[@]}"; do
    if ! grep -Fqx "$pattern" .gitignore 2>/dev/null; then
        MISSING_IGNORE_COUNT=$((MISSING_IGNORE_COUNT + 1))
    fi
done

if [ "$MISSING_IGNORE_COUNT" -gt 0 ]; then
    log_info "Some recommended secret-related patterns are not explicitly present in .gitignore"
else
    log_pass "Recommended secret ignore patterns are present"
fi

###############################################################################
# SECTION 4: FILE PERMISSIONS
###############################################################################

log_section "4. FILE PERMISSIONS & SECURITY"

WORLD_WRITABLE=$(find . -type f -perm -002 2>/dev/null | rg -v '(^|/)node_modules/' | wc -l)
if [ "$WORLD_WRITABLE" -gt 0 ]; then
    log_warn "Found $WORLD_WRITABLE world-writable files (security risk):"
    find . -type f -perm -002 2>/dev/null | rg -v '(^|/)node_modules/' | head -3 | sed 's/^/  /'
else
    log_pass "No unexpected world-writable files"
fi

UNEXPECTED_EXEC=$(find . -type f \( -name "*.js" -o -name "*.ts" \) -perm /111 2>/dev/null | rg -v '(^|/)node_modules/' | rg -v '(^|/)scripts/' | wc -l)
if [ "$UNEXPECTED_EXEC" -gt 0 ]; then
    log_warn "Found $UNEXPECTED_EXEC unexpected executable files"
else
    log_pass "No unexpected executable source files"
fi

###############################################################################
# SECTION 5: CODE QUALITY & DANGEROUS PATTERNS
###############################################################################

log_section "5. CODE QUALITY & DANGEROUS PATTERNS"

if command -v rg >/dev/null 2>&1; then
    EVAL_COUNT=$(rg -n "\\beval\\s*\\(" app lib components scripts config middleware.ts --glob '!**/node_modules/**' --glob '!**/*.test.*' --glob '!**/*.spec.*' 2>/dev/null | wc -l)
    if [ "$EVAL_COUNT" -gt 0 ]; then
        log_fail "Found $EVAL_COUNT eval() calls - security risk"
    else
        log_pass "No eval() usage detected"
    fi

    EXEC_COUNT=$(rg -n "\\b(exec|execSync|spawn|spawnSync|system)\\s*\\(" app lib components scripts config middleware.ts --glob '!**/node_modules/**' 2>/dev/null | wc -l)
    if [ "$EXEC_COUNT" -gt 0 ]; then
        log_warn "Found $EXEC_COUNT exec/spawn/system calls - verify input sanitization"
    else
        log_pass "No exec/spawn/system calls detected"
    fi

    SQL_PATTERN=$(rg -n "(SELECT|INSERT|UPDATE|DELETE).*(\$\\{|\\+)|\\bquery\\s*\\(.*(\$\\{|\\+)" app lib components scripts config --glob '!**/node_modules/**' 2>/dev/null | wc -l)
    if [ "$SQL_PATTERN" -gt 0 ]; then
        log_warn "Found $SQL_PATTERN potential dynamic SQL construction patterns"
    else
        log_pass "No obvious dynamic SQL construction detected"
    fi
else
    log_warn "ripgrep not installed; dangerous pattern checks are limited"
fi

###############################################################################
# SECTION 6: GIT SECURITY
###############################################################################

log_section "6. GIT REPOSITORY SECURITY"

if [ -d ".git" ]; then
    if git log --all --pretty=format:"%h %s" 2>/dev/null | grep -Ei "revert|rollback|fix.*leak|remove.*secret" > "$TMP_DIR/suspicious-commits.txt"; then
        log_info "Found commits mentioning security-related fixes:"
        head -3 "$TMP_DIR/suspicious-commits.txt" | sed 's/^/  /'
    fi

    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
        log_info "Currently on protected branch candidate: $CURRENT_BRANCH"
        log_info "Ensure remote branch protection rules are enabled"
    fi

    log_pass "Git repository checked"
else
    log_warn "Not a git repository"
fi

###############################################################################
# SECTION 7: CONFIGURATION FILES SECURITY
###############################################################################

log_section "7. SENSITIVE CONFIGURATION FILES"

EXPOSED_CONFIGS=0
CONFIG_FILES=("config.json" "settings.json" "secrets.json" ".env.example" "credentials.json")
for config in "${CONFIG_FILES[@]}"; do
    if [ -f "$config" ] && [ "$config" != ".env.example" ]; then
        if ! grep -Fqx "$config" .gitignore 2>/dev/null; then
            log_warn "$config found - ensure it does not contain real secrets"
            EXPOSED_CONFIGS=$((EXPOSED_CONFIGS + 1))
        fi
    fi
done

if [ "$EXPOSED_CONFIGS" -eq 0 ]; then
    log_pass "No exposed sensitive configuration files"
fi

###############################################################################
# SECTION 8: DEPENDENCY SOURCE VERIFICATION
###############################################################################

log_section "8. DEPENDENCY SOURCE VERIFICATION"

if [ -f "package.json" ]; then
    SUSPICIOUS_REGISTRIES=$(rg -n 'registry.*(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.)' package.json 2>/dev/null | wc -l)
    if [ "$SUSPICIOUS_REGISTRIES" -gt 0 ]; then
        log_warn "Non-standard local/private npm registries configured - verify legitimacy"
    else
        log_pass "No obvious local/private registry overrides in package.json"
    fi
fi

###############################################################################
# SUMMARY
###############################################################################

log_section "SECURITY CHECKUP SUMMARY"

echo ""
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${YELLOW}Warnings: $WARNINGS${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo ""

if [ "$FAILED" -eq 0 ]; then
    if [ "$WARNINGS" -eq 0 ]; then
        echo -e "${GREEN}🎉 EXCELLENT: All security checks passed!${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠️  GOOD: Passed critical checks, review warnings above${NC}"
        exit 0
    fi
else
    echo -e "${RED}🚨 ATTENTION: Security issues detected - review failures above${NC}"
    exit 1
fi
