"use client"

import { useEffect, useState } from "react"
import { RotateCcw } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/ui/states"

import { formatDateTime } from "@/lib/format/date"
import { useAgentPublishImpactQuery, useAgentVersionQuery, useAgentVersionsQuery, useRevertAgentMutation } from "@/queries/admin/use-agent-queries"
import { AGENT_TYPE_LABELS, AGENT_VERSION_ORIGIN_LABELS, type Agent, type AgentConfig, type AgentVersion } from "@/schemas/admin/agent.schema"

import { PublishImpactDetails } from "./publish-dialog"
import { RESTRICTED_DRAFT_REVERT_REASON, RESTRICTED_VERSION_REASON, RestrictedConfigNotice, UnavailableAction } from "./restricted-config"

/** Conteúdo de uma configuração (versão publicada ou conteúdo testado) — só leitura. */
export function AgentConfigSummary({ config }: { config: AgentConfig }) {
  const rows: [string, string][] = [
    ["Nome", config.name],
    ["Tipo", AGENT_TYPE_LABELS[config.agentType] ?? config.agentType],
    ["Objetivo", config.objective],
    ["Descrição", config.description],
    ["Bases de conhecimento", `${config.knowledgeDocumentIds.length} selecionada(s)`],
    ["Limites de atuação", config.actionLimitsEnabled ? (config.actionLimits ?? "") : "Desligados"],
  ]
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
      <div>
        <dt className="text-xs font-medium text-muted-foreground">Contexto</dt>
        <dd className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{config.contextPrompt}</dd>
      </div>
    </dl>
  )
}

function VersionContent({ agentId, versionId }: { agentId: string; versionId: string }) {
  const versionQuery = useAgentVersionQuery(agentId, versionId)
  if (versionQuery.isLoading) return <Skeleton className="h-24 w-full" />
  if (!versionQuery.data) return <p className="text-sm text-destructive">Não foi possível carregar esta versão.</p>
  if (!versionQuery.data.config) return <RestrictedConfigNotice />
  return <AgentConfigSummary config={versionQuery.data.config} />
}

/** Prévia da reversão: a mesma da publicação, comparando a versão escolhida com a vigente. Só existe com o diálogo aberto. */
function RevertImpact({ agentId, versionId, onLoaded }: { agentId: string; versionId: string; onLoaded: (ready: boolean) => void }) {
  const impactQuery = useAgentPublishImpactQuery(agentId, versionId)
  const ready = Boolean(impactQuery.data)
  useEffect(() => onLoaded(ready), [ready, onLoaded])
  if (impactQuery.data) return <PublishImpactDetails impact={impactQuery.data} />
  if (impactQuery.isError) {
    return (
      <InlineError message="Não foi possível carregar quem usa este agente e o que muda. Sem essa conferência, a reversão fica indisponível." onRetry={() => void impactQuery.refetch()} />
    )
  }
  return (
    <div className="space-y-2" aria-label="Conferindo quem usa este agente e o que muda">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}

/**
 * Reverter (PEN-002, item 7; PEN-050): publica de novo a configuração de uma versão anterior como versão NOVA — nenhuma versão é
 * apagada ou alterada. Com rascunho em andamento, só com a confirmação explícita de descartá-lo. Como toda publicação, mostra antes
 * os consumidores afetados e as mudanças em bases, ferramentas, alcance e limites (condição de segurança da revisão de 03/11/2026).
 */
function RevertButton({ agent, version }: { agent: Agent; version: AgentVersion }) {
  // O servidor recusaria: a versão é de outro alcance, ou reverter descartaria um rascunho de outro alcance.
  const unavailable = version.restricted ? RESTRICTED_VERSION_REASON : agent.draft?.restricted ? RESTRICTED_DRAFT_REVERT_REASON : null
  if (unavailable) {
    return (
      <UnavailableAction reason={unavailable}>
        <Button size="sm" variant="outline" disabled>
          <RotateCcw className="h-3.5 w-3.5" /> Reverter para esta versão
        </Button>
      </UnavailableAction>
    )
  }
  return <RevertDialog agent={agent} version={version} />
}

function RevertDialog({ agent, version }: { agent: Agent; version: AgentVersion }) {
  const [open, setOpen] = useState(false)
  const [discardDraft, setDiscardDraft] = useState(false)
  const [impactReady, setImpactReady] = useState(false)
  const revertMutation = useRevertAgentMutation()
  const needsConfirmation = agent.hasDraft
  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setDiscardDraft(false); setImpactReady(false) } }}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RotateCcw className="h-3.5 w-3.5" /> Reverter para esta versão
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Reverter para a versão {version.number}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                A configuração da versão {version.number} será publicada como uma versão nova, que passa a ser a vigente: vale nas próximas execuções do chat, da voz, dos
                Workflows e dos orquestradores que usam este agente, sem republicá-los. As versões anteriores continuam disponíveis e iguais.
              </p>
              {needsConfirmation ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <p className="text-sm">Há um rascunho em andamento{agent.draftUpdatedByName ? ` (salvo por ${agent.draftUpdatedByName}${agent.draftUpdatedAt ? ` em ${formatDateTime(agent.draftUpdatedAt)}` : ""})` : ""}. Reverter descarta esse rascunho.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Checkbox id={`discard-${version.id}`} checked={discardDraft} onCheckedChange={(checked) => setDiscardDraft(checked === true)} />
                    <Label htmlFor={`discard-${version.id}`} className="text-sm">Descartar o rascunho em andamento</Label>
                  </div>
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-[45vh] min-w-0 overflow-y-auto">
          <RevertImpact agentId={agent.id} versionId={version.id} onLoaded={setImpactReady} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            disabled={!impactReady || revertMutation.isPending || (needsConfirmation && !discardDraft)}
            onClick={async () => {
              try {
                await revertMutation.mutateAsync({ id: agent.id, versionId: version.id, discardDraft, expectedDraftRevision: agent.draftRevision })
                setOpen(false)
              } catch {
                // Rascunho surgido no meio (409): o aviso acima aparece com os dados atualizados.
              }
            }}
          >
            {revertMutation.isPending ? "Revertendo..." : "Publicar como versão nova"}
          </Button>
        </AlertDialogFooter>
        {revertMutation.error ? <p className="text-sm text-destructive">{revertMutation.error.message}</p> : null}
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function AgentVersionsPanel({ agent }: { agent: Agent }) {
  const versionsQuery = useAgentVersionsQuery(agent.id)
  const [openId, setOpenId] = useState<string | null>(null)

  if (versionsQuery.isLoading) return <Skeleton className="h-40 w-full" />
  if (versionsQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar as versões.</p>
  if (!versionsQuery.data?.length) return <p className="text-sm text-muted-foreground">Este agente ainda não foi publicado: só existe o rascunho, que pode ser testado.</p>

  return (
    <div className="space-y-3">
      {versionsQuery.data.map((version) => (
        <div key={version.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Versão {version.number}</span>
            {version.current ? <Badge>Vigente</Badge> : null}
            <Badge variant="outline">{version.origin === "REVERT" && version.revertedFromNumber ? `Reversão da versão ${version.revertedFromNumber}` : AGENT_VERSION_ORIGIN_LABELS[version.origin]}</Badge>
            <span className="text-xs text-muted-foreground">
              {version.publishedByName} · {formatDateTime(version.publishedAt)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {version.restricted ? (
                <RestrictedConfigNotice />
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === version.id ? null : version.id)}>
                  {openId === version.id ? "Ocultar configuração" : "Ver configuração"}
                </Button>
              )}
              {version.current ? null : <RevertButton agent={agent} version={version} />}
            </div>
          </div>
          {openId === version.id && !version.restricted ? (
            <div className="mt-3 border-t pt-3">
              <VersionContent agentId={agent.id} versionId={version.id} />
            </div>
          ) : null}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Versões publicadas não mudam: qualquer alteração vai para o rascunho, que nunca afeta produção, e só vale ao publicar uma versão nova — que passa a ser a vigente
        para todos os consumidores.
      </p>
    </div>
  )
}
