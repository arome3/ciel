import { Command } from "commander"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import { requireAuth, workflowAuthHeaders } from "../auth"
import * as out from "../output"
import { CliError } from "../errors"

const DEPLOY_TIMEOUT = 120_000 // 2 minutes
const INSTALL_TIMEOUT = 30_000

const WORKFLOW_ID_RE = /workflow[_\s-]?id[:\s]+([a-f0-9-]{36})/i
const UUID_FALLBACK_RE = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i

function buildPackageJson(): string {
  return JSON.stringify(
    {
      name: `ciel-deploy-${randomUUID().slice(0, 8)}`,
      private: true,
      scripts: { "cre-compile": "cre-compile" },
      dependencies: {
        "@chainlink/cre-sdk": "^1.1.3",
        zod: "^3.22.0",
        viem: "^2.0.0",
        "@noble/hashes": "^1.4.0",
      },
    },
    null,
    2,
  )
}

function buildProjectYaml(): string {
  const sepoliaRpc = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"
  const mainnetRpc = process.env.ETHEREUM_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
  return `staging-settings:
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
}

function buildWorkflowYaml(): string {
  return `staging-settings:
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
}

function parseDonWorkflowId(output: string): string {
  const match = output.match(WORKFLOW_ID_RE)
  if (match) return match[1]

  const fallback = output.match(UUID_FALLBACK_RE)
  if (fallback) return fallback[1]

  throw new CliError(
    "DEPLOY_PARSE_FAILED",
    `Could not parse DON workflow ID from CRE output. Output: ${output.slice(0, 300)}`,
  )
}

export const deployCommand = new Command("deploy")
  .description("Deploy a workflow to DON using local CRE credentials")
  .argument("<id>", "workflow ID")
  .addHelpText("after", `
Prerequisites:
  1. CRE CLI installed and authenticated (cre account access)
  2. CIEL_PRIVATE_KEY set (wallet that owns the workflow)
  3. BASE_SEPOLIA_RPC_URL set (optional, defaults to https://sepolia.base.org)

Examples:
  $ ciel deploy abc123               Deploy workflow abc123 to DON
  $ ciel --json deploy abc123        Deploy and output result as JSON

Alternative: download the project bundle from the web UI or API and
deploy manually:
  $ curl http://localhost:3001/api/workflows/<id>/export -o bundle.json
  `)
  .action(async (id, _opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const auth = requireAuth(config)
    const client = new CielClient(config)

    // Step 1: Fetch workflow from API
    out.info("Fetching workflow...")
    const workflow = await client.getWorkflow(id)

    if (!config.jsonMode) {
      out.header("Deploy to DON")
      out.field("Workflow", workflow.name ?? id)
      out.field("Template", `${workflow.templateId} — ${workflow.templateName}`)
    }

    let tempDir: string | null = null

    try {
      // Step 2: Scaffold CRE workspace
      out.info("Scaffolding CRE workspace...")
      tempDir = await mkdtemp(join(tmpdir(), "ciel-deploy-"))
      const wfDir = join(tempDir, "wf")
      await mkdir(wfDir)

      await Promise.all([
        writeFile(join(tempDir, "project.yaml"), buildProjectYaml(), "utf-8"),
        writeFile(join(wfDir, "main.ts"), workflow.code, "utf-8"),
        writeFile(join(wfDir, "config.json"), JSON.stringify(workflow.config, null, 2), "utf-8"),
        writeFile(join(wfDir, "workflow.yaml"), buildWorkflowYaml(), "utf-8"),
        writeFile(join(wfDir, "package.json"), buildPackageJson(), "utf-8"),
      ])

      // Step 3: Install dependencies
      out.info("Installing dependencies...")
      const installProc = Bun.spawn(["bun", "install"], {
        cwd: wfDir,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env as Record<string, string>,
      })

      const installTimeout = setTimeout(() => installProc.kill(), INSTALL_TIMEOUT)
      const installExit = await installProc.exited
      clearTimeout(installTimeout)

      if (installExit !== 0) {
        const stderr = await new Response(installProc.stderr).text()
        throw new CliError(
          "INSTALL_FAILED",
          `bun install failed (exit ${installExit}): ${stderr.slice(0, 500)}`,
        )
      }

      // Step 4: Deploy via CRE CLI
      out.info("Running cre workflow deploy...")

      // CRE CLI expects CRE_ETH_PRIVATE_KEY (raw hex without 0x prefix)
      const deployEnv = { ...process.env } as Record<string, string>
      if (!deployEnv.CRE_ETH_PRIVATE_KEY) {
        const rawKey = deployEnv.PRIVATE_KEY ?? deployEnv.CIEL_PRIVATE_KEY
        if (rawKey) {
          deployEnv.CRE_ETH_PRIVATE_KEY = rawKey.replace(/^0x/i, "")
        }
      }

      const deployProc = Bun.spawn(
        ["cre", "workflow", "deploy", "wf", "--target", "production-settings"],
        {
          cwd: tempDir,
          stdout: "pipe",
          stderr: "pipe",
          env: deployEnv,
        },
      )

      let didTimeout = false
      const deployTimeout = setTimeout(() => {
        didTimeout = true
        deployProc.kill()
      }, DEPLOY_TIMEOUT)

      const deployExit = await deployProc.exited
      clearTimeout(deployTimeout)

      const stdout = await new Response(deployProc.stdout).text()
      const stderr = await new Response(deployProc.stderr).text()
      const combined = stdout + "\n" + stderr

      if (didTimeout) {
        throw new CliError(
          "DEPLOY_TIMEOUT",
          `CRE deploy timed out after ${DEPLOY_TIMEOUT / 1000}s`,
        )
      }

      if (deployExit !== 0) {
        throw new CliError(
          "DEPLOY_FAILED",
          `CRE deploy failed (exit ${deployExit}): ${combined.slice(0, 500)}`,
        )
      }

      // Step 5: Parse DON workflow ID
      const donWorkflowId = parseDonWorkflowId(combined)

      // Step 6: Report back to Ciel API
      out.info("Reporting deployment to Ciel...")
      const headers = await workflowAuthHeaders(auth, id)
      const result = await client.reportDeploy(id, donWorkflowId, headers)

      if (config.jsonMode) {
        out.json({ ...result, donWorkflowId })
        return
      }

      out.success("Deployed to DON")
      out.field("DON Workflow ID", donWorkflowId)
      out.field("Deploy Status", result.deployStatus)

      out.hint("Monitor events: ciel events")
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })
