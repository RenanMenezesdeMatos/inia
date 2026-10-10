import { describe, expect, it } from "vitest"
import { flattenOutputSchema, outputSchemaSchema, resolveOutputSchemaField } from "./output-schema-fields.js"

const SCHEMA = outputSchemaSchema.parse([
  {
    key: "diagnosis",
    label: "Diagnóstico",
    fields: [
      { key: "severity", label: "Severidade", type: "STRING", enumValues: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      { key: "confidence", label: "Confiança", type: "NUMBER" },
    ],
  },
  {
    key: "flags",
    label: "Flags",
    fields: [{ key: "offensiveLanguage", label: "Linguagem ofensiva", type: "BOOLEAN" }],
  },
])

describe("flattenOutputSchema", () => {
  it("builds friendly group › field labels and dotted paths", () => {
    const flat = flattenOutputSchema(SCHEMA)
    expect(flat).toContainEqual({
      path: "diagnosis.severity",
      label: "Diagnóstico › Severidade",
      type: "STRING",
      enumValues: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    })
    expect(flat).toContainEqual({ path: "flags.offensiveLanguage", label: "Flags › Linguagem ofensiva", type: "BOOLEAN" })
  })
})

describe("resolveOutputSchemaField", () => {
  it("finds a field by its dotted path", () => {
    expect(resolveOutputSchemaField(SCHEMA, "diagnosis.confidence")).toMatchObject({ type: "NUMBER" })
  })

  it("returns undefined for an unknown path (legacy/unconfigured field)", () => {
    expect(resolveOutputSchemaField(SCHEMA, "diagnosis.unknownField")).toBeUndefined()
  })

  it("returns undefined when the schema itself is absent (orchestrator never configured one)", () => {
    expect(resolveOutputSchemaField(null, "diagnosis.severity")).toBeUndefined()
    expect(resolveOutputSchemaField(undefined, "diagnosis.severity")).toBeUndefined()
  })
})
