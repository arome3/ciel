import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// Config mock: Tenderly is configured
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    TENDERLY_ACCESS_KEY: "test-key",
    TENDERLY_ACCOUNT_SLUG: "test-account",
    TENDERLY_PROJECT_SLUG: "test-project",
    TENDERLY_VIRTUAL_TESTNET_RPC: undefined,
    BASE_SEPOLIA_RPC_URL: "https://base-sepolia.test",
    PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    REGISTRY_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    CONSUMER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000002",
    WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
    X402_FACILITATOR_URL: "https://x402.test",
    API_PORT: 3001,
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
    DATABASE_PATH: ":memory:",
    CRE_CLI_PATH: "echo",
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
  },
}))

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// Mock emitter
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: () => {},
  getAgentChannel: () => ({}),
  getConnectedClientCount: () => 0,
}))

// Mock provider
mock.module(resolve(SRC, "services/blockchain/provider.ts"), () => ({
  account: { address: "0xDeployerAddress" },
  getPublicClient: () => ({}),
  getWalletClient: () => ({}),
  publicClient: {},
  walletClient: {},
}))

// Mock the Tenderly client
const mockTestnet = {
  id: "vnet-test-123",
  name: "Test Net",
  slug: "test-net",
  networkId: 84532,
  chainId: 73571,
  publicRpcUrl: "https://public.rpc.test",
  adminRpcUrl: "https://admin.rpc.test",
  explorerUrl: "https://dashboard.tenderly.co/test",
  createdAt: "2026-03-01T00:00:00Z",
}

mock.module(resolve(SRC, "services/tenderly/client.ts"), () => ({
  createTestnet: () => Promise.resolve({ ...mockTestnet }),
  deleteTestnet: () => Promise.resolve(),
  fundAccount: () => Promise.resolve(),
  snapshot: () => Promise.resolve("0xsnap123"),
  revertToSnapshot: () => Promise.resolve(true),
  ensureTenderlyConfigured: () => {},
  DEFAULT_FUND_WEI: "0x56BC75E2D63100000",
}))

// Mock rate limiter (no-op in tests)
const noopMiddleware = (_req: any, _res: any, next: any) => next()
mock.module(resolve(SRC, "middleware/rate-limiter.ts"), () => ({
  tenderlyLimiter: noopMiddleware,
  defaultLimiter: noopMiddleware,
  generateLimiter: noopMiddleware,
  executeLimiter: noopMiddleware,
  simulateLimiter: noopMiddleware,
  publishLimiter: noopMiddleware,
  eventsSseLimiter: noopMiddleware,
  discoverLimiter: noopMiddleware,
  pipelineLimiter: noopMiddleware,
}))

// Mock deployer
mock.module(resolve(SRC, "services/tenderly/deployer.ts"), () => ({
  deployContractsToTestnet: () => Promise.resolve({
    registryAddress: "0xRegistry123",
    consumerAddress: "0xConsumer456",
    explorerUrl: "https://dashboard.tenderly.co/test",
  }),
}))

// ── Dynamic imports ──
let app: any
let _resetManagerState: () => void

beforeAll(async () => {
  // Import manager to get reset function
  const managerMod = await import("../services/tenderly/manager")
  _resetManagerState = managerMod._resetManagerState

  // Import the route and build a minimal Express app
  const express = (await import("express")).default
  const tenderlyRouter = (await import("../routes/tenderly")).default

  app = express()
  app.use(express.json())
  app.use("/api", tenderlyRouter)
  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    const statusCode = err.statusCode ?? 500
    res.status(statusCode).json({
      error: {
        code: err.code ?? "INTERNAL_ERROR",
        message: err.message ?? "Unknown error",
      },
    })
  })
})

beforeEach(() => {
  _resetManagerState()
})

async function req(method: string, path: string, body?: unknown) {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  }
  if (body) options.body = JSON.stringify(body)

  return new Promise<{ status: number; body: any }>((resolve) => {
    const http = require("http")
    const srv = http.createServer(app)
    srv.listen(0, () => {
      const port = srv.address().port
      const url = `http://localhost:${port}${path}`
      fetch(url, options)
        .then(async (res) => {
          const body = await res.json().catch(() => null)
          srv.close()
          resolve({ status: res.status, body })
        })
        .catch((err) => {
          srv.close()
          resolve({ status: 500, body: { error: err.message } })
        })
    })
  })
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("POST /api/tenderly/create", () => {
  test("creates testnet with default options", async () => {
    const res = await req("POST", "/api/tenderly/create", { name: "test-net" })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe("vnet-test-123")
    expect(res.body.name).toBe("Test Net")
    expect(res.body.explorerUrl).toBeTruthy()
  })

  test("validates name is required", async () => {
    const res = await req("POST", "/api/tenderly/create", {})

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe("POST /api/tenderly/deploy-contracts", () => {
  test("deploys contracts to active testnet", async () => {
    // First create a testnet
    await req("POST", "/api/tenderly/create", { name: "deploy-test" })

    const res = await req("POST", "/api/tenderly/deploy-contracts")

    expect(res.status).toBe(200)
    expect(res.body.registryAddress).toBe("0xRegistry123")
    expect(res.body.consumerAddress).toBe("0xConsumer456")
  })
})

describe("POST /api/tenderly/fund", () => {
  test("funds an address", async () => {
    // Create testnet first
    await req("POST", "/api/tenderly/create", { name: "fund-test" })

    const res = await req("POST", "/api/tenderly/fund", {
      address: "0x1234567890123456789012345678901234567890",
      amountEth: 50,
    })

    expect(res.status).toBe(200)
    expect(res.body.funded).toBe(true)
    expect(res.body.amountEth).toBe(50)
  })

  test("validates address format", async () => {
    await req("POST", "/api/tenderly/create", { name: "fund-test" })

    const res = await req("POST", "/api/tenderly/fund", {
      address: "invalid",
      amountEth: 100,
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe("GET /api/tenderly/status", () => {
  test("returns inactive when no testnet", async () => {
    const res = await req("GET", "/api/tenderly/status")

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
    expect(res.body.testnet).toBeNull()
  })

  test("returns active testnet info", async () => {
    await req("POST", "/api/tenderly/create", { name: "status-test" })

    const res = await req("GET", "/api/tenderly/status")

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(true)
    expect(res.body.testnet).not.toBeNull()
    expect(res.body.testnet.rpcUrl).toBeTruthy()
  })
})

describe("POST /api/tenderly/snapshot", () => {
  test("creates snapshot when testnet active", async () => {
    await req("POST", "/api/tenderly/create", { name: "snap-test" })

    const res = await req("POST", "/api/tenderly/snapshot")

    expect(res.status).toBe(200)
    expect(res.body.snapshotId).toBe("0xsnap123")
  })

  test("fails when no active testnet", async () => {
    const res = await req("POST", "/api/tenderly/snapshot")

    expect(res.status).toBe(404)
  })
})

describe("POST /api/tenderly/revert", () => {
  test("reverts to snapshot", async () => {
    await req("POST", "/api/tenderly/create", { name: "revert-test" })
    await req("POST", "/api/tenderly/snapshot")

    const res = await req("POST", "/api/tenderly/revert", { snapshotId: "0xsnap123" })

    expect(res.status).toBe(200)
    expect(res.body.reverted).toBe(true)
  })
})

describe("DELETE /api/tenderly/cleanup", () => {
  test("destroys active testnet", async () => {
    await req("POST", "/api/tenderly/create", { name: "cleanup-test" })

    const res = await req("DELETE", "/api/tenderly/cleanup")

    expect(res.status).toBe(200)
    expect(res.body.destroyed).toBe(true)

    // Verify it's gone
    const status = await req("GET", "/api/tenderly/status")
    expect(status.body.active).toBe(false)
  })

  test("fails when no active testnet", async () => {
    const res = await req("DELETE", "/api/tenderly/cleanup")

    expect(res.status).toBe(404)
  })
})
