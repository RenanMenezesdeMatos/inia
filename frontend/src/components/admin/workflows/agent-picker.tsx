"use client"

import { useMemo, useState } from "react"
import { Check, Search } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

import { AGENT_TYPE_ICONS } from "@/components/admin/agents/agent-visuals"
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, type Agent, type AgentType } from "@/schemas/admin/agent.schema"
import { describeSpecialty, resolveAgentSpecialty } from "@/schemas/admin/orchestrator-policy"
import { cn } from "@/lib/utils"

const TOP_PER_GROUP = 3

type AgentGroup = { type: AgentType; agents: Agent[] }

/** Agrupa por tipo na ordem em que cada tipo aparece pela primeira vez na lista (que já vem
 * ordenada por uso do backend) — assim um tipo novo (ex.: "E-mail") simplesmente ganha sua
 * própria seção sem precisar tocar neste componente. */
function groupByType(agents: Agent[]): AgentGroup[] {
  const groups: AgentGroup[] = []
  const index = new Map<AgentType, AgentGroup>()
  for (const agent of agents) {
    let group = index.get(agent.agentType)
    if (!group) {
      group = { type: agent.agentType, agents: [] }
      index.set(agent.agentType, group)
      groups.push(group)
    }
    group.agents.push(agent)
  }
  return groups
}

function AgentTypeIcon({ type }: { type: Agent["agentType"] }) {
  const Icon = AGENT_TYPE_ICONS[type]
  const colors = AGENT_TYPE_COLORS[type]
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", colors.iconBg)}>
      <Icon className={cn("h-3.5 w-3.5", colors.icon)} />
    </span>
  )
}

function formatCreatedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function AgentRow({ agent, selected, disabledReason, onSelect }: { agent: Agent; selected: boolean; disabledReason: string | null; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabledReason !== null}
      title={disabledReason ?? undefined}
      aria-disabled={disabledReason !== null}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
        selected && "bg-primary/5",
        disabledReason !== null && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
    >
      <AgentTypeIcon type={agent.agentType} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{agent.name}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {disabledReason ?? `${describeSpecialty(resolveAgentSpecialty(agent))} · Criado por ${agent.createdByName ?? "—"} em ${formatCreatedAt(agent.createdAt)}`}
        </span>
      </span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
    </button>
  )
}

/**
 * Picker de agente no estilo Power Automate: o campo é a própria busca, e a lista de agentes
 * (agrupada por tipo, em linhas, com scroll própria) já vem aberta no corpo do painel. Depois
 * de escolher, o campo colapsa pra mostrar ícone + nome do agente selecionado — clicar nele de
 * novo reabre a busca. Cada grupo mostra só os 3 mais usados; havendo mais, um accordion
 * revela o resto sem busca ativa.
 */
export function AgentPicker({
  agents,
  value,
  onChange,
  disabledReason,
}: {
  agents: Agent[]
  value: string
  onChange: (agentId: string) => void
  /** Agente que não pode ser escolhido aqui (ex.: especialista de outro domínio numa política de
   * Orquestrador) fica visível, desabilitado, com o motivo no lugar da linha de criação. */
  disabledReason?: (agent: Agent) => string | null
}) {
  const [search, setSearch] = useState("")
  const [showList, setShowList] = useState(!value)
  const selected = agents.find((agent) => agent.id === value)
  // Valor trocado por fora: a lista acompanha (fechada com agente escolhido, aberta sem).
  const [syncedValue, setSyncedValue] = useState(value)
  if (syncedValue !== value) {
    setSyncedValue(value)
    setShowList(!value)
  }

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    return groupByType(agents)
      .map((group) => {
        const filtered = term ? group.agents.filter((agent) => agent.name.toLowerCase().includes(term)) : group.agents
        return term
          ? { type: group.type, visible: filtered, extra: [] as Agent[] }
          : { type: group.type, visible: filtered.slice(0, TOP_PER_GROUP), extra: filtered.slice(TOP_PER_GROUP) }
      })
      .filter((group) => group.visible.length > 0 || group.extra.length > 0)
  }, [agents, search])

  function selectAgent(agentId: string) {
    onChange(agentId)
    setSearch("")
  }

  return (
    <div className="space-y-2">
      {showList ? (
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              setSearch("")
              if (value) setShowList(false)
              event.currentTarget.blur()
            }}
            placeholder="Buscar agente..."
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowList(true)}
          className="flex h-8 w-full items-center gap-2 rounded-md border px-2 text-left text-sm hover:bg-muted"
        >
          {selected ? (
            <>
              <AgentTypeIcon type={selected.agentType} />
              <span className="min-w-0 flex-1 truncate">{selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Selecione o agente</span>
          )}
        </button>
      )}

      {/* O Radix envolve o conteúdo num `display: table` que ignora a largura disponível: sem o `block`, nomes longos não truncam
          e empurram o contêiner (o diálogo "Novo orquestrador" escondia o botão de criar). */}
      {showList ? (
        <ScrollArea className="h-64 rounded-md border [&_[data-slot=scroll-area-viewport]>div]:!block">
          <div className="space-y-3 p-3">
            {groups.length === 0 ? <p className="py-3 text-center text-sm text-muted-foreground">Nenhum agente encontrado.</p> : null}
            {groups.map((group) => (
              <div key={group.type} className="space-y-1">
                <h4 className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{AGENT_TYPE_LABELS[group.type]}</h4>
                {group.visible.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} selected={agent.id === value} disabledReason={disabledReason?.(agent) ?? null} onSelect={() => selectAgent(agent.id)} />
                ))}
                {group.extra.length > 0 ? (
                  <Accordion type="single" collapsible>
                    <AccordionItem value={group.type} className="border-0">
                      <AccordionTrigger className="px-2 py-1.5 text-xs font-normal text-muted-foreground hover:no-underline">
                        Ver mais {group.extra.length}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-1 pb-0">
                        {group.extra.map((agent) => (
                          <AgentRow key={agent.id} agent={agent} selected={agent.id === value} disabledReason={disabledReason?.(agent) ?? null} onSelect={() => selectAgent(agent.id)} />
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  )
}
