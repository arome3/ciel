// apps/api/src/services/tenderly/deployer.ts
// Programmatic contract deployment to Tenderly Virtual TestNet via Foundry.

import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"
import { runCommand } from "../cre/cre-utils"
import { getActiveTestnet, setContractAddresses } from "./manager"

const log = createLogger("TenderlyDeployer")

const DEPLOY_TIMEOUT = 60_000

export interface DeployResult {
  registryAddress: string
  consumerAddress: string
  explorerUrl: string
}

export async function deployContractsToTestnet(): Promise<DeployResult> {
  const { testnet } = getActiveTestnet()

  if (!testnet) {
    throw new AppError(
      ErrorCodes.TENDERLY_TESTNET_NOT_FOUND,
      404,
      "No active testnet — create one first with POST /api/tenderly/create",
    )
  }

  log.info(`Deploying contracts to VNet "${testnet.name}" (${testnet.publicRpcUrl})`)

  // Deployer is already funded during testnet creation (manager.createWorkflowTestnet).
  // No redundant fundAccount call here — avoids an unnecessary failure surface.

  // Resolve contracts directory
  const contractsDir = resolve(import.meta.dir, "../../../../../contracts")

  // SECURITY: Private key is passed via env only — never as a CLI argument.
  // Forge reads it via vm.envUint("PRIVATE_KEY") in the Solidity script.
  // CLI args are visible via `ps aux` / /proc/<pid>/cmdline.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PRIVATE_KEY: config.PRIVATE_KEY,
    TENDERLY_VIRTUAL_TESTNET_RPC: testnet.publicRpcUrl,
  }

  const result = await runCommand(
    [
      "forge", "script",
      "script/DeployTenderly.s.sol",
      "--rpc-url", testnet.publicRpcUrl,
      "--broadcast",
      "--slow",
    ],
    contractsDir,
    env,
    DEPLOY_TIMEOUT,
    "forge deploy (Tenderly)",
  )

  if (result.timedOut) {
    throw new AppError(
      ErrorCodes.DEPLOY_TIMEOUT,
      504,
      "Contract deployment to Tenderly VNet timed out",
    )
  }

  if (result.exitCode !== 0) {
    throw new AppError(
      ErrorCodes.DEPLOY_FAILED,
      500,
      `Contract deployment failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
      { stdout: result.stdout.slice(0, 500), stderr: result.stderr.slice(0, 500) },
    )
  }

  // Parse deployed addresses from deployment JSON file
  let registryAddress: string
  let consumerAddress: string

  try {
    const deploymentPath = resolve(contractsDir, "deployments/tenderly-vnet.json")
    const raw = await readFile(deploymentPath, "utf-8")
    const deployment = JSON.parse(raw)
    registryAddress = deployment.contracts.AutopilotRegistry
    consumerAddress = deployment.contracts.AutopilotConsumer

    if (!registryAddress || !consumerAddress) {
      throw new Error("Missing contract addresses in deployment JSON")
    }
  } catch (parseErr) {
    // Fall back to parsing forge stdout
    const registryMatch = result.stdout.match(/AutopilotRegistry deployed to:\s*(0x[a-fA-F0-9]{40})/i)
    const consumerMatch = result.stdout.match(/AutopilotConsumer deployed to:\s*(0x[a-fA-F0-9]{40})/i)

    if (registryMatch && consumerMatch) {
      registryAddress = registryMatch[1]
      consumerAddress = consumerMatch[1]
    } else {
      throw new AppError(
        ErrorCodes.DEPLOY_FAILED,
        500,
        `Could not parse deployed addresses from forge output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        { stdout: result.stdout.slice(0, 500) },
      )
    }
  }

  // Update manager state
  setContractAddresses(registryAddress, consumerAddress)

  log.info(`Contracts deployed — Registry: ${registryAddress}, Consumer: ${consumerAddress}`)

  return {
    registryAddress,
    consumerAddress,
    explorerUrl: testnet.explorerUrl,
  }
}
