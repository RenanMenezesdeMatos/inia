import { z } from "zod"

// Mesmos tipos amigáveis do backend (workflow-variable-schema.ts) — nunca "Data/Hora" ainda,
// nenhum comparador do motor a suporta hoje.
export const workflowVariableTypeSchema = z.enum(["BOOLEAN", "NUMERIC", "TEXT"])
export type WorkflowVariableType = z.infer<typeof workflowVariableTypeSchema>

export const WORKFLOW_VARIABLE_TYPE_LABELS: Record<WorkflowVariableType, string> = {
  BOOLEAN: "Verdadeiro/Falso",
  NUMERIC: "Número",
  TEXT: "Texto",
}

export const workflowVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: workflowVariableTypeSchema,
  createdAt: z.coerce.string(),
})
export type WorkflowVariable = z.infer<typeof workflowVariableSchema>
