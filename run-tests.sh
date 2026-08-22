#!/usr/bin/env bash
# All suites. No install step, no network.
set -e
for f in lib/scoring.test.ts lib/integration.test.ts lib/email.test.ts lib/grid.test.ts; do
  echo "── $f"
  node --experimental-strip-types "$f" 2>/dev/null | tail -2
done
