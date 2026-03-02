import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export interface CliConfig {
  apiUrl: string
  privateKey: string | undefined
  timeout: number
  jsonMode: boolean
  noColor: boolean
  defaultChain: string
}

interface ConfigFile {
  apiUrl?: string
  defaultChain?: string
  timeout?: number
}

const CONFIG_DIR = join(homedir(), ".ciel")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

function loadConfigFile(): ConfigFile {
  try {
    if (!existsSync(CONFIG_PATH)) return {}
    const raw = readFileSync(CONFIG_PATH, "utf-8")
    return JSON.parse(raw) as ConfigFile
  } catch {
    return {}
  }
}

export function saveConfigFile(updates: Partial<ConfigFile>): void {
  const existing = loadConfigFile()
  const merged = { ...existing, ...updates }
  const { mkdirSync, writeFileSync } = require("fs")
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n")
}

export interface GlobalFlags {
  json?: boolean
  apiUrl?: string
  privateKey?: string
  timeout?: string
  color?: boolean
}

export function resolveConfig(flags: GlobalFlags): CliConfig {
  const file = loadConfigFile()

  const noColor = flags.color === false
    || process.env.NO_COLOR !== undefined
    || false

  const apiUrl = flags.apiUrl
    ?? process.env.CIEL_API_URL
    ?? file.apiUrl
    ?? "http://localhost:3001"

  const privateKey = flags.privateKey
    ?? process.env.CIEL_PRIVATE_KEY
    ?? process.env.PRIVATE_KEY
    ?? undefined

  const timeout = flags.timeout
    ? Number(flags.timeout)
    : (process.env.CIEL_TIMEOUT ? Number(process.env.CIEL_TIMEOUT) : (file.timeout ?? 30000))

  const defaultChain = process.env.CIEL_DEFAULT_CHAIN
    ?? file.defaultChain
    ?? "base-sepolia"

  return {
    apiUrl,
    privateKey,
    timeout,
    jsonMode: flags.json ?? false,
    noColor,
    defaultChain,
  }
}
