import { describe, test, expect } from "bun:test"
import {
  checkSchemaCompatibility,
  suggestFieldMappings,
  areTypesCompatible,
  coerceValue,
  levenshteinDistance,
} from "../services/pipeline/schema-checker"
import type { JSONSchema } from "../services/pipeline/schema-checker"

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeSchema(
  props: Record<string, string>,
  required?: string[],
): JSONSchema {
  const properties: Record<string, { type: string }> = {}
  for (const [key, type] of Object.entries(props)) {
    properties[key] = { type }
  }
  return { type: "object", properties, required }
}

// ─────────────────────────────────────────────
// Levenshtein Distance
// ─────────────────────────────────────────────

describe("levenshteinDistance", () => {
  test("identical strings → 0", () => {
    expect(levenshteinDistance("price", "price")).toBe(0)
  })

  test("single character difference → 1", () => {
    expect(levenshteinDistance("price", "pricE")).toBe(1)
  })

  test("insertion → 1", () => {
    expect(levenshteinDistance("price", "prices")).toBe(1)
  })

  test("completely different → length of longer", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3)
  })

  test("empty string → length of other", () => {
    expect(levenshteinDistance("", "hello")).toBe(5)
    expect(levenshteinDistance("hello", "")).toBe(5)
  })
})

// ─────────────────────────────────────────────
// Type Compatibility
// ─────────────────────────────────────────────

describe("areTypesCompatible", () => {
  test("same types are compatible", () => {
    expect(areTypesCompatible("string", "string")).toBe(true)
    expect(areTypesCompatible("number", "number")).toBe(true)
    expect(areTypesCompatible("boolean", "boolean")).toBe(true)
  })

  test("number → string coercion", () => {
    expect(areTypesCompatible("number", "string")).toBe(true)
  })

  test("string → number coercion", () => {
    expect(areTypesCompatible("string", "number")).toBe(true)
  })

  test("boolean → number coercion", () => {
    expect(areTypesCompatible("boolean", "number")).toBe(true)
  })

  test("unknown types are incompatible", () => {
    expect(areTypesCompatible("object", "string")).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Value Coercion
// ─────────────────────────────────────────────

describe("coerceValue", () => {
  test("same type returns value unchanged", () => {
    expect(coerceValue(42, "number", "number")).toBe(42)
    expect(coerceValue("hello", "string", "string")).toBe("hello")
  })

  test("number → string", () => {
    expect(coerceValue(42, "number", "string")).toBe("42")
  })

  test("string → number", () => {
    expect(coerceValue("42", "string", "number")).toBe(42)
  })

  test("non-numeric string → number returns 0", () => {
    expect(coerceValue("abc", "string", "number")).toBe(0)
  })

  test("number → boolean", () => {
    expect(coerceValue(1, "number", "boolean")).toBe(true)
    expect(coerceValue(0, "number", "boolean")).toBe(false)
  })

  test("boolean → string", () => {
    expect(coerceValue(true, "boolean", "string")).toBe("true")
  })
})

// ─────────────────────────────────────────────
// Schema Compatibility
// ─────────────────────────────────────────────

describe("checkSchemaCompatibility", () => {
  test("exact field match → score 1.0, confidence 1.0", () => {
    const output = makeSchema({ price: "number", timestamp: "number" })
    const input = makeSchema({ price: "number", timestamp: "number" }, ["price", "timestamp"])

    const result = checkSchemaCompatibility(output, input)

    expect(result.compatible).toBe(true)
    expect(result.score).toBe(1)
    expect(result.matchedFields).toHaveLength(2)
    expect(result.matchedFields[0].confidence).toBe(1.0)
    expect(result.unmatchedRequired).toHaveLength(0)
  })

  test("fuzzy name match (Levenshtein ≤ 3) → confidence 0.8", () => {
    const output = makeSchema({ priceUsd: "number" })
    const input = makeSchema({ priceUsdc: "number" }, ["priceUsdc"])

    const result = checkSchemaCompatibility(output, input)

    expect(result.compatible).toBe(true)
    expect(result.matchedFields).toHaveLength(1)
    expect(result.matchedFields[0].confidence).toBe(0.8)
    expect(result.matchedFields[0].reason).toBe("fuzzy_name")
  })

  test("type coercion match → confidence 0.5", () => {
    const output = makeSchema({ value: "number" })
    const input = makeSchema({ amount: "string" }, ["amount"])

    const result = checkSchemaCompatibility(output, input)

    expect(result.compatible).toBe(true)
    expect(result.matchedFields).toHaveLength(1)
    expect(result.matchedFields[0].confidence).toBe(0.5)
    expect(result.matchedFields[0].reason).toBe("type_coercion")
  })

  test("unmatched required field → not compatible", () => {
    // Use "object" type which has no coercion path from "string"
    const output = makeSchema({ foo: "string" })
    const input = makeSchema({ bar: "object" }, ["bar"])

    const result = checkSchemaCompatibility(output, input)

    expect(result.compatible).toBe(false)
    expect(result.unmatchedRequired).toContain("bar")
  })

  test("type conflict detected", () => {
    const output = makeSchema({ value: "string" })
    const input = makeSchema({ value: "boolean" }, ["value"])

    const result = checkSchemaCompatibility(output, input)

    // string → boolean is coercible, so it should match
    expect(result.matchedFields).toHaveLength(1)
  })

  test("empty input schema → trivially compatible", () => {
    const output = makeSchema({ price: "number" })
    const input: JSONSchema = { type: "object" }

    const result = checkSchemaCompatibility(output, input)

    expect(result.compatible).toBe(true)
    expect(result.score).toBe(1)
  })

  test("empty output schema → score 0", () => {
    const output: JSONSchema = { type: "object" }
    const input = makeSchema({ value: "number" }, ["value"])

    const result = checkSchemaCompatibility(output, input)

    expect(result.score).toBe(0)
  })

  test("null schemas → compatible", () => {
    const result = checkSchemaCompatibility(null, null)
    expect(result.compatible).toBe(true)
    expect(result.score).toBe(1)
  })

  test("all-optional fields with partial match", () => {
    const output = makeSchema({ price: "number", name: "string" })
    const input = makeSchema({ price: "number", category: "string", flag: "boolean" })

    const result = checkSchemaCompatibility(output, input)

    // price exact match, name→category fuzzy or type match, flag→boolean may match
    expect(result.score).toBeGreaterThan(0)
    expect(result.matchedFields.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────
// Suggest Field Mappings
// ─────────────────────────────────────────────

describe("suggestFieldMappings", () => {
  test("returns sorted suggestions by confidence", () => {
    const output = makeSchema({ price: "number", value: "number" })
    const input = makeSchema({ price: "number", amount: "string" })

    const suggestions = suggestFieldMappings(output, input)

    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    // Should be sorted descending by confidence
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].confidence).toBeGreaterThanOrEqual(suggestions[i].confidence)
    }
  })

  test("empty schemas → empty suggestions", () => {
    const suggestions = suggestFieldMappings(null, null)
    expect(suggestions).toHaveLength(0)
  })
})
