import { Router } from "express"
import { desc, eq, and, like, sql } from "drizzle-orm"
import { verifyMessage } from "viem"
import JSZip from "jszip"
import { db } from "../db"
import { workflows } from "../db/schema"
import { WorkflowsListQuerySchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"
import { defaultLimiter } from "../middleware/rate-limiter"
import { buildPackageJson } from "../services/cre/cre-utils"
import { emitEvent } from "../services/events/emitter"

const router = Router()

// GET /workflows — list workflows with pagination + filtering
router.get("/workflows", async (req, res, next) => {
  try {
    const query = WorkflowsListQuerySchema.parse(req.query)
    const { page, limit, category, search, owner, sort } = query
    const publishedFilter = query.published
    const offset = (page - 1) * limit

    // Build conditions
    const conditions: ReturnType<typeof eq>[] = []

    // Published filter — accessing unpublished requires owner auth
    if (publishedFilter === "all" || publishedFilter === "false") {
      const ownerHeader = req.headers["x-owner-address"] as string | undefined
      if (!ownerHeader || !owner || ownerHeader.toLowerCase() !== owner.toLowerCase()) {
        throw new AppError(
          ErrorCodes.UNAUTHORIZED,
          403,
          "Accessing unpublished workflows requires X-Owner-Address header matching owner filter",
        )
      }
      if (publishedFilter === "false") {
        conditions.push(eq(workflows.published, false))
      }
      // "all" = no published filter
    } else {
      // Default: only published
      conditions.push(eq(workflows.published, true))
    }

    if (category) {
      conditions.push(eq(workflows.category, category))
    }
    if (search) {
      conditions.push(like(workflows.name, `%${search}%`))
    }
    if (owner) {
      conditions.push(eq(workflows.ownerAddress, owner))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Sort order
    const orderBy = sort === "newest"
      ? desc(workflows.createdAt)
      : sort === "oldest"
        ? workflows.createdAt
        : desc(workflows.totalExecutions)

    // Fetch rows + total count
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(workflows)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(workflows)
        .where(whereClause),
    ])

    const total = countResult[0]?.count ?? 0

    res.json({
      workflows: rows.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        category: w.category,
        priceUsdc: w.priceUsdc,
        capabilities: JSON.parse(w.capabilities),
        chains: JSON.parse(w.chains),
        totalExecutions: w.totalExecutions,
        successfulExecutions: w.successfulExecutions,
        ownerAddress: w.ownerAddress,
        inputSchema: w.inputSchema ?? null,
        outputSchema: w.outputSchema ?? null,
        published: w.published,
        publishedAt: w.publishTxHash ? w.updatedAt : null,
        deployStatus: w.deployStatus,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      total,
      page,
      limit,
    })
  } catch (err) {
    next(err)
  }
})

// GET /workflows/:id/export — download a ready-to-deploy CRE project zip
router.get("/workflows/:id/export", async (req, res, next) => {
  try {
    const workflow = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, req.params.id))
      .get()

    if (!workflow) {
      throw new AppError(
        ErrorCodes.WORKFLOW_NOT_FOUND,
        404,
        `Workflow ${req.params.id} not found`,
      )
    }

    const sepoliaRpc = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"
    const mainnetRpc = process.env.ETHEREUM_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
    const projectYaml = `staging-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: ${sepoliaRpc}
    - chain-name: ethereum-mainnet
      url: ${mainnetRpc}

production-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: ${sepoliaRpc}
    - chain-name: ethereum-mainnet
      url: ${mainnetRpc}
`

    const workflowYaml = `staging-settings:
  user-workflow:
    workflow-name: "ciel-staging"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.json"
    secrets-path: ""

production-settings:
  user-workflow:
    workflow-name: "ciel-production"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.json"
    secrets-path: ""
`

    const safeName = (workflow.name ?? "workflow").replace(/[^a-zA-Z0-9-_]/g, "-")
    const configJson = typeof workflow.config === "string"
      ? workflow.config
      : JSON.stringify(workflow.config, null, 2)

    const zip = new JSZip()
    zip.file("project.yaml", projectYaml)
    zip.file("wf/main.ts", workflow.code)
    zip.file("wf/config.json", configJson)
    zip.file("wf/package.json", buildPackageJson("ciel-export"))
    zip.file("wf/workflow.yaml", workflowYaml)
    zip.file("README.txt", [
      `Ciel CRE Project: ${workflow.name}`,
      `ID: ${workflow.id}`,
      "",
      "Prerequisites:",
      "  - CRE CLI installed (npm i -g @chainlink/cre-cli)",
      "  - CRE account access configured (cre account access)",
      "  - Bun runtime installed (https://bun.sh)",
      "",
      "Steps:",
      "  1. cd wf && bun install && cd ..",
      "  2. cre workflow deploy wf --target production-settings",
      "",
      "Or use the Ciel CLI instead:",
      `  ciel deploy ${workflow.id}`,
    ].join("\n"))

    const buffer = await zip.generateAsync({ type: "nodebuffer" })

    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-cre-project.zip"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

// POST /workflows/:id/report-deploy — CLI reports successful DON deployment
router.post("/workflows/:id/report-deploy", defaultLimiter, async (req, res, next) => {
  try {
    const workflowId = req.params.id
    const { donWorkflowId } = req.body ?? {}

    if (!donWorkflowId || typeof donWorkflowId !== "string") {
      throw new AppError(
        ErrorCodes.INVALID_INPUT,
        400,
        "Body must include a non-empty donWorkflowId string",
      )
    }

    // Fetch workflow
    const workflow = await db
      .select({ ownerAddress: workflows.ownerAddress })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .get()

    if (!workflow) {
      throw new AppError(
        ErrorCodes.WORKFLOW_NOT_FOUND,
        404,
        `Workflow ${workflowId} not found`,
      )
    }

    // Verify EIP-191 signature
    const address = req.headers["x-owner-address"] as string | undefined
    const signature = req.headers["x-owner-signature"] as string | undefined

    if (!address || !signature) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Missing authentication headers",
      )
    }

    let valid = false
    try {
      valid = await verifyMessage({
        address: address as `0x${string}`,
        message: workflowId,
        signature: signature as `0x${string}`,
      })
    } catch {
      // invalid signature format
    }

    if (!valid) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Invalid signature",
      )
    }

    if (workflow.ownerAddress.toLowerCase() !== address.toLowerCase()) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Not authorized to update this workflow",
      )
    }

    // Update DB
    await db
      .update(workflows)
      .set({
        donWorkflowId,
        deployStatus: "deployed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workflows.id, workflowId))

    // Emit SSE event for live UI update
    emitEvent({
      type: "deploy",
      data: {
        workflowId,
        status: "deployed",
        donWorkflowId,
        timestamp: Date.now(),
      },
    })

    res.json({ workflowId, deployStatus: "deployed" })
  } catch (err) {
    next(err)
  }
})

// GET /workflows/:id — get a single workflow by ID
router.get("/workflows/:id", async (req, res, next) => {
  try {
    const workflow = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, req.params.id))
      .get()

    if (!workflow) {
      throw new AppError(
        ErrorCodes.WORKFLOW_NOT_FOUND,
        404,
        `Workflow ${req.params.id} not found`,
      )
    }

    res.json({
      ...workflow,
      capabilities: JSON.parse(workflow.capabilities),
      chains: JSON.parse(workflow.chains),
      config: JSON.parse(workflow.config),
      simulationTrace: workflow.simulationTrace
        ? JSON.parse(workflow.simulationTrace)
        : null,
      inputSchema: workflow.inputSchema ?? null,
      outputSchema: workflow.outputSchema ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /workflows/:id/config — owner updates persistent config defaults
router.patch("/workflows/:id/config", defaultLimiter, async (req, res, next) => {
  try {
    const workflowId = req.params.id
    const { config: newConfig } = req.body ?? {}

    // ── Validate config body ──
    if (
      !newConfig ||
      typeof newConfig !== "object" ||
      Array.isArray(newConfig)
    ) {
      throw new AppError(
        ErrorCodes.INVALID_INPUT,
        400,
        "Body must include a non-null config object",
      )
    }

    // ── Fetch workflow ──
    const workflow = await db
      .select({
        ownerAddress: workflows.ownerAddress,
      })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .get()

    if (!workflow) {
      throw new AppError(
        ErrorCodes.WORKFLOW_NOT_FOUND,
        404,
        `Workflow ${workflowId} not found`,
      )
    }

    // ── Verify EIP-191 signature ──
    const address = req.headers["x-owner-address"] as string | undefined
    const signature = req.headers["x-owner-signature"] as string | undefined

    if (!address || !signature) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Missing authentication headers",
      )
    }

    let valid = false
    try {
      valid = await verifyMessage({
        address: address as `0x${string}`,
        message: workflowId,
        signature: signature as `0x${string}`,
      })
    } catch {
      // invalid signature format
    }

    if (!valid) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Invalid signature",
      )
    }

    if (workflow.ownerAddress.toLowerCase() !== address.toLowerCase()) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Not authorized to update this workflow",
      )
    }

    // ── Persist config ──
    await db
      .update(workflows)
      .set({
        config: JSON.stringify(newConfig),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workflows.id, workflowId))

    res.json({ config: newConfig })
  } catch (err) {
    next(err)
  }
})

export default router
