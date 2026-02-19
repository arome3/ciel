import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — at external boundary with absolute paths
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

const mockWriteContract = mock(() => Promise.resolve("0xtxhash"))
// Correct event signature: keccak256("WorkflowPublished(bytes32,address,string,string)")
const EVENT_SIG = "0x1121cbf4068a5e17c0badc2bdd4d8552ac59c779af38167f7e966897d9f0b8af"
const ENCODED_STRINGS = "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000004546573740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000046465666900000000000000000000000000000000000000000000000000000000"
const WORKFLOW_ID_TOPIC = "0x000000000000000000000000000000000000000000000000000000000000abcd"
const CREATOR_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000001"

const mockWaitForTransactionReceipt = mock(() =>
  Promise.resolve({
    blockNumber: 123n,
    status: "success",
    logs: [
      {
        address: "0x1234567890abcdef1234567890abcdef12345678",
        topics: [EVENT_SIG, WORKFLOW_ID_TOPIC, CREATOR_TOPIC],
        data: ENCODED_STRINGS,
        blockNumber: 123n,
        transactionHash: "0xtxhash",
        transactionIndex: 0,
        blockHash: "0xblockhash",
        logIndex: 0,
        removed: false,
      },
    ],
  })
)
const mockReadContract = mock(() => Promise.resolve([[], 0n]))

mock.module(resolve(SRC, "services/blockchain/provider.ts"), () => ({
  publicClient: {
    readContract: mockReadContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  },
  walletClient: {
    writeContract: mockWriteContract,
  },
}))

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    REGISTRY_CONTRACT_ADDRESS: "0x1234567890abcdef1234567890abcdef12345678",
    CONSUMER_CONTRACT_ADDRESS: "0xabcdef1234567890abcdef1234567890abcdef12",
    PRIVATE_KEY: "0x0000000000000000000000000000000000000000000000000000000000000001",
    BASE_SEPOLIA_RPC_URL: "http://localhost:8545",
    NODE_ENV: "test",
  },
}))

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
  }),
}))

// ─────────────────────────────────────────────
// Dynamic imports after mocks are registered
// ─────────────────────────────────────────────

let registryModule: typeof import("../services/blockchain/registry")
let nonceManagerModule: typeof import("../services/blockchain/nonce-manager")

beforeAll(async () => {
  registryModule = await import("../services/blockchain/registry")
  nonceManagerModule = await import("../services/blockchain/nonce-manager")
})

beforeEach(() => {
  mockWriteContract.mockClear()
  mockWaitForTransactionReceipt.mockClear()
  mockReadContract.mockClear()
  nonceManagerModule._resetTxMutex()

  // Reset defaults
  mockWriteContract.mockImplementation(() => Promise.resolve("0xtxhash"))
  mockWaitForTransactionReceipt.mockImplementation(() =>
    Promise.resolve({
      blockNumber: 123n,
      status: "success",
      logs: [
        {
          address: "0x1234567890abcdef1234567890abcdef12345678",
          topics: [EVENT_SIG, WORKFLOW_ID_TOPIC, CREATOR_TOPIC],
          data: ENCODED_STRINGS,
          blockNumber: 123n,
          transactionHash: "0xtxhash",
          transactionIndex: 0,
          blockHash: "0xblockhash",
          logIndex: 0,
          removed: false,
        },
      ],
    })
  )
  mockReadContract.mockImplementation(() => Promise.resolve([[], 0n]))
})

// ========================================
// Tests
// ========================================

describe("publishToRegistry", () => {
  test("calls writeContract with correct args and returns workflowId + txHash", async () => {
    const result = await registryModule.publishToRegistry({
      name: "Test",
      description: "Desc",
      category: "defi",
      supportedChains: [10344971235874465080n],
      capabilities: ["HTTPClient"],
      x402Endpoint: "https://example.com",
      pricePerExecution: 100000n,
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(result.txHash).toBe("0xtxhash")
    // workflowId should be extracted from decoded event
    expect(result.workflowId).toBeDefined()
  })

  test("throws AppError when writeContract fails", async () => {
    mockWriteContract.mockImplementation(() =>
      Promise.reject(new Error("execution reverted: EmptyName()"))
    )

    await expect(
      registryModule.publishToRegistry({
        name: "",
        description: "Desc",
        category: "defi",
        supportedChains: [10344971235874465080n],
        capabilities: [],
        x402Endpoint: "",
        pricePerExecution: 0n,
      })
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR" })
  })

  test("throws AppError when event log is missing", async () => {
    mockWaitForTransactionReceipt.mockImplementation(() =>
      Promise.resolve({
        blockNumber: 123n,
        status: "success",
        logs: [], // No logs
      })
    )

    await expect(
      registryModule.publishToRegistry({
        name: "Test",
        description: "Desc",
        category: "defi",
        supportedChains: [10344971235874465080n],
        capabilities: [],
        x402Endpoint: "",
        pricePerExecution: 0n,
      })
    ).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
      message: "Could not extract workflowId from tx receipt",
    })
  })

  test("includes timeout in waitForTransactionReceipt", async () => {
    await registryModule.publishToRegistry({
      name: "Test",
      description: "Desc",
      category: "defi",
      supportedChains: [10344971235874465080n],
      capabilities: [],
      x402Endpoint: "",
      pricePerExecution: 0n,
    })

    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60_000 })
    )
  })
})

describe("recordExecution", () => {
  test("calls writeContract with correct args", async () => {
    await registryModule.recordExecution(
      "0x000000000000000000000000000000000000000000000000000000000000abcd",
      true
    )

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    const call = (mockWriteContract.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
    expect(call.functionName).toBe("recordExecution")
  })

  test("throws AppError on contract revert", async () => {
    mockWriteContract.mockImplementation(() =>
      Promise.reject(new Error("execution reverted: NotAuthorizedSender()"))
    )

    await expect(
      registryModule.recordExecution(
        "0x000000000000000000000000000000000000000000000000000000000000abcd",
        true
      )
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR" })
  })
})

describe("updateWorkflow", () => {
  test("submits correct args", async () => {
    await registryModule.updateWorkflow({
      workflowId: "0x000000000000000000000000000000000000000000000000000000000000abcd",
      name: "Updated",
      description: "Updated Desc",
      category: "analytics",
      capabilities: ["NewCap"],
      x402Endpoint: "https://new.com",
      pricePerExecution: 200000n,
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    const call = (mockWriteContract.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
    expect(call.functionName).toBe("updateWorkflow")
  })

  test("throws AppError on failure", async () => {
    mockWriteContract.mockImplementation(() =>
      Promise.reject(new Error("execution reverted"))
    )

    await expect(
      registryModule.updateWorkflow({
        workflowId: "0x000000000000000000000000000000000000000000000000000000000000abcd",
        name: "Name",
        description: "Desc",
        category: "defi",
        capabilities: [],
        x402Endpoint: "",
        pricePerExecution: 0n,
      })
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR" })
  })
})

describe("reactivateWorkflow", () => {
  test("submits correct args", async () => {
    await registryModule.reactivateWorkflow(
      "0x000000000000000000000000000000000000000000000000000000000000abcd"
    )

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    const call = (mockWriteContract.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
    expect(call.functionName).toBe("reactivateWorkflow")
  })
})

describe("getWorkflowFromRegistry", () => {
  test("calls readContract and returns result", async () => {
    const mockWorkflow = {
      creator: "0x0000000000000000000000000000000000000001" as const,
      name: "Test",
      description: "Desc",
      category: "defi",
      supportedChains: [10344971235874465080n] as readonly bigint[],
      capabilities: ["HTTPClient"] as readonly string[],
      x402Endpoint: "",
      pricePerExecution: 0n,
      totalExecutions: 0n,
      successfulExecutions: 0n,
      createdAt: 1000n,
      active: true,
    }
    mockReadContract.mockImplementation(() => Promise.resolve(mockWorkflow) as never)

    const result = await registryModule.getWorkflowFromRegistry(
      "0x000000000000000000000000000000000000000000000000000000000000abcd"
    )
    expect(result).toEqual(mockWorkflow)
  })

  test("throws AppError on failure", async () => {
    mockReadContract.mockImplementation(() =>
      Promise.reject(new Error("call failed")) as never
    )

    await expect(
      registryModule.getWorkflowFromRegistry(
        "0x000000000000000000000000000000000000000000000000000000000000abcd"
      )
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR" })
  })
})

describe("searchWorkflowsByCategory", () => {
  test("passes offset and limit, returns data + total", async () => {
    const mockIds = ["0xabc", "0xdef"] as const
    mockReadContract.mockImplementation(() =>
      Promise.resolve([mockIds, 5n]) as never
    )

    const result = await registryModule.searchWorkflowsByCategory("defi", 0n, 2n)
    expect(result.data).toEqual(mockIds)
    expect(result.total).toBe(5n)
  })
})

describe("searchWorkflowsByChain", () => {
  test("passes offset and limit, returns data + total", async () => {
    mockReadContract.mockImplementation(() =>
      Promise.resolve([["0xabc"], 1n]) as never
    )

    const result = await registryModule.searchWorkflowsByChain(10344971235874465080n, 0n, 10n)
    expect(result.data).toEqual(["0xabc"])
    expect(result.total).toBe(1n)
  })
})

describe("getAllWorkflowIds", () => {
  test("passes offset and limit, returns data + total", async () => {
    mockReadContract.mockImplementation(() =>
      Promise.resolve([["0x1", "0x2"], 2n]) as never
    )

    const result = await registryModule.getAllWorkflowIds(0n, 50n)
    expect(result.data).toEqual(["0x1", "0x2"])
    expect(result.total).toBe(2n)
  })

  test("throws AppError on RPC failure", async () => {
    mockReadContract.mockImplementation(() =>
      Promise.reject(new Error("network error")) as never
    )

    await expect(
      registryModule.getAllWorkflowIds()
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR" })
  })
})

describe("getCreatorWorkflows", () => {
  test("passes creator, offset, limit", async () => {
    mockReadContract.mockImplementation(() =>
      Promise.resolve([["0xabc"], 1n]) as never
    )

    const result = await registryModule.getCreatorWorkflows(
      "0x0000000000000000000000000000000000000001",
      0n,
      10n
    )
    expect(result.data).toEqual(["0xabc"])
    expect(result.total).toBe(1n)
  })
})

describe("retry integration", () => {
  test("retries writeContract on transient RPC error", async () => {
    let calls = 0
    mockWriteContract.mockImplementation(() => {
      calls++
      if (calls < 2) return Promise.reject(new Error("ECONNRESET"))
      return Promise.resolve("0xtxhash")
    })

    await registryModule.recordExecution(
      "0x000000000000000000000000000000000000000000000000000000000000abcd",
      true
    )

    expect(calls).toBe(2) // first failed, second succeeded
  })

  test("does not retry writeContract on contract revert", async () => {
    let calls = 0
    mockWriteContract.mockImplementation(() => {
      calls++
      return Promise.reject(new Error("execution reverted: Unauthorized()"))
    })

    await expect(
      registryModule.recordExecution(
        "0x000000000000000000000000000000000000000000000000000000000000abcd",
        true
      )
    ).rejects.toThrow()

    expect(calls).toBe(1) // no retry
  })
})
