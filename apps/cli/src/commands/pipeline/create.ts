import { Command } from "commander"
import { existsSync } from "fs"
import { CielClient } from "../../client"
import { resolveConfig } from "../../config"
import { requireAuth, pipelineAuthHeaders } from "../../auth"
import { fileNotFound, invalidInput } from "../../errors"
import * as out from "../../output"

export const pipelineCreateCommand = new Command("create")
  .description("Create a pipeline from a JSON file")
  .requiredOption("--file <path>", "path to pipeline definition JSON")
  .action(async (opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const auth = requireAuth(config)
    const client = new CielClient(config)

    if (!existsSync(opts.file)) {
      throw fileNotFound(opts.file)
    }

    let definition: { name: string; description?: string; steps: unknown[] }
    try {
      const raw = await Bun.file(opts.file).text()
      definition = JSON.parse(raw)
    } catch {
      throw invalidInput(`Failed to parse JSON from ${opts.file}`)
    }

    if (!definition.name || !Array.isArray(definition.steps)) {
      throw invalidInput("Pipeline JSON must have 'name' (string) and 'steps' (array)")
    }

    // Use a temp pipeline ID for initial auth headers
    const tempHeaders = await pipelineAuthHeaders(auth, "new-pipeline")

    const data = await client.createPipeline(
      {
        name: definition.name,
        description: definition.description,
        ownerAddress: auth.address,
        steps: definition.steps,
      },
      tempHeaders,
    )

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Pipeline Created")
    out.field("ID", data.id)
    out.field("Name", data.name)
    out.field("Steps", data.steps.length)
    out.field("Total Price", `$${(data.totalPriceUsdc / 1_000_000).toFixed(2)}`)
    out.field("Owner", data.ownerAddress)

    out.hint(`Execute: ciel pipeline execute ${data.id}`)
  })
