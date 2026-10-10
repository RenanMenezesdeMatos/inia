"use client"

import { useMemo, useState } from "react"
import { Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"

import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { TriggerConfigEditor } from "./trigger-fields"
import { useManageableTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { useUserAccountsQuery } from "@/queries/admin/use-user-account-queries"
import { useUpdateWorkflowAnalysisConfigMutation, useUpdateWorkflowMutation } from "@/queries/admin/use-workflow-queries"
import type { AnalysisConfigInput } from "@/services/admin/workflow-service"
import type { WorkflowDetail } from "@/schemas/admin/workflow.schema"
import {
  CONSOLIDATED_STRUCTURE_ANCHOR_ROLE,
  CONSOLIDATED_STRUCTURE_LABELS,
  consolidatedStructureAnchorId,
  consolidatedStructureGroupId,
  type ConsolidatedStructure,
  type ConsolidatedStructureKind,
} from "@/schemas/admin/consolidated-structure-schema"
import {
  POPULATION_FILTER_ANCHOR_ROLE,
  POPULATION_FILTER_LABELS,
  type PopulationFilter,
  type PopulationFilterKind,
} from "@/schemas/admin/population-filter-schema"
import type { StructureAnchorKind } from "@/schemas/admin/structure-anchor-schema"

const CONSOLIDATED_STRUCTURE_KINDS: ConsolidatedStructureKind[] = [
  "SUPERVISOR_TEAM",
  "SUBTEAM",
  "TEAM",
  "COORDINATOR_STRUCTURE",
  "MANAGER_STRUCTURE",
  "SENIOR_MANAGER_STRUCTURE",
  "DIRECTOR_STRUCTURE",
]

const POPULATION_FILTER_KINDS: PopulationFilterKind[] = ["ALL", "EMPLOYEE", ...CONSOLIDATED_STRUCTURE_KINDS]

export function buildConsolidatedStructure(kind: ConsolidatedStructureKind, anchorId: string): ConsolidatedStructure | null {
  switch (kind) {
    case "SUPERVISOR_TEAM":
      return anchorId ? { kind: "SUPERVISOR_TEAM", supervisorId: anchorId } : null
    case "SUBTEAM":
      return anchorId ? { kind: "SUBTEAM", subteamId: anchorId } : null
    case "TEAM":
      return anchorId ? { kind: "TEAM", teamId: anchorId } : null
    case "COORDINATOR_STRUCTURE":
      return anchorId ? { kind: "COORDINATOR_STRUCTURE", coordinatorId: anchorId } : null
    case "MANAGER_STRUCTURE":
      return anchorId ? { kind: "MANAGER_STRUCTURE", managerId: anchorId } : null
    case "SENIOR_MANAGER_STRUCTURE":
      return anchorId ? { kind: "SENIOR_MANAGER_STRUCTURE", seniorManagerId: anchorId } : null
    case "DIRECTOR_STRUCTURE":
      return anchorId ? { kind: "DIRECTOR_STRUCTURE", directorId: anchorId } : null
  }
}

export function buildPopulationFilter(kind: PopulationFilterKind, anchorId: string): PopulationFilter | null {
  if (kind === "ALL") return { kind: "ALL" }
  if (kind === "EMPLOYEE") return anchorId ? { kind: "EMPLOYEE", employeeId: anchorId } : null
  return buildConsolidatedStructure(kind, anchorId)
}

/** Mesmo id "canônico" de um kind, seja pessoa-âncora ou grupo — usado pra pré-popular o Select
 * único que representa a âncora (pessoa OU grupo, nunca os dois) de cada configuração. */
function structureGroupId(kind: StructureAnchorKind, structure: ConsolidatedStructure | null): string {
  if (!structure || structure.kind !== kind) return ""
  return consolidatedStructureAnchorId(structure) ?? consolidatedStructureGroupId(structure)
}

/** Numeração visual da sequência Abrangência → Gatilho → Alvo da avaliação → População/Estrutura —
 * transmite que são 4 decisões em ORDEM, não campos soltos (Parte 1/5 do pedido). */
/** Grupos/Subgrupos que a âncora pode usar: só os que quem edita gerencia, dentro da Abrangência do Workflow. */
function groupOptionsFor(
  kind: StructureAnchorKind | "ALL" | "EMPLOYEE",
  manageable: ReturnType<typeof useManageableTeamsQuery>["data"],
  scopeType: WorkflowDetail["scopeType"],
  teamId: WorkflowDetail["teamId"],
) {
  if (!manageable) return []
  if (kind === "TEAM") {
    if (scopeType === "TEAM" || scopeType === "SUBTEAM") return manageable.teams.filter((team) => team.id === teamId)
    return manageable.teams
  }
  if (kind === "SUBTEAM") {
    const teams = scopeType === "ALL_TEAMS" ? manageable.teams : manageable.teams.filter((team) => team.id === teamId)
    return teams.flatMap((team) => team.subteams)
  }
  return []
}

function SectionHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{n}</span>
      <Label className="text-sm font-semibold">{title}</Label>
    </div>
  )
}

/**
 * Configurações do próprio Workflow — nunca reconfiguradas dentro de um Node. Abrangência (com
 * validação cross-group já feita pelo backend ao salvar — ver workflow-router.ts) é sempre
 * mostrada; o Modo de avaliação (Individual x Consolidado) só é uma ESCOLHA real pra Agenda de
 * calendário — pros demais Triggers a seção mostra só texto informativo (Agenda relativa e
 * Flag/Indicador são sempre Individual por definição, nunca uma pergunta ao usuário).
 */
export function WorkflowSettingsSheet({ workflow }: { workflow: WorkflowDetail }) {
  const [open, setOpen] = useState(false)
  const manageableTeamsQuery = useManageableTeamsQuery()
  const usersQuery = useUserAccountsQuery()
  const updateMutation = useUpdateWorkflowMutation()
  const updateAnalysisMutation = useUpdateWorkflowAnalysisConfigMutation(workflow.id)

  const [orgScope, setOrgScope] = useState<OrgScopeValue>({
    scopeType: workflow.scopeType,
    teamId: workflow.teamId ?? undefined,
    subteamId: workflow.subteamId ?? undefined,
  })

  // Abrangência salva mudou: o formulário acompanha (ajuste na renderização, sem render extra).
  const [syncedScope, setSyncedScope] = useState({ scopeType: workflow.scopeType, teamId: workflow.teamId, subteamId: workflow.subteamId })
  if (syncedScope.scopeType !== workflow.scopeType || syncedScope.teamId !== workflow.teamId || syncedScope.subteamId !== workflow.subteamId) {
    setSyncedScope({ scopeType: workflow.scopeType, teamId: workflow.teamId, subteamId: workflow.subteamId })
    setOrgScope({ scopeType: workflow.scopeType, teamId: workflow.teamId ?? undefined, subteamId: workflow.subteamId ?? undefined })
  }

  const scopeChanged =
    orgScope.scopeType !== workflow.scopeType || (orgScope.teamId ?? null) !== workflow.teamId || (orgScope.subteamId ?? null) !== workflow.subteamId

  async function handleSaveScope() {
    try {
      await updateMutation.mutateAsync({ id: workflow.id, orgScope })
    } catch {
      // já sinalizado via updateMutation.isError / toast do useAdminMutation
    }
  }

  // Modo de avaliação: só é uma escolha real pra Agenda de calendário. Agenda relativa ao
  // expediente é sempre Individual (uma jornada é de uma pessoa só — nunca "50% da jornada de
  // uma equipe") — o backend rejeita Consolidado mesmo com um payload manual, isto só evita
  // oferecer a escolha onde ela nunca seria aceita. Flag/Indicador já têm sujeito individual
  // implícito no próprio evento — nem Filtro Populacional faz sentido pra eles.
  const isSchedule = workflow.trigger.kind === "schedule"
  const isRelativeToShift = workflow.trigger.kind === "schedule" && workflow.trigger.mode === "RELATIVE_TO_SHIFT"
  const supportsConsolidatedMode = isSchedule && !isRelativeToShift
  const supportsPopulationFilter = isSchedule

  const currentStructure = workflow.consolidatedStructure ?? null
  const [mode, setMode] = useState<"INDIVIDUAL" | "CONSOLIDATED">(currentStructure ? "CONSOLIDATED" : "INDIVIDUAL")
  const [structureKind, setStructureKind] = useState<ConsolidatedStructureKind>(currentStructure?.kind ?? "SUPERVISOR_TEAM")
  const [structureAnchorId, setStructureAnchorId] = useState<string>(structureGroupId(currentStructure?.kind ?? "SUPERVISOR_TEAM", currentStructure))

  const currentFilter = workflow.populationFilter ?? { kind: "ALL" as const }
  const [filterKind, setFilterKind] = useState<PopulationFilterKind>(currentFilter.kind)
  const [filterAnchorId, setFilterAnchorId] = useState<string>(
    currentFilter.kind === "EMPLOYEE" ? currentFilter.employeeId : structureGroupId(currentFilter.kind as ConsolidatedStructureKind, currentFilter as ConsolidatedStructure),
  )

  // Modo/estrutura/filtro salvos mudaram: o formulário recomeça deles (ajuste na renderização, sem render extra).
  const [syncedAnalysis, setSyncedAnalysis] = useState({ structure: workflow.consolidatedStructure, filter: workflow.populationFilter })
  if (syncedAnalysis.structure !== workflow.consolidatedStructure || syncedAnalysis.filter !== workflow.populationFilter) {
    setSyncedAnalysis({ structure: workflow.consolidatedStructure, filter: workflow.populationFilter })
    const structure = workflow.consolidatedStructure ?? null
    setMode(structure ? "CONSOLIDATED" : "INDIVIDUAL")
    setStructureKind(structure?.kind ?? "SUPERVISOR_TEAM")
    setStructureAnchorId(structureGroupId(structure?.kind ?? "SUPERVISOR_TEAM", structure))

    const filter = workflow.populationFilter ?? { kind: "ALL" as const }
    setFilterKind(filter.kind)
    setFilterAnchorId(filter.kind === "EMPLOYEE" ? filter.employeeId : structureGroupId(filter.kind as ConsolidatedStructureKind, filter as ConsolidatedStructure))
  }

  // Filtro só de UX (a pessoa/grupo precisa estar dentro da Abrangência) — o backend valida de
  // novo, sempre, na gravação.
  const structureAnchorRole = CONSOLIDATED_STRUCTURE_ANCHOR_ROLE[structureKind]
  const filterAnchorRole = filterKind === "EMPLOYEE" ? "OPERATOR" : POPULATION_FILTER_ANCHOR_ROLE[filterKind as ConsolidatedStructureKind]

  const structurePeopleOptions = useMemo(() => {
    if (!structureAnchorRole || !usersQuery.data) return []
    return usersQuery.data.filter((person) => person.role === structureAnchorRole && (workflow.scopeType === "ALL_TEAMS" || person.teamId === workflow.teamId))
  }, [usersQuery.data, structureAnchorRole, workflow.scopeType, workflow.teamId])

  const filterPeopleOptions = useMemo(() => {
    if (!filterAnchorRole || !usersQuery.data) return []
    return usersQuery.data.filter((person) => person.role === filterAnchorRole && (workflow.scopeType === "ALL_TEAMS" || person.teamId === workflow.teamId))
  }, [usersQuery.data, filterAnchorRole, workflow.scopeType, workflow.teamId])

  const structureGroupOptions = useMemo(
    () => groupOptionsFor(structureKind, manageableTeamsQuery.data, workflow.scopeType, workflow.teamId),
    [manageableTeamsQuery.data, structureKind, workflow.scopeType, workflow.teamId],
  )
  const filterGroupOptions = useMemo(
    () => groupOptionsFor(filterKind, manageableTeamsQuery.data, workflow.scopeType, workflow.teamId),
    [manageableTeamsQuery.data, filterKind, workflow.scopeType, workflow.teamId],
  )

  const nextStructure = buildConsolidatedStructure(structureKind, structureAnchorId)
  const nextFilter = buildPopulationFilter(filterKind, filterAnchorId)
  const analysisInput: AnalysisConfigInput | null =
    mode === "CONSOLIDATED" ? (nextStructure ? { mode: "CONSOLIDATED", consolidatedStructure: nextStructure } : null) : nextFilter ? { mode: "INDIVIDUAL", populationFilter: nextFilter.kind === "ALL" ? null : nextFilter } : null

  const analysisChanged =
    mode === "CONSOLIDATED"
      ? !currentStructure || structureKind !== currentStructure.kind || structureAnchorId !== structureGroupId(currentStructure.kind, currentStructure)
      : Boolean(currentStructure) || filterKind !== currentFilter.kind || filterAnchorId !== (currentFilter.kind === "EMPLOYEE" ? currentFilter.employeeId : structureGroupId(currentFilter.kind as ConsolidatedStructureKind, currentFilter as ConsolidatedStructure))

  async function handleSaveAnalysis() {
    if (!analysisInput) return
    try {
      await updateAnalysisMutation.mutateAsync(analysisInput)
    } catch {
      // já sinalizado via updateAnalysisMutation.isError / toast do useAdminMutation
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Configurações do workflow">
          <Settings className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full max-w-md space-y-6 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Configurações do workflow</SheetTitle>
          <SheetDescription>
            Onde, quando e o que este workflow avalia — em sequência, configurado uma vez aqui, nunca repetido em cada nó do canvas.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4">
          <SectionHeading n={1} title="Abrangência" />
          {manageableTeamsQuery.data ? (
            <OrgScopeSelect teams={manageableTeamsQuery.data.teams} value={orgScope} onChange={setOrgScope} allowAllTeams={manageableTeamsQuery.data.unrestricted} />
          ) : (
            <Skeleton className="h-10 w-full" />
          )}
          <p className="text-xs text-muted-foreground">
            Em quais grupos este workflow pode atuar. Trocar a abrangência é validado contra os Orchestrators, a Estrutura Consolidada e o
            Filtro Populacional já configurados — uma referência que ficaria fora do novo grupo bloqueia a troca, com uma mensagem
            explicando qual.
          </p>
          {updateMutation.isError ? <p className="text-sm text-destructive">{(updateMutation.error as Error).message}</p> : null}
          <Button size="sm" disabled={!scopeChanged || updateMutation.isPending} onClick={handleSaveScope}>
            {updateMutation.isPending ? "Salvando..." : "Salvar abrangência"}
          </Button>
        </div>

        <Separator />
        <div className="space-y-3 px-4">
          <SectionHeading n={2} title="Gatilho" />
          <p className="text-xs text-muted-foreground">
            Quando e por que este workflow começa. É a mesma configuração do nó Gatilho no canvas — editar aqui ou lá dá no mesmo.
          </p>
          <TriggerConfigEditor
            trigger={workflow.trigger}
            workflowId={workflow.id}
            scope={{ scopeType: workflow.scopeType, teamId: workflow.teamId ?? undefined }}
            graph={workflow.draftGraph}
            consolidatedStructure={workflow.consolidatedStructure ?? null}
            populationFilter={workflow.populationFilter ?? null}
          />
        </div>

        <Separator />
        <div className="space-y-3 px-4">
          <SectionHeading n={3} title="Alvo da avaliação" />
          <p className="text-sm font-medium">O que este workflow vai avaliar?</p>

          {!isSchedule ? (
            <p className="text-sm text-muted-foreground">
              {workflow.trigger.kind === "channel_flag"
                ? "Colaborador da interação (automático) — o sujeito é sempre o operador da interação que disparou este workflow."
                : "Colaborador da medição (automático) — o sujeito é sempre o colaborador da medição que disparou este workflow."}
            </p>
          ) : isRelativeToShift ? (
            <p className="text-sm text-muted-foreground">
              Colaborador (automático) — a jornada pertence ao colaborador. Agenda relativa ao expediente sempre calcula um horário por
              pessoa, nunca existe &quot;50% da jornada de uma equipe&quot;.
            </p>
          ) : (
            <>
              <Select value={mode} onValueChange={(value) => setMode(value as "INDIVIDUAL" | "CONSOLIDATED")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INDIVIDUAL">Colaboradores individualmente</SelectItem>
                  <SelectItem value="CONSOLIDATED">Uma estrutura consolidada</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {mode === "INDIVIDUAL"
                  ? "Executa a análise separadamente para cada colaborador elegível."
                  : "Analisa uma equipe ou estrutura como uma única unidade."}
              </p>
            </>
          )}
        </div>

        <Separator />
        <div className="space-y-3 px-4">
          <SectionHeading n={4} title="População / Estrutura" />

          {supportsPopulationFilter && mode === "INDIVIDUAL" ? (
            <>
              <p className="text-sm font-medium">Quais colaboradores?</p>
              <Select value={filterKind} onValueChange={(value) => setFilterKind(value as PopulationFilterKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POPULATION_FILTER_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {POPULATION_FILTER_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {filterAnchorRole ? (
                <Select value={filterAnchorId} onValueChange={setFilterAnchorId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`Selecione ${POPULATION_FILTER_LABELS[filterKind].toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {filterPeopleOptions.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {filterKind === "SUBTEAM" || filterKind === "TEAM" ? (
                <Select value={filterAnchorId} onValueChange={setFilterAnchorId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`Selecione o ${filterKind === "SUBTEAM" ? "subgrupo" : "grupo"}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {filterGroupOptions.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Quais colaboradores, dentro da Abrangência, participam deste workflow — cada um continua tendo sua própria execução
                individual. &quot;Todos os colaboradores elegíveis&quot; (padrão) é o comportamento de sempre. Isso nunca vira análise
                agregada, é só uma restrição de quem participa.
              </p>
            </>
          ) : null}

          {supportsConsolidatedMode && mode === "CONSOLIDATED" ? (
            <>
              <p className="text-sm font-medium">Qual estrutura será analisada?</p>
              <Select value={structureKind} onValueChange={(value) => setStructureKind(value as ConsolidatedStructureKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSOLIDATED_STRUCTURE_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {CONSOLIDATED_STRUCTURE_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {structureAnchorRole ? (
                <Select value={structureAnchorId} onValueChange={setStructureAnchorId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`Selecione ${CONSOLIDATED_STRUCTURE_LABELS[structureKind].toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {structurePeopleOptions.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {structureKind === "SUBTEAM" || structureKind === "TEAM" ? (
                <Select value={structureAnchorId} onValueChange={setStructureAnchorId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`Selecione o ${structureKind === "SUBTEAM" ? "subgrupo" : "grupo"}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {structureGroupOptions.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Este workflow analisa a estrutura escolhida acima como UMA única unidade — nunca dispara uma execução por operador dela.
                Output/Escalonar continuam indo pra quem for configurado (ex.: a pessoa-âncora ou a liderança dela), nunca pros
                operadores individuais.
              </p>
            </>
          ) : null}

          {updateAnalysisMutation.isError ? <p className="text-sm text-destructive">{(updateAnalysisMutation.error as Error).message}</p> : null}
          {isSchedule ? (
            <Button size="sm" disabled={!analysisChanged || !analysisInput || updateAnalysisMutation.isPending} onClick={handleSaveAnalysis}>
              {updateAnalysisMutation.isPending ? "Salvando..." : "Salvar modo de avaliação"}
            </Button>
          ) : null}
        </div>

        <Separator />
        <p className="px-4 text-xs text-muted-foreground">Regras, períodos, ações e destinatários são configurados nos nós do canvas.</p>
      </SheetContent>
    </Sheet>
  )
}
