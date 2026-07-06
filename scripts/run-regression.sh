#!/usr/bin/env bash
# VERA Regression Test Runner
# Usage: bash scripts/run-regression.sh
# Env vars: VERA_URL, VERA_TOKEN (optional — enables Tier 2/3 tests)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== VERA Regression Suite ==="
echo "Target: https://aeraky1565.github.io/VERA-My-Chief-of-Staff/"
echo "Creds:  $([ -n "${VERA_URL:-}" ] && echo "present (Tier 2/3 enabled)" || echo "absent (Tier 1 only)")"
echo ""

# Install @playwright/test if needed (browsers pre-installed in Claude Code env)
if [ ! -d node_modules/@playwright ]; then
  echo "Installing @playwright/test..."
  npm install --silent
fi

# Run tests, capture exit code without dying on failure
set +e
npx playwright test tests/regression.spec.js 2>&1 | tee /tmp/vera-regression.log
PLAYWRIGHT_EXIT=$?
set -e

# Summary
echo ""
echo "=============================="
PASSED=$(grep -c "✓\|passed" /tmp/vera-regression.log 2>/dev/null || echo 0)
FAILED=$(grep -c "✗\|failed\|×" /tmp/vera-regression.log 2>/dev/null || echo 0)
if [ "$PLAYWRIGHT_EXIT" -eq 0 ]; then
  echo "✅ VERA Regression PASSED"
else
  echo "❌ VERA Regression FAILED"
fi
echo "=============================="
echo ""
echo "Full log: /tmp/vera-regression.log"
echo "JSON results: test-results/results.json (if generated)"

exit $PLAYWRIGHT_EXIT
