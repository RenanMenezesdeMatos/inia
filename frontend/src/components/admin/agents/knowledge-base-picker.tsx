"use client"

import { useState } from "react"

import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { KnownKnowledgeOptions } from "@/queries/admin/use-agent-knowledge-options-queries"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

import { AvailablePanel } from "./knowledge-base-picker/available-panel"
import { agentKnowledgeScopeOf, optionProblems } from "./knowledge-base-picker/picker-rules"
import { SelectedPanel } from "./knowledge-base-picker/selected-panel"

/**
 * SELETOR DE BASES DO AGENT (substitui o antigo "Disponíveis × Selecionadas" de lista inteira, que não aguentava ~1000 bases). Duas
 * abas: "Ligadas (N)" — as escolhidas, com busca local e o selo do que impede salvar; "Disponíveis" — busca e filtros no servidor
 * (`/admin/agents/knowledge-options`), página por posição e "Ligar as filtradas" com confirmação. Inline no cartão, sem Sheet.
 * A pré-seleção pelo Grupo continua no formulário (ele troca a escolha inteira ao mudar o Grupo, como sempre).
 */
export function KnowledgeBasePicker({
  selectedIds,
  onChange,
  universe,
  orgScope,
  teams,
  known,
  fallbackTitles,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** Universo do agente (nulo = pendente: qualquer universo cabe). */
  universe: OperatingUniverse | null
  orgScope: OrgScopeValue
  teams: readonly Team[] | undefined
  known: KnownKnowledgeOptions
  /** Títulos que o agente já traz, para as escolhidas que ainda carregam ou que quem edita não enxerga. */
  fallbackTitles: ReadonlyMap<string, string>
}) {
  const [tab, setTab] = useState<"selected" | "available">(selectedIds.length ? "selected" : "available")
  const agentScope = agentKnowledgeScopeOf(orgScope)
  const blocking = selectedIds.filter((id) => {
    const option = known.byId.get(id)
    return option ? optionProblems(option, universe, agentScope, teams).length > 0 : false
  }).length

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="selected">
            Ligadas
            <Badge variant="secondary" className="ml-1.5 tabular-nums" data-testid="agent-knowledge-count">
              {selectedIds.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="available">Disponíveis</TabsTrigger>
        </TabsList>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <strong className="font-semibold text-foreground tabular-nums">{selectedIds.length}</strong> {selectedIds.length === 1 ? "base ligada" : "bases ligadas"} a este agente
          {blocking ? <span className="text-destructive"> · {blocking} {blocking === 1 ? "impede" : "impedem"} salvar</span> : null}
        </p>
      </div>
      <TabsContent value="selected">
        <SelectedPanel selectedIds={selectedIds} onChange={onChange} known={known} fallbackTitles={fallbackTitles} universe={universe} agentScope={agentScope} teams={teams} />
      </TabsContent>
      <TabsContent value="available">
        <AvailablePanel selectedIds={selectedIds} onChange={onChange} known={known} universe={universe} agentScope={agentScope} teams={teams} />
      </TabsContent>
    </Tabs>
  )
}
