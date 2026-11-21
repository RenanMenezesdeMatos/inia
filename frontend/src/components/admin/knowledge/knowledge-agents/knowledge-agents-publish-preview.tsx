"use client"

import { PublishImpactDetails } from "@/components/admin/agents/agent-lifecycle/publish-dialog"
import { StatusChip } from "@/components/ui/surface"
import { cn } from "@/lib/utils"
import { KNOWLEDGE_LINK_OUTCOME_LABELS, type KnowledgeLinksPreview, type KnowledgeLinksResult } from "@/schemas/admin/agent-knowledge-links.schema"

/** Resumo do que aconteceu, para o aviso depois de gravar. */
export function knowledgeLinksSummary(result: Pick<KnowledgeLinksResult, "results">): string {
  const count = (outcome: string) => result.results.filter((item) => item.outcome === outcome).length
  const parts = [
    count("PUBLISHED") ? `${count("PUBLISHED")} publicado(s)` : null,
    count("DRAFT_SAVED") ? `${count("DRAFT_SAVED")} salvo(s) no rascunho` : null,
    count("DRAFT_ONLY_OTHER_CHANGES") ? `${count("DRAFT_ONLY_OTHER_CHANGES")} só no rascunho (outras alterações pendentes: publique pela tela do agente)` : null,
  ].filter(Boolean)
  return parts.length ? `Agentes atualizados: ${parts.join(" · ")}.` : "Nada mudou nos agentes."
}

/** Conferência antes de publicar: o resultado em cada agente e, para quem publica, quem usa o agente e o que muda. */
export function KnowledgeAgentsPublishPreview({ preview }: { preview: KnowledgeLinksPreview }) {
  return (
    <ul className="space-y-2" data-testid="knowledge-agents-preview">
      {preview.agents.map((agent) => (
        <li key={agent.agentId} className={cn("rounded-xl border bg-card px-3 py-2.5", agent.problem && "border-destructive/40 bg-destructive/5")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            {agent.outcome ? (
              <StatusChip tone={agent.outcome === "PUBLISHED" ? "success" : agent.outcome === "DRAFT_ONLY_OTHER_CHANGES" ? "warning" : "neutral"}>
                {agent.outcome === "PUBLISHED" && agent.impact ? `Publica a versão ${agent.impact.nextVersionNumber}` : KNOWLEDGE_LINK_OUTCOME_LABELS[agent.outcome]}
              </StatusChip>
            ) : null}
          </div>
          {agent.problem ? <p className="mt-1 text-xs text-destructive">{agent.problem.message}</p> : null}
          {agent.outcome === "PUBLISHED" && agent.firstPublication ? (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Primeira publicação deste agente: tudo o que está no rascunho dele passa a valer, não só a base.</p>
          ) : null}
          {agent.outcome === "DRAFT_ONLY_OTHER_CHANGES" ? (
            <p className="mt-1 text-xs text-muted-foreground">O rascunho deste agente tem outras alterações ainda não publicadas. A base entra só no rascunho; publique pela tela do agente, onde você vê tudo o que vai junto.</p>
          ) : null}
          {agent.impact ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-primary">Quem usa este agente e o que muda</summary>
              <div className="mt-2"><PublishImpactDetails impact={agent.impact} /></div>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
