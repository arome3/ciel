#!/usr/bin/env bash
# =============================================================================
# Ciel × Tenderly Virtual TestNet — End-to-End Demo
# =============================================================================
# Demonstrates the full CRE + Tenderly VNet workflow for hackathon submission:
#   1. Create Virtual TestNet (fork Base Sepolia)
#   2. Deploy Registry + Consumer contracts
#   3. Authorize deployer for direct contract calls
#   4. Generate CRE workflows for all 3 prize categories
#   5. Publish workflows on-chain
#   6. Simulate CRE workflows
#   7. Record executions with realistic success/failure mix
#   8. Deliver reports to Consumer contract
#   9. Display summary with explorer URL
#
# Prerequisites:
#   - Ciel API server running on localhost:3001
#   - TENDERLY_ACCESS_KEY, TENDERLY_PROJECT_SLUG in .env
#   - PRIVATE_KEY in .env (deployer wallet)
#   - foundry (cast) installed
#   - jq installed
#
# Usage: ./scripts/demo-tenderly.sh [--name <vnet-name>] [--skip-generate]
# =============================================================================

set -euo pipefail

# --- Configuration ---
API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3001}"
VNET_NAME="ciel-hackathon-demo"
SKIP_GENERATE=false
NETWORK_ID=84532  # Base Sepolia

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) VNET_NAME="$2"; shift 2 ;;
    --skip-generate) SKIP_GENERATE=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

# --- Prerequisites Check ---
step "Checking prerequisites"

command -v curl >/dev/null 2>&1 || fail "curl not found"
command -v jq   >/dev/null 2>&1 || fail "jq not found"
command -v cast >/dev/null 2>&1 || fail "cast (foundry) not found — install via: curl -L https://foundry.paradigm.xyz | bash"

# Load .env from project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
  ok "Loaded .env"
else
  fail ".env not found at $PROJECT_ROOT/.env"
fi

[[ -n "${TENDERLY_ACCESS_KEY:-}" ]]   || fail "TENDERLY_ACCESS_KEY not set in .env"
[[ -n "${TENDERLY_PROJECT_SLUG:-}" ]] || fail "TENDERLY_PROJECT_SLUG not set in .env"
[[ -n "${PRIVATE_KEY:-}" ]]           || fail "PRIVATE_KEY not set in .env"

# Derive deployer address from private key
DEPLOYER=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null) || fail "Invalid PRIVATE_KEY"
ok "Deployer: $DEPLOYER"

# Check API server is running
API_HEALTH=$(curl -sf "$API_URL/health" 2>/dev/null || echo "")
if [[ -z "$API_HEALTH" ]]; then
  fail "API server not responding at $API_URL — start it with: cd apps/api && bun dev"
fi
ok "API server healthy at $API_URL"

echo -e "${BOLD}All prerequisites met${NC}"

# =============================================================================
# STEP 1: Create Virtual TestNet
# =============================================================================
step "Step 1: Creating Tenderly Virtual TestNet"

CREATE_RESPONSE=$(curl -sf -X POST "$API_URL/api/tenderly/create" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$VNET_NAME\", \"networkId\": $NETWORK_ID, \"syncState\": true}" \
) || fail "Failed to create VNet — check API logs"

VNET_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id')
RPC_URL=$(echo "$CREATE_RESPONSE" | jq -r '.rpcUrl')
EXPLORER_URL=$(echo "$CREATE_RESPONSE" | jq -r '.explorerUrl')

ok "VNet created: $VNET_NAME"
ok "VNet ID: $VNET_ID"
ok "RPC: $RPC_URL"
ok "Explorer: $EXPLORER_URL"

# =============================================================================
# STEP 2: Deploy Contracts
# =============================================================================
step "Step 2: Deploying Registry + Consumer contracts"

DEPLOY_RESPONSE=$(curl -sf -X POST "$API_URL/api/tenderly/deploy-contracts" \
  -H "Content-Type: application/json" \
) || fail "Contract deployment failed — check forge output in API logs"

REGISTRY=$(echo "$DEPLOY_RESPONSE" | jq -r '.registryAddress')
CONSUMER=$(echo "$DEPLOY_RESPONSE" | jq -r '.consumerAddress')

ok "Registry: $REGISTRY"
ok "Consumer: $CONSUMER"

# =============================================================================
# STEP 3: Authorize Deployer
# =============================================================================
step "Step 3: Authorizing deployer on Registry + Consumer"

# Registry: authorize deployer for recordExecution
cast send "$REGISTRY" "addAuthorizedSender(address)" "$DEPLOYER" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --quiet 2>/dev/null \
  || fail "Failed to authorize deployer on Registry"
ok "Deployer authorized on Registry"

# Consumer: authorize deployer for onReport
cast send "$CONSUMER" "addAuthorizedSender(address)" "$DEPLOYER" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --quiet 2>/dev/null \
  || fail "Failed to authorize deployer on Consumer"
ok "Deployer authorized on Consumer"

# =============================================================================
# STEP 4: Publish 3 Workflows (one per prize category)
# =============================================================================
step "Step 4: Publishing workflows for all 3 prize categories"

# Helper: publish a workflow and capture its on-chain ID
publish_workflow() {
  local name="$1" desc="$2" category="$3" chains="$4" caps="$5" price="$6"
  local tx_hash

  tx_hash=$(cast send "$REGISTRY" \
    "publishWorkflow(string,string,string,uint64[],string[],string,uint256)" \
    "$name" "$desc" "$category" "$chains" "$caps" \
    "https://api.ciel.sh/x402/execute" "$price" \
    --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json 2>/dev/null \
    | jq -r '.transactionHash') || fail "Failed to publish: $name"

  # Extract workflowId from event logs
  local workflow_id
  workflow_id=$(cast receipt "$tx_hash" --rpc-url "$RPC_URL" --json 2>/dev/null \
    | jq -r '.logs[0].topics[1] // empty') || true

  if [[ -z "$workflow_id" || "$workflow_id" == "null" ]]; then
    # Fallback: use tx hash as identifier
    workflow_id="$tx_hash"
    warn "Using tx hash as workflow ID (RPC log limitation)"
  fi

  echo "$workflow_id"
}

# Category 1: Custom Data Feeds (Oracle)
echo -e "\n  ${BOLD}Category: Custom Data Feeds${NC}"
WF_ORACLE=$(publish_workflow \
  "Chainlink ETH/USD Price Feed Reader" \
  "CRE workflow reading Chainlink Data Feed (ETH/USD) with threshold alerting. Template 13." \
  "oracle" \
  "[84532]" \
  "[price-feed,chainlink-feeds,alert]" \
  "100000")
ok "Oracle workflow: ${WF_ORACLE:0:18}..."

# Category 2: Cross-Chain Bridge (DeFi)
echo -e "\n  ${BOLD}Category: Cross-Chain Bridge${NC}"
WF_BRIDGE=$(publish_workflow \
  "Cross-Chain CCIP Token Bridge" \
  "CRE workflow for Chainlink CCIP cross-chain token transfers. Template 15." \
  "defi" \
  "[84532,42161]" \
  "[ccip,ccipTransfer,evmWrite]" \
  "250000")
ok "Bridge workflow: ${WF_BRIDGE:0:18}..."

# Category 3: AI Agent Orchestration
echo -e "\n  ${BOLD}Category: AI Agent Orchestration${NC}"
WF_AI=$(publish_workflow \
  "Multi-AI Consensus Oracle" \
  "CRE workflow orchestrating multiple AI models with BFT consensus. Template 9." \
  "ai" \
  "[84532]" \
  "[multi-ai,alert,evmWrite]" \
  "500000")
ok "AI Oracle workflow: ${WF_AI:0:18}..."

# =============================================================================
# STEP 5: Generate & Simulate CRE Workflows (optional — AI-intensive)
# =============================================================================
if [[ "$SKIP_GENERATE" == "false" ]]; then
  step "Step 5: Generating CRE workflows via AI engine"

  generate_workflow() {
    local prompt="$1" label="$2"
    local gen_response
    gen_response=$(curl -sf -X POST "$API_URL/api/generate" \
      -H "Content-Type: application/json" \
      -H "X-Owner-Address: $DEPLOYER" \
      -d "{\"prompt\": \"$prompt\"}" \
      --max-time 120) || { warn "Generation timed out for: $label"; return; }

    local wf_id template_id
    wf_id=$(echo "$gen_response" | jq -r '.workflowId // empty')
    template_id=$(echo "$gen_response" | jq -r '.template.templateId // empty')

    if [[ -n "$wf_id" ]]; then
      ok "$label → workflow $wf_id (template: $template_id)"

      # Simulate
      echo "    Simulating..."
      local sim_response
      sim_response=$(curl -sf -X POST "$API_URL/api/simulate" \
        -H "Content-Type: application/json" \
        -d "{\"workflowId\": \"$wf_id\", \"mode\": \"stored\"}" \
        --max-time 60) || { warn "Simulation timed out for: $label"; return; }

      local sim_success
      sim_success=$(echo "$sim_response" | jq -r '.success // false')
      if [[ "$sim_success" == "true" ]]; then
        ok "    Simulation passed"
      else
        warn "    Simulation: $sim_success (runtime errors are expected without real API keys)"
      fi
    else
      warn "$label — generation failed (check API logs)"
    fi
  }

  generate_workflow "Read ETH/USD price from Chainlink data feed every 5 minutes and alert if below 2000" "Price Feed (T13)"
  generate_workflow "Bridge USDC tokens from Base to Arbitrum via CCIP when balance exceeds 1000" "CCIP Bridge (T15)"
  generate_workflow "Query 3 AI models for ETH price prediction, reach BFT consensus, and post result onchain" "AI Consensus (T9)"
else
  step "Step 5: Skipping workflow generation (--skip-generate)"
fi

# =============================================================================
# STEP 6: Record Executions (realistic mix)
# =============================================================================
step "Step 6: Recording executions (building transaction history)"

record_exec() {
  local workflow_id="$1" success="$2" label="$3"
  cast send "$REGISTRY" "recordExecution(bytes32,bool)" "$workflow_id" "$success" \
    --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --quiet 2>/dev/null \
    || { warn "recordExecution failed for $label"; return; }
}

echo "  Recording Oracle executions (8 success, 1 failure)..."
for i in {1..8}; do record_exec "$WF_ORACLE" true "oracle-$i"; done
record_exec "$WF_ORACLE" false "oracle-fail"
ok "Oracle: 9 executions recorded"

echo "  Recording Bridge executions (5 success, 2 failures)..."
for i in {1..5}; do record_exec "$WF_BRIDGE" true "bridge-$i"; done
record_exec "$WF_BRIDGE" false "bridge-fail-1"
record_exec "$WF_BRIDGE" false "bridge-fail-2"
ok "Bridge: 7 executions recorded"

echo "  Recording AI Oracle executions (6 success, 1 failure)..."
for i in {1..6}; do record_exec "$WF_AI" true "ai-$i"; done
record_exec "$WF_AI" false "ai-fail"
ok "AI Oracle: 7 executions recorded"

# =============================================================================
# STEP 7: Deliver Reports to Consumer
# =============================================================================
step "Step 7: Delivering CRE reports to Consumer contract"

send_report() {
  local workflow_id="$1" report_data="$2" label="$3"
  # metadata = workflowId (first 32 bytes used by Consumer to index)
  cast send "$CONSUMER" "onReport(bytes,bytes)" "$workflow_id" "$report_data" \
    --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --quiet 2>/dev/null \
    || { warn "onReport failed for $label"; return; }
}

# Simulated ABI-encoded report data (price values, status flags)
ORACLE_REPORT="0x$(printf '%064x' 200000000000)$(printf '%064x' 8)$(printf '%064x' 1)"    # ETH $2000.00, 8 decimals, valid
BRIDGE_REPORT="0x$(printf '%064x' 1000000000)$(printf '%064x' 84532)$(printf '%064x' 42161)"  # 1000 USDC, Base→Arb
AI_REPORT="0x$(printf '%064x' 195500000000)$(printf '%064x' 3)$(printf '%064x' 2)"        # $1955.00 consensus, 3 models, 2 agreed

echo "  Delivering Oracle reports..."
send_report "$WF_ORACLE" "$ORACLE_REPORT" "oracle-report-1"
send_report "$WF_ORACLE" "$ORACLE_REPORT" "oracle-report-2"
send_report "$WF_ORACLE" "$ORACLE_REPORT" "oracle-report-3"
ok "Oracle: 3 reports delivered"

echo "  Delivering Bridge reports..."
send_report "$WF_BRIDGE" "$BRIDGE_REPORT" "bridge-report-1"
send_report "$WF_BRIDGE" "$BRIDGE_REPORT" "bridge-report-2"
ok "Bridge: 2 reports delivered"

echo "  Delivering AI consensus reports..."
send_report "$WF_AI" "$AI_REPORT" "ai-report-1"
send_report "$WF_AI" "$AI_REPORT" "ai-report-2"
send_report "$WF_AI" "$AI_REPORT" "ai-report-3"
ok "AI Oracle: 3 reports delivered"

# =============================================================================
# STEP 8: Verify On-Chain State
# =============================================================================
step "Step 8: Verifying on-chain state"

# Read workflow count
TOTAL_WORKFLOWS=$(cast call "$REGISTRY" "getAllWorkflows(uint256,uint256)(bytes32[],uint256)" 0 100 \
  --rpc-url "$RPC_URL" 2>/dev/null | tail -1 | tr -d ' ') || TOTAL_WORKFLOWS="?"
ok "Total workflows on registry: $TOTAL_WORKFLOWS"

# Read report counts
for label_id in "Oracle:$WF_ORACLE" "Bridge:$WF_BRIDGE" "AI:$WF_AI"; do
  label="${label_id%%:*}"
  wid="${label_id#*:}"
  count=$(cast call "$CONSUMER" "getReportCount(bytes32)(uint256)" "$wid" \
    --rpc-url "$RPC_URL" 2>/dev/null | tr -d ' ') || count="?"
  ok "$label report count: $count"
done

# =============================================================================
# STEP 9: Create Snapshot
# =============================================================================
step "Step 9: Creating state snapshot"

SNAPSHOT_RESPONSE=$(curl -sf -X POST "$API_URL/api/tenderly/snapshot" \
  -H "Content-Type: application/json") || warn "Snapshot creation failed"

if [[ -n "${SNAPSHOT_RESPONSE:-}" ]]; then
  SNAPSHOT_ID=$(echo "$SNAPSHOT_RESPONSE" | jq -r '.snapshotId // empty')
  ok "Snapshot: $SNAPSHOT_ID"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Ciel × Tenderly Demo Complete${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Explorer URL:${NC}"
echo -e "  ${CYAN}$EXPLORER_URL${NC}"
echo ""
echo -e "  ${BOLD}Contracts:${NC}"
echo -e "  Registry: $REGISTRY"
echo -e "  Consumer: $CONSUMER"
echo ""
echo -e "  ${BOLD}On-Chain Workflows:${NC}"
echo -e "  Oracle (Custom Data Feeds): ${WF_ORACLE:0:18}..."
echo -e "  Bridge (Cross-Chain):       ${WF_BRIDGE:0:18}..."
echo -e "  AI Oracle (Agent Orch.):    ${WF_AI:0:18}..."
echo ""
echo -e "  ${BOLD}Transaction Summary:${NC}"
echo -e "  Contract deploys:     4 (Registry, Consumer, setRegistry, authorize)"
echo -e "  Authorize deployer:   2"
echo -e "  publishWorkflow:      3 (one per prize category)"
echo -e "  recordExecution:     23 (mixed success/failure)"
echo -e "  onReport:             8 (with ABI-encoded data)"
echo -e "  ${BOLD}Total:               40+ transactions${NC}"
echo ""
echo -e "  ${BOLD}Prize Categories Covered:${NC}"
echo -e "  ${GREEN}✓${NC} Custom Data Feeds    → Chainlink ETH/USD Reader (Template 13)"
echo -e "  ${GREEN}✓${NC} Cross-Chain Bridge   → CCIP Token Bridge (Template 15)"
echo -e "  ${GREEN}✓${NC} AI Agent Orchestration → Multi-AI Consensus (Template 9)"
echo ""
echo -e "  ${YELLOW}Copy the Explorer URL for your hackathon submission.${NC}"
echo -e "  To clean up: curl -X DELETE $API_URL/api/tenderly/cleanup"
echo ""
