import { Command } from "commander"
import { resolveConfig, getConfigPath, saveConfigFile } from "../config"
import * as out from "../output"

export const configCommand = new Command("config")
  .description("Show or modify CLI configuration")
  .argument("[action]", "show, set, or path", "show")
  .argument("[key]", "config key (for set)")
  .argument("[value]", "config value (for set)")
  .action(async (action, key, value, _opts, cmd) => {
    const config = resolveConfig(cmd.optsWithGlobals())

    switch (action) {
      case "show": {
        if (config.jsonMode) {
          out.json({
            apiUrl: config.apiUrl,
            timeout: config.timeout,
            defaultChain: config.defaultChain,
            jsonMode: config.jsonMode,
            noColor: config.noColor,
            hasPrivateKey: !!config.privateKey,
            configPath: getConfigPath(),
          })
          return
        }

        out.header("Ciel Configuration")
        out.field("API URL", config.apiUrl)
        out.field("Timeout", `${config.timeout}ms`)
        out.field("Default Chain", config.defaultChain)
        out.field("JSON Mode", config.jsonMode ? "on" : "off")
        out.field("Color", config.noColor ? "off" : "on")
        out.field("Private Key", config.privateKey
          ? `0x...${config.privateKey.slice(-4)}`
          : "not set")
        out.field("Config File", getConfigPath())
        console.log()
        break
      }

      case "set": {
        if (!key || !value) {
          out.error("Usage: ciel config set <key> <value>")
          out.info("  Keys: apiUrl, defaultChain, timeout")
          process.exit(1)
        }

        const validKeys = ["apiUrl", "defaultChain", "timeout"]
        if (!validKeys.includes(key)) {
          out.error(`Invalid key "${key}". Valid keys: ${validKeys.join(", ")}`)
          process.exit(1)
        }

        const parsed = key === "timeout" ? { [key]: Number(value) } : { [key]: value }
        saveConfigFile(parsed)
        out.success(`Set ${key} = ${value}`)
        break
      }

      case "path": {
        if (config.jsonMode) {
          out.json({ path: getConfigPath() })
          return
        }
        console.log(getConfigPath())
        break
      }

      default:
        out.error(`Unknown config action: ${action}`)
        out.info("  Available: show, set, path")
        process.exit(1)
    }
  })
