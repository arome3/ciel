import { Router } from "express"
import { z } from "zod"
import { db } from "../db"
import { userSettings, workflows } from "../db/schema"
import { eq } from "drizzle-orm"
import { AppError, ErrorCodes } from "../types/errors"
import { githubLimiter } from "../middleware/rate-limiter"
import { config } from "../config"
import { createLogger } from "../lib/logger"
import { buildPackageJson } from "../services/cre/cre-utils"
import { validateWorkflow } from "../services/ai-engine/validator"
import {
  isGitHubConfigured,
  getInstallationAccount,
  getInstallationOctokit,
  listRepos,
  createRepo,
  createBranch,
  atomicCommit,
  getFileContent,
  parseGitHubUrl,
  getPublicOctokit,
  type FileEntry,
} from "../services/github/client"

const log = createLogger("GitHubRoutes")
const router = Router()

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function requireOwnerAddress(req: { headers: Record<string, unknown> }): string {
  const addr = req.headers["x-owner-address"] as string | undefined
  if (!addr) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 403, "X-Owner-Address header required")
  }
  return addr
}

async function getInstallationId(ownerAddress: string): Promise<number> {
  const settings = await db
    .select({
      githubInstallationId: userSettings.githubInstallationId,
    })
    .from(userSettings)
    .where(eq(userSettings.ownerAddress, ownerAddress))
    .get()

  if (!settings?.githubInstallationId) {
    throw new AppError(
      ErrorCodes.GITHUB_AUTH_FAILED,
      401,
      "GitHub not connected — install the GitHub App first",
    )
  }

  return settings.githubInstallationId
}

// ─────────────────────────────────────────────
// GET /github/install — Redirect to GitHub App installation
// ─────────────────────────────────────────────

router.get("/github/install", (req, res, next) => {
  try {
    if (!isGitHubConfigured()) {
      throw new AppError(ErrorCodes.GITHUB_NOT_CONFIGURED, 501, "GitHub App not configured")
    }
    const ownerAddress = requireOwnerAddress(req)
    const appSlug = config.GITHUB_APP_CLIENT_ID
    const installUrl = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(ownerAddress)}`
    res.redirect(installUrl)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// GET /github/callback — GitHub App installation callback
// ─────────────────────────────────────────────

const CallbackSchema = z.object({
  installation_id: z.coerce.number().int().positive(),
  setup_action: z.string().optional(),
  state: z.string().min(1),
})

router.get("/github/callback", async (req, res, next) => {
  try {
    if (!isGitHubConfigured()) {
      throw new AppError(ErrorCodes.GITHUB_NOT_CONFIGURED, 501, "GitHub App not configured")
    }

    const parsed = CallbackSchema.safeParse(req.query)
    if (!parsed.success) {
      throw new AppError(
        ErrorCodes.INVALID_INPUT,
        400,
        "Missing installation_id or state parameter",
      )
    }

    const { installation_id, state: ownerAddress } = parsed.data

    // Resolve GitHub username from installation
    const username = await getInstallationAccount(installation_id)

    // Upsert user settings with GitHub installation
    const existing = await db
      .select({ ownerAddress: userSettings.ownerAddress })
      .from(userSettings)
      .where(eq(userSettings.ownerAddress, ownerAddress))
      .get()

    const now = new Date().toISOString()

    if (existing) {
      await db
        .update(userSettings)
        .set({
          githubInstallationId: installation_id,
          githubUsername: username,
          updatedAt: now,
        })
        .where(eq(userSettings.ownerAddress, ownerAddress))
    } else {
      await db.insert(userSettings).values({
        ownerAddress,
        githubInstallationId: installation_id,
        githubUsername: username,
        updatedAt: now,
      })
    }

    log.info(`GitHub connected for ${ownerAddress} as @${username}`)

    // Redirect to frontend settings page
    const frontendUrl = config.NEXT_PUBLIC_API_URL.replace(/:\d+$/, ":3000")
    res.redirect(`${frontendUrl}/settings?github=connected`)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// DELETE /github/disconnect — Remove GitHub connection
// ─────────────────────────────────────────────

router.delete("/github/disconnect", githubLimiter, async (req, res, next) => {
  try {
    const ownerAddress = requireOwnerAddress(req)

    await db
      .update(userSettings)
      .set({
        githubInstallationId: null,
        githubUsername: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userSettings.ownerAddress, ownerAddress))

    log.info(`GitHub disconnected for ${ownerAddress}`)
    res.json({ disconnected: true })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// GET /github/status — Check connection status
// ─────────────────────────────────────────────

router.get("/github/status", async (req, res, next) => {
  try {
    const ownerAddress = requireOwnerAddress(req)

    const settings = await db
      .select({
        githubInstallationId: userSettings.githubInstallationId,
        githubUsername: userSettings.githubUsername,
      })
      .from(userSettings)
      .where(eq(userSettings.ownerAddress, ownerAddress))
      .get()

    if (!settings?.githubInstallationId) {
      res.json({ connected: false, username: null, installationId: null })
      return
    }

    res.json({
      connected: true,
      username: settings.githubUsername,
      installationId: settings.githubInstallationId,
    })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// GET /github/repos — List accessible repos
// ─────────────────────────────────────────────

router.get("/github/repos", githubLimiter, async (req, res, next) => {
  try {
    const ownerAddress = requireOwnerAddress(req)
    const installationId = await getInstallationId(ownerAddress)
    const repos = await listRepos(installationId)
    res.json({ repos })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// POST /workflows/:id/export-github — Push workflow to GitHub
// ─────────────────────────────────────────────

const ExportSchema = z.object({
  repo: z.string().min(1).max(100),
  owner: z.string().min(1).max(100),
  createRepo: z.boolean().default(false),
  isPrivate: z.boolean().default(true),
  branch: z.string().min(1).max(100).default("main"),
  createBranch: z.boolean().default(false),
  commitMessage: z.string().min(1).max(200).default("Add Ciel CRE workflow"),
  path: z.string().max(200).default(""),
})

router.post("/workflows/:id/export-github", githubLimiter, async (req, res, next) => {
  try {
    const ownerAddress = requireOwnerAddress(req)
    const installationId = await getInstallationId(ownerAddress)
    const body = ExportSchema.parse(req.body)

    // Fetch workflow and verify ownership
    const workflow = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, req.params.id))
      .get()

    if (!workflow) {
      throw new AppError(ErrorCodes.WORKFLOW_NOT_FOUND, 404, "Workflow not found")
    }

    if (
      workflow.ownerAddress !== ownerAddress &&
      workflow.ownerAddress !== "0x0000000000000000000000000000000000000000"
    ) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 403, "Not the workflow owner")
    }

    let { owner, repo, branch } = body

    // Create repo if requested
    if (body.createRepo) {
      const created = await createRepo(installationId, repo, body.isPrivate)
      owner = created.owner
      repo = created.name
      branch = created.defaultBranch
    }

    // Create branch if requested
    if (body.createBranch && !body.createRepo) {
      await createBranch(installationId, owner, repo, branch, "main")
    }

    // Build files to push
    const pathPrefix = body.path ? `${body.path.replace(/\/+$/, "")}/` : ""
    const configJson = typeof workflow.config === "string"
      ? workflow.config
      : JSON.stringify(workflow.config, null, 2)

    const safeName = (workflow.name ?? "workflow").replace(/[^a-zA-Z0-9-_]/g, "-")

    const files: FileEntry[] = [
      { path: `${pathPrefix}main.ts`, content: workflow.code },
      { path: `${pathPrefix}config.json`, content: configJson },
      { path: `${pathPrefix}package.json`, content: buildPackageJson("ciel-export") },
      {
        path: `${pathPrefix}README.md`,
        content: [
          `# ${workflow.name}`,
          "",
          workflow.description,
          "",
          `**Template**: ${workflow.templateName} (T${workflow.templateId})`,
          `**Category**: ${workflow.category}`,
          `**Generated by**: [Ciel](https://ciel.dev)`,
          "",
          "## Setup",
          "",
          "```bash",
          "bun install",
          "bun run cre-compile",
          "```",
          "",
          "## Deploy",
          "",
          "```bash",
          "cre workflow deploy . --target production-settings",
          "```",
        ].join("\n"),
      },
    ]

    const result = await atomicCommit(
      installationId,
      owner,
      repo,
      branch,
      body.commitMessage,
      files,
    )

    log.info(`Exported workflow ${workflow.id} to ${owner}/${repo}`, { commitSha: result.commitSha })

    res.json({
      success: true,
      repoUrl: `https://github.com/${owner}/${repo}`,
      branch,
      filesCreated: result.filesCreated,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
    })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// POST /workflows/import-github — Import workflow from GitHub
// ─────────────────────────────────────────────

const ImportSchema = z.object({
  url: z.string().url().max(500),
  branch: z.string().max(100).optional(),
  configPath: z.string().max(300).optional(),
})

router.post("/workflows/import-github", githubLimiter, async (req, res, next) => {
  try {
    const ownerAddress = requireOwnerAddress(req)
    const body = ImportSchema.parse(req.body)

    const parsed = parseGitHubUrl(body.url)

    // Determine the file path for the main .ts file
    let tsPath: string
    let configDir: string

    if (parsed.type === "blob" && parsed.path) {
      tsPath = parsed.path
      const parts = parsed.path.split("/")
      parts.pop()
      configDir = parts.join("/")
    } else if (parsed.type === "tree" && parsed.path) {
      tsPath = `${parsed.path}/main.ts`
      configDir = parsed.path
    } else {
      // Repo root — look for main.ts
      tsPath = "main.ts"
      configDir = ""
    }

    const branch = body.branch ?? parsed.branch

    // Try authenticated first (for private repos), fall back to public
    let octokit
    try {
      const installationId = await getInstallationId(ownerAddress)
      octokit = await getInstallationOctokit(installationId)
    } catch {
      // Not connected — use unauthenticated (public repos only)
      octokit = getPublicOctokit()
    }

    // Fetch the TypeScript file
    const code = await getFileContent(
      octokit,
      parsed.owner,
      parsed.repo,
      tsPath,
      branch,
    )

    // Try to fetch config.json from same directory
    const configPath = body.configPath ?? (configDir ? `${configDir}/config.json` : "config.json")
    let configJson = "{}"
    try {
      configJson = await getFileContent(
        octokit,
        parsed.owner,
        parsed.repo,
        configPath,
        branch,
      )
    } catch {
      // Config not found — use empty default
      log.debug("No config.json found, using empty default")
    }

    // Validate the imported code
    const validation = await validateWorkflow(code, configJson)

    // Parse config for DB storage
    let configParsed: Record<string, unknown> = {}
    try {
      configParsed = JSON.parse(configJson)
    } catch {
      // Invalid JSON — keep empty
    }

    // Infer name from file path or repo
    const fileName = tsPath.split("/").pop()?.replace(/\.ts$/, "") ?? "imported"
    const workflowName = fileName === "main"
      ? `${parsed.repo}-import`
      : fileName

    // Insert workflow into DB
    const workflowId = crypto.randomUUID()
    await db.insert(workflows).values({
      id: workflowId,
      name: workflowName,
      description: `Imported from GitHub: ${parsed.owner}/${parsed.repo}`,
      prompt: `Imported from GitHub: ${body.url}`,
      templateId: 0,
      templateName: "imported",
      code,
      config: configJson,
      ownerAddress,
      category: "core-defi",
      capabilities: "[]",
      chains: JSON.stringify(["base-sepolia"]),
    })

    log.info(`Imported workflow from ${parsed.owner}/${parsed.repo} as ${workflowId}`)

    res.json({
      workflowId,
      code,
      config: configParsed,
      validation: {
        valid: validation.valid,
        errors: validation.errors,
      },
      source: {
        repo: `${parsed.owner}/${parsed.repo}`,
        branch: branch ?? parsed.branch ?? "main",
        path: tsPath,
      },
    })
  } catch (err) {
    next(err)
  }
})

export default router
