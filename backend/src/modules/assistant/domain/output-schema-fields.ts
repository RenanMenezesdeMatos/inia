import { z } from "zod"

/**
 * Descrição tipada (opcional) do JSON que `output_instructions` pede ao modelo — não uma DSL,
 * só uma lista de grupos/campos com label amigável e tipo. `output_instructions` continua sendo
 * o texto que de fato instrui o LLM; isto é só metadado para o Workflow Builder conseguir
 * montar "Diagnóstico › Severidade" em vez de expor o JSON path técnico ao admin.
 */
export const outputSchemaFieldTypeSchema = z.enum(["STRING", "NUMBER", "BOOLEAN", "ARRAY"])
export type OutputSchemaFieldType = z.infer<typeof outputSchemaFieldTypeSchema>

export const outputSchemaFieldSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: outputSchemaFieldTypeSchema,
  // Só relevante para type STRING — quando presente, o campo vira um select de valores fixos
  // (ex.: severity: ["LOW","MEDIUM","HIGH","CRITICAL"]) em vez de texto livre.
  enumValues: z.array(z.string().trim().min(1)).optional(),
  description: z.string().trim().optional(),
})

export const outputSchemaGroupSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  fields: z.array(outputSchemaFieldSchema).min(1),
})

export const outputSchemaSchema = z.array(outputSchemaGroupSchema)
export type OutputSchema = z.infer<typeof outputSchemaSchema>

export type FlatOutputSchemaField = {
  path: string
  label: string
  /** Tipo para fins de comparador (COMPARATORS_BY_FIELD_TYPE) — ENUM compara como STRING. */
  type: OutputSchemaFieldType
  enumValues?: string[]
  description?: string
  /** Presentes quando o campo vem da definição nova (structured-output-definition.ts):
   * tipo declarado (inclui ENUM), obrigatoriedade e rótulos das opções. */
  fieldType?: "STRING" | "NUMBER" | "BOOLEAN" | "ENUM" | "ARRAY"
  required?: boolean
  enumOptions?: { value: string; label: string }[]
}

/** Achata grupo+campo em `{ path: "diagnosis.severity", label: "Diagnóstico › Severidade" }` —
 * o path é exatamente o segmento que aparece depois de "structuredResult." no sourcePath real. */
export function flattenOutputSchema(schema: OutputSchema): FlatOutputSchemaField[] {
  return schema.flatMap((group) =>
    group.fields.map((field) => ({
      path: `${group.key}.${field.key}`,
      label: `${group.label} › ${field.label}`,
      type: field.type,
      ...(field.enumValues !== undefined ? { enumValues: field.enumValues } : {}),
      ...(field.description !== undefined ? { description: field.description } : {}),
    })),
  )
}

export function resolveOutputSchemaField(schema: OutputSchema | null | undefined, path: string): FlatOutputSchemaField | undefined {
  if (!schema) return undefined
  return flattenOutputSchema(schema).find((field) => field.path === path)
}
