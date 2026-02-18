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
  const templateLines = [
    `- **Template**: #${tmpl.id} — ${tmpl.name}`,
    `- **Category**: ${tmpl.category}`,
    `- **Required Capabilities**: ${tmpl.requiredCapabilities.join(", ")}`,
    `- **Trigger Type**: ${tmpl.triggerType}`,
    `- **Description**: ${tmpl.defaultPromptFill}`,
  ]

  sections.push(`## Matched Template\n\n${templateLines.join("\n")}`)

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

  return sections.join("\n\n")
}
