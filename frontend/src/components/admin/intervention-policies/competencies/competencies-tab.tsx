"use client"

import { useState } from "react"
import { ArrowLeft, GraduationCap, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { useIndicatorCatalog } from "@/components/admin/workflows/indicator-select"
import { useCompetenciesQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { CompetencyView } from "@/schemas/admin/intervention-policy.schema"

import { CompetencyEditor } from "../competency-editor"
import { useInterventionCapabilities } from "../shared/use-intervention-capabilities"

/** Catálogo de competências da organização (sem versões; ativar/desativar, nunca excluir). */
export function CompetenciesTab() {
  const { canEdit } = useInterventionCapabilities()
  const competenciesQuery = useCompetenciesQuery()
  const { byCode } = useIndicatorCatalog()
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [lastSaved, setLastSaved] = useState<CompetencyView | null>(null)
  const competencies = competenciesQuery.data ?? []

  if (editing) {
    // A versão devolvida pelo save vale até a lista ser recarregada (nunca volta para "Nova competência").
    const fromList = editing.id ? competencies.find((competency) => competency.id === editing.id) : undefined
    const current = editing.id ? (lastSaved?.id === editing.id && (!fromList || lastSaved.updatedAt > fromList.updatedAt) ? lastSaved : (fromList ?? null)) : null
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
          <ArrowLeft /> Competências
        </Button>
        <CompetencyEditor key={current ? `${current.id}|${current.updatedAt}` : "new"} competency={current} onSaved={(saved: CompetencyView) => {
            setLastSaved(saved)
            setEditing({ id: saved.id })
          }} onCancel={() => setEditing(null)} />
      </div>
    )
  }

  const newButton = (
    <Button onClick={() => setEditing({ id: null })} disabled={!canEdit} title={canEdit ? undefined : "Criar competências exige a permissão de edição em toda a organização."}>
      <Plus /> Nova competência
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Liga o diagnóstico ao treinamento: padrão sustentado → competência → conteúdo aprovado da base → atividades.</p>
        {newButton}
      </div>
      {competenciesQuery.isPending ? (
        <ListSkeleton view="list" rows={4} />
      ) : competenciesQuery.isError ? (
        <ListErrorState message="Não foi possível carregar as competências." onRetry={() => void competenciesQuery.refetch()} />
      ) : competencies.length === 0 ? (
        <ListEmptyState icon={GraduationCap} title="Nenhuma competência" description="Cadastre competências para ligar diagnósticos sustentados a treinamentos." action={newButton} />
      ) : (
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competência</TableHead>
                <TableHead>Indicadores</TableHead>
                <TableHead>Conteúdos</TableHead>
                <TableHead>Atividades</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competencies.map((competency) => {
                const unpublished = competency.documents.filter((document) => !document.published).length
                return (
                  <TableRow key={competency.id} className={competency.active ? undefined : "opacity-60"} data-testid={`competency-row-${competency.key}`}>
                    <TableCell>
                      <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => setEditing({ id: competency.id })}>
                        {competency.name}
                      </button>
                      <p className="font-mono text-xs text-muted-foreground">{competency.key}</p>
                    </TableCell>
                    <TableCell className="text-sm">{competency.indicatorCodes.length === 0 ? "—" : competency.indicatorCodes.map((code) => byCode.get(code)?.name ?? code).join(", ")}</TableCell>
                    <TableCell className="text-sm">
                      {competency.documents.length}
                      {unpublished > 0 ? <span className="block text-xs text-amber-700 dark:text-amber-400">{unpublished} sem versão publicada</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">{competency.activities.length}</TableCell>
                    <TableCell>
                      <Badge variant={competency.active ? "secondary" : "outline"}>{competency.active ? "Ativa" : "Inativa"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: competency.id })}>
                        {canEdit ? "Abrir e editar" : "Abrir"}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
