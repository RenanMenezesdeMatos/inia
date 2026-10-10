import { describe, expect, it } from "vitest"
import { flattenOutputSchema, outputSchemaSchema, resolveOutputSchemaField } from "./output-schema-fields"

const SCHEMA = outputSchemaSchema.parse([
  {
    key: "diagnosis",
    label: "Diagnóstico",
    fields: [{ key: "severity", label: "Severidade", type: "STRING", enumValues: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }],
  },
  { key: "flags", label: "Flags", fields: [{ key: "offensiveLanguage", label: "Linguagem ofensiva", type: "BOOLEAN" }] },
])

describe("flattenOutputSchema", () => {
  it("builds friendly group › field labels", () => {
    expect(flattenOutputSchema(SCHEMA).map((field) => field.label)).toEqual(["Diagnóstico › Severidade", "Flags › Linguagem ofensiva"])
  })
})

describe("resolveOutputSchemaField", () => {
  it("finds a field by its dotted path", () => {
    expect(resolveOutputSchemaField(SCHEMA, "flags.offensiveLanguage")).toMatchObject({ type: "BOOLEAN" })
  })

  it("returns undefined for an unknown path or a missing schema", () => {
    expect(resolveOutputSchemaField(SCHEMA, "diagnosis.unknown")).toBeUndefined()
    expect(resolveOutputSchemaField(null, "diagnosis.severity")).toBeUndefined()
  })
})
