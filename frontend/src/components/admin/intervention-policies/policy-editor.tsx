"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckCheck, Pencil, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDiscardPolicyDraftMutation, usePublishPolicyMutation, useSavePolicyDraftMutation } from "@/queries/admin/use-intervention-policy-queries"
import type { ConfigIssue, PolicyDefinition, PolicyView } from "@/schemas/admin/intervention-policy.schema"
import { validatePolicy } from "@/services/admin/intervention-policy-service"

import { DiscardDraftButton } from "./shared/active-status-control"
import { IssuesPanel, Note } from "./shared/fields"
import { errorMessage, issuesFromError, latestPublishedVersion } from "./shared/helpers"
import { sanitizeDefinition } from "./policy-editor/defaults"
import { PolicyDefinitionForm } from "./policy-editor/policy-definition-form"
import { PublishPopover } from "./policy-editor/publish-popover"

/**
 * Editor da política: edita o RASCUNHO (uma versão por vez). Sem rascunho, mostra a última versão publicada só para leitura;
 * "Editar" abre um rascunho LOCAL a partir dela — nada é gravado até "Salvar rascunho" ou "Publicar". O backend valida o
 * formato ao salvar e a combinação ao validar/publicar; as pendências voltam como `{ path, code, message }` e aparecem aqui.
 */
// A ordem das regras é a do contrato salvo (as pendências do backend apontam `rules.N` nessa ordem); mover renumera tudo.
const cloneDefinition = (definition: PolicyDefinition | null) => (definition ? structuredClone(definition) : null)

export function PolicyEditor({ policy }: { policy: PolicyView }) {
  const saveDraft = useSavePolicyDraftMutation()
  const publish = usePublishPolicyMutation()
  const discard = useDiscardPolicyDraftMutation()
  const validate = useMutation({ mutationFn: () => validatePolicy(policy.id) })
  const basePublished = latestPublishedVersion(policy.versions)
  const [definition, setDefinition] = useState<PolicyDefinition | null>(() => cloneDefinition(policy.draft?.definition ?? basePublished?.definition ?? null))
  const [dirty, setDirty] = useState(false)
  const [localDraft, setLocalDraft] = useState(false)
  const [issues, setIssues] = useState<ConfigIssue[]>([])
  const [issuesTitle, setIssuesTitle] = useState("Antes de publicar")
  const [validated, setValidated] = useState(false)
  const hasDraft = policy.draft !== null || localDraft
  const editable = policy.can.edit && hasDraft
  const busy = saveDraft.isPending || publish.isPending || discard.isPending || validate.isPending

  function update(next: PolicyDefinition) {
    setDefinition(next)
    setDirty(true)
    setIssues([])
    setValidated(false)
  }

  function startLocalDraft() {
    setDefinition(cloneDefinition(basePublished?.definition ?? null))
    setLocalDraft(true)
    setDirty(true)
    setIssues([])
  }

  function cancelLocalDraft() {
    setDefinition(cloneDefinition(basePublished?.definition ?? null))
    setLocalDraft(false)
    setDirty(false)
    setIssues([])
  }

  function showIssues(title: string, error: unknown) {
    const list = issuesFromError(error)
    setIssuesTitle(title)
    setIssues(list.length > 0 ? list : [{ path: "", code: "FAILED", message: errorMessage(error) }])
  }

  /** Grava o rascunho quando há alteração local; devolve se o rascunho salvo está atualizado. */
  async function persist(): Promise<boolean> {
    if (!definition) return false
    if (!dirty && policy.draft) return true
    try {
      await saveDraft.mutateAsync({ id: policy.id, definition: sanitizeDefinition(definition) })
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

  async function handlePublish(effectiveFrom: string | null) {
    if (!(await persist())) return false
    try {
      await publish.mutateAsync({ id: policy.id, effectiveFrom })
      setIssues([])
      return true
    } catch (error) {
      showIssues("A versão não foi publicada", error)
      return false
    }
  }

  async function handleDiscard() {
    await discard.mutateAsync(policy.id)
    setDefinition(cloneDefinition(basePublished?.definition ?? null))
    setLocalDraft(false)
    setDirty(false)
    setIssues([])
  }

  return (
    <div className="space-y-4" data-testid="policy-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {policy.draft ? <Badge variant="outline">Rascunho v{policy.draft.version}</Badge> : null}
          {localDraft && !policy.draft ? <Badge variant="outline">Novo rascunho (ainda não salvo)</Badge> : null}
          {!hasDraft && basePublished ? <Badge variant="secondary">Versão publicada v{basePublished.version} — só leitura</Badge> : null}
          {dirty ? <span className="text-xs text-amber-700 dark:text-amber-400">Alterações não salvas</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!hasDraft && policy.can.edit && basePublished ? (
            <Button size="sm" disabled={busy} onClick={startLocalDraft}>
              <Pencil /> Editar (novo rascunho)
            </Button>
          ) : null}
          {editable ? (
            <>
              {localDraft && !policy.draft ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={cancelLocalDraft}>
                  Cancelar edição
                </Button>
              ) : null}
              {policy.draft && basePublished ? <DiscardDraftButton disabled={busy} pending={discard.isPending} error={discard.isError ? errorMessage(discard.error) : null} description={`As alterações do rascunho v${policy.draft.version} serão perdidas. A versão em vigor não muda.`} onConfirm={handleDiscard} /> : null}
              <Button size="sm" variant="outline" disabled={busy} onClick={handleValidate}>
                <CheckCheck /> {validate.isPending ? "Validando..." : "Validar"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => void persist()}>
                <Save /> {saveDraft.isPending ? "Salvando..." : "Salvar rascunho"}
              </Button>
            </>
          ) : null}
          {hasDraft && policy.can.publish && definition ? <PublishPopover disabled={busy} pending={publish.isPending} dirty={dirty} onPublish={handlePublish} /> : null}
        </div>
      </div>

      {!policy.can.edit ? <Note>Você pode consultar esta política, mas não editá-la: falta a permissão de edição ou o seu escopo não cobre o escopo dela.</Note> : null}
      {editable && !policy.can.publish ? <Note>Você pode editar e validar o rascunho; publicar exige a permissão de publicação no escopo desta política.</Note> : null}

      <IssuesPanel title={issuesTitle} issues={issues} success={validated ? "Nenhuma pendência: o rascunho pode ser publicado." : null} />

      {definition ? <PolicyDefinitionForm definition={definition} readOnly={!editable} issues={issues} onChange={update} /> : <p className="text-sm text-muted-foreground">Esta política ainda não tem versão.</p>}
    </div>
  )
}
