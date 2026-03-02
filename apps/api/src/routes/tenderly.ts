import { Router } from "express"
import { z } from "zod"
import { parseEther } from "viem"
import { AppError, ErrorCodes } from "../types/errors"
import { tenderlyLimiter } from "../middleware/rate-limiter"
import { createLogger } from "../lib/logger"
import { ensureTenderlyConfigured, fundAccount } from "../services/tenderly/client"
import {
  createWorkflowTestnet,
  destroyActiveTestnet,
  getActiveTestnet,
  snapshotState,
  revertState,
} from "../services/tenderly/manager"
import { deployContractsToTestnet } from "../services/tenderly/deployer"

const log = createLogger("TenderlyRoutes")
const router = Router()

// --- Validation Schemas ---

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  networkId: z.number().int().positive().default(84532),
  chainId: z.number().int().positive().optional(),
  syncState: z.boolean().default(false),
})

const FundSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountEth: z.number().positive().max(10000).default(100),
})

const RevertSchema = z.object({
  snapshotId: z.string().min(1),
})

// --- Routes ---

// POST /api/tenderly/create — Create Virtual TestNet
router.post("/tenderly/create", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()
    const { name, networkId, chainId, syncState } = CreateSchema.parse(req.body)

    const testnet = await createWorkflowTestnet({ name, networkId, chainId, syncState })

    res.json({
      id: testnet.id,
      name: testnet.name,
      networkId: testnet.networkId,
      chainId: testnet.chainId,
      rpcUrl: testnet.publicRpcUrl,
      explorerUrl: testnet.explorerUrl,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/tenderly/deploy-contracts — Deploy Registry + Consumer
router.post("/tenderly/deploy-contracts", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()

    const result = await deployContractsToTestnet()

    res.json({
      registryAddress: result.registryAddress,
      consumerAddress: result.consumerAddress,
      explorerUrl: result.explorerUrl,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/tenderly/fund — Fund an address with ETH
router.post("/tenderly/fund", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()
    const { address, amountEth } = FundSchema.parse(req.body)

    const { testnet } = getActiveTestnet()
    if (!testnet) {
      throw new AppError(
        ErrorCodes.TENDERLY_TESTNET_NOT_FOUND,
        404,
        "No active testnet — create one first",
      )
    }

    // Convert ETH to wei hex — use parseEther for string-based decimal precision
    const weiAmount = parseEther(amountEth.toString())
    const weiHex = `0x${weiAmount.toString(16)}`

    await fundAccount(testnet.adminRpcUrl, address, weiHex)

    res.json({
      address,
      amountEth,
      weiHex,
      funded: true,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/tenderly/status — Current testnet info
router.get("/tenderly/status", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()

    const { testnet, contracts, snapshotId } = getActiveTestnet()

    res.json({
      active: testnet !== null,
      testnet: testnet
        ? {
          id: testnet.id,
          name: testnet.name,
          networkId: testnet.networkId,
          chainId: testnet.chainId,
          rpcUrl: testnet.publicRpcUrl,
          explorerUrl: testnet.explorerUrl,
        }
        : null,
      contracts,
      snapshotId,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/tenderly/snapshot — Save state snapshot
router.post("/tenderly/snapshot", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()

    const snapshotId = await snapshotState()

    res.json({ snapshotId })
  } catch (err) {
    next(err)
  }
})

// POST /api/tenderly/revert — Revert to snapshot
router.post("/tenderly/revert", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()
    const { snapshotId } = RevertSchema.parse(req.body)

    const success = await revertState(snapshotId)

    res.json({ reverted: success, snapshotId })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/tenderly/cleanup — Destroy active testnet
router.delete("/tenderly/cleanup", tenderlyLimiter, async (req, res, next) => {
  try {
    ensureTenderlyConfigured()

    await destroyActiveTestnet()

    res.json({ destroyed: true })
  } catch (err) {
    next(err)
  }
})

export default router
