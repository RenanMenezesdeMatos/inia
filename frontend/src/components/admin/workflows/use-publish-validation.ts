"use client"

import { useQuery } from "@tanstack/react-query"

import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import type { GraphIssue } from "@/schemas/admin/workflow-validation"
import { validateWorkflowDraft } from "@/services/admin/workflow-service"

/**
 * UMA verdade para "Pronto para publicar" (rodada de hardening 2026-09-16, Parte A): o editor só
 * diz isso quando a validação LOCAL (workflow-validation.ts — forma do grafo, sem banco) E o
 * dry-run do BACKEND (`POST /:id/validate`, a mesma função do botão Publicar — destinatário
 * ambíguo/não encontrado, agente/orquestrador inativo, tudo que depende do banco) estão válidos.
 * Nenhuma regra de hierarquia/destinatário é copiada pro frontend: o que depende do banco vem do
 * backend, com `nodeId` pra navegar até o nó.
 *
 * Quando roda: só sobre o rascunho PERSISTIDO — depois de "Salvar rascunho" (a `revision` muda) e
 * quando a configuração do Workflow muda (Abrangência/Estrutura/Gatilho, que entram na revisão).
 * Nunca a cada tecla nem a cada arrasto de nó: com o grafo sujo (`isDirty`) o estado é STALE e
 * nenhum request sai. Com problema local, também não sai request — o backend pararia no mesmo
 * problema, e a lista local já o mostra.
 *
 * Estados: `stale` (alterações não salvas / ainda não validado) · `blocked_local` (problemas
 * locais) · `validating` · `ready` · `invalid` (o backend recusou) · `error` (não conseguiu
 * validar — rede/servidor). O botão Publicar só habilita em `ready`; e mesmo assim o backend
 * valida DE NOVO ao publicar (a organização pode ter mudado entre o dry-run e o clique).
 */
export type PublishValidationStatus = "stale" | "blocked_local" | "validating" | "ready" | "invalid" | "error"

export type PublishValidation = {
  status: PublishValidationStatus
  /** Problema apontado pelo backend (um por vez — o dry-run para no primeiro), pra entrar na
   * mesma lista dos problemas locais. `nodeId` vazio = problema do Workflow inteiro. */
  backendIssue: GraphIssue | null
  /** Refaz o dry-run (usado pelo botão "Validar de novo" em `error`). */
  revalidate: () => void
}

export type UsePublishValidationInput = {
  workflowId: string
  /** Identidade do rascunho persistido + configuração — muda a cada save e a cada mudança de
   * Abrangência/Estrutura/Gatilho; é a chave do dry-run. */
  revision: string
  isDirty: boolean
  localIssueCount: number
}

export function usePublishValidation({ workflowId, revision, isDirty, localIssueCount }: UsePublishValidationInput): PublishValidation {
  const enabled = !isDirty && localIssueCount === 0
  const query = useQuery({
    queryKey: adminQueryKeys.workflowPublishValidation(workflowId, revision),
    queryFn: () => validateWorkflowDraft(workflowId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  // Com alteração pendente, a resposta guardada fala de um rascunho que já mudou: mostrá-la esconderia "Alterações não salvas".
  const backendIssue: GraphIssue | null = !isDirty && query.data && !query.data.valid && query.data.error ? { nodeId: query.data.error.nodeId ?? "", message: query.data.error.message } : null

  let status: PublishValidationStatus
  if (isDirty) status = "stale"
  else if (localIssueCount > 0) status = "blocked_local"
  else if (query.isPending || query.isFetching) status = "validating"
  else if (query.isError) status = "error"
  else if (query.data?.valid) status = "ready"
  else status = "invalid"

  return { status, backendIssue, revalidate: () => void query.refetch() }
}

/** Problemas locais + o do backend numa lista só, sem repetir a mesma mensagem no mesmo nó. */
export function combineIssues(localIssues: GraphIssue[], backendIssue: GraphIssue | null): GraphIssue[] {
  if (!backendIssue) return localIssues
  const duplicate = localIssues.some((issue) => issue.nodeId === backendIssue.nodeId && issue.message === backendIssue.message)
  return duplicate ? localIssues : [...localIssues, backendIssue]
}
