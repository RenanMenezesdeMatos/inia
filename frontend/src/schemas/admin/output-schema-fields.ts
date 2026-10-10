import { z } from "zod"

/** Espelho de backend/src/modules/assistant/domain/output-schema-fields.ts — descrição tipada
 * opcional do JSON que outputInstructions pede ao modelo, usada só para o Workflow Builder
 * montar um seletor "Diagnóstico › Severidade" em vez do JSON path técnico. */
export const outputSchemaFieldTypeSchema = z.enum(["STRING", "NUMBER", "BOOLEAN", "ARRAY"])
export type OutputSchemaFieldType = z.infer<typeof outputSchemaFieldTypeSchema>

export const outputSchemaFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: outputSchemaFieldTypeSchema,
  enumValues: z.array(z.string()).optional(),
  description: z.string().optional(),
})
export type OutputSchemaField = z.infer<typeof outputSchemaFieldSchema>

export const outputSchemaGroupSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(outputSchemaFieldSchema).min(1),
})
export type OutputSchemaGroup = z.infer<typeof outputSchemaGroupSchema>

export const outputSchemaSchema = z.array(outputSchemaGroupSchema)
export type OutputSchema = z.infer<typeof outputSchemaSchema>

export type FlatOutputSchemaField = {
  path: string
  label: string
  /** Tipo para fins de comparador — ENUM compara como STRING (com `enumValues`). */
  type: OutputSchemaFieldType
  enumValues?: string[]
  description?: string
  /** Presentes quando o campo vem da definição nova (structured-output.ts): tipo declarado
   * (inclui ENUM), obrigatoriedade e rótulos das opções (o select da Condition mostra o rótulo). */
  fieldType?: "STRING" | "NUMBER" | "BOOLEAN" | "ENUM" | "ARRAY"
  required?: boolean
  enumOptions?: { value: string; label: string }[]
}

export function flattenOutputSchema(schema: OutputSchema): FlatOutputSchemaField[] {
  return schema.flatMap((group) =>
    group.fields.map((field) => ({
      path: `${group.key}.${field.key}`,
      label: `${group.label} › ${field.label}`,
      type: field.type,
      enumValues: field.enumValues,
      description: field.description,
    })),
  )
}

export function resolveOutputSchemaField(schema: OutputSchema | null | undefined, path: string): FlatOutputSchemaField | undefined {
  if (!schema) return undefined
  return flattenOutputSchema(schema).find((field) => field.path === path)
}
