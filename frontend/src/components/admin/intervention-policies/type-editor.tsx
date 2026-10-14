"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckCheck, Pencil, Save, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { formatDateTime } from "@/lib/format/date"
import { useCapabilityCatalogQuery, useDiscardInterventionTypeDraftMutation, usePublishInterventionTypeMutation, useSaveInterventionTypeDraftMutation, useSetInterventionTypeActiveMutation } from "@/queries/admin/use-intervention-policy-queries"
import type { ConfigIssue, InterventionTypeDefinition, InterventionTypeView } from "@/schemas/admin/intervention-policy.schema"
import { validateInterventionType } from "@/services/admin/intervention-policy-service"

import { ActiveStatusControl, DiscardDraftButton } from "./shared/active-status-control"
import { IssuesPanel, Note } from "./shared/fields"
import { errorMessage, issuesFromError } from "./shared/helpers"
import { useInterventionCapabilities } from "./shared/use-intervention-capabilities"
import { CapabilitiesSection } from "./type-editor/capabilities-section"
import { FormFieldsSection } from "./type-editor/form-fields-section"
import { CompletionSection, EvidenceSection, IdentitySection, IncompatibilitySection, ResponsibilitySection } from "./type-editor/settings-sections"
import { enforceTypeRules } from "./type-editor/type-rules"

/**
 * Editor de um TIPO de intervenção (dado administrável, versionado: rascunho → publicado imutável). A chave não muda depois de
 * criada. Escrever no catálogo exige a permissão em TODA a organização — sem isso o backend responde 403
 * ORGANIZATION_SCOPE_REQUIRED, e a mensagem aparece aqui.
 */
export function TypeEditor({ type, types }: { type: InterventionTypeView; types: InterventionTypeView[] }) {
  const { canEdit, canPublish } = useInterventionCapabilities()
  const catalogQuery = useCapabilityCatalogQuery()
  const saveDraft = useSaveInterventionTypeDraftMutation()
  const publish = usePublishInterventionTypeMutation()
  const discard = useDiscardInterventionTypeDraftMutation()
  const setActive = useSetInterventionTypeActiveMutation()
  const validate = useMutation({ mutationFn: () => validateInterventionType(type.id) })
  const [definition, setDefinition] = useState<InterventionTypeDefinition | null>(() => structuredClone(type.draft?.definition ?? type.published?.definition ?? null))
  const [dirty, setDirty] = useState(false)
  const [localDraft, setLocalDraft] = useState(false)
  const [issues, setIssues] = useState<ConfigIssue[]>([])
  const [issuesTitle, setIssuesTitle] = useState("Antes de publicar")
  const [validated, setValidated] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const hasDraft = type.draft !== null || localDraft
  const editable = canEdit && hasDraft
  const busy = saveDraft.isPending || publish.isPending || discard.isPending || validate.isPending

  function update(next: InterventionTypeDefinition) {
    setDefinition(enforceTypeRules(next, catalogQuery.data))
    setDirty(true)
    setIssues([])
    setValidated(false)
  }

  function showIssues(title: string, error: unknown) {
    const list = issuesFromError(error)
    setIssuesTitle(title)
    setIssues(list.length > 0 ? list : [{ path: "", code: "FAILED", message: errorMessage(error) }])
  }

  async function persist(): Promise<boolean> {
    if (!definition) return false
    if (!dirty && type.draft) return true
    try {
      await saveDraft.mutateAsync({ id: type.id, definition })
      setDirty(false)
      return true
    } catch (error) {
      showIssues("O rascunho não foi salvo", error)
      return false
    }
  }

  async function handleValidate() {
    if (!(await persist())) return
    try {
      const result = await validate.mutateAsync()
      setIssuesTitle("Antes de publicar")
      setIssues(result.issues)
      setValidated(result.valid)
    } catch (error) {
      showIssues("Não foi possível validar", error)
    }
  }

  async function handlePublish() {
    setPublishOpen(false)
    if (!(await persist())) return
    try {
      await publish.mutateAsync(type.id)
      setIssues([])
      setLocalDraft(false)
    } catch (error) {
      showIssues("O tipo não foi publicado", error)
    }
  }

  async function handleDiscard() {
    await discard.mutateAsync(type.id)
    setDefinition(structuredClone(type.published?.definition ?? null))
    setLocalDraft(false)
    setDirty(false)
    setIssues([])
  }

  return (
    <div className="space-y-4" data-testid="type-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {definition?.name ?? type.key}
            <Badge variant="outline" className="font-mono">
              {type.key}
            </Badge>
            <Badge variant={type.active ? "secondary" : "outline"}>{type.active ? "Ativo" : "Inativo"}</Badge>
          </h2>
          <p className="text-xs text-muted-foreground">
            {type.published ? `Publicado: v${type.published.version}${type.published.publishedAt ? ` em ${formatDateTime(type.published.publishedAt)}` : ""}` : "Nunca publicado"}
            {type.draft ? ` · Rascunho: v${type.draft.version}` : ""}
            {localDraft && !type.draft ? " · Novo rascunho (ainda não salvo)" : ""}
            {` · Em uso: ${type.usage.active} ativa(s) de ${type.usage.total}`}
            {dirty ? " · Alterações não salvas" : ""}
          </p>
          <p className="text-xs text-muted-foreground">A chave não muda depois de criada. Intervenções já abertas seguem a versão com que nasceram.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!hasDraft && canEdit && type.published ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setDefinition(structuredClone(type.published!.definition))
                setLocalDraft(true)
                setDirty(true)
              }}
            >
              <Pencil /> Editar (novo rascunho)
            </Button>
          ) : null}
          {editable ? (
            <>
              {type.draft && type.published ? <DiscardDraftButton disabled={busy} pending={discard.isPending} error={discard.isError ? errorMessage(discard.error) : null} description={`As alterações do rascunho v${type.draft.version} serão perdidas. A versão publicada continua valendo.`} onConfirm={handleDiscard} /> : null}
              <Button size="sm" variant="outline" disabled={busy} onClick={handleValidate}>
                <CheckCheck /> {validate.isPending ? "Validando..." : "Validar"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => void persist()}>
                <Save /> {saveDraft.isPending ? "Salvando..." : "Salvar rascunho"}
              </Button>
            </>
          ) : null}
          {hasDraft && canPublish ? (
            <Popover open={publishOpen} onOpenChange={setPublishOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" disabled={busy}>
                  <Send /> Publicar…
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <PopoverHeader>
                  <PopoverTitle>Publicar este tipo</PopoverTitle>
                  <PopoverDescription>A versão publicada não muda mais e passa a ser a usada por novas intervenções e pelas políticas.</PopoverDescription>
                </PopoverHeader>
                {dirty ? <p className="text-xs text-muted-foreground">As alterações não salvas são salvas no rascunho antes de publicar.</p> : null}
                <Button size="sm" disabled={publish.isPending} onClick={handlePublish}>
                  {publish.isPending ? "Publicando..." : "Publicar versão"}
                </Button>
              </PopoverContent>
            </Popover>
          ) : null}
          {canPublish ? (
            <ActiveStatusControl
              active={type.active}
              name={definition?.name ?? type.key}
              pending={setActive.isPending}
              error={setActive.isError ? errorMessage(setActive.error) : null}
              deactivateDescription="Um tipo inativo não pode ser aberto manualmente e a publicação de novas versões de políticas que o usam passa a ser rejeitada. Nada é apagado: as intervenções já abertas continuam."
              onSetActive={(active) => setActive.mutateAsync({ id: type.id, active })}
            />
          ) : null}
        </div>
      </div>

      {!canEdit ? <Note>Você pode consultar este tipo, mas não editá-lo (falta a permissão de edição).</Note> : null}
      {canEdit && !canPublish && editable ? <Note>Publicar ou desativar tipos exige a permissão de publicação em toda a organização.</Note> : null}
      <IssuesPanel title={issuesTitle} issues={issues} success={validated ? "Nenhuma pendência: o rascunho pode ser publicado." : null} />

      {definition ? (
        <fieldset disabled={!editable} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <IdentitySection definition={definition} disabled={!editable} onChange={update} />
          <CapabilitiesSection definition={definition} catalog={catalogQuery.data} disabled={!editable} onChange={(capabilities) => update({ ...definition, capabilities })} />
          <ResponsibilitySection definition={definition} disabled={!editable} onChange={update} />
          <EvidenceSection definition={definition} catalog={catalogQuery.data} disabled={!editable} onChange={update} />
          <FormFieldsSection fields={definition.form} disabled={!editable} onChange={(form) => update({ ...definition, form })} />
          <CompletionSection definition={definition} catalog={catalogQuery.data} disabled={!editable} onChange={update} />
          <IncompatibilitySection definition={definition} ownKey={type.key} types={types} disabled={!editable} onChange={update} />
        </fieldset>
      ) : null}
    </div>
  )
}
