"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, ExternalLink, Send } from "lucide-react"

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
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/ui/states"

import { cn } from "@/lib/utils"
import { useAgentPublishImpactQuery, usePublishAgentMutation } from "@/queries/admin/use-agent-queries"
import {
  AGENT_REFERENCE_KIND_LABELS,
  AGENT_REFERENCE_STATUS_LABELS,
  type Agent,
  type AgentPublishConsumer,
  type AgentPublishImpact,
} from "@/schemas/admin/agent.schema"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

const consumerNoun = (consumer: AgentPublishConsumer) => (consumer.kind === "WORKFLOW" ? "Workflow" : "orquestrador")

/** Um consumidor que a pessoa pode consultar: nome, tipo, status, onde usa o agente, link — e o aviso de quem perde o acesso. */
function ConsumerItem({ consumer }: { consumer: AgentPublishConsumer }) {
  return (
    <li
      className={cn("rounded-md border px-2.5 py-2", consumer.losesAccess && "border-destructive/40 bg-destructive/5")}
      data-testid="publish-consumer"
      data-loses-access={consumer.losesAccess || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{consumer.name}</span>
        <Badge variant="outline">{AGENT_REFERENCE_KIND_LABELS[consumer.kind]}</Badge>
        <Badge variant={consumer.status === "ACTIVE" ? "secondary" : "outline"}>{AGENT_REFERENCE_STATUS_LABELS[consumer.status]}</Badge>
        {consumer.losesAccess ? (
          <Badge variant="destructive" data-testid="publish-loses-access">
            <AlertTriangle /> Perde o acesso
          </Badge>
        ) : null}
        <Link href={consumer.link} className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2">
          Ver {consumerNoun(consumer)} <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      {consumer.usages.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {consumer.kind === "WORKFLOW" ? "Etapa" : "Papel"}: {consumer.usages.join(", ")}
        </p>
      ) : null}
      {consumer.losesAccess ? (
        <p className="mt-1 text-xs text-destructive">
          O alcance da versão nova não cobre este {consumerNoun(consumer)}: as execuções dele que chamarem o agente passam a ser bloqueadas. Publicar nunca amplia o acesso.
        </p>
      ) : null}
    </li>
  )
}

/** Uma linha de "O que muda": destacada quando a mudança é sensível (bases, ferramentas, alcance, limites). */
function ChangeRow({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-sm" data-testid={testId}>
      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

function AddedRemoved({ added, removed }: { added: string[]; removed: string[] }) {
  return (
    <ul className="space-y-0.5">
      {added.map((item) => (
        <li key={`+${item}`}>
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Inclui:</span> {item}
        </li>
      ))}
      {removed.map((item) => (
        <li key={`-${item}`}>
          <span className="font-medium text-destructive">Remove:</span> {item}
        </li>
      ))}
    </ul>
  )
}

function Transition({ from, to }: { from: string; to: string }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      <dt className="text-muted-foreground">Hoje:</dt>
      <dd className="whitespace-pre-wrap">{from}</dd>
      <dt className="text-muted-foreground">Passa a ser:</dt>
      <dd className="font-medium whitespace-pre-wrap">{to}</dd>
    </dl>
  )
}

/** Mudanças em relação à versão vigente: as sensíveis em destaque, os demais campos alterados só nomeados. */
function PublishChanges({ impact }: { impact: AgentPublishImpact }) {
  const { knowledge, tools, scope, limits, otherFields } = impact.changes
  const knowledgeChanged = knowledge.added.length > 0 || knowledge.removed.length > 0
  const toolsChanged = tools.added.length > 0 || tools.removed.length > 0
  const sensitive = knowledgeChanged || toolsChanged || scope !== null || limits !== null
  return (
    <div className="space-y-2" data-testid="publish-changes">
      {knowledgeChanged ? (
        <ChangeRow label="Bases de conhecimento" testId="publish-change-knowledge">
          <AddedRemoved added={knowledge.added.map((item) => item.title)} removed={knowledge.removed.map((item) => item.title)} />
        </ChangeRow>
      ) : null}
      {toolsChanged ? (
        <ChangeRow label="Ferramentas de investigação" testId="publish-change-tools">
          <AddedRemoved added={tools.added} removed={tools.removed} />
        </ChangeRow>
      ) : null}
      {scope ? (
        <ChangeRow label="Alcance" testId="publish-change-scope">
          <Transition from={scope.from} to={scope.to} />
        </ChangeRow>
      ) : null}
      {limits ? (
        <ChangeRow label="Limites de atuação" testId="publish-change-limits">
          <Transition from={limits.from} to={limits.to} />
        </ChangeRow>
      ) : null}
      {sensitive ? null : <p className="text-sm text-muted-foreground">Sem mudança em bases de conhecimento, ferramentas, alcance ou limites de atuação.</p>}
      {otherFields.length > 0 ? (
        <p className="text-sm" data-testid="publish-change-other">
          <span className="text-muted-foreground">Outros campos alterados:</span> {otherFields.join(", ")}
        </p>
      ) : null}
    </div>
  )
}

export function PublishImpactDetails({ impact }: { impact: AgentPublishImpact }) {
  return (
    <div className="space-y-4">
      <Section title="Quem usa este agente">
        {impact.consumers.length > 0 ? (
          <ul className="space-y-1.5 text-sm" data-testid="publish-consumers">
            {impact.consumers.map((consumer) => (
              <ConsumerItem key={`${consumer.kind}:${consumer.id}`} consumer={consumer} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum Workflow ou orquestrador que você pode consultar usa este agente.</p>
        )}
        {impact.hasRestrictedConsumers ? (
          <p className="rounded-md bg-muted px-2.5 py-2 text-xs" data-testid="publish-restricted">
            Existem outros consumidores que você não tem permissão para consultar.
          </p>
        ) : null}
      </Section>
      <Section title={impact.currentVersionNumber ? `O que muda em relação à versão ${impact.currentVersionNumber}` : "O que passa a valer"}>
        <PublishChanges impact={impact} />
      </Section>
    </div>
  )
}

/** Corpo do diálogo: só existe aberto, então cada abertura busca a prévia de novo (consumidores e mudanças podem ter mudado). */
function PublishDialogBody({ agent, onConflict, onClose }: { agent: Agent; onConflict: (error: unknown) => void; onClose: () => void }) {
  const impactQuery = useAgentPublishImpactQuery(agent.id)
  const publishMutation = usePublishAgentMutation()
  const impact = impactQuery.data ?? null
  const nextVersion = impact?.nextVersionNumber ?? (agent.currentVersionNumber ?? 0) + 1
  const currentVersion = impact ? impact.currentVersionNumber : agent.currentVersionNumber

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Publicar a versão {nextVersion}?</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-2" data-testid="publish-effect">
            <p>
              {currentVersion ? `A versão ${nextVersion} substitui a vigente (versão ${currentVersion})` : `A versão ${nextVersion} passa a ser a vigente`} e vale nas próximas execuções do chat,
              da voz, dos Workflows e dos orquestradores que usam este agente, sem republicá-los. O rascunho salvo vira essa versão, que não pode mais ser alterada.
            </p>
            {agent.active ? null : <p className="font-medium">O agente está inativo e continua assim: publicar não o reativa.</p>}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="max-h-[55vh] min-w-0 overflow-y-auto">
        {impact ? (
          <PublishImpactDetails impact={impact} />
        ) : impactQuery.isError ? (
          <InlineError message="Não foi possível carregar quem usa este agente e o que muda. Sem essa conferência, a publicação fica indisponível." onRetry={() => void impactQuery.refetch()} />
        ) : (
          <div className="space-y-2" aria-label="Conferindo quem usa este agente e o que muda">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <Button
          disabled={!impact || publishMutation.isPending}
          onClick={async () => {
            try {
              await publishMutation.mutateAsync({ id: agent.id, expectedDraftRevision: agent.draftRevision })
            } catch (error) {
              onConflict(error)
            } finally {
              onClose()
            }
          }}
        >
          {publishMutation.isPending ? "Publicando..." : `Publicar versão ${nextVersion}`}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/**
 * "Publicar" (revisão aprovada da PEN-002/PEN-076, 03/11/2026): a versão nova vira a VIGENTE para as próximas execuções de todos
 * os consumidores, sem republicá-los. Condição de segurança: antes de confirmar, a pessoa vê os consumidores afetados que pode
 * consultar (com quem perderia o acesso pelo alcance novo), o aviso dos que não pode, e as mudanças em bases, ferramentas,
 * alcance e limites. Sem essa prévia carregada, o botão de confirmar fica desabilitado.
 */
export function PublishAgentDialog({ agent, onConflict }: { agent: Agent; onConflict: (error: unknown) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm">
          <Send className="h-3.5 w-3.5" /> Publicar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:sm:max-w-xl">
        <PublishDialogBody agent={agent} onConflict={onConflict} onClose={() => setOpen(false)} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
