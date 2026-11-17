"use client"

import { ShieldCheck } from "lucide-react"

import { AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { useAccessRolesQuery } from "@/queries/access/use-access"
import { SCOPE_TYPE_LABELS } from "@/schemas/access/access.schema"

/**
 * Papéis (V1.5.7): cada papel é um PACOTE DE PERMISSÕES, atribuído a contas com um escopo — nunca um cargo. Esta aba só descreve os
 * papéis; a atribuição acontece conta a conta, em Usuários (botão "Papéis de …"), pela mesma regra de delegação do servidor.
 */
export function AccessRolesView() {
  const roles = useAccessRolesQuery()
  if (roles.isPending) return <TableSkeleton rows={4} />
  if (roles.isError) return <AnalyticsErrorState error={roles.error} onRetry={() => void roles.refetch()} />

  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-label="Papéis de acesso">
      {roles.data.map((role) => (
        <li key={role.code} className="space-y-2 rounded-xl border p-4" data-testid="access-role">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="font-semibold">{role.name}</h3>
            {role.assignableByYou ? <Badge variant="outline">Você pode conceder</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">{role.description}</p>
          <p className="text-xs text-muted-foreground">Escopos possíveis: {role.allowedScopes.map((scope) => SCOPE_TYPE_LABELS[scope]).join(" · ")}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">{role.permissions.map((permission) => <li key={permission.code}>{permission.label}</li>)}</ul>
        </li>
      ))}
    </ul>
  )
}
