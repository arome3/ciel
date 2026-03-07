# Ciel

**AI-Powered Chainlink CRE Workflow Marketplace**

Describe blockchain automations in plain English. An AI agent generates a valid [CRE](https://docs.chain.link/cre) workflow, simulates it, and publishes it as a payable micro-service that other AI agents can discover and execute via [x402](https://www.x402.org/) micropayments.

> *"Describe what you want automated onchain, and an AI builds it, tests it, and sells it to other AI agents."*
>
> *Chainlink CRE took workflow development from weeks to hours. Ciel takes it from hours to minutes.*

---

## How It Works

```
┌─────────────────────────────────────────────┐
│              GENERATE                        │
│  User describes intent in natural language   │
│  → AI generates CRE TypeScript workflow      │
│  → CRE CLI compiles to WASM + simulates it  │
│  → User reviews and approves                 │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              PUBLISH                         │
│  Approved workflow is registered onchain     │
│  with metadata, pricing, and x402 endpoint   │
│  → Deployed to Chainlink DON via CRE CLI    │
│  → Becomes a payable micro-service           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              CONSUME                         │
│  AI agents discover workflows via registry   │
│  → Evaluate fitness via metadata + AI        │
│  → Pay via x402 micropayment                 │
│  → Trigger execution, receive results        │
└─────────────────────────────────────────────┘
```

The flywheel: more users generating workflows → richer marketplace → more agents consuming → more revenue for creators → more users building.

---

## Generation Pipeline (Deep Dive)

When a user types a prompt like *"Monitor ETH/USD price every 5 minutes and swap on Uniswap when it drops below $1800"*, the following happens:

```
  Prompt
    │
    ▼
┌──────────────┐   ParsedIntent    ┌──────────────────┐   Template ID
│ Intent Parser ├─────────────────►│ Template Matcher  ├──────────┐
│ (deterministic│  triggers, data   │ (TF-IDF + ONNX   │          │
│  NLP, no LLM) │  sources, actions │  embeddings)      │          │
└──────────────┘                   └──────────────────┘          │
                                                                  ▼
┌──────────────┐   Valid CRE TS    ┌──────────────────┐   Raw code
│  Validator   │◄─────────────────│ Code Generator    │◄─────────┘
│ (8-point check│  + quickFix      │ (GPT-5.3-Codex,  │  intent +
│  + 10 auto-  │  auto-repair     │  layered prompt)  │  template
│  repair steps)│                  └──────────────────┘
└──────┬───────┘
       │ validated code
       ▼
┌──────────────────────────────────────────────┐
│              CRE Simulation                   │
│  1. Write TS + config to temp workspace       │
│  2. Symlink pre-cached deps (cre-sdk, viem)   │
│  3. cre-compile: TS → JS → Javy WASM          │
│  4. cre-simulate: run WASM in sandboxed DON   │
│     (fire trigger → execute handler → report) │
└──────────────────────────────────────────────┘
```

### Why WASM?

CRE workflows run on Chainlink DON nodes using BFT consensus. Every node must produce the **exact same output** from the exact same code. The CRE CLI compiles TypeScript → JavaScript → WASM via [Javy](https://github.com/nicovank/nickel/blob/main/nickel.cc) (QuickJS engine). QuickJS is deterministic — no `fetch`, `WebSocket`, `Date.now()`, or `process`. All external I/O goes through SDK capabilities that the DON consensus protocol mediates, ensuring identical results across nodes.

### Stage Details

| Stage | Component | What It Does |
|-------|-----------|-------------|
| **1. Intent Parser** | Deterministic NLP | Stemming (Porter), synonym expansion, entity extraction, trigger detection (`cron`/`http`/`evm_log`). No LLM — pure keyword matching with adaptive fuzzy distance. |
| **2. Template Matcher** | TF-IDF + Embeddings | Scores intent against 22 CRE templates. Keyword signal (IDF-weighted) fused with ONNX semantic embeddings (all-MiniLM-L6-v2, 384-dim). |
| **3. Code Generator** | GPT-5.3-Codex | Layered prompt: static base (~14K chars, OpenAI prefix-cached) + template-specific patterns. Generates complete CRE TypeScript via Responses API with Structured Outputs. |
| **4. Validator** | 8-point check + quickFix | Import whitelist, no async in handlers, no non-determinism, correct SDK patterns. 10 auto-repair steps fix common LLM mistakes (e.g. `Date.now()` → `runtime.now()`, `JSON.parse(body)` → `decodeJson(body)`). |
| **5. Simulation** | CRE CLI | Compiles to WASM, runs in sandboxed DON simulator. Network errors (DNS, RPC) are non-fatal — they're runtime capability errors, not code bugs. |

### Multi-AI Consensus Oracle (Flagship Template)

The crown jewel — a CRE workflow that queries **GPT-4o, Claude, and Gemini** independently on each DON node, applies BFT outlier rejection for intra-node consensus, then uses `consensusMedianAggregation` across all DON nodes for a cryptographically verified onchain result.

This mirrors the architecture from Chainlink's corporate actions pilot with Swift, DTCC, Euroclear, and 24 financial institutions — and demonstrates why CRE's decentralized consensus is *structurally necessary*, not just a pass-through.

### x402 Payment-Gated Execution

Published workflows become payable micro-services. Any AI agent can discover a workflow, pay 0.01 USDC via x402 on Base Sepolia, and receive the execution result. Workflow owners bypass payment via EIP-191 signature verification.

### 22 Pre-Built CRE Templates

| # | Template | Category |
|---|----------|----------|
| 1 | Price Monitoring + Alert | Core DeFi |
| 2 | Cross-Chain Portfolio Rebalancer | Core DeFi |
| 3 | AI Prediction Market Settlement | Core DeFi |
| 4 | Stablecoin Issuance Pipeline | Institutional |
| 5 | Proof of Reserve Monitor | Institutional |
| 6 | Tokenized Fund Lifecycle | Institutional |
| 7 | Parametric Insurance | Risk & Compliance |
| 8 | Compliance-Gated DeFi Ops | Risk & Compliance |
| 9 | Multi-AI Consensus Oracle | AI-Powered |
| 10 | Custom Data Feed / NAV Oracle | AI-Powered |
| 11 | DEX Swap (Uniswap V3) | Core DeFi |
| 12 | Wallet Activity Monitor | Core DeFi |
| 13 | Chainlink Data Feed Reader | Core DeFi |
| 14 | Stateful KV Store (S3 + SigV4) | Infrastructure |
| 15 | Cross-Chain CCIP Transfer | Cross-Chain |
| 16 | Dual-Trigger Workflow | Advanced |
| 17 | Stablecoin Redemption / Burn | Institutional |
| 18 | Payment Initiation & Confirmation | Institutional |
| 19 | Escrow Lock / Release | Institutional |
| 20 | Settlement Reconciliation | Institutional |
| 21 | Shareholder Registry | Institutional |
| 22 | Dividend Distribution | Institutional |

---

## Architecture

```
ciel/
├── apps/
│   ├── api/          # Express backend (Bun runtime)
│   ├── web/          # Next.js 14 frontend
│   └── cli/          # CLI tool
├── contracts/        # Foundry Solidity contracts (Base Sepolia)
├── agent/            # Demo AI agent
├── packages/
│   ├── sdk/          # @ciel/sdk — Buyer SDK (discover + execute)
│   ├── mcp-server/   # @ciel/mcp-server — MCP tool server for AI agents
│   └── shared/       # Shared types, constants, utils
├── package.json      # Bun workspaces root
└── turbo.json        # Turborepo task config
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.2+ |
| Monorepo | Turborepo 2.x |
| Backend | Express.js, Zod validation |
| Frontend | Next.js 14, React 18, TailwindCSS, shadcn/ui, Monaco Editor, Zustand |
| Database | SQLite via `bun:sqlite` + Drizzle ORM |
| AI (Primary) | OpenAI GPT-5.3-Codex with Structured Outputs (Responses API) |
| AI (Fallback) | Anthropic Claude Sonnet 4 |
| Smart Contracts | Foundry, Solidity 0.8.24, Base Sepolia (chain ID 84532) |
| Onchain Library | Viem 2.x |
| Payments | `@x402/express` (server), `@x402/fetch` (client) |
| CRE SDK | `@chainlink/cre-sdk` ^1.1.3 |
| Real-Time | Server-Sent Events via `better-sse` |

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) 1.2+
- [Foundry](https://book.getfoundry.sh/) (for smart contract development)
- [CRE CLI](https://docs.chain.link/cre) (for workflow simulation)
- OpenAI API key (GPT-4o for code generation)

### Installation

```bash
git clone <repo-url>
cd ciel
bun install
```

### Environment Setup

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | GPT-4o for code generation and consensus oracle |
| `ANTHROPIC_API_KEY` | Claude for consensus oracle + fallback generation |
| `GEMINI_API_KEY` | Gemini for consensus oracle |
| `PRIVATE_KEY` | Deployer wallet private key (Base Sepolia) |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC endpoint |
| `DATABASE_PATH` | SQLite database path (default: `./data/ciel.db`) |

See `.env.example` for the full list including x402, Tenderly, and contract address variables.

### Development

```bash
# Run everything (API + frontend)
bun run dev

# Run only the API server (port 3001)
bun run dev:api

# Run only the frontend (port 3000)
bun run dev:web
```

### Testing

```bash
# Run all tests across workspaces
bun run test

# Run API tests only
cd apps/api && bun test

# Run smart contract tests
cd contracts && forge test
```

### Build

```bash
bun run build
```

---

## API Reference

All routes are prefixed with `/api` unless noted.

| Method | Route | Description | Rate Limit |
|--------|-------|-------------|------------|
| `GET` | `/.well-known/agent-card.json` | A2A agent card with dynamic skills (root path) | Default |
| `GET` | `/health` | Health check (DB ping, SSE clients, uptime) | Default |
| `GET` | `/workflows` | List published workflows | Default |
| `GET` | `/workflows/:id` | Get workflow by ID | Default |
| `POST` | `/generate` | Generate a CRE workflow from natural language | 10 req/min |
| `POST` | `/simulate` | Run CRE CLI simulation (stored or direct mode) | 5 req/min |
| `POST` | `/publish` | Publish workflow to onchain registry + deploy to DON | Default |
| `POST` | `/workflows/:id/redeploy` | Redeploy a failed DON deployment | Default |
| `GET` | `/workflows/:id/execute` | Execute workflow (x402-gated, 0.01 USDC) | 30 req/min |
| `GET` | `/events` | SSE stream for real-time activity | Persistent |
| `POST` | `/pipelines` | Create a multi-workflow pipeline | 10 req/min |
| `POST` | `/pipelines/:id/execute` | Execute a pipeline (DAG scheduler) | 10 req/min |
| `GET` | `/pipelines/metrics` | Pipeline execution metrics | Default |

### Generate a Workflow

```bash
curl -X POST http://localhost:3001/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Every hour, check if ETH drops below $1800 and alert me"}'
```

The AI engine parses the intent, matches it to a template, generates CRE TypeScript code, validates it, and returns:

```json
{
  "workflow": {
    "id": "uuid",
    "code": "// CRE TypeScript workflow...",
    "config": "{ ... }",
    "templateId": 1,
    "explanation": "This workflow uses a cron trigger to..."
  }
}
```

---

## Smart Contracts

Deployed on **Base Sepolia** (chain ID 84532).

| Contract | Purpose |
|----------|---------|
| `AutopilotRegistry` | Onchain workflow registry — stores metadata, pricing, discovery indexes by category and chain |
| `AutopilotConsumer` | Implements `IReceiver` — receives and stores CRE DON reports per workflow |

```bash
bun run deploy:contracts
```

---

## Database

SQLite via Drizzle ORM:

| Table | Purpose |
|-------|---------|
| `workflows` | Generated workflows with code, config, simulation results, publish status, DON deployment status, x402 pricing |
| `executions` | Agent executions with payment info, results, and duration |
| `events` | Event log for SSE broadcast (execution, publish, deploy, pipeline events) |
| `pipelines` | Multi-workflow pipeline definitions with steps, pricing, and owner |
| `pipelineExecutions` | Pipeline execution history with per-step results |

```bash
# Push schema changes
bun run db:push

# Seed sample data
bun run db:seed
```

---

## Agent Integration

Every published Ciel workflow is a payable micro-service that AI agents can discover and execute. There are multiple integration paths depending on the agent's capabilities:

```
┌──────────────────────────────────────────────────────────────┐
│                       AI AGENT                                │
├──────────┬──────────┬──────────┬──────────┬──────────────────┤
│ MCP      │ SDK      │ REST API │ On-Chain │ A2A Agent Card   │
│ Server   │          │ (direct) │ Registry │ (passive)        │
│ (native  │ (npm     │          │ (direct  │                  │
│  tools)  │  module) │          │  read)   │                  │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────────┬────────┘
     │          │          │          │              │
     └──────────┴──────┬───┘          │              │
                       ▼              ▼              ▼
              ┌────────────┐  ┌────────────┐  ┌──────────────┐
              │ Ciel API   │  │ Base       │  │ /.well-known │
              │ (Express)  │  │ Sepolia    │  │ /agent-card  │
              │ + x402     │  │ Registry   │  │ .json        │
              └────────────┘  └────────────┘  └──────────────┘
```

### 1. MCP Server — Native AI Agent Tools

Any MCP-compatible AI agent (Claude, GPT, Cursor, Windsurf) gets native tool access to Ciel.

**Setup for Claude Code / Claude Desktop:**

```json
{
  "mcpServers": {
    "ciel": {
      "command": "npx",
      "args": ["@ciel/mcp-server"],
      "env": { "CIEL_API_URL": "https://api.ciel.app" }
    }
  }
}
```

This gives the agent three tools:

| Tool | Description |
|------|-------------|
| `ciel_discover` | Find workflows by category, chain, or capability |
| `ciel_get_workflow` | Get full workflow details (code, config, schemas, stats) |
| `ciel_execute` | Run a workflow (owner-bypass / free tier) |

### 2. Buyer SDK — Programmatic Access

```bash
npm install @ciel/sdk
```

```ts
import { CielSDK } from "@ciel/sdk"

// Discovery — no auth needed
const sdk = new CielSDK({ apiUrl: "https://api.ciel.app" })
const workflows = await sdk.discover({ category: "core-defi" })
const detail = await sdk.getWorkflow(workflows[0].workflowId)

// Execution with x402 payment — requires optional peer deps
// npm install viem @x402/fetch @x402/evm
const paidSdk = new CielSDK({
  apiUrl: "https://api.ciel.app",
  privateKey: process.env.PRIVATE_KEY,
})
const result = await paidSdk.execute(detail.id)
```

Payment deps (`viem`, `@x402/fetch`, `@x402/evm`) are optional peer deps — only needed for `execute()`.

### 3. REST API — Direct HTTP

Any agent that can make HTTP requests can use the API directly:

```bash
# Discover workflows
curl http://localhost:3001/api/discover?category=core-defi

# Get workflow details
curl http://localhost:3001/api/workflows/{id}

# Execute (x402-gated — returns 402 with payment challenge)
curl http://localhost:3001/api/workflows/{id}/execute
```

The x402 middleware returns a `402 Payment Required` response with `X-Payment-Required` and `X-Payment-Address` headers. The agent signs a USDC payment, retries with `X-Payment` header, and receives the result.

### 4. On-Chain Registry — Direct Blockchain Read

Agents can bypass the API entirely and read the registry contract on Base Sepolia:

| Contract | Address |
|----------|---------|
| `AutopilotRegistry` | `0x10317DEe62219bD69619C27575995F4CC145DdC0` |
| `AutopilotConsumer` | `0x34DAba0F2295972547d3ceb42f12B50a18D8E392` |

```ts
// Read directly from on-chain registry
registry.searchByCategory("core-defi", 0, 10)
registry.getWorkflow(workflowId) // → metadata, pricing, x402Endpoint
```

### 5. A2A Agent Card — Passive Discovery

Ciel serves a [Google A2A](https://a2a-protocol.org/) agent card at:

```bash
curl https://api.ciel.app/.well-known/agent-card.json
```

Returns skills (one per published workflow), auth schemes (`x402`), and provider info. Any A2A-compatible orchestrator can crawl this endpoint to discover Ciel's capabilities automatically.

### 6. SSE Events — Real-Time Streaming

Agents can subscribe to real-time events for monitoring:

```bash
curl -H "Accept: text/event-stream" http://localhost:3001/api/events
```

Event types: `execution`, `discovery`, `deploy`, `pipeline_started`, `pipeline_completed`, `pipeline_failed`, and per-step pipeline events. Supports `Last-Event-ID` for replay (up to 100 events).

### 7. Pipeline Composition — Multi-Workflow DAGs

Agents can compose multiple workflows into a single pipeline with conditional branching:

```bash
# Create a pipeline
curl -X POST http://localhost:3001/api/pipelines \
  -d '{"name": "Price→Swap", "steps": [...], "ownerAddress": "0x..."}'

# Execute it
curl -X POST http://localhost:3001/api/pipelines/{id}/execute \
  -d '{"input": {...}}'
```

Pipelines run steps in DAG order with retry logic (1 attempt, 2s delay), 60s per-step timeout, and conditional branching via `onSuccessStepId`/`onFailureStepId`.

### 8. Demo Agent — Reference Implementation

The `agent/` directory contains a full working example of the consume flow:

1. **Discover** — Queries the API + on-chain registry + x402 Bazaar
2. **Evaluate** — Scores workflow fitness (schema match, reliability, price)
3. **Pay** — Sends x402 micropayment (0.01 USDC on Base Sepolia)
4. **Execute** — Triggers the workflow and receives the result
5. **Compose** — Builds multi-workflow pipelines from a goal string

### 9. CLI — Command-Line Interface

```bash
ciel search --category core-defi     # Discover workflows
ciel show <workflow-id>               # View details
ciel execute <workflow-id>            # Execute with payment
ciel list --published                 # List published workflows
```

---

## Services & Ports

| Service | Port |
|---------|------|
| Next.js Frontend | 3000 |
| Express API | 3001 |
| Anvil (local Foundry) | 8545 |

---

## License

MIT
