#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# Ciel Pre-Demo Checklist
# Verifies environment, tests, and services before demo recording
# ─────────────────────────────────────────────

PASS=0
FAIL=0
TOTAL=0
BGPIDS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
  for pid in "${BGPIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

check() {
  local label="$1"
  shift
  TOTAL=$((TOTAL + 1))
  echo -n "  [$TOTAL] $label ... "
  if "$@" >/dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC}"
    FAIL=$((FAIL + 1))
  fi
}

check_env() {
  local var="$1"
  TOTAL=$((TOTAL + 1))
  echo -n "  [$TOTAL] env: $var ... "
  if [ -n "${!var:-}" ]; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} (not set)"
    FAIL=$((FAIL + 1))
  fi
}

wait_for_url() {
  local url="$1"
  local max_wait="$2"
  local elapsed=0
  while [ $elapsed -lt "$max_wait" ]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# Portable timeout — macOS lacks GNU timeout
run_with_timeout() {
  local secs=$1; shift
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs" && kill "$cmd_pid" 2>/dev/null ) &
  local watchdog_pid=$!
  wait "$cmd_pid" 2>/dev/null
  local rc=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  return $rc
}

echo ""
echo "============================================"
echo "  Ciel Pre-Demo Checklist"
echo "============================================"
echo ""

# ── 1. Environment variables ──
echo -e "${YELLOW}[1/7] Environment Variables${NC}"

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  echo "  (.env loaded)"
fi

REQUIRED_VARS=(
  OPENAI_API_KEY
  ANTHROPIC_API_KEY
  GEMINI_API_KEY
  PRIVATE_KEY
  BASE_SEPOLIA_RPC_URL
  REGISTRY_CONTRACT_ADDRESS
  CONSUMER_CONTRACT_ADDRESS
  WALLET_ADDRESS
  X402_FACILITATOR_URL
)

for var in "${REQUIRED_VARS[@]}"; do
  check_env "$var"
done

# ── 2. Tool prerequisites ──
echo ""
echo -e "${YELLOW}[2/7] Tool Prerequisites${NC}"

check "bun installed" command -v bun
check "forge installed" command -v forge

# ── 3. API unit tests ──
echo ""
echo -e "${YELLOW}[3/7] API Tests (bun test)${NC}"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] bun test ... "
if (cd apps/api && bun test 2>&1 | tail -1); then
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# ── 4. Contract tests ──
echo ""
echo -e "${YELLOW}[4/7] Contract Tests (forge test)${NC}"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] forge test ... "
if (cd contracts && forge test --summary 2>&1 | tail -1); then
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# ── 5. API smoke test ──
echo ""
echo -e "${YELLOW}[5/7] API Smoke Test${NC}"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] Start API + GET /api/health ... "

if lsof -i :3001 -t >/dev/null 2>&1; then
  echo -e "${RED}FAIL${NC} (port 3001 already in use)"
  FAIL=$((FAIL + 1))
else

# Build first
(cd apps/api && bun run build) >/dev/null 2>&1 || true

# Start API in background
(cd apps/api && bun run dev) >/dev/null 2>&1 &
API_PID=$!
BGPIDS+=("$API_PID")

if wait_for_url "http://localhost:3001/api/health" 15; then
  HEALTH=$(curl -sf http://localhost:3001/api/health)
  STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | head -1 || echo "")
  if echo "$STATUS" | grep -q '"ok"'; then
    echo -e "${GREEN}PASS${NC} ($STATUS)"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} (status: $STATUS)"
    FAIL=$((FAIL + 1))
  fi
else
  echo -e "${RED}FAIL${NC} (timeout after 15s)"
  FAIL=$((FAIL + 1))
fi

kill "$API_PID" 2>/dev/null || true
wait "$API_PID" 2>/dev/null || true

fi  # end port 3001 check

# ── 6. Web smoke test ──
echo ""
echo -e "${YELLOW}[6/7] Web Smoke Test${NC}"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] Start Next.js + poll localhost:3000 ... "

if lsof -i :3000 -t >/dev/null 2>&1; then
  echo -e "${RED}FAIL${NC} (port 3000 already in use)"
  FAIL=$((FAIL + 1))
else

(cd apps/web && bun run dev) >/dev/null 2>&1 &
WEB_PID=$!
BGPIDS+=("$WEB_PID")

if wait_for_url "http://localhost:3000" 20; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (timeout after 20s)"
  FAIL=$((FAIL + 1))
fi

kill "$WEB_PID" 2>/dev/null || true
wait "$WEB_PID" 2>/dev/null || true

fi  # end port 3000 check

# ── 7. Agent demo (best-effort) ──
echo ""
echo -e "${YELLOW}[7/7] Agent Demo (best-effort)${NC}"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] Agent discovers + composes pipeline ... "

if [ -f agent/src/index.ts ]; then
  if run_with_timeout 30 bash -c 'cd agent && bun run src/index.ts' >/dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${YELLOW}SKIP${NC} (timeout or error — non-blocking)"
    # Don't count as fail — agent depends on full env
    TOTAL=$((TOTAL - 1))
  fi
else
  echo -e "${YELLOW}SKIP${NC} (agent/src/index.ts not found)"
  TOTAL=$((TOTAL - 1))
fi

# ── Summary ──
echo ""
echo "============================================"
echo -e "  Results: ${GREEN}$PASS passed${NC} / ${RED}$FAIL failed${NC} / $TOTAL total"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}Some checks failed. Review above output.${NC}"
  exit 1
else
  echo -e "  ${GREEN}All checks passed! Ready for demo.${NC}"
  exit 0
fi
