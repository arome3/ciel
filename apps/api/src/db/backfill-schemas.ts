// ─────────────────────────────────────────────
// Backfill Script — Populate inputSchema/outputSchema
// ─────────────────────────────────────────────
// One-shot script to backfill existing workflows that have
// null schemas with the corresponding template .schema.json data.
//
// Usage: cd apps/api && bun run src/db/backfill-schemas.ts

import { db } from "./index"
import { workflows } from "./schema"
import { loadTemplateSchemas } from "../services/ai-engine/file-manager"
import { isNull, eq } from "drizzle-orm"

async function backfill() {
  console.log("Backfilling inputSchema/outputSchema...")

  // Find all workflows missing schemas
  const rows = await db
    .select({ id: workflows.id, templateId: workflows.templateId })
    .from(workflows)
    .where(isNull(workflows.inputSchema))

  if (rows.length === 0) {
    console.log("No workflows need backfilling.")
    process.exit(0)
  }

  console.log(`Found ${rows.length} workflows to backfill.`)

  // Cache schemas per templateId to avoid redundant file reads
  const schemaCache = new Map<number, ReturnType<typeof loadTemplateSchemas>>()
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    if (!schemaCache.has(row.templateId)) {
      schemaCache.set(row.templateId, loadTemplateSchemas(row.templateId))
    }

    const schemas = schemaCache.get(row.templateId)
    if (!schemas) {
      skipped++
      continue
    }

    await db
      .update(workflows)
      .set({
        inputSchema: schemas.inputSchema,
        outputSchema: schemas.outputSchema,
      })
      .where(eq(workflows.id, row.id))

    updated++
  }

  console.log(`Backfill complete: ${updated} updated, ${skipped} skipped (no schema file).`)
  process.exit(0)
}

backfill().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})
