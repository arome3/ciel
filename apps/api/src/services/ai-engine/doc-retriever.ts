// ─────────────────────────────────────────────
// Doc Retriever — Capability-Based Documentation Lookup
// ─────────────────────────────────────────────
// Maps template capabilities to relevant CRE SDK doc files.
// Only includes low-overlap docs (consensus, node-mode, state-management, chain-selectors).
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

// Only low-overlap docs — capabilities.md, triggers.md, and config-schema.md
// are excluded because API_REFERENCE in the static base prompt already covers
// those patterns (and the doc files contain stale/contradictory examples).
const CAPABILITY_TO_DOCS: Record<string, string[]> = {
  "multi-ai": ["consensus.md", "node-mode.md"],
  "multi-chain": ["chain-selectors.md"],
  evmWrite: ["chain-selectors.md"],
  "chainlink-feeds": ["chain-selectors.md"],
  "kv-store": ["state-management.md"],
  ccip: ["chain-selectors.md"],
  evmRead: ["chain-selectors.md"],
  ccipTransfer: ["chain-selectors.md"],
  burn: ["chain-selectors.md"],
  escrowLock: ["chain-selectors.md"],
  escrowRelease: ["chain-selectors.md"],
  initiatePayment: ["state-management.md"],
  distribute: ["chain-selectors.md"],
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
 * 1. Map each requiredCapability to its doc files (low-overlap only)
 * 2. Deduplicate file set
 * 3. Concatenate cached contents with section headers
 *
 * @param template - The matched template definition
 * @returns Concatenated documentation string with section headers
 */
export function retrieveRelevantDocs(
  template: TemplateDefinition,
  intent?: ParsedIntent,
): string {
  const docFiles = new Set<string>()

  // Map capabilities to doc files (low-overlap only)
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
