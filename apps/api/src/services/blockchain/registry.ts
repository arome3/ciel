import { publicClient, walletClient } from "./provider"
import { config } from "../../config"
import { parseAbi, decodeEventLog, type Hex } from "viem"
import { createLogger } from "../../lib/logger"
import { AppError, ErrorCodes } from "../../types/errors"
import { withRetry } from "./retry"
import { txMutex } from "./nonce-manager"

const log = createLogger("Registry")

// --- ABI (relevant functions only) ---

const registryAbi = parseAbi([
  // Write
  "function publishWorkflow(string name, string description, string category, uint64[] supportedChains, string[] capabilities, string x402Endpoint, uint256 pricePerExecution) returns (bytes32)",
  "function updateWorkflow(bytes32 workflowId, string name, string description, string category, string[] capabilities, string x402Endpoint, uint256 pricePerExecution)",
  "function recordExecution(bytes32 workflowId, bool success)",
  "function deactivateWorkflow(bytes32 workflowId)",
  "function reactivateWorkflow(bytes32 workflowId)",
  "function addAuthorizedSender(address sender)",
  "function removeAuthorizedSender(address sender)",
  // Read
  "function getWorkflow(bytes32 workflowId) view returns ((address creator, string name, string description, string category, uint64[] supportedChains, string[] capabilities, string x402Endpoint, uint256 pricePerExecution, uint256 totalExecutions, uint256 successfulExecutions, uint256 createdAt, bool active))",
  "function isAuthorizedSender(address sender) view returns (bool)",
  "function searchByCategory(string category, uint256 offset, uint256 limit) view returns (bytes32[], uint256)",
  "function searchByChain(uint64 chainSelector, uint256 offset, uint256 limit) view returns (bytes32[], uint256)",
  "function getAllWorkflows(uint256 offset, uint256 limit) view returns (bytes32[], uint256)",
  "function getCreatorWorkflows(address creator, uint256 offset, uint256 limit) view returns (bytes32[], uint256)",
  // Events
  "event WorkflowPublished(bytes32 indexed workflowId, address indexed creator, string name, string category)",
  "event WorkflowUpdated(bytes32 indexed workflowId, address indexed creator)",
])

const registryAddress = config.REGISTRY_CONTRACT_ADDRESS as Hex

const TX_TIMEOUT = 60_000

// --- Publish ---

export async function publishToRegistry(params: {
  name: string
  description: string
  category: string
  supportedChains: bigint[]
  capabilities: string[]
  x402Endpoint: string
  pricePerExecution: bigint
}): Promise<{ workflowId: Hex; txHash: Hex }> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "publishWorkflow",
          args: [
            params.name,
            params.description,
            params.category,
            params.supportedChains,
            params.capabilities,
            params.x402Endpoint,
            params.pricePerExecution,
          ],
        })
      )

      log.info(`Published workflow — tx: ${hash}`)

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: TX_TIMEOUT,
      })
      log.info(
        `Confirmed in block ${receipt.blockNumber} — status: ${receipt.status}`
      )

      // Extract workflowId from event logs using decodeEventLog
      const event = receipt.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: registryAbi, data: l.data, topics: l.topics })
          } catch {
            return null
          }
        })
        .find((e) => e?.eventName === "WorkflowPublished")

      if (!event || event.eventName !== "WorkflowPublished") {
        throw new AppError(
          ErrorCodes.CONTRACT_ERROR,
          500,
          "Could not extract workflowId from tx receipt"
        )
      }

      const workflowId = event.args.workflowId as Hex
      return { workflowId, txHash: hash }
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to publish workflow to registry",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

// --- Update Workflow ---

export async function updateWorkflow(params: {
  workflowId: Hex
  name: string
  description: string
  category: string
  capabilities: string[]
  x402Endpoint: string
  pricePerExecution: bigint
}): Promise<Hex> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "updateWorkflow",
          args: [
            params.workflowId,
            params.name,
            params.description,
            params.category,
            params.capabilities,
            params.x402Endpoint,
            params.pricePerExecution,
          ],
        })
      )

      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT })
      log.info(`Updated workflow ${params.workflowId} — tx: ${hash}`)
      return hash
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to update workflow on registry",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

// --- Record Execution ---

export async function recordExecution(
  workflowId: Hex,
  success: boolean
): Promise<void> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "recordExecution",
          args: [workflowId, success],
        })
      )

      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT })
      log.info(
        `Recorded execution for ${workflowId} — success: ${success}`
      )
    } catch (err) {
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to record execution on registry",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

// --- Deactivate ---

export async function deactivateWorkflow(workflowId: Hex): Promise<void> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "deactivateWorkflow",
          args: [workflowId],
        })
      )

      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT })
      log.info(`Deactivated workflow ${workflowId}`)
    } catch (err) {
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to deactivate workflow",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

// --- Reactivate ---

export async function reactivateWorkflow(workflowId: Hex): Promise<void> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "reactivateWorkflow",
          args: [workflowId],
        })
      )

      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT })
      log.info(`Reactivated workflow ${workflowId}`)
    } catch (err) {
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to reactivate workflow",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

// --- Access Control ---

export async function addAuthorizedSender(sender: Hex): Promise<void> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "addAuthorizedSender",
          args: [sender],
        })
      )

      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT })
      log.info(`Added authorized sender: ${sender}`)
    } catch (err) {
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to add authorized sender",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

export async function removeAuthorizedSender(sender: Hex): Promise<void> {
  return txMutex.withLock(async () => {
    try {
      const hash = await withRetry(() =>
        walletClient.writeContract({
          address: registryAddress,
          abi: registryAbi,
          functionName: "removeAuthorizedSender",
          args: [sender],
        })
      )

      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT })
      log.info(`Removed authorized sender: ${sender}`)
    } catch (err) {
      throw new AppError(
        ErrorCodes.CONTRACT_ERROR,
        500,
        "Failed to remove authorized sender",
        { cause: err instanceof Error ? err.message : String(err) }
      )
    }
  })
}

// --- Read ---

export async function getWorkflowFromRegistry(workflowId: Hex) {
  try {
    return await withRetry(() =>
      publicClient.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "getWorkflow",
        args: [workflowId],
      })
    )
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to read workflow from registry",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}

export async function searchWorkflowsByCategory(
  category: string,
  offset: bigint = 0n,
  limit: bigint = 50n
): Promise<{ data: readonly Hex[]; total: bigint }> {
  try {
    const [ids, total] = await withRetry(() =>
      publicClient.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "searchByCategory",
        args: [category, offset, limit],
      })
    )
    return { data: ids as readonly Hex[], total }
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to search workflows by category",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}

export async function searchWorkflowsByChain(
  chainSelector: bigint,
  offset: bigint = 0n,
  limit: bigint = 50n
): Promise<{ data: readonly Hex[]; total: bigint }> {
  try {
    const [ids, total] = await withRetry(() =>
      publicClient.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "searchByChain",
        args: [chainSelector, offset, limit],
      })
    )
    return { data: ids as readonly Hex[], total }
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to search workflows by chain",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}

export async function getAllWorkflowIds(
  offset: bigint = 0n,
  limit: bigint = 50n
): Promise<{ data: readonly Hex[]; total: bigint }> {
  try {
    const [ids, total] = await withRetry(() =>
      publicClient.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "getAllWorkflows",
        args: [offset, limit],
      })
    )
    return { data: ids as readonly Hex[], total }
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to get all workflow IDs from registry",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}

export async function getCreatorWorkflows(
  creator: Hex,
  offset: bigint = 0n,
  limit: bigint = 50n
): Promise<{ data: readonly Hex[]; total: bigint }> {
  try {
    const [ids, total] = await withRetry(() =>
      publicClient.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "getCreatorWorkflows",
        args: [creator, offset, limit],
      })
    )
    return { data: ids as readonly Hex[], total }
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to get creator workflows from registry",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}
