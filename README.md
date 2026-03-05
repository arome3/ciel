# Ciel

**AI-Powered Chainlink CRE Workflow Marketplace**

Describe blockchain automations in plain English. An AI agent generates a valid [CRE](https://docs.chain.link/cre) workflow, simulates it, and publishes it as a payable micro-service that other AI agents can discover and execute via [x402](https://www.x402.org/) micropayments.

> *"Describe what you want automated onchain, and an AI builds it, tests it, and sells it to other AI agents."*

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
│   └── web/          # Next.js 14 frontend
├── contracts/        # Foundry Solidity contracts (Base Sepolia)
├── agent/            # Demo AI agent (CLI)
├── packages/
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

All routes are prefixed with `/api`.

| Method | Route | Description | Rate Limit |
|--------|-------|-------------|------------|
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

## Demo AI Agent

The `agent/` directory contains a standalone CLI agent that demonstrates the full consume flow:

1. **Discover** — Queries the onchain registry and x402 Bazaar for available workflows
2. **Evaluate** — Scores workflow fitness (schema match, reliability, price)
3. **Pay** — Sends x402 micropayment (0.01 USDC on Base Sepolia)
4. **Execute** — Triggers the Multi-AI Consensus Oracle and receives the BFT-verified result

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
