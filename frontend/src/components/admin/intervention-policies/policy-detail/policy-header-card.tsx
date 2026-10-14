"use client"

import { useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { formatDateTime } from "@/lib/format/date"
import { useEditorCatalogQuery, useSetPolicyActiveMutation, useUpdatePolicyHeaderMutation, useUpdatePolicyScopeMutation } from "@/queries/admin/use-intervention-policy-queries"
import type { PolicyView } from "@/schemas/admin/intervention-policy.schema"

import { ActiveStatusControl } from "../shared/active-status-control"
import { Note } from "../shared/fields"
import { errorMessage } from "../shared/helpers"
import { fromOrgScope, scopeIsComplete, toOrgScope } from "../policies/scope"

/**
 * Cabeçalho da política: nome (muda sempre), escopo (só até a primeira publicação — depois o backend responde
 * INTERVENTION_POLICY_SCOPE_LOCKED), vigência e status. Desativar nunca apaga: novas avaliações respondem "não aplicável".
 */
export function PolicyHeaderCard({ policy }: { policy: PolicyView }) {
  const updateName = useUpdatePolicyHeaderMutation()
  const updateScope = useUpdatePolicyScopeMutation()
  const setActive = useSetPolicyActiveMutation()
  const catalogQuery = useEditorCatalogQuery()
  const nameId = useId()
  const [name, setName] = useState(policy.name)
  const [scope, setScope] = useState<OrgScopeValue>(() => toOrgScope(policy))
  const everPublished = policy.versions.some((version) => version.status === "PUBLISHED")
  const nextScope = fromOrgScope(scope)
  const scopeChanged = nextScope.scopeType !== policy.scopeType || nextScope.teamId !== policy.teamId || nextScope.subteamId !== policy.subteamId
  const scopeComplete = scopeIsComplete(nextScope)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {policy.name}
              <Badge variant="outline" className="font-mono">
                {policy.key}
              </Badge>
              <Badge variant={policy.active ? "secondary" : "outline"}>{policy.active ? "Ativa" : "Inativa"}</Badge>
            </CardTitle>
            <CardDescription>
              {policy.scopeLabel} · {policy.inForce ? `Em vigor: v${policy.inForce.version} desde ${policy.inForce.effectiveFrom ? formatDateTime(policy.inForce.effectiveFrom) : "—"}` : "Nenhuma versão em vigor"}
              {policy.scheduled.length > 0 ? ` · ${policy.scheduled.map((version) => `v${version.version} a partir de ${version.effectiveFrom ? formatDateTime(version.effectiveFrom) : "—"}`).join(", ")}` : ""}
              {` · ${policy.evaluations.last30Days} avaliação(ões) nos últimos 30 dias`}
            </CardDescription>
          </div>
          {policy.can.publish ? (
            <ActiveStatusControl
              active={policy.active}
              name={policy.name}
              pending={setActive.isPending}
              error={setActive.isError ? errorMessage(setActive.error) : null}
              deactivateTitle="Desativar a política?"
              deactivateDescription="Novas avaliações passam a responder “Política não aplicável”. Nada é apagado: versões, avaliações e intervenções já abertas continuam como estão, e a política pode ser reativada."
              onSetActive={(active) => setActive.mutateAsync({ id: policy.id, active })}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {policy.can.edit ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={nameId} className="text-xs">
                Nome da política
              </Label>
              <Input id={nameId} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={updateName.isPending || name.trim() === policy.name || name.trim().length === 0} onClick={() => updateName.mutate({ id: policy.id, name: name.trim() })}>
              {updateName.isPending ? "Salvando..." : "Salvar nome"}
            </Button>
          </div>
        ) : null}
        {policy.can.edit && !everPublished ? (
          <div className="space-y-2">
            {catalogQuery.isError ? (
              <Note>Não foi possível carregar os grupos agora: {errorMessage(catalogQuery.error)}</Note>
            ) : (
              <OrgScopeSelect teams={catalogQuery.data?.teams ?? []} value={scope} onChange={setScope} allowAllTeams={catalogQuery.data?.unrestricted ?? true} />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={updateScope.isPending || !scopeChanged || !scopeComplete} onClick={() => updateScope.mutate({ id: policy.id, name: policy.name, ...nextScope })}>
                {updateScope.isPending ? "Salvando..." : "Salvar escopo"}
              </Button>
              <p className="text-xs text-muted-foreground">O escopo só muda enquanto nada foi publicado.</p>
            </div>
            {updateScope.isError ? <p className="text-xs text-destructive">{errorMessage(updateScope.error)}</p> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Escopo: {policy.scopeLabel}. {everPublished ? "O escopo não muda depois da primeira publicação — para outro escopo, crie outra política." : ""}</p>
        )}
      </CardContent>
    </Card>
  )
}
