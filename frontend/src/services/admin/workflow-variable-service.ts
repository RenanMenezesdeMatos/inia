import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { workflowVariableSchema, type WorkflowVariable, type WorkflowVariableType } from "@/schemas/admin/workflow-variable.schema"

export async function fetchWorkflowVariables(workflowId: string): Promise<WorkflowVariable[]> {
  return z.array(workflowVariableSchema).parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/variables`))
}

export async function createWorkflowVariable(workflowId: string, input: { name: string; type: WorkflowVariableType }): Promise<WorkflowVariable> {
  return workflowVariableSchema.parse(await adminSend(`/api/v1/admin/workflows/${workflowId}/variables`, "POST", input))
}

