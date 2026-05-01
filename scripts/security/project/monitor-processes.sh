#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "════════════════════════════════════════════════════════════════"
echo "  REAL-TIME PROCESS MONITOR"
echo "════════════════════════════════════════════════════════════════"
echo "Project root: $PROJECT_ROOT"
echo "Press Ctrl+C to stop"
echo ""

while true; do
    TS="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$TS] Network listeners (non-loopback):"

    if command -v ss >/dev/null 2>&1; then
        ss -tlnp 2>/dev/null | awk 'NR==1 || ($4 !~ /127\.0\.0\.1|::1/)'
    elif command -v netstat >/dev/null 2>&1; then
        netstat -tlnp 2>/dev/null | awk 'NR==1 || ($4 !~ /127\.0\.0\.1|::1/)'
    else
        echo "  Neither ss nor netstat is available"
    fi

    echo "[$TS] Suspicious process patterns:"
    SUSPICIOUS=$(ps aux | grep -E "curl .*https?://|wget .*https?://|nc .* -l|cryptomine|bitcoin-miner|xmrig" | grep -v grep || true)
    if [ -n "$SUSPICIOUS" ]; then
        echo -e "${RED}⚠️  SUSPICIOUS PROCESS DETECTED${NC}"
        echo "$SUSPICIOUS"
    else
        echo "  None detected"
    fi

    echo "[$TS] Recently modified binaries (/usr/bin,/usr/local/bin within 24h):"
    MODIFIED=$(find /usr/bin /usr/local/bin -type f -mtime -1 2>/dev/null | head -5)
    if [ -n "$MODIFIED" ]; then
        echo "$MODIFIED" | sed 's/^/  /'
    else
        echo "  None"
    fi

    echo ""
    sleep 30
done
