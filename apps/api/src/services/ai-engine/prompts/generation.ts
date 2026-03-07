// ─────────────────────────────────────────────
// Generation Prompt Builder — User Message Assembly
// ─────────────────────────────────────────────
// Builds the user-role message for GPT-5.2, including the parsed intent,
// matched template details, and optional retry context.

import type { ParsedIntent } from "../types"
import type { TemplateDefinition } from "../template-matcher"

/**
 * Input for building the generation prompt.
 */
export interface GenerationPromptInput {
  /** Original user prompt */
  userPrompt: string
  /** Parsed intent from stage 1 */
  intent: ParsedIntent
  /** Matched template from stage 2 */
  template: TemplateDefinition
  /** Optional: error from previous attempt (for retries) */
  previousError?: string
  /** Optional: self-review from previous attempt (for retries) */
  previousSelfReview?: string
  /** Optional: fix patterns + compiler output from error-resolver (for retries) */
  enrichedContext?: string
}

/**
 * Builds the user-role prompt for code generation.
 *
 * Structure:
 * 1. User request (original prompt)
 * 2. Parsed intent fields (trigger, schedule, data sources, conditions, actions, chains)
 * 3. Template context (name, category, capabilities, trigger type, description)
 * 4. Retry context (if previous attempt failed)
 *
 * @param input - Generation prompt input fields
 * @returns Complete user prompt string
 */
export function buildGenerationPrompt(input: GenerationPromptInput): string {
  const sections: string[] = []

  // ── User Request ──
  sections.push(`## User Request\n\n${input.userPrompt}`)

  // ── Parsed Intent ──
  const intent = input.intent
  const intentLines = [
    `- **Trigger Type**: ${intent.triggerType}`,
    `- **Confidence**: ${(intent.confidence * 100).toFixed(0)}%`,
  ]

  if (intent.schedule) {
    intentLines.push(`- **Schedule**: ${intent.schedule}`)
  }

  if (intent.dataSources.length > 0) {
    intentLines.push(`- **Data Sources**: ${intent.dataSources.join(", ")}`)
  }

  if (intent.entities && Object.keys(intent.entities).length > 0) {
    const entityLines = Object.entries(intent.entities)
      .map(([source, names]) => `${source}: ${names.join(", ")}`)
      .join("; ")
    intentLines.push(`- **Recognized Entities**: ${entityLines}`)
  }

  if (intent.conditions.length > 0) {
    intentLines.push(`- **Conditions**: ${intent.conditions.join("; ")}`)
  }

  if (intent.actions.length > 0) {
    intentLines.push(`- **Actions**: ${intent.actions.join(", ")}`)
  }

  if (intent.chains.length > 0) {
    intentLines.push(`- **Target Chains**: ${intent.chains.join(", ")}`)
  }

  sections.push(`## Parsed Intent\n\n${intentLines.join("\n")}`)

  // ── Template Context ──
  const tmpl = input.template
  if (tmpl.id === 0) {
    // Wildcard mode — no pre-existing template matched
    sections.push(
      "## Wildcard Mode — Build From First Principles\n\n" +
      "No pre-existing template matched this request. You have the full CRE SDK API reference " +
      "in the system prompt. Generate a correct CRE workflow from scratch.\n\n" +
      "Architecture checklist:\n" +
      "1. Choose the trigger type that best fits the user's description (cron for periodic, http for on-demand, evm_log for reactive)\n" +
      "2. Design a Zod configSchema with all necessary fields (API URLs, thresholds, addresses)\n" +
      "3. Implement the handler function with the user's core business logic\n" +
      "4. Use the two-step report pattern for any on-chain writes\n" +
      "5. Follow ALL 14 critical constraints — especially: no async in handlers, no banned imports, no Date.now()\n" +
      "6. Keep it simple — implement the minimum viable workflow",
    )
  } else {
    const templateLines = [
      `- **Template**: #${tmpl.id} — ${tmpl.name}`,
      `- **Category**: ${tmpl.category}`,
      `- **Required Capabilities**: ${tmpl.requiredCapabilities.join(", ")}`,
      `- **Trigger Type**: ${tmpl.triggerType}`,
      `- **Description**: ${tmpl.defaultPromptFill}`,
    ]

    sections.push(`## Matched Template\n\n${templateLines.join("\n")}`)
  }

  // ── Retry Context ──
  if (input.previousError || input.previousSelfReview) {
    const retryLines: string[] = []

    if (input.previousError) {
      retryLines.push(
        `**Previous Error**: ${input.previousError}\n` +
        "Fix this specific issue in your next attempt.",
      )
    }

    if (input.previousSelfReview) {
      retryLines.push(
        `**Previous Self-Review**: ${input.previousSelfReview}\n` +
        "Address the issues you identified in your self-review.",
      )
    }

    sections.push(
      "## Retry Context (IMPORTANT — Fix These Issues)\n\n" +
      retryLines.join("\n\n"),
    )
  }

  // ── Enriched Context (compiler output + fix patterns) ──
  if (input.enrichedContext) {
    sections.push(input.enrichedContext)
  }

  return sections.join("\n\n")
}
