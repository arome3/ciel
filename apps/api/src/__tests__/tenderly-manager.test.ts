import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    TENDERLY_ACCESS_KEY: "test-key",
    TENDERLY_ACCOUNT_SLUG: "test-account",
    TENDERLY_PROJECT_SLUG: "test-project",
    BASE_SEPOLIA_RPC_URL: "https://base-sepolia.test",
    PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    NODE_ENV: "test",
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
const emittedEvents: Array<{ type: string; data: unknown }> = []
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: (event: any) => { emittedEvents.push(event) },
}))

// Mock the Tenderly client module
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

// Mock provider (only needs account)
mock.module(resolve(SRC, "services/blockchain/provider.ts"), () => ({
  account: { address: "0xDeployerAddress" },
  getPublicClient: () => ({}),
  getWalletClient: () => ({}),
  publicClient: {},
  walletClient: {},
}))

// ── Dynamic import ──
let createWorkflowTestnet: typeof import("../services/tenderly/manager").createWorkflowTestnet
let destroyActiveTestnet: typeof import("../services/tenderly/manager").destroyActiveTestnet
let getActiveTestnet: typeof import("../services/tenderly/manager").getActiveTestnet
let setContractAddresses: typeof import("../services/tenderly/manager").setContractAddresses
let snapshotState: typeof import("../services/tenderly/manager").snapshotState
let revertState: typeof import("../services/tenderly/manager").revertState
let _resetManagerState: typeof import("../services/tenderly/manager")._resetManagerState

beforeAll(async () => {
  const mod = await import("../services/tenderly/manager")
  createWorkflowTestnet = mod.createWorkflowTestnet
  destroyActiveTestnet = mod.destroyActiveTestnet
  getActiveTestnet = mod.getActiveTestnet
  setContractAddresses = mod.setContractAddresses
  snapshotState = mod.snapshotState
  revertState = mod.revertState
  _resetManagerState = mod._resetManagerState
})

beforeEach(() => {
  _resetManagerState()
  emittedEvents.length = 0
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("createWorkflowTestnet", () => {
  test("creates testnet and sets active state", async () => {
    const result = await createWorkflowTestnet({ name: "Test Net", networkId: 84532 })

    expect(result.id).toBe("vnet-test-123")
    expect(result.name).toBe("Test Net")

    const active = getActiveTestnet()
    expect(active.testnet).not.toBeNull()
    expect(active.testnet!.id).toBe("vnet-test-123")
  })

  test("emits SSE event on creation", async () => {
    await createWorkflowTestnet({ name: "Test", networkId: 84532 })

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].type).toBe("tenderly")
    expect((emittedEvents[0].data as any).action).toBe("testnet_created")
  })

  test("destroys existing testnet before creating new one", async () => {
    await createWorkflowTestnet({ name: "First", networkId: 84532 })
    emittedEvents.length = 0

    await createWorkflowTestnet({ name: "Second", networkId: 1 })

    // Should have emitted destroy + create events
    const actions = emittedEvents.map(e => (e.data as any).action)
    expect(actions).toContain("testnet_destroyed")
    expect(actions).toContain("testnet_created")
  })
})

describe("destroyActiveTestnet", () => {
  test("clears active state", async () => {
    await createWorkflowTestnet({ name: "ToDestroy", networkId: 84532 })
    emittedEvents.length = 0

    await destroyActiveTestnet()

    const active = getActiveTestnet()
    expect(active.testnet).toBeNull()
    expect(active.contracts.registry).toBeNull()
    expect(active.snapshotId).toBeNull()
  })

  test("throws when no active testnet", async () => {
    try {
      await destroyActiveTestnet()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_TESTNET_NOT_FOUND")
    }
  })

  test("emits SSE event on destruction", async () => {
    await createWorkflowTestnet({ name: "ToDestroy", networkId: 84532 })
    emittedEvents.length = 0

    await destroyActiveTestnet()

    expect(emittedEvents).toHaveLength(1)
    expect((emittedEvents[0].data as any).action).toBe("testnet_destroyed")
  })
})

describe("setContractAddresses", () => {
  test("stores contract addresses", async () => {
    await createWorkflowTestnet({ name: "Test", networkId: 84532 })

    setContractAddresses("0xRegistry", "0xConsumer")

    const active = getActiveTestnet()
    expect(active.contracts.registry).toBe("0xRegistry")
    expect(active.contracts.consumer).toBe("0xConsumer")
  })

  test("throws when no active testnet", () => {
    try {
      setContractAddresses("0x1", "0x2")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_TESTNET_NOT_FOUND")
    }
  })

  test("emits SSE event on deployment", async () => {
    await createWorkflowTestnet({ name: "Test", networkId: 84532 })
    emittedEvents.length = 0

    setContractAddresses("0xReg", "0xCon")

    expect(emittedEvents).toHaveLength(1)
    expect((emittedEvents[0].data as any).action).toBe("contracts_deployed")
  })
})

describe("snapshotState", () => {
  test("creates snapshot and stores ID", async () => {
    await createWorkflowTestnet({ name: "Test", networkId: 84532 })

    const id = await snapshotState()
    expect(id).toBe("0xsnap123")

    const active = getActiveTestnet()
    expect(active.snapshotId).toBe("0xsnap123")
  })

  test("throws when no active testnet", async () => {
    try {
      await snapshotState()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_TESTNET_NOT_FOUND")
    }
  })
})

describe("revertState", () => {
  test("reverts and clears snapshot ID", async () => {
    await createWorkflowTestnet({ name: "Test", networkId: 84532 })
    await snapshotState()

    const result = await revertState("0xsnap123")
    expect(result).toBe(true)

    const active = getActiveTestnet()
    expect(active.snapshotId).toBeNull()
  })

  test("throws when no active testnet", async () => {
    try {
      await revertState("0xsnap123")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_TESTNET_NOT_FOUND")
    }
  })
})

describe("getActiveTestnet", () => {
  test("returns null state when no testnet active", () => {
    const active = getActiveTestnet()
    expect(active.testnet).toBeNull()
    expect(active.contracts.registry).toBeNull()
    expect(active.contracts.consumer).toBeNull()
    expect(active.snapshotId).toBeNull()
  })
})
