import { Command } from "commander"
import { CielClient } from "../client"
import { resolveConfig } from "../config"
import * as out from "../output"

export const generateCommand = new Command("generate")
  .description("Generate a CRE workflow from a natural language prompt")
  .argument("<prompt>", "workflow description in plain English")
  .option("--template <id>", "hint a specific template ID (T1-T22)")
  .option("--show-code", "display generated code")
  .option("--show-config", "display workflow configuration")
  .action(async (prompt, opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())
    const client = new CielClient(config)

    const data = await client.generate(prompt, opts.template)

    if (config.jsonMode) {
      out.json(data)
      return
    }

    out.header("Workflow Generated")
    out.field("ID", data.workflowId)
    out.field("Template", `${data.template.id} — ${data.template.name}`)
    out.field("Confidence", `${(data.template.confidence * 100).toFixed(1)}%`)
    out.field("Validation", data.validation.passed ? "passed" : "failed")

    if (!data.validation.passed) {
      console.log()
      for (const check of data.validation.checks) {
        out.traceStep(check.name, check.passed ? "passed" : "failed", check.message)
      }
    }

    if (data.secretsYaml) {
      out.field("Secrets", "required (secrets.yaml will be generated)")
    }

    if (opts.showCode) {
      out.code(data.code, "typescript")
    }

    if (opts.showConfig) {
      try {
        const parsed = JSON.parse(data.configJson)
        out.code(JSON.stringify(parsed, null, 2), "json")
      } catch {
        out.code(data.configJson, "json")
      }
    }

    out.hint(`Next: ciel simulate ${data.workflowId}`)
  })
