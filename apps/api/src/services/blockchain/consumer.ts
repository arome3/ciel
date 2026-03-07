import { getPublicClient } from "./provider"
import { config } from "../../config"
import { parseAbi, type Hex } from "viem"
import { createLogger } from "../../lib/logger"
import { AppError, ErrorCodes } from "../../types/errors"
import { withRetry } from "./retry"

const log = createLogger("Consumer")

// --- ABI (read-only functions) ---

const consumerAbi = parseAbi([
  "function getLatestReport(bytes32 workflowId) view returns (bytes report, uint256 timestamp)",
  "function getReportCount(bytes32 workflowId) view returns (uint256)",
  "function getReport(bytes32 workflowId, uint256 index) view returns (bytes)",
  "function getAllReports(bytes32 workflowId, uint256 offset, uint256 limit) view returns (bytes[], uint256)",
])

// --- Dynamic Consumer Address Resolution ---

type ManagerModule = typeof import("../tenderly/manager")
let _manager: ManagerModule | null = null
function getManager(): ManagerModule {
  if (!_manager) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _manager = require("../tenderly/manager") as ManagerModule
  }
  return _manager
}

function getConsumerAddress(): Hex {
  const active = getManager().getActiveTestnet()
  if (active.testnet && active.contracts.consumer) {
    log.debug(`Using VNet consumer: ${active.contracts.consumer}`)
    return active.contracts.consumer as Hex
  }
  return config.CONSUMER_CONTRACT_ADDRESS as Hex
}

// --- Read Functions ---

export async function getLatestReport(
  workflowId: Hex
): Promise<{ report: Hex; timestamp: bigint }> {
  try {
    const [report, timestamp] = await withRetry(() =>
      getPublicClient().readContract({
        address: getConsumerAddress(),
        abi: consumerAbi,
        functionName: "getLatestReport",
        args: [workflowId],
      })
    )

    log.debug(`Fetched latest report for ${workflowId}`)
    return { report: report as Hex, timestamp }
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to get latest report from consumer",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}

export async function getReportCount(workflowId: Hex): Promise<bigint> {
  try {
    const count = await withRetry(() =>
      getPublicClient().readContract({
        address: getConsumerAddress(),
        abi: consumerAbi,
        functionName: "getReportCount",
        args: [workflowId],
      })
    )

    return count
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to get report count from consumer",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}

export async function getReportsPaginated(
  workflowId: Hex,
  offset: bigint = 0n,
  limit: bigint = 50n
): Promise<{ data: readonly Hex[]; total: bigint }> {
  try {
    const [reports, total] = await withRetry(() =>
      getPublicClient().readContract({
        address: getConsumerAddress(),
        abi: consumerAbi,
        functionName: "getAllReports",
        args: [workflowId, offset, limit],
      })
    )

    log.debug(`Fetched ${reports.length} reports for ${workflowId} (total: ${total})`)
    return { data: reports as readonly Hex[], total }
  } catch (err) {
    throw new AppError(
      ErrorCodes.CONTRACT_ERROR,
      500,
      "Failed to get paginated reports from consumer",
      { cause: err instanceof Error ? err.message : String(err) }
    )
  }
}
