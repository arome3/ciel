// apps/api/src/services/tenderly/manager.ts
// Singleton managing the "active testnet" lifecycle state.

import { createLogger } from "../../lib/logger"
import { AppError, ErrorCodes } from "../../types/errors"
import { emitEvent } from "../events/emitter"
import { account } from "../blockchain/provider"
import {
  createTestnet,
  deleteTestnet,
  fundAccount,
  snapshot as createSnapshot,
  revertToSnapshot as revertSnapshot,
  DEFAULT_FUND_WEI,
  type TenderlyTestnet,
  type CreateTestnetConfig,
} from "./client"

const log = createLogger("TenderlyManager")

// --- State ---

interface ManagerState {
  testnet: TenderlyTestnet | null
  contracts: {
    registry: string | null
    consumer: string | null
  }
  snapshotId: string | null
}

let state: ManagerState = {
  testnet: null,
  contracts: { registry: null, consumer: null },
  snapshotId: null,
}

// --- Public API ---

export async function createWorkflowTestnet(opts: CreateTestnetConfig): Promise<TenderlyTestnet> {
  // Destroy any existing testnet first
  if (state.testnet) {
    log.info("Destroying existing active testnet before creating new one")
    await destroyActiveTestnet()
  }

  const testnet = await createTestnet(opts)
  state.testnet = testnet

  // Auto-fund the deployer account with 100 ETH
  try {
    await fundAccount(testnet.adminRpcUrl, account.address, DEFAULT_FUND_WEI)
    log.info(`Funded deployer ${account.address} with 100 ETH`)
  } catch (err) {
    log.warn(`Failed to auto-fund deployer: ${err instanceof Error ? err.message : String(err)}`)
  }

  emitEvent({
    type: "tenderly",
    data: {
      action: "testnet_created",
      testnetId: testnet.id,
      name: testnet.name,
      explorerUrl: testnet.explorerUrl,
      timestamp: Date.now(),
    },
  })

  return testnet
}

export async function destroyActiveTestnet(): Promise<void> {
  if (!state.testnet) {
    throw new AppError(
      ErrorCodes.TENDERLY_TESTNET_NOT_FOUND,
      404,
      "No active testnet to destroy",
    )
  }

  const testnetId = state.testnet.id
  await deleteTestnet(testnetId)

  emitEvent({
    type: "tenderly",
    data: {
      action: "testnet_destroyed",
      testnetId,
      timestamp: Date.now(),
    },
  })

  state = {
    testnet: null,
    contracts: { registry: null, consumer: null },
    snapshotId: null,
  }
}

export function getActiveTestnet(): {
  testnet: TenderlyTestnet | null
  contracts: { registry: string | null; consumer: string | null }
  snapshotId: string | null
} {
  return { ...state }
}

export function setContractAddresses(registry: string, consumer: string): void {
  if (!state.testnet) {
    throw new AppError(
      ErrorCodes.TENDERLY_TESTNET_NOT_FOUND,
      404,
      "No active testnet — create one first",
    )
  }

  state.contracts = { registry, consumer }
  log.info(`Contract addresses set — Registry: ${registry}, Consumer: ${consumer}`)

  emitEvent({
    type: "tenderly",
    data: {
      action: "contracts_deployed",
      testnetId: state.testnet.id,
      registry,
      consumer,
      timestamp: Date.now(),
    },
  })
}

export async function snapshotState(): Promise<string> {
  if (!state.testnet) {
    throw new AppError(
      ErrorCodes.TENDERLY_TESTNET_NOT_FOUND,
      404,
      "No active testnet — create one first",
    )
  }

  if (state.snapshotId) {
    log.warn(`Overwriting existing snapshot ${state.snapshotId} with new one`)
  }

  const id = await createSnapshot(state.testnet.adminRpcUrl)
  state.snapshotId = id
  return id
}

export async function revertState(snapshotId: string): Promise<boolean> {
  if (!state.testnet) {
    throw new AppError(
      ErrorCodes.TENDERLY_TESTNET_NOT_FOUND,
      404,
      "No active testnet — create one first",
    )
  }

  const result = await revertSnapshot(state.testnet.adminRpcUrl, snapshotId)
  if (result) {
    state.snapshotId = null
  }
  return result
}

// --- Test-only introspection ---

export function _resetManagerState(): void {
  state = {
    testnet: null,
    contracts: { registry: null, consumer: null },
    snapshotId: null,
  }
}
