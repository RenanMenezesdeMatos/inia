"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"
import { useCompetenciesQuery, useInterventionTypesQuery, usePoliciesQuery, usePolicyAuditQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { AuditEntry } from "@/schemas/admin/intervention-policy.schema"

import { PolicyEvaluationsPanel } from "../policy-detail/policy-evaluations-panel"
import { OptionSelect } from "../shared/fields"
import { errorMessage, interventionTypeName } from "../shared/helpers"
import { AUDIT_ENTITY_LABELS, auditActionLabel } from "../shared/labels"

const ALL = "__ALL__"

/** Detalhes legíveis do payload de auditoria (versão, vigência) — nunca o JSON cru. */
function auditDetails(entry: AuditEntry): string {
  const payload = (entry.payload ?? {}) as { version?: unknown; effectiveFrom?: unknown; name?: unknown; scopeType?: unknown }
  const parts: string[] = []
  if (typeof payload.version === "number") parts.push(`versão ${payload.version}`)
  if (typeof payload.effectiveFrom === "string") parts.push(`vigência a partir de ${formatDateTime(payload.effectiveFrom)}`)
  if (entry.action === "INTERVENTION_POLICY_UPDATED" && typeof payload.name === "string") parts.push(`nome: ${payload.name}`)
  if (typeof payload.scopeType === "string") parts.push("escopo alterado")
  return parts.join(" · ")
}

/**
 * Auditoria (com `intervention_policies.audit`): o que mudou na configuração (tipos, competências, políticas), por quem e
 * quando; e as avaliações de cada política com "Reavaliar" (nova avaliação ligada à original, sem abrir intervenção).
 */
export function AuditTab() {
  const policiesQuery = usePoliciesQuery()
  const typesQuery = useInterventionTypesQuery()
  const competenciesQuery = useCompetenciesQuery()
  const [entityId, setEntityId] = useState<string>(ALL)
  const [evaluationsPolicyId, setEvaluationsPolicyId] = useState<string | null>(null)
  const auditQuery = usePolicyAuditQuery(entityId === ALL ? null : entityId)
  const policies = policiesQuery.data ?? []
  const names = new Map<string, string>([
    ...policies.map((policy) => [policy.id, policy.name] as const),
    ...(typesQuery.data ?? []).map((type) => [type.id, interventionTypeName(type)] as const),
    ...(competenciesQuery.data ?? []).map((competency) => [competency.id, competency.name] as const),
  ])
  const entityOptions = [
    { value: ALL, label: "Toda a configuração" },
    ...policies.map((policy) => ({ value: policy.id, label: `Política: ${policy.name}` })),
    ...(typesQuery.data ?? []).map((type) => ({ value: type.id, label: `Tipo: ${interventionTypeName(type)}` })),
    ...(competenciesQuery.data ?? []).map((competency) => ({ value: competency.id, label: `Competência: ${competency.name}` })),
  ]

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Alterações de configuração</h3>
            <p className="text-xs text-muted-foreground">As 200 mais recentes.</p>
          </div>
          <OptionSelect className="min-w-64" label="Mostrar" value={entityId} options={entityOptions} onChange={setEntityId} />
        </div>
        {auditQuery.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : auditQuery.isError ? (
          <p className="text-sm text-destructive">{errorMessage(auditQuery.error, "Não foi possível carregar a auditoria.")}</p>
        ) : auditQuery.data.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>O quê</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQuery.data.map((entry) => (
                  <TableRow key={entry.id} data-testid={`audit-${entry.id}`}>
                    <TableCell className="text-sm">{formatDateTime(entry.createdAt)}</TableCell>
                    <TableCell className="text-sm">{entry.actorName ?? "Sistema"}</TableCell>
                    <TableCell className="text-sm">{auditActionLabel(entry.action)}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="outline">{AUDIT_ENTITY_LABELS[entry.entityType] ?? "Configuração"}</Badge> {names.get(entry.entityId) ?? "Item não disponível"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{auditDetails(entry) || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Avaliações por política</h3>
            <p className="text-xs text-muted-foreground">Cada avaliação guarda a versão e o fundamento. Reavaliar cria uma avaliação nova ligada à original e não abre intervenção.</p>
          </div>
          <OptionSelect className="min-w-64" label="Política" value={evaluationsPolicyId ?? undefined} placeholder="Escolha a política" options={policies.map((policy) => ({ value: policy.id, label: policy.name }))} onChange={setEvaluationsPolicyId} />
        </div>
        {evaluationsPolicyId ? <PolicyEvaluationsPanel key={evaluationsPolicyId} policyId={evaluationsPolicyId} /> : <p className="text-sm text-muted-foreground">Escolha uma política para ver as avaliações.</p>}
      </section>
    </div>
  )
}
