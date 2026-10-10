"use client"

import { useState } from "react"
import { ShieldCheck, UsersRound } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAccessRolesQuery, useGrantRoleToLeadersMutation } from "@/queries/access/use-access"
import { SCOPE_TYPE_LABELS, type AccessRole } from "@/schemas/access/access.schema"

/** Papéis (V1.5.7): cada papel é um PACOTE DE PERMISSÕES, atribuído a contas com um escopo — nunca um cargo. */
export function AccessRolesView() {
  const roles = useAccessRolesQuery()
  const [grantingRole, setGrantingRole] = useState<AccessRole | null>(null)
  const grant = useGrantRoleToLeadersMutation()
  if (roles.isPending) return <TableSkeleton rows={4} />
  if (roles.isError) return <AnalyticsErrorState error={roles.error} onRetry={() => void roles.refetch()} />

  async function confirmGrant() {
    if (!grantingRole) return
    try {
      const result = await grant.mutateAsync(grantingRole.code)
      toast.success(result.granted > 0 ? `${grantingRole.name}: ${result.granted} ${result.granted === 1 ? "gestor recebeu" : "gestores receberam"} o papel.` : `${grantingRole.name}: nenhum gestor novo — ${result.alreadyAssigned} já tinham o papel.`)
      setGrantingRole(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conceder o papel aos gestores.")
    }
  }

  return (
    <>
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
            {/* Ação em lote só para papéis de leitura pensados para a gestão, que aceitam "Minha estrutura". */}
            {role.assignableByYou && role.code === "LEITOR_DE_CONVERSAS_INIA" ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setGrantingRole(role)}><UsersRound aria-hidden />Conceder aos gestores</Button>
            ) : null}
          </li>
        ))}
      </ul>
      <AlertDialog open={grantingRole !== null} onOpenChange={(open) => (!open ? setGrantingRole(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conceder “{grantingRole?.name}” aos gestores?</AlertDialogTitle>
            <AlertDialogDescription>
              Cada pessoa com conta ativa que lidera alguém (Diretor, Gerente Sênior, Gerente, Coordenador, Supervisor) no seu escopo recebe o papel com escopo “Minha estrutura” — ela passa a ler só as conversas de quem está abaixo dela. Cada concessão fica registrada na auditoria e pode ser revogada individualmente. Quem já tem o papel não é alterado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={grant.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmGrant() }} disabled={grant.isPending}>{grant.isPending ? "Concedendo…" : "Conceder"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
