"use client"

import { useCurrentUserQuery } from "@/queries/auth/use-current-user"

/**
 * O que a sessão pode fazer na administração de políticas (capabilities calculadas ao vivo pelo backend). A UI só desabilita
 * ou esconde — o backend confere tudo de novo (escopo da política, catálogo exige escopo de organização inteira).
 */
export function useInterventionCapabilities() {
  const capabilities = useCurrentUserQuery().data?.access.capabilities
  return {
    canEdit: capabilities?.canEditInterventionPolicies ?? false,
    canSimulate: Boolean(capabilities?.canSimulateInterventionPolicies || capabilities?.canManageWorkflows),
    canPublish: capabilities?.canPublishInterventionPolicies ?? false,
    canAudit: capabilities?.canAuditInterventionPolicies ?? false,
  }
}
