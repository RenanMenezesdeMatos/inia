"use client"

import { useId, useState, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useConfirmWorkflowRetryMutation, useWorkflowRetryPreviewQuery } from "@/queries/admin/use-workflow-queries"
import { ENROLLMENT_BLOCKED_REASON_LABELS, enrollmentStatusLabel } from "@/schemas/admin/workflow.schema"
import {
  RETRY_AGENT_ROLE_LABELS,
  WORKFLOW_RETRY_RECONFIRM,
  workflowRetryRefusalFrom,
  type WorkflowRetryPreview,
  type WorkflowRetryRefusal,
} from "@/schemas/admin/workflow-retry.schema"

import { blockedReasonText, blockReasonOf, shortExecutionId, vigenteVersionText, type BlockReason } from "./enrollment-format"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

function ItemList({ items, empty, testId }: { items: { key: string; content: ReactNode }[]; empty: string; testId: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-1 text-sm" data-testid={testId}>
      {items.map((item) => (
        <li key={item.key} className="rounded-md bg-muted/50 px-2 py-1">
          {item.content}
        </li>
      ))}
    </ul>
  )
}

function InactiveBadge() {
  return (
    <Badge variant="outline" className="ml-0.5 border-amber-500/40 text-amber-800 dark:text-amber-300">
      inativo
    </Badge>
  )
}

/** Onde a tentativa começa — mesma versão, versão nova, ou execução de um colaborador de "Selecionar colaboradores" numa versão nova. */
function startsAtText(preview: WorkflowRetryPreview, blockedStep: string): string {
  if (preview.startsAt === "BLOCKED_STEP") return `Continua da etapa bloqueada (“${blockedStep}”), com os resultados das etapas já concluídas.`
  if (preview.startsAt === "AFTER_FAN_OUT") {
    return "Recomeça logo depois do envio para vários colaboradores (“Selecionar colaboradores”), só para o colaborador desta execução, e reavalia as etapas seguintes na versão vigente — porque ela é diferente da versão da execução original."
  }
  return "Recomeça do início (Gatilho) e reavalia todas as etapas na versão vigente, porque ela é diferente da versão da execução original."
}

/** Vínculo da tentativa com a execução principal de "Selecionar colaboradores" e se o resultado entra no consolidado. */
function FanOutLink({ fanOut }: { fanOut: NonNullable<WorkflowRetryPreview["fanOut"]> }) {
  return (
    <div className="space-y-0.5 text-sm" data-testid="retry-fan-out">
      <p>
        Esta é a execução de um colaborador de “Selecionar colaboradores”: a nova tentativa fica ligada à mesma execução principal (
        <span className="font-medium">{shortExecutionId(fanOut.parentEnrollmentId)}</span>).
      </p>
      <p className={fanOut.joinsConsolidation ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300"}>
        {fanOut.joinsConsolidation
          ? "O resultado dela entra no resultado consolidado: a execução principal ainda aguarda em “Consolidar resultados”."
          : `O resultado dela não entra no resultado consolidado: a execução principal não está aguardando em “Consolidar resultados” (situação: ${enrollmentStatusLabel(fanOut.parentStatus)}).`}
      </p>
    </div>
  )
}

/** O que a nova tentativa usará se confirmada agora — versão, agentes, orquestradores, destinos, aprovações e ponto de partida. */
function RetryPreviewDetails({ preview, reason }: { preview: WorkflowRetryPreview; reason: BlockReason }) {
  const blockedStep = preview.blockedNode.label ?? "etapa bloqueada"
  const version = preview.workflowVersion
  return (
    <div className="space-y-3" data-testid="retry-preview">
      <p className="text-sm" data-testid="retry-blocked-step">
        Parou em <span className="font-medium">“{blockedStep}”</span> — {blockedReasonText(reason, preview.blockedNode)}.
      </p>

      <Section title="Versão do Workflow">
        <p className="text-sm" data-testid="retry-version">
          {version ? (
            <>
              <span className="font-medium">Versão {version.number}</span> (publicada e vigente)
              {version.number !== preview.originalVersion.number ? ` — a execução original começou na versão ${preview.originalVersion.number} e continua nela.` : " — a mesma da execução original."}
            </>
          ) : (
            "Nenhuma versão publicada."
          )}
        </p>
      </Section>

      <Section title="Onde começa">
        <p className="text-sm" data-testid="retry-starts-at">
          {startsAtText(preview, blockedStep)}
        </p>
        {preview.fanOut ? <FanOutLink fanOut={preview.fanOut} /> : null}
      </Section>

      <Section title="Agentes">
        <ItemList
          testId="retry-agents"
          empty="Nenhuma etapa chama agente nesta versão."
          items={preview.agents.map((agent) => ({
            key: agent.nodeId,
            content: (
              <span>
                <span className="text-muted-foreground">{agent.nodeLabel}:</span> <span className="font-medium">{agent.agentName ?? "agente não encontrado"}</span>{" "}
                <span className="text-muted-foreground">· {vigenteVersionText(agent.agentVersionNumber)}</span>
                {agent.active === false ? (
                  <>
                    {" "}
                    <InactiveBadge />
                  </>
                ) : null}
              </span>
            ),
          }))}
        />
      </Section>

      {preview.orchestrators.length > 0 ? (
        <Section title="Orquestradores">
          <ItemList
            testId="retry-orchestrators"
            empty=""
            items={preview.orchestrators.map((orchestrator) => ({
              key: orchestrator.nodeId,
              content: (
                <div className="space-y-1">
                  <p>
                    <span className="text-muted-foreground">{orchestrator.nodeLabel}:</span> <span className="font-medium">{orchestrator.orchestratorName ?? "orquestrador não encontrado"}</span>{" "}
                    <span className="text-muted-foreground">
                      · {typeof orchestrator.orchestratorVersionNumber === "number" ? `configuração da versão ${orchestrator.orchestratorVersionNumber}` : "sem versão fixada"}
                    </span>
                  </p>
                  {orchestrator.agents.length > 0 ? (
                    <ul className="space-y-0.5 pl-3 text-xs" data-testid={`retry-orchestrator-agents-${orchestrator.nodeId}`}>
                      {orchestrator.agents.map((agent) => (
                        <li key={`${agent.role}:${agent.agentId}`}>
                          <span className="text-muted-foreground">{RETRY_AGENT_ROLE_LABELS[agent.role]}:</span> {agent.agentName ?? "agente não encontrado"}{" "}
                          <span className="text-muted-foreground">· {vigenteVersionText(agent.agentVersionNumber)}</span>
                          {agent.active === false ? (
                            <>
                              {" "}
                              <InactiveBadge />
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ),
            }))}
          />
        </Section>
      ) : null}

      {preview.agents.length > 0 || preview.orchestrators.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="retry-vigente-note">
          Os agentes rodam na versão vigente no momento da chamada: se alguém publicar uma versão nova depois desta confirmação, a execução usa a nova e o detalhe da
          execução mostra a confirmada e a usada.
        </p>
      ) : null}

      <Section title="Destinos da entrega">
        <ItemList
          testId="retry-destinations"
          empty="Esta versão não entrega nada (não tem etapa de saída)."
          items={preview.destinations.map((destination) => ({
            key: destination.nodeId,
            content: (
              <span>
                <span className="text-muted-foreground">{destination.nodeLabel}:</span> {destination.description}
              </span>
            ),
          }))}
        />
      </Section>

      <Section title="Aprovações">
        <ItemList
          testId="retry-approvals"
          empty="Sem revisão humana nesta versão."
          items={preview.approvals.map((approval) => ({
            key: approval.nodeId,
            content: (
              <span>
                <span className="text-muted-foreground">{approval.nodeLabel}:</span> {approval.description}
              </span>
            ),
          }))}
        />
      </Section>
    </div>
  )
}

/** Corpo do diálogo: só existe com o diálogo aberto, então cada abertura busca a prévia de novo e começa sem recusa anterior. */
function RetryDialogBody({
  workflowId,
  enrollmentId,
  reason,
  onClose,
  onRetried,
}: {
  workflowId: string
  enrollmentId: string
  reason: BlockReason
  onClose: () => void
  onRetried?: (retryEnrollmentId: string) => void
}) {
  const previewQuery = useWorkflowRetryPreviewQuery(workflowId, enrollmentId)
  const confirmMutation = useConfirmWorkflowRetryMutation(workflowId)
  // Prévia que o servidor mandou junto com uma recusa (dados mudaram, Workflow desligado…) — substitui a carregada.
  const [refreshed, setRefreshed] = useState<WorkflowRetryPreview | null>(null)
  const [refusal, setRefusal] = useState<WorkflowRetryRefusal | null>(null)
  const preview = refreshed ?? previewQuery.data ?? null
  const blockers = preview?.blockers ?? []
  const statusId = useId()
  const canConfirm = preview !== null && preview.blockers.length === 0 && !confirmMutation.isPending
  // A mensagem da recusa já aparece na lista de impedimentos quando a prévia nova a traz — não repete.
  const refusalMessage =
    refusal && refusal.code !== WORKFLOW_RETRY_RECONFIRM && !preview?.blockers.some((blocker) => blocker.code === refusal.code) ? refusal.message : null

  function confirm() {
    if (!preview || !canConfirm) return
    setRefusal(null)
    confirmMutation.mutate(
      { enrollmentId, fingerprint: preview.fingerprint },
      {
        onSuccess: (result) => {
          onRetried?.(result.enrollmentId)
          onClose()
        },
        onError: (error) => {
          const handled = workflowRetryRefusalFrom(error)
          if (!handled) return
          if (handled.preview) setRefreshed(handled.preview)
          setRefusal(handled)
        },
      },
    )
  }

  return (
    <>
      <AlertDialogHeader className="shrink-0">
        <AlertDialogTitle>Nova tentativa da execução</AlertDialogTitle>
        <AlertDialogDescription>
          Nada roda até você confirmar. A execução original continua “{ENROLLMENT_BLOCKED_REASON_LABELS[reason]}”, na versão em que começou, e a nova tentativa fica vinculada a ela.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {/* Só os detalhes rolam: o motivo de não poder confirmar fica sempre junto das ações. */}
      {preview ? (
        <div key={preview.fingerprint} className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1" role="region" aria-label="Detalhes da nova tentativa" tabIndex={0} data-testid="retry-details">
          <RetryPreviewDetails preview={preview} reason={reason} />
        </div>
      ) : null}

      {/* Uma região só anuncia o estado, para o leitor de tela não repetir o mesmo aviso. */}
      <div
        id={statusId}
        className="max-h-[30dvh] min-w-0 shrink-0 space-y-2 overflow-y-auto empty:hidden"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={blockers.length > 1 ? 0 : undefined}
        data-testid="retry-action-status"
      >
        {refusal?.code === WORKFLOW_RETRY_RECONFIRM ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm font-medium text-amber-800 dark:text-amber-300" data-testid="retry-reconfirm">
            Os dados mudaram desde que você abriu; confira e confirme de novo.
          </p>
        ) : null}
        {refusalMessage ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" data-testid="retry-refusal">
            {refusalMessage}
          </p>
        ) : null}
        {blockers.length > 0 ? (
          <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" data-testid="retry-blockers">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-4 shrink-0" /> Não é possível confirmar agora
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {blockers.map((blocker) => (
                <li key={`${blocker.code}-${blocker.message}`}>{blocker.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!preview && previewQuery.isError ? (
          <p className="text-sm text-destructive">{previewQuery.error instanceof AdminApiError ? previewQuery.error.message : "Não foi possível carregar o que a nova tentativa usará."}</p>
        ) : null}
        {!preview && !previewQuery.isError ? <p className="text-sm text-muted-foreground">Conferindo a versão, os agentes e os destinos…</p> : null}
      </div>

      <AlertDialogFooter className="shrink-0">
        <AlertDialogCancel disabled={confirmMutation.isPending}>Cancelar</AlertDialogCancel>
        {/* aria-disabled, não disabled: o foco continua no botão quando uma recusa do servidor o desabilita, e o motivo é lido junto. */}
        <Button aria-disabled={!canConfirm} aria-describedby={canConfirm ? undefined : statusId} className={canConfirm ? undefined : "cursor-not-allowed opacity-50"} onClick={confirm}>
          {confirmMutation.isPending ? "Confirmando…" : "Confirmar nova tentativa"}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/**
 * Confirmação da nova tentativa de uma execução bloqueada — por agente inativo, acesso não autorizado ou revisão sem revisor ou sem conteúdo (PEN-073 a PEN-075, P5c). Mostra o
 * que será usado (com a versão VIGENTE de cada agente, inclusive os de cada Orquestrador) e envia a impressão digital do que foi
 * visto; se o servidor disser que mudou, troca pela prévia nova e pede outro clique.
 */
export function WorkflowRetryDialog({
  workflowId,
  enrollmentId,
  blockedReason,
  open,
  onOpenChange,
  onRetried,
}: {
  workflowId: string
  enrollmentId: string
  /** `blockedReason` da execução original — ausente = agente inativo (o motivo original). */
  blockedReason?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetried?: (retryEnrollmentId: string) => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col data-[size=default]:sm:max-w-lg">
        <RetryDialogBody workflowId={workflowId} enrollmentId={enrollmentId} reason={blockReasonOf(blockedReason)} onClose={() => onOpenChange(false)} onRetried={onRetried} />
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Botão "Nova tentativa" + diálogo. Os cliques não chegam à linha da tabela (que expande ao clicar). */
export function RetryExecutionButton({
  workflowId,
  enrollmentId,
  blockedReason,
  onRetried,
}: {
  workflowId: string
  enrollmentId: string
  blockedReason?: string | null
  onRetried?: (retryEnrollmentId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw /> Nova tentativa
      </Button>
      <WorkflowRetryDialog workflowId={workflowId} enrollmentId={enrollmentId} blockedReason={blockedReason} open={open} onOpenChange={setOpen} onRetried={onRetried} />
    </span>
  )
}
