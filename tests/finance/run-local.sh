#!/usr/bin/env bash
set -euo pipefail
# Synthetic data only. Requires an existing disposable PostgreSQL at this local socket/port.
finance_test_db="tms_finance_test_${$}"
finance_test_port="${FINANCE_TEST_PORT:-55439}"
finance_test_root="$(cd "$(dirname "$0")/../.." && pwd)"
createdb -h /tmp -p "$finance_test_port" "$finance_test_db"
trap 'dropdb -h /tmp -p "$finance_test_port" "$finance_test_db"' EXIT
psql -h /tmp -p "$finance_test_port" -d "$finance_test_db" -v ON_ERROR_STOP=1 -f "$finance_test_root/tests/finance/fixture.sql" > /dev/null
psql -h /tmp -p "$finance_test_port" -d "$finance_test_db" -v ON_ERROR_STOP=1 -f "$finance_test_root/supabase/migrations/20261016143657_tms_finance_core.sql" > /dev/null
psql -h /tmp -p "$finance_test_port" -d "$finance_test_db" -v ON_ERROR_STOP=1 -f "$finance_test_root/tests/finance/scenarios.sql"

node "$finance_test_root/tests/finance/concurrency.mjs" "$finance_test_db" "$finance_test_port"
