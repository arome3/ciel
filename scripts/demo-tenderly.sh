#!/usr/bin/env bash
# Tenderly Virtual TestNet Demo Script
# Prerequisites: TENDERLY_ACCESS_KEY, TENDERLY_PROJECT_SLUG set in .env
set -euo pipefail

echo "=== Ciel × Tenderly Virtual TestNet Demo ==="
echo ""

# Step 1: Create Virtual TestNet
echo ">>> Creating Virtual TestNet (forking Base Sepolia)..."
ciel tenderly create --name "hackathon-demo" --network 84532 --sync
echo ""

# Step 2: Deploy contracts
echo ">>> Deploying Registry + Consumer contracts..."
ciel tenderly deploy
echo ""

# Step 3: Generate a workflow
echo ">>> Generating CRE workflow..."
WORKFLOW_ID=$(ciel generate "Monitor ETH/USD price and alert when below 2000" --json | jq -r '.workflowId')
echo "Workflow ID: $WORKFLOW_ID"
echo ""

# Step 4: Simulate the workflow
echo ">>> Simulating workflow..."
ciel simulate "$WORKFLOW_ID"
echo ""

# Step 5: Show status with explorer URL
echo ">>> Virtual TestNet Status:"
ciel tenderly status
echo ""

echo "=== Demo Complete ==="
echo "Copy the Explorer URL above for your hackathon submission."
echo ""
echo "To clean up: ciel tenderly cleanup"
