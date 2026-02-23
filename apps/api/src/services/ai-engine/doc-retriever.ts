// ─────────────────────────────────────────────
// Doc Retriever — Capability-Based Documentation Lookup
// ─────────────────────────────────────────────
// Maps template capabilities to relevant CRE SDK doc files.
// Always includes config-schema.md as a baseline.
// All files cached at module load — zero per-request I/O.

import { readFileSync } from "fs"
import { join } from "path"
import type { TemplateDefinition } from "./template-matcher"
import type { ParsedIntent } from "./types"
import { detectStateKeyword } from "./file-manager"
import { createLogger } from "../../lib/logger"

const log = createLogger("DocRetriever")

// ─────────────────────────────────────────────
// Capability → Doc File Mapping
// ─────────────────────────────────────────────

const CAPABILITY_TO_DOCS: Record<string, string[]> = {
  "price-feed": ["capabilities.md", "triggers.md"],
  "weather-api": ["capabilities.md", "triggers.md"],
  "flight-api": ["capabilities.md", "triggers.md"],
  "reserve-api": ["capabilities.md", "triggers.md"],
  "nav-api": ["capabilities.md", "triggers.md"],
  "compliance-api": ["capabilities.md", "triggers.md"],
  "defi-api": ["capabilities.md", "triggers.md"],
  "prediction-market": ["capabilities.md", "triggers.md"],
  "multi-ai": ["consensus.md", "node-mode.md"],
  evmWrite: ["capabilities.md", "chain-selectors.md"],
  "multi-chain": ["chain-selectors.md", "capabilities.md"],
  alert: ["capabilities.md"],
  "wallet-api": ["capabilities.md", "triggers.md"],
}

// ─────────────────────────────────────────────
// Module-Level Cache (loaded once at process start)
// ─────────────────────────────────────────────

const DOCS_DIR = join(__dirname, "../../../data/cre-docs")

const ALL_DOC_FILES = [
  "capabilities.md",
  "chain-selectors.md",
  "config-schema.md",
  "consensus.md",
  "node-mode.md",
  "triggers.md",
  "state-management.md",
]

/** Pre-loaded doc contents: filename → content string */
const DOC_CACHE = new Map<string, string>()

for (const fileName of ALL_DOC_FILES) {
  try {
    const content = readFileSync(join(DOCS_DIR, fileName), "utf-8")
    DOC_CACHE.set(fileName, content)
  } catch {
    log.info(`Doc file not found at startup: ${fileName}`)
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Retrieves relevant CRE SDK documentation for a template.
 *
 * Reads from module-level cache — zero file I/O per request.
 *
 * Strategy:
 * 1. Map each requiredCapability to its doc files
 * 2. Deduplicate file set
 * 3. Always include config-schema.md (every workflow needs config)
 * 4. Concatenate cached contents with section headers
 *
 * @param template - The matched template definition
 * @returns Concatenated documentation string with section headers
 */
export function retrieveRelevantDocs(
  template: TemplateDefinition,
  intent?: ParsedIntent,
): string {
  const docFiles = new Set<string>()

  // Always include config-schema — every workflow needs the Runner pattern
  docFiles.add("config-schema.md")

  // Map capabilities to doc files
  for (const capability of template.requiredCapabilities) {
    const docs = CAPABILITY_TO_DOCS[capability]
    if (docs) {
      for (const doc of docs) {
        docFiles.add(doc)
      }
    }
  }

  // Include state management docs when intent has state keywords
  if (intent && detectStateKeyword(intent.keywords)) {
    docFiles.add("state-management.md")
  }

  // Read from cache and concatenate with section headers
  const sections: string[] = []

  for (const fileName of docFiles) {
    const content = DOC_CACHE.get(fileName)
    if (content) {
      sections.push(`--- ${fileName} ---\n${content}`)
    }
  }

  return sections.join("\n\n")
}
