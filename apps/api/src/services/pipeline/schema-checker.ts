// apps/api/src/services/pipeline/schema-checker.ts

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface JSONSchemaProperty {
  type: string
  description?: string
}

export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
}

export interface FieldSuggestion {
  sourceField: string
  targetField: string
  confidence: number
  reason: string
}

export interface SchemaCompatibility {
  compatible: boolean
  score: number
  matchedFields: FieldSuggestion[]
  unmatchedRequired: string[]
  suggestions: FieldSuggestion[]
}

// ─────────────────────────────────────────────
// Levenshtein Distance
// ─────────────────────────────────────────────

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

// ─────────────────────────────────────────────
// Type Compatibility
// ─────────────────────────────────────────────

const TYPE_COERCIONS: Record<string, Set<string>> = {
  number: new Set(["string", "boolean"]),
  string: new Set(["number", "boolean"]),
  boolean: new Set(["number", "string"]),
}

export function areTypesCompatible(sourceType: string, targetType: string): boolean {
  if (sourceType === targetType) return true
  return TYPE_COERCIONS[sourceType]?.has(targetType) ?? false
}

// ─────────────────────────────────────────────
// Runtime Type Coercion (n8n pattern)
// ─────────────────────────────────────────────

export function coerceValue(value: unknown, sourceType: string, targetType: string): unknown {
  if (sourceType === targetType) return value

  if (targetType === "string") return String(value)
  if (targetType === "number") {
    const n = Number(value)
    return Number.isNaN(n) ? 0 : n
  }
  if (targetType === "boolean") return Boolean(value)

  return value
}

// ─────────────────────────────────────────────
// Schema Compatibility Check
// ─────────────────────────────────────────────

export function checkSchemaCompatibility(
  outputSchema: JSONSchema | null | undefined,
  inputSchema: JSONSchema | null | undefined,
): SchemaCompatibility {
  const result: SchemaCompatibility = {
    compatible: false,
    score: 0,
    matchedFields: [],
    unmatchedRequired: [],
    suggestions: [],
  }

  // No schemas → trivially compatible
  if (!inputSchema?.properties || Object.keys(inputSchema.properties).length === 0) {
    result.compatible = true
    result.score = 1
    return result
  }

  if (!outputSchema?.properties || Object.keys(outputSchema.properties).length === 0) {
    result.unmatchedRequired = inputSchema.required ?? []
    result.score = 0
    return result
  }

  const outProps = outputSchema.properties
  const inProps = inputSchema.properties
  const requiredFields = new Set(inputSchema.required ?? [])
  const usedSourceFields = new Set<string>()

  for (const [inKey, inField] of Object.entries(inProps)) {
    // Level 1: Exact name + type match → confidence 1.0
    if (outProps[inKey] && outProps[inKey].type === inField.type) {
      result.matchedFields.push({
        sourceField: inKey,
        targetField: inKey,
        confidence: 1.0,
        reason: "exact",
      })
      usedSourceFields.add(inKey)
      continue
    }

    // Level 2: Same type, similar name (Levenshtein ≤ 3) → confidence 0.8
    let fuzzyMatch: FieldSuggestion | null = null
    for (const [outKey, outField] of Object.entries(outProps)) {
      if (usedSourceFields.has(outKey)) continue
      if (outField.type === inField.type && levenshteinDistance(outKey, inKey) <= 3) {
        fuzzyMatch = {
          sourceField: outKey,
          targetField: inKey,
          confidence: 0.8,
          reason: "fuzzy_name",
        }
        break
      }
    }

    if (fuzzyMatch) {
      result.matchedFields.push(fuzzyMatch)
      usedSourceFields.add(fuzzyMatch.sourceField)
      continue
    }

    // Level 3: Compatible type coercion → confidence 0.5
    let coercionMatch: FieldSuggestion | null = null
    for (const [outKey, outField] of Object.entries(outProps)) {
      if (usedSourceFields.has(outKey)) continue
      if (areTypesCompatible(outField.type, inField.type)) {
        coercionMatch = {
          sourceField: outKey,
          targetField: inKey,
          confidence: 0.5,
          reason: "type_coercion",
        }
        break
      }
    }

    if (coercionMatch) {
      result.matchedFields.push(coercionMatch)
      usedSourceFields.add(coercionMatch.sourceField)
      continue
    }

    // No match found
    if (requiredFields.has(inKey)) {
      result.unmatchedRequired.push(inKey)
    }
  }

  // Score = matched required / total required (or total fields if no required specified)
  const totalRequired = requiredFields.size || Object.keys(inProps).length
  const matchedRequired = result.matchedFields.filter(
    (m) => requiredFields.has(m.targetField) || requiredFields.size === 0,
  ).length

  result.score = totalRequired > 0 ? matchedRequired / totalRequired : 1
  result.compatible = result.unmatchedRequired.length === 0 && result.score > 0
  result.suggestions = [...result.matchedFields].sort((a, b) => b.confidence - a.confidence)

  return result
}

// ─────────────────────────────────────────────
// Convenience Wrapper
// ─────────────────────────────────────────────

export function suggestFieldMappings(
  outputSchema: JSONSchema | null | undefined,
  inputSchema: JSONSchema | null | undefined,
): FieldSuggestion[] {
  const { suggestions } = checkSchemaCompatibility(outputSchema, inputSchema)
  return suggestions
}
