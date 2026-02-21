// apps/api/src/services/cre/deployer.ts

import { eq } from "drizzle-orm"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"
import { Semaphore } from "../../lib/semaphore"
import { db } from "../../db"
import { workflows } from "../../db/schema"
import { emitEvent } from "../events/emitter"
import { runCommand, withCREWorkspace, parseDonWorkflowId } from "./cre-utils"

const log = createLogger("CRE Deployer")

// --- Constants ---

const DEPLOY_TIMEOUT = 60_000         // 60 seconds

// --- Concurrency Semaphore (R3 fix — was missing, unbounded before) ---

const deploySemaphore = new Semaphore(3)

// --- Test-only introspection ---

export function _getDeployState(): { activeCount: number; queueLength: number } {
  return deploySemaphore._getState()
}

// --- Interfaces ---

export interface DeployInput {
  code: string
  configJson: Record<string, unknown>
  consumerAddress: string
}

export interface DeployResult {
  donWorkflowId: string
  success: boolean
}

// Re-export for backward compat (function lives in cre-utils.ts)
export { parseDonWorkflowId } from "./cre-utils"

// --- Main Deploy Function ---

export async function deployWorkflow(input: DeployInput): Promise<DeployResult> {
  const startTime = Date.now()

  // Merge consumerAddress into configJson (F4 fix — was dead code before)
  const mergedConfig = {
    ...input.configJson,
    consumerContractAddress: input.consumerAddress,
  }

  try {
    return await withCREWorkspace(
      {
        prefix: "ciel-deploy",
        code: input.code,
        configJson: mergedConfig,
        semaphore: deploySemaphore,
      },
      async (cwd, env) => {
        // Run CRE workflow deploy
        const deployResult = await runCommand(
          [config.CRE_CLI_PATH, "workflow", "deploy", ".", "--target", "production"],
          cwd,
          env,
          DEPLOY_TIMEOUT,
          "cre workflow deploy",
        )

        if (deployResult.timedOut) {
          throw new AppError(
            ErrorCodes.DEPLOY_TIMEOUT,
            500,
            `CRE deploy timed out after ${DEPLOY_TIMEOUT}ms`,
          )
        }

        if (deployResult.exitCode !== 0) {
          throw new AppError(
            ErrorCodes.DEPLOY_FAILED,
            500,
            `CRE deploy failed (exit ${deployResult.exitCode}): ${deployResult.stderr.slice(0, 500)}`,
          )
        }

        // Parse workflow ID from output
        const combinedOutput = deployResult.stdout + "\n" + deployResult.stderr
        const donWorkflowId = parseDonWorkflowId(combinedOutput)

        const duration = Date.now() - startTime
        log.info(`Deploy succeeded in ${duration}ms — donWorkflowId: ${donWorkflowId}`)

        return {
          donWorkflowId,
          success: true,
        }
      },
    )
  } catch (err) {
    const message = (err as Error).message

    // ENOENT detection: CRE binary not found
    if (
      message.includes("ENOENT") ||
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new AppError(
        ErrorCodes.CRE_CLI_ERROR,
        500,
        `CRE CLI not found at '${config.CRE_CLI_PATH}'. Install it or set CRE_CLI_PATH.`,
      )
    }

    // Re-throw AppErrors as-is
    if (err instanceof AppError) throw err

    throw new AppError(
      ErrorCodes.DEPLOY_FAILED,
      500,
      `Deploy error: ${message}`,
    )
  }
}

// --- Fire-and-forget deploy result handler ---
// Shared by publish and redeploy routes to avoid duplication
// and to prevent DB errors in .then() from falling through to .catch()

export function handleDeployResult(
  workflowId: string,
  deployPromise: Promise<DeployResult>,
  routeLog: ReturnType<typeof createLogger>,
): void {
  deployPromise
    .then(async (result) => {
      try {
        await db.update(workflows).set({
          donWorkflowId: result.donWorkflowId,
          deployStatus: "deployed",
          updatedAt: new Date().toISOString(),
        }).where(eq(workflows.id, workflowId))
        routeLog.info(`DON deploy succeeded for ${workflowId}: ${result.donWorkflowId}`)
        emitEvent({ type: "deploy", data: { workflowId, status: "deployed", donWorkflowId: result.donWorkflowId, timestamp: Date.now() } })
      } catch (dbErr) {
        routeLog.error(`Failed to update deploy status for ${workflowId}: ${(dbErr as Error).message}`)
      }
    })
    .catch(async (err) => {
      await db.update(workflows).set({
        deployStatus: "failed",
        updatedAt: new Date().toISOString(),
      }).where(eq(workflows.id, workflowId)).catch(() => {})
      routeLog.error(`DON deploy failed for ${workflowId}: ${(err as Error).message}`)
      emitEvent({ type: "deploy", data: { workflowId, status: "failed", error: (err as Error).message, timestamp: Date.now() } })
    })
}
