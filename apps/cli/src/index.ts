#!/usr/bin/env bun

import { Command } from "commander"
import { CliError } from "./errors"
import { setJsonMode, setNoColor, error as printError, json } from "./output"

// ── Commands ──
import { generateCommand } from "./commands/generate"
import { simulateCommand } from "./commands/simulate"
import { publishCommand } from "./commands/publish"
import { executeCommand } from "./commands/execute"
import { redeployCommand } from "./commands/redeploy"
import { deployCommand } from "./commands/deploy"
import { listCommand } from "./commands/list"
import { showCommand } from "./commands/show"
import { searchCommand } from "./commands/search"
import { healthCommand } from "./commands/health"
import { eventsCommand } from "./commands/events"
import { configCommand } from "./commands/config-cmd"
import { pipelineCommand } from "./commands/pipeline/index"
import { tenderlyCommand } from "./commands/tenderly/index"

const program = new Command()
  .name("ciel")
  .description("Ciel CLI — AI-driven blockchain workflow automation")
  .version("0.1.0")
  .option("--json", "output as JSON for scripting")
  .option("--api-url <url>", "Ciel API base URL")
  .option("--private-key <key>", "private key for signing (prefer CIEL_PRIVATE_KEY env var)")
  .option("--timeout <ms>", "request timeout in milliseconds")
  .option("--no-color", "disable ANSI colors")

// Apply global options before each command runs
program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.opts()
  if (opts.json) setJsonMode(true)
  if (opts.color === false) setNoColor(true)
  if (process.env.NO_COLOR !== undefined) setNoColor(true)
})

// Register commands
program.addCommand(generateCommand)
program.addCommand(simulateCommand)
program.addCommand(publishCommand)
program.addCommand(executeCommand)
program.addCommand(redeployCommand)
program.addCommand(deployCommand)
program.addCommand(listCommand)
program.addCommand(showCommand)
program.addCommand(searchCommand)
program.addCommand(healthCommand)
program.addCommand(eventsCommand)
program.addCommand(configCommand)
program.addCommand(pipelineCommand)
program.addCommand(tenderlyCommand)

// Global error handler
async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof CliError) {
      if (program.opts().json) {
        json(err.toJSON())
      } else {
        printError(err.message)
      }
      process.exit(err.exitCode)
    }

    // Unknown errors
    const message = err instanceof Error ? err.message : String(err)
    if (program.opts().json) {
      json({ error: { code: "UNKNOWN", message } })
    } else {
      printError(message)
    }
    process.exit(1)
  }
}

main()
