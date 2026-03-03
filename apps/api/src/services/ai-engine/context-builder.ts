// ─────────────────────────────────────────────
// Context Builder — Few-Shot Example Assembly
// ─────────────────────────────────────────────
// Selects and loads template scaffold files as few-shot examples
// for the LLM code generator. Uses a TEMPLATE_RELATIONS map to
// pick the 2 most relevant sibling templates for each target.
// All files cached at module load — zero per-request I/O.

import { readFileSync } from "fs"
import { join } from "path"

// ─────────────────────────────────────────────
// Template Relations Map
// ─────────────────────────────────────────────

const TEMPLATE_RELATIONS: Record<number, [number, number]> = {
  1: [4, 8],
  2: [1, 7],
  3: [1, 6],
  4: [1, 9],
  5: [4, 6],
  6: [3, 5],
  7: [1, 2],
  8: [1, 4],
  9: [4, 1],
  10: [6, 3],
  11: [1, 10],
  12: [11, 1],
  13: [1, 4],    // Data Feed Reader — shares contract read pattern with T1, T4
  14: [1, 13],   // Stateful KV Store — cron + HTTP like T1, contract reads like T13
  15: [2, 4],    // Cross-Chain CCIP — multi-chain like T2, on-chain write like T4
  16: [1, 12],   // Dual-Trigger — cron handler like T1, evm_log handler like T12
  17: [8, 6],    // Stablecoin Burn — compliance like T8, payout-adjacent like T6
  18: [6, 1],    // Payment Initiation — payout pattern like T6, cron like T1
  19: [8, 17],   // Escrow Lock/Release — compliance like T8, burn-adjacent like T17
  20: [19, 4],   // Settlement Reconciliation — settlement like T19, evmWrite like T4
  21: [8, 19],   // Shareholder Registry — compliance like T8, escrow-adjacent like T19
  22: [6, 21],   // Dividend Distribution — payout like T6, registry like T21
}

// ─────────────────────────────────────────────
// Module-Level Cache (loaded once at process start)
// ─────────────────────────────────────────────

const TEMPLATES_DIR = join(__dirname, "../../../data/templates")

/** Pre-loaded template contents: templateId → file content */
const TEMPLATE_CACHE = new Map<number, string>()

for (let id = 1; id <= 22; id++) {
  try {
    const content = readFileSync(join(TEMPLATES_DIR, `template-${id}.ts`), "utf-8")
    TEMPLATE_CACHE.set(id, content)
  } catch {
    // Missing template at startup — non-fatal
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Builds few-shot context by loading related template scaffolds.
 *
 * Reads from module-level cache — zero file I/O per request.
 *
 * @param templateId - Target template ID (1-22)
 * @returns Labeled code fences with 2 related template examples
 */
export function buildFewShotContext(templateId: number): string {
  const relations = TEMPLATE_RELATIONS[templateId]
  if (!relations) {
    return ""
  }

  const examples: string[] = []

  for (const relatedId of relations) {
    const content = TEMPLATE_CACHE.get(relatedId)
    if (content) {
      examples.push(
        `### Example: Template ${relatedId}\n` +
        "```typescript\n" +
        content +
        "\n```",
      )
    }
  }

  if (examples.length === 0) {
    return ""
  }

  return "## Working CRE Workflow Examples\n\n" +
    "Study these examples carefully. They demonstrate the correct CRE SDK patterns.\n\n" +
    examples.join("\n\n")
}
