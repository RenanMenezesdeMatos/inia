"use client"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusChip } from "@/components/ui/surface"
import { UniverseBadge } from "@/components/operating-universe/universe-badge"
import { cn } from "@/lib/utils"
import { AGENT_TYPE_LABELS, type AgentType } from "@/schemas/admin/agent.schema"
import type { KnowledgeLinkCandidate } from "@/schemas/admin/agent-knowledge-links.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

import { knowledgeLinkStatusOf } from "./knowledge-agents-status"

export const agentScopeLabelOf = (agent: Pick<KnowledgeLinkCandidate, "scopeType" | "teamName" | "subteamName">) =>
  agent.scopeType === "ALL_TEAMS" ? "Todos os grupos" : agent.scopeType === "SUBTEAM" ? `Subgrupo ${agent.subteamName ?? "—"}` : `Grupo ${agent.teamName ?? "—"}`

/**
 * Um agente na lista da base, nos moldes da linha do seletor de bases do agente: caixa de marcar com o nome (nome acessível), selos de
 * situação e uma linha com tipo, alcance e universo. `changed` = a pessoa mexeu nele e ainda não gravou. Bloqueado não marca e diz por quê.
 */
export function KnowledgeAgentRow({ agent, checked, changed, onToggle }: { agent: KnowledgeLinkCandidate; checked: boolean; changed: boolean; onToggle: (checked: boolean) => void }) {
  const id = `knowledge-agent-${agent.id}`
  const status = knowledgeLinkStatusOf(agent)
  const disabled = agent.block !== null
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors",
        !disabled && "hover:border-primary/40",
        checked && "border-primary/40 bg-primary/5",
        changed && "ring-1 ring-amber-500/50",
        disabled && "opacity-70",
      )}
      data-testid="knowledge-agent-option"
    >
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onToggle(value === true)} className="mt-0.5" aria-describedby={`${id}-details`} />
      <label htmlFor={id} className={cn("min-w-0 flex-1", !disabled && "cursor-pointer")}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium leading-snug">{agent.name}</span>
          <UniverseBadge universe={agent.operatingUniverse as OperatingUniverse | null} />
          {status ? <StatusChip tone={status.tone}>{status.label}</StatusChip> : null}
          {changed ? <StatusChip tone="warning">{checked ? "Será ligado" : "Será desligado"}</StatusChip> : null}
          {!agent.published ? <Badge variant="outline">Não publicado</Badge> : null}
          {!agent.active ? <Badge variant="outline">Inativo</Badge> : null}
          {agent.draft.otherChanges ? <Badge variant="outline" title={agent.draft.updatedByName ? `Rascunho salvo por ${agent.draft.updatedByName}` : undefined}>Rascunho com outras alterações</Badge> : null}
        </span>
        <span id={`${id}-details`} className="mt-0.5 block text-xs text-muted-foreground">
          {AGENT_TYPE_LABELS[agent.agentType as AgentType] ?? agent.agentType} · {agentScopeLabelOf(agent)}
          {agent.blockMessage ? <span className="block text-destructive">{agent.blockMessage}</span> : null}
        </span>
      </label>
    </li>
  )
}
