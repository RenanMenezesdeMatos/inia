"use client"

import Link from "next/link"
import { ArrowDown, Bot } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/ui/states"
import { SettingsSection, StatusChip } from "@/components/ui/surface"
import { useAgentKnowledgeLinksQuery } from "@/queries/admin/use-agent-queries"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"

import { KNOWLEDGE_AGENTS_ANCHOR, OPEN_KNOWLEDGE_AGENTS_EVENT } from "./knowledge-agents-picker"
import { agentHref, knowledgeLinkStatusOf } from "./knowledge-agents-status"

const PREVIEW_SIZE = 5

/**
 * "Agentes" na lateral do editor da base: um resumo — quantos agentes consultam a base e os primeiros deles — e o atalho para o cartão
 * "Agentes que consultam esta base", embaixo do editor, onde se escolhe e grava (com busca, filtros e paginação). Só para quem
 * administra agentes.
 */
export function KnowledgeAgentsSection({ documentId, archived = false }: { documentId: string | null; archived?: boolean }) {
  const canManageAgents = (useCurrentUserQuery().data?.access.permissions ?? []).includes("agents.manage")
  const linksQuery = useAgentKnowledgeLinksQuery(canManageAgents && documentId ? { knowledgeDocumentId: documentId, tab: "LINKED", page: 1, pageSize: PREVIEW_SIZE } : null)
  if (!canManageAgents) return null
  if (documentId === null) {
    return (
      <SettingsSection title="Agentes" icon={Bot}>
        <p className="text-sm text-muted-foreground">Salve a base para escolher aqui mesmo os agentes que vão consultá-la.</p>
      </SettingsSection>
    )
  }
  const data = linksQuery.data
  const linked = data?.items ?? []
  const more = (data?.counts.linked ?? 0) - linked.length
  return (
    <SettingsSection title="Agentes" icon={Bot}>
      {linksQuery.isPending ? (
        <div className="space-y-2" aria-label="Carregando agentes"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-2/3" /></div>
      ) : linksQuery.isError ? (
        <InlineError message="Não foi possível carregar os agentes desta base." onRetry={() => void linksQuery.refetch()} />
      ) : (
        <div className="space-y-2.5">
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum agente consulta esta base.</p>
          ) : (
            <ul className="space-y-1.5" data-testid="knowledge-linked-agents">
              {linked.map((agent) => {
                const status = knowledgeLinkStatusOf(agent)
                return (
                  <li key={agent.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={agentHref(agent.id)} target="_blank" rel="noopener" title="Abrir o agente em outra aba" className="min-w-0 truncate underline-offset-2 hover:underline">{agent.name}</Link>
                    {status ? <StatusChip tone={status.tone} className="shrink-0">{status.label}</StatusChip> : null}
                  </li>
                )
              })}
              {more > 0 ? <li className="text-xs text-muted-foreground">e mais {more}</li> : null}
            </ul>
          )}
          {/* Base arquivada não mostra o cartão de escolha (run-8, QA-06): o atalho também some. */}
          {archived ? <p className="text-xs text-muted-foreground">Base arquivada: reative-a para escolher agentes.</p> : <Button type="button" size="sm" variant="outline" className="w-full" asChild>
            <a href={`#${KNOWLEDGE_AGENTS_ANCHOR}`} onClick={() => window.dispatchEvent(new Event(OPEN_KNOWLEDGE_AGENTS_EVENT))}><ArrowDown data-icon="inline-start" />Escolher agentes</a>
          </Button>}
        </div>
      )}
    </SettingsSection>
  )
}
