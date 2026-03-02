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

mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: () => {},
}))

mock.module(resolve(SRC, "services/blockchain/provider.ts"), () => ({
  account: { address: "0xDeployerAddress" },
}))

// --- Controllable mocks for manager + runCommand + readFile ---

const mockTestnet = {
  id: "vnet-deploy-123",
  name: "Deploy Test",
  slug: "deploy-test",
  networkId: 84532,
  chainId: 73571,
  publicRpcUrl: "https://public.rpc.test",
  adminRpcUrl: "https://admin.rpc.test",
  explorerUrl: "https://dashboard.tenderly.co/test",
  createdAt: "2026-03-01T00:00:00Z",
}

let mockActiveTestnet: { testnet: typeof mockTestnet | null; contracts: any; snapshotId: string | null } = {
  testnet: mockTestnet,
  contracts: { registry: null, consumer: null },
  snapshotId: null,
}

const setContractAddressesCalls: Array<{ registry: string; consumer: string }> = []

mock.module(resolve(SRC, "services/tenderly/manager.ts"), () => ({
  getActiveTestnet: () => ({ ...mockActiveTestnet }),
  setContractAddresses: (registry: string, consumer: string) => {
    setContractAddressesCalls.push({ registry, consumer })
  },
}))

// Controllable runCommand mock
let mockRunCommandResult = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  timedOut: false,
}

mock.module(resolve(SRC, "services/cre/cre-utils.ts"), () => ({
  runCommand: () => Promise.resolve({ ...mockRunCommandResult }),
}))

// Controllable readFile mock — we mock the whole node:fs/promises module
let mockReadFileResult: string | Error = JSON.stringify({
  contracts: {
    AutopilotRegistry: "0xRegistryFromJSON",
    AutopilotConsumer: "0xConsumerFromJSON",
  },
})

mock.module("node:fs/promises", () => ({
  readFile: () => {
    if (mockReadFileResult instanceof Error) {
      return Promise.reject(mockReadFileResult)
    }
    return Promise.resolve(mockReadFileResult)
  },
}))

// ── Dynamic imports ──
let deployContractsToTestnet: () => Promise<any>

beforeAll(async () => {
  const mod = await import("../services/tenderly/deployer")
  deployContractsToTestnet = mod.deployContractsToTestnet
})

beforeEach(() => {
  mockActiveTestnet = {
    testnet: mockTestnet,
    contracts: { registry: null, consumer: null },
    snapshotId: null,
  }
  mockRunCommandResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
  }
  mockReadFileResult = JSON.stringify({
    contracts: {
      AutopilotRegistry: "0xRegistryFromJSON",
      AutopilotConsumer: "0xConsumerFromJSON",
    },
  })
  setContractAddressesCalls.length = 0
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("deployContractsToTestnet", () => {
  test("succeeds via JSON deployment file", async () => {
    const result = await deployContractsToTestnet()

    expect(result.registryAddress).toBe("0xRegistryFromJSON")
    expect(result.consumerAddress).toBe("0xConsumerFromJSON")
    expect(result.explorerUrl).toBe("https://dashboard.tenderly.co/test")
  })

  test("updates manager state with contract addresses", async () => {
    await deployContractsToTestnet()

    expect(setContractAddressesCalls).toHaveLength(1)
    expect(setContractAddressesCalls[0]).toEqual({
      registry: "0xRegistryFromJSON",
      consumer: "0xConsumerFromJSON",
    })
  })

  test("falls back to stdout parsing when JSON file missing", async () => {
    mockReadFileResult = new Error("ENOENT: no such file")
    // Addresses must be valid 40-hex-char format for the regex to match
    mockRunCommandResult.stdout =
      "AutopilotRegistry deployed to: 0x1111111111111111111111111111111111111111\n" +
      "AutopilotConsumer deployed to: 0x2222222222222222222222222222222222222222\n"

    const result = await deployContractsToTestnet()

    expect(result.registryAddress).toBe("0x1111111111111111111111111111111111111111")
    expect(result.consumerAddress).toBe("0x2222222222222222222222222222222222222222")
  })

  test("throws DEPLOY_TIMEOUT when forge times out", async () => {
    mockRunCommandResult.timedOut = true

    try {
      await deployContractsToTestnet()
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("DEPLOY_TIMEOUT")
      expect(err.statusCode).toBe(504)
    }
  })

  test("throws DEPLOY_FAILED on non-zero exit code", async () => {
    mockRunCommandResult.exitCode = 1
    mockRunCommandResult.stderr = "forge: compilation failed"

    try {
      await deployContractsToTestnet()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("DEPLOY_FAILED")
      expect(err.statusCode).toBe(500)
      expect(err.message).toContain("exit 1")
    }
  })

  test("throws when no active testnet", async () => {
    mockActiveTestnet.testnet = null

    try {
      await deployContractsToTestnet()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_TESTNET_NOT_FOUND")
      expect(err.statusCode).toBe(404)
    }
  })

  test("throws DEPLOY_FAILED when neither JSON nor stdout have addresses", async () => {
    mockReadFileResult = new Error("ENOENT")
    mockRunCommandResult.stdout = "no addresses here"

    try {
      await deployContractsToTestnet()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("DEPLOY_FAILED")
      expect(err.statusCode).toBe(500)
      expect(err.message).toContain("Could not parse deployed addresses")
    }
  })

  test("throws DEPLOY_FAILED when JSON has missing addresses", async () => {
    mockReadFileResult = JSON.stringify({
      contracts: {
        AutopilotRegistry: "0xRegistryFromJSON",
        // Missing AutopilotConsumer
      },
    })
    mockRunCommandResult.stdout = "no fallback"

    try {
      await deployContractsToTestnet()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("DEPLOY_FAILED")
    }
  })
})
