import { z } from "zod"

// Tipos amigáveis já suportados pelo motor (ver VARIABLE_TYPE_CHECKERS em action-executors.ts) —
// deliberadamente não inclui Data/Hora ainda (não pedido, nenhum comparador do motor a suporta).
export const workflowVariableTypeSchema = z.enum(["BOOLEAN", "NUMERIC", "TEXT"])

export const createWorkflowVariableSchema = z.object({
  name: z.string().trim().min(1),
  type: workflowVariableTypeSchema,
})

// Só o nome pode mudar depois de criada — o id (referenciado por nodes já configurados) nunca
// muda, e o tipo mudar depois quebraria qualquer Condition/Action já configurada em cima dele.
export const updateWorkflowVariableSchema = z.object({ name: z.string().trim().min(1) })
