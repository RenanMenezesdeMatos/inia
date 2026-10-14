"use client"

import { useId, useState } from "react"
import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useIndicatorCatalog } from "@/components/admin/workflows/indicator-select"
import { useCreateCompetencyMutation, useSetCompetencyActiveMutation, useUpdateCompetencyMutation } from "@/queries/admin/use-intervention-policy-queries"
import type { CompetencyInput, CompetencyView, ConfigIssue } from "@/schemas/admin/intervention-policy.schema"

import { ActiveStatusControl } from "./shared/active-status-control"
import { IssuesPanel, Note } from "./shared/fields"
import { errorMessage, issuesFromError, normalizeStableKey, STABLE_KEY_HINT, STABLE_KEY_PATTERN } from "./shared/helpers"
import { IndicatorCodeField } from "./shared/indicator-code-field"
import { useInterventionCapabilities } from "./shared/use-intervention-capabilities"
import { ACTIVITY_KEY_PATTERN, ActivitiesSection } from "./competency-editor/activities-section"
import { DocumentsSection, useLinkedDocuments } from "./competency-editor/documents-section"
import { PatternPicker } from "./competency-editor/pattern-picker"

/**
 * COMPETÊNCIA (sem versões): liga o diagnóstico ao treinamento — padrões sustentados (práticas KP-…, critérios KC-…,
 * comportamentos BEHAVIOR:…) → competência → conteúdo da base → atividades. Os vínculos são escolhidos por uma pessoa; nada é
 * inferido do nome do indicador. A chave não muda depois de criada; desativar nunca apaga.
 */

const toInput = (competency: CompetencyView | null): CompetencyInput =>
  competency
    ? { key: competency.key, name: competency.name, description: competency.description, knowledgeDocumentIds: [...competency.knowledgeDocumentIds], practiceKeys: [...competency.practiceKeys], criterionKeys: [...competency.criterionKeys], indicatorCodes: [...competency.indicatorCodes], activities: structuredClone(competency.activities) }
    : { key: "", name: "", description: "", knowledgeDocumentIds: [], practiceKeys: [], criterionKeys: [], indicatorCodes: [], activities: [] }

export function CompetencyEditor({ competency, onSaved, onCancel }: { competency: CompetencyView | null; onSaved: (saved: CompetencyView) => void; onCancel: () => void }) {
  const { canEdit } = useInterventionCapabilities()
  const create = useCreateCompetencyMutation()
  const update = useUpdateCompetencyMutation()
  const setActive = useSetCompetencyActiveMutation()
  const { byCode } = useIndicatorCatalog()
  const nameId = useId()
  const keyId = useId()
  const descriptionId = useId()
  const [input, setInput] = useState<CompetencyInput>(() => toInput(competency))
  const [keyTouched, setKeyTouched] = useState(Boolean(competency))
  const [issues, setIssues] = useState<ConfigIssue[]>([])
  const [pendingIndicator, setPendingIndicator] = useState<string | null>(null)
  const linkedDocuments = useLinkedDocuments(input.knowledgeDocumentIds, competency?.documents ?? [])
  const disabled = !canEdit
  const keyValid = STABLE_KEY_PATTERN.test(input.key)
  const activityKeys = input.activities.map((activity) => activity.key)
  const activitiesValid = input.activities.every((activity) => ACTIVITY_KEY_PATTERN.test(activity.key) && activity.title.trim().length > 0) && new Set(activityKeys).size === activityKeys.length
  const canSave = canEdit && keyValid && input.name.trim().length > 0 && activitiesValid
  const pending = create.isPending || update.isPending
  const change = (next: CompetencyInput) => {
    setInput(next)
    setIssues([])
  }

  async function handleSave() {
    const payload: CompetencyInput = { ...input, name: input.name.trim(), description: input.description.trim(), activities: input.activities.map((activity) => ({ ...activity, title: activity.title.trim(), description: activity.description.trim() })) }
    try {
      const saved = competency ? await update.mutateAsync({ id: competency.id, input: payload }) : await create.mutateAsync(payload)
      onSaved(saved)
    } catch (error) {
      const list = issuesFromError(error)
      setIssues(list.length > 0 ? list : [{ path: "", code: "FAILED", message: errorMessage(error) }])
    }
  }

  return (
    <div className="space-y-4" data-testid="competency-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {competency ? competency.name : "Nova competência"}
            {competency ? <Badge variant={competency.active ? "secondary" : "outline"}>{competency.active ? "Ativa" : "Inativa"}</Badge> : null}
          </h2>
          <p className="text-xs text-muted-foreground">Usada pelas condições &quot;Diagnóstico sustentado&quot; e pelos treinamentos.</p>
        </div>
        {competency && canEdit ? (
          <ActiveStatusControl
            active={competency.active}
            name={competency.name}
            pending={setActive.isPending}
            error={setActive.isError ? errorMessage(setActive.error) : null}
            deactivateDescription="Uma competência inativa deixa de ser oferecida em novas condições. Nada é apagado: políticas e treinamentos que já a referenciam continuam com a referência."
            onSetActive={(active) => setActive.mutateAsync({ id: competency.id, active })}
          />
        ) : null}
      </div>
      {!canEdit ? <Note>Você pode consultar esta competência, mas não editá-la (falta a permissão de edição em toda a organização).</Note> : null}
      <IssuesPanel title="A competência não foi salva" issues={issues} />

      <fieldset disabled={disabled} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <section className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Identificação</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={nameId} className="text-xs">
                Nome da competência *
              </Label>
              <Input
                id={nameId}
                value={input.name}
                maxLength={120}
                onChange={(event) => change({ ...input, name: event.target.value, ...(keyTouched ? {} : { key: normalizeStableKey(event.target.value) }) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={keyId} className="text-xs">
                Chave *
              </Label>
              <Input
                id={keyId}
                className="font-mono"
                value={input.key}
                maxLength={40}
                disabled={Boolean(competency)}
                onChange={(event) => {
                  setKeyTouched(true)
                  change({ ...input, key: normalizeStableKey(event.target.value) })
                }}
              />
              <p className="text-xs text-muted-foreground">{competency ? "A chave não muda depois de criada (é a identidade usada pelas políticas)." : STABLE_KEY_HINT}</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={descriptionId} className="text-xs">
              Descrição
            </Label>
            <Textarea id={descriptionId} rows={2} maxLength={2000} value={input.description} onChange={(event) => change({ ...input, description: event.target.value })} />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border p-4">
          <div>
            <h3 className="text-sm font-semibold">Ligação com o diagnóstico</h3>
            <p className="text-xs text-muted-foreground">Quais padrões sustentados do diagnóstico apontam para esta competência.</p>
          </div>
          <PatternPicker practiceKeys={input.practiceKeys} criterionKeys={input.criterionKeys} disabled={disabled} onChange={(next) => change({ ...input, ...next })} />
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Indicadores</p>
            <div className="flex flex-wrap gap-1.5">
              {input.indicatorCodes.map((code) => (
                <Badge key={code} variant="outline" className="gap-1">
                  {byCode.get(code)?.name ?? code}
                  {disabled ? null : (
                    <button type="button" aria-label={`Remover ${byCode.get(code)?.name ?? code}`} onClick={() => change({ ...input, indicatorCodes: input.indicatorCodes.filter((current) => current !== code) })}>
                      <X className="size-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {input.indicatorCodes.length === 0 ? <span className="text-xs text-muted-foreground">Nenhum.</span> : null}
            </div>
            {disabled ? null : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1">
                  <IndicatorCodeField label="Adicionar indicador" value={pendingIndicator} onChange={(code) => setPendingIndicator(code)} />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!pendingIndicator || input.indicatorCodes.includes(pendingIndicator) || input.indicatorCodes.length >= 20}
                  onClick={() => {
                    if (!pendingIndicator) return
                    change({ ...input, indicatorCodes: [...input.indicatorCodes, pendingIndicator] })
                    setPendingIndicator(null)
                  }}
                >
                  Adicionar
                </Button>
              </div>
            )}
          </div>
        </section>

        <DocumentsSection ids={input.knowledgeDocumentIds} saved={competency?.documents ?? []} disabled={disabled} onChange={(knowledgeDocumentIds) => change({ ...input, knowledgeDocumentIds, activities: input.activities.map((activity) => (activity.documentId && !knowledgeDocumentIds.includes(activity.documentId) ? { ...activity, documentId: null } : activity)) })} />
        <ActivitiesSection activities={input.activities} documents={linkedDocuments} disabled={disabled} onChange={(activities) => change({ ...input, activities })} />
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {canEdit ? "Cancelar" : "Voltar"}
        </Button>
        {canEdit ? (
          <Button disabled={!canSave || pending} onClick={handleSave}>
            {pending ? "Salvando..." : competency ? "Salvar competência" : "Criar competência"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
