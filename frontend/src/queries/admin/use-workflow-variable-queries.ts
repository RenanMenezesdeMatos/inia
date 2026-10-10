import { useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createWorkflowVariable,
  fetchWorkflowVariables,
} from "@/services/admin/workflow-variable-service"
import type { WorkflowVariableType } from "@/schemas/admin/workflow-variable.schema"

import { adminQueryKeys } from "./admin-query-keys"

export function useWorkflowVariablesQuery(workflowId: string) {
  return useQuery({
    queryKey: adminQueryKeys.workflowVariables(workflowId),
    queryFn: () => fetchWorkflowVariables(workflowId),
    enabled: Boolean(workflowId),
  })
}

export function useCreateWorkflowVariableMutation(workflowId: string) {
  return useAdminMutation({
    mutationFn: (input: { name: string; type: WorkflowVariableType }) => createWorkflowVariable(workflowId, input),
    invalidateKey: adminQueryKeys.workflowVariables(workflowId),
    successMessage: "Variável criada.",
  })
}

