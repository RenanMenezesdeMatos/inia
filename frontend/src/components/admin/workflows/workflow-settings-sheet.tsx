"use client"

import { useMemo, useState } from "react"
import { Settings } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

import { OrgScopeSelect, orgScopeValueAfterUniverseChange, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { TriggerConfigEditor } from "./trigger-fields"
import { WorkflowUniverseProvider } from "./workflow-universe-context"
import { fitsUniverse, teamsForUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import { useManageableTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { useUserAccountsQuery } from "@/queries/admin/use-user-account-queries"
import { useDiscardWorkflowConfigurationMutation, useUpdateWorkflowAnalysisConfigMutation, useUpdateWorkflowMutation } from "@/queries/admin/use-workflow-queries"
import type { AnalysisConfigInput } from "@/services/admin/workflow-service"
import { withDraftConfiguration, type WorkflowDetail } from "@/schemas/admin/workflow.schema"
import { describeConfigurationChanges } from "./workflow-configuration-summary"
import {
  CONSOLIDATED_STRUCTURE_ANCHOR_ROLE,
  CONSOLIDATED_STRUCTURE_LABELS,
  consolidatedStructureAnchorId,
  consolidatedStructureGroupId,
  type ConsolidatedStructure,
  type ConsolidatedStructureKind,
} from "@/schemas/admin/consolidated-structure-schema"
import {
  ACTIVE_ACCESS_ONLY_TITLE,
  POPULATION_FILTER_ANCHOR_ROLE,
  POPULATION_FILTER_LABELS,
  type PopulationFilter,
  type PopulationFilterKind,
} from "@/schemas/admin/population-filter-schema"
import type { StructureAnchorKind } from "@/schemas/admin/structure-anchor-schema"
import { UniverseSelect } from "@/components/operating-universe/universe-select"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"

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
// Também só os do universo do Workflow (hierarquia universo → Grupo → Subgrupo); pendente cabe em qualquer universo.
function groupOptionsFor(
  kind: StructureAnchorKind | "ALL" | "EMPLOYEE",
  manageable: ReturnType<typeof useManageableTeamsQuery>["data"],
  scopeType: WorkflowDetail["scopeType"],
  teamId: WorkflowDetail["teamId"],
  universe: UniverseChoice = null,
) {
  if (!manageable) return []
  const universeTeams = teamsForUniverse(manageable.teams, universe)
  if (kind === "TEAM") {
    const selectable = universeTeams.filter((team) => team.selectable)
    if (scopeType === "TEAM" || scopeType === "SUBTEAM") return selectable.filter((team) => team.id === teamId)
    return selectable
  }
  if (kind === "SUBTEAM") {
    const teams = scopeType === "ALL_TEAMS" ? universeTeams : universeTeams.filter((team) => team.id === teamId)
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
  // Tudo aqui edita o RASCUNHO da configuração; os campos de topo de `workflow` são a publicada (o que roda hoje).
  const editable = useMemo(() => withDraftConfiguration(workflow), [workflow])
  const pendingChanges = useMemo(() => describeConfigurationChanges(workflow), [workflow])
  const discardMutation = useDiscardWorkflowConfigurationMutation(workflow.id)
  const [open, setOpen] = useState(false)
  const manageableTeamsQuery = useManageableTeamsQuery()
  const usersQuery = useUserAccountsQuery()
  const updateMutation = useUpdateWorkflowMutation()
  const updateAnalysisMutation = useUpdateWorkflowAnalysisConfigMutation(workflow.id)

  const [orgScope, setOrgScope] = useState<OrgScopeValue>({
    scopeType: editable.scopeType,
    teamId: editable.teamId ?? undefined,
    subteamId: editable.subteamId ?? undefined,
  })

  // Abrangência do rascunho mudou: o formulário acompanha (ajuste na renderização, sem render extra).
  const [syncedScope, setSyncedScope] = useState({ scopeType: editable.scopeType, teamId: editable.teamId, subteamId: editable.subteamId })
  if (syncedScope.scopeType !== editable.scopeType || syncedScope.teamId !== editable.teamId || syncedScope.subteamId !== editable.subteamId) {
    setSyncedScope({ scopeType: editable.scopeType, teamId: editable.teamId, subteamId: editable.subteamId })
    setOrgScope({ scopeType: editable.scopeType, teamId: editable.teamId ?? undefined, subteamId: editable.subteamId ?? undefined })
  }

  const [universe, setUniverse] = useState(editable.operatingUniverse)
  const [syncedUniverse, setSyncedUniverse] = useState(editable.operatingUniverse)
  if (syncedUniverse !== editable.operatingUniverse) {
    setSyncedUniverse(editable.operatingUniverse)
    setUniverse(editable.operatingUniverse)
  }
  const universeEnforced = useCurrentUserQuery().data?.operatingUniverseEnforced ?? false
  const orgScopeChanged =
    orgScope.scopeType !== editable.scopeType || (orgScope.teamId ?? null) !== editable.teamId || (orgScope.subteamId ?? null) !== editable.subteamId
  const universeChanged = universe !== editable.operatingUniverse
  const scopeChanged = orgScopeChanged || universeChanged

  // Trocar o universo limpa o Grupo/Subgrupo da Abrangência que deixou de caber nele (salvos juntos em "Salvar abrangência").
  function handleUniverseChange(next: typeof universe) {
    setUniverse(next)
    setOrgScope((current) => orgScopeValueAfterUniverseChange(current, manageableTeamsQuery.data?.teams, next))
  }

  async function handleSaveScope() {
    try {
      await updateMutation.mutateAsync({ id: workflow.id, ...(orgScopeChanged ? { orgScope } : {}), ...(universeChanged ? { operatingUniverse: universe } : {}) })
    } catch {
      // já sinalizado via updateMutation.isError / toast do useAdminMutation
    }
  }

  // Modo de avaliação: só é uma escolha real pra Agenda de calendário. Agenda relativa ao
  // expediente é sempre Individual (uma jornada é de uma pessoa só — nunca "50% da jornada de
  // uma equipe") — o backend rejeita Consolidado mesmo com um payload manual, isto só evita
  // oferecer a escolha onde ela nunca seria aceita. Flag/Indicador já têm sujeito individual
  // implícito no próprio evento — nem Filtro Populacional faz sentido pra eles.
  const isSchedule = editable.trigger.kind === "schedule"
  const isRelativeToShift = editable.trigger.kind === "schedule" && editable.trigger.mode === "RELATIVE_TO_SHIFT"
  const supportsConsolidatedMode = isSchedule && !isRelativeToShift
  const supportsPopulationFilter = isSchedule

  const currentStructure = editable.consolidatedStructure ?? null
  const [mode, setMode] = useState<"INDIVIDUAL" | "CONSOLIDATED">(currentStructure ? "CONSOLIDATED" : "INDIVIDUAL")
  const [structureKind, setStructureKind] = useState<ConsolidatedStructureKind>(currentStructure?.kind ?? "SUPERVISOR_TEAM")
  const [structureAnchorId, setStructureAnchorId] = useState<string>(structureGroupId(currentStructure?.kind ?? "SUPERVISOR_TEAM", currentStructure))

  const currentFilter = editable.populationFilter ?? { kind: "ALL" as const }
  const [filterKind, setFilterKind] = useState<PopulationFilterKind>(currentFilter.kind)
  const [filterAnchorId, setFilterAnchorId] = useState<string>(
    currentFilter.kind === "EMPLOYEE" ? currentFilter.employeeId : structureGroupId(currentFilter.kind as ConsolidatedStructureKind, currentFilter as ConsolidatedStructure),
  )

  // "Somente quem tem acesso ativo à INIA": opção do modo Individual, para qualquer gatilho (o Filtro Populacional só existe em Agenda).
  const currentRequireAccess = editable.requireActiveAccess === true
  const [requireAccess, setRequireAccess] = useState(currentRequireAccess)

  // Modo/estrutura/filtro do rascunho mudaram: o formulário recomeça deles (ajuste na renderização, sem render extra).
  const [syncedAnalysis, setSyncedAnalysis] = useState({ structure: editable.consolidatedStructure, filter: editable.populationFilter, requireAccess: currentRequireAccess })
  if (syncedAnalysis.structure !== editable.consolidatedStructure || syncedAnalysis.filter !== editable.populationFilter || syncedAnalysis.requireAccess !== currentRequireAccess) {
    setSyncedAnalysis({ structure: editable.consolidatedStructure, filter: editable.populationFilter, requireAccess: currentRequireAccess })
    setRequireAccess(currentRequireAccess)
    const structure = editable.consolidatedStructure ?? null
    setMode(structure ? "CONSOLIDATED" : "INDIVIDUAL")
    setStructureKind(structure?.kind ?? "SUPERVISOR_TEAM")
    setStructureAnchorId(structureGroupId(structure?.kind ?? "SUPERVISOR_TEAM", structure))

    const filter = editable.populationFilter ?? { kind: "ALL" as const }
    setFilterKind(filter.kind)
    setFilterAnchorId(filter.kind === "EMPLOYEE" ? filter.employeeId : structureGroupId(filter.kind as ConsolidatedStructureKind, filter as ConsolidatedStructure))
  }

  // Filtro só de UX (a pessoa/grupo precisa estar dentro da Abrangência) — o backend valida de
  // novo, sempre, na gravação.
  const structureAnchorRole = CONSOLIDATED_STRUCTURE_ANCHOR_ROLE[structureKind]
  const filterAnchorRole = filterKind === "EMPLOYEE" ? "OPERATOR" : POPULATION_FILTER_ANCHOR_ROLE[filterKind as ConsolidatedStructureKind]

  const structurePeopleOptions = useMemo(() => {
    if (!structureAnchorRole || !usersQuery.data) return []
    return usersQuery.data.filter((person) => person.role === structureAnchorRole && (editable.scopeType === "ALL_TEAMS" || person.teamId === editable.teamId) && fitsUniverse(person.operatingUniverse, editable.operatingUniverse))
  }, [usersQuery.data, structureAnchorRole, editable.scopeType, editable.teamId, editable.operatingUniverse])

  const filterPeopleOptions = useMemo(() => {
    if (!filterAnchorRole || !usersQuery.data) return []
    return usersQuery.data.filter((person) => person.role === filterAnchorRole && (editable.scopeType === "ALL_TEAMS" || person.teamId === editable.teamId) && fitsUniverse(person.operatingUniverse, editable.operatingUniverse))
  }, [usersQuery.data, filterAnchorRole, editable.scopeType, editable.teamId, editable.operatingUniverse])

  const structureGroupOptions = useMemo(
    () => groupOptionsFor(structureKind, manageableTeamsQuery.data, editable.scopeType, editable.teamId, editable.operatingUniverse),
    [manageableTeamsQuery.data, structureKind, editable.scopeType, editable.teamId, editable.operatingUniverse],
  )
  const filterGroupOptions = useMemo(
    () => groupOptionsFor(filterKind, manageableTeamsQuery.data, editable.scopeType, editable.teamId, editable.operatingUniverse),
    [manageableTeamsQuery.data, filterKind, editable.scopeType, editable.teamId, editable.operatingUniverse],
  )

  // Consolidado só existe em Agenda de calendário; em qualquer outro gatilho a avaliação é sempre individual.
  const consolidatedSelected = supportsConsolidatedMode && mode === "CONSOLIDATED"
  const nextStructure = buildConsolidatedStructure(structureKind, structureAnchorId)
  // Fora da Agenda não há Filtro Populacional: grava "todos" e só a opção de acesso.
  const nextFilter = supportsPopulationFilter ? buildPopulationFilter(filterKind, filterAnchorId) : ({ kind: "ALL" } as const)
  const analysisInput: AnalysisConfigInput | null = consolidatedSelected
    ? nextStructure
      ? { mode: "CONSOLIDATED", consolidatedStructure: nextStructure }
      : null
    : nextFilter
      ? { mode: "INDIVIDUAL", populationFilter: nextFilter.kind === "ALL" ? null : nextFilter, requireActiveAccess: requireAccess }
      : null

  const analysisChanged = !isSchedule
    ? requireAccess !== currentRequireAccess
    : mode === "CONSOLIDATED"
      ? !currentStructure || structureKind !== currentStructure.kind || structureAnchorId !== structureGroupId(currentStructure.kind, currentStructure)
      : Boolean(currentStructure) || requireAccess !== currentRequireAccess || filterKind !== currentFilter.kind || filterAnchorId !== (currentFilter.kind === "EMPLOYEE" ? currentFilter.employeeId : structureGroupId(currentFilter.kind as ConsolidatedStructureKind, currentFilter as ConsolidatedStructure))

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
            {workflow.published ? " As alterações ficam no rascunho e só passam a valer quando você Publicar." : ""}
          </SheetDescription>
        </SheetHeader>

        {pendingChanges.length > 0 ? (
          <div className="mx-4 space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm" data-testid="workflow-settings-pending">
            <p className="font-medium">Alterações não publicadas</p>
            <p className="text-xs text-muted-foreground">O workflow continua rodando com a configuração publicada até você Publicar:</p>
            <ul className="space-y-0.5 text-xs">
              {pendingChanges.map((item) => (
                <li key={item.change}>
                  <span className="font-medium">{item.label}:</span> {item.published} → {item.draft}
                </li>
              ))}
            </ul>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={discardMutation.isPending}>
                  Descartar alterações de configuração
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Descartar alterações de configuração?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Gatilho, Abrangência e Alvo da avaliação voltam a ser os publicados. O fluxo em rascunho no canvas não muda.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => discardMutation.mutate()}>Descartar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}

        <div className="space-y-3 px-4">
          <SectionHeading n={1} title="Abrangência" />
          {/* Universo primeiro: é o topo da hierarquia — os Grupos/Subgrupos da Abrangência abaixo são só os dele. */}
          <div className="space-y-1.5">
            <Label htmlFor="workflow-settings-universe">Universo de atuação</Label>
            <UniverseSelect id="workflow-settings-universe" value={universe} onChange={handleUniverseChange} allowPending={!universeEnforced && editable.operatingUniverse === null} />
            <p className="text-xs text-muted-foreground">Só colaboradores deste universo entram nas execuções. Agentes, Orquestradores e indicadores das etapas precisam ser do mesmo universo — conferido ao Publicar.</p>
          </div>
          {manageableTeamsQuery.data ? (
            <OrgScopeSelect teams={manageableTeamsQuery.data.teams} value={orgScope} onChange={setOrgScope} allowAllTeams={manageableTeamsQuery.data.unrestricted} universe={universe} />
          ) : (
            <Skeleton className="h-10 w-full" />
          )}
          <p className="text-xs text-muted-foreground">
            Em quais grupos este workflow pode atuar. Trocar a abrangência é conferido com os Orquestradores, a Estrutura Consolidada e o
            Filtro Populacional já configurados. Se algo ficar fora do novo grupo, a troca é recusada e a mensagem diz o quê.
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
            Quando e por que este workflow começa. É a mesma configuração do nó Gatilho no canvas — editar aqui ou lá dá no mesmo. Fica no
            rascunho: nada muda nas execuções até Publicar.
          </p>
          <WorkflowUniverseProvider value={editable.operatingUniverse}>
          <TriggerConfigEditor
            trigger={editable.trigger}
            workflowId={workflow.id}
            scope={{ scopeType: editable.scopeType, teamId: editable.teamId ?? undefined }}
            graph={workflow.draftGraph}
            consolidatedStructure={editable.consolidatedStructure ?? null}
            populationFilter={editable.populationFilter ?? null}
          />
          </WorkflowUniverseProvider>
        </div>

        <Separator />
        <div className="space-y-3 px-4">
          <SectionHeading n={3} title="Alvo da avaliação" />
          <p className="text-sm font-medium">O que este workflow vai avaliar?</p>

          {!isSchedule ? (
            <p className="text-sm text-muted-foreground">
              {editable.trigger.kind === "channel_flag"
                ? "Colaborador da interação (automático): sempre quem atendeu a interação que disparou este workflow."
                : editable.trigger.kind === "manual"
                  ? "O colaborador escolhido em Executar agora (automático)."
                  : "Colaborador da medição (automático): sempre o dono da medição que disparou este workflow."}
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

          {!consolidatedSelected ? (
            <div className="space-y-2 rounded-lg border bg-card p-3" data-testid="workflow-require-active-access">
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor="workflow-require-active-access" className="text-sm font-medium leading-snug">
                  {ACTIVE_ACCESS_ONLY_TITLE}
                </Label>
                <Switch id="workflow-require-active-access" checked={requireAccess} onCheckedChange={setRequireAccess} />
              </div>
              <p className="text-xs text-muted-foreground">
                Ligada, este workflow só cria execução para quem tem login ativo na INIA. Quem receber acesso depois passa a entrar
                sozinho; quem perder o acesso deixa de entrar (o que já estava em andamento termina). Não muda com quem a pessoa é
                comparada: quartil e ranking continuam sobre todos os colaboradores da população.
              </p>
            </div>
          ) : null}

          {consolidatedSelected ? (
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
          <Button size="sm" disabled={!analysisChanged || !analysisInput || updateAnalysisMutation.isPending} onClick={handleSaveAnalysis}>
            {updateAnalysisMutation.isPending ? "Salvando..." : isSchedule ? "Salvar modo de avaliação" : "Salvar população"}
          </Button>
        </div>

        <Separator />
        <p className="px-4 text-xs text-muted-foreground">Regras, períodos, ações e destinatários são configurados nos nós do canvas.</p>
      </SheetContent>
    </Sheet>
  )
}
