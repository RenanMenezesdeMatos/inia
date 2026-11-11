"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"

import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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

import { AgentPicker } from "@/components/admin/workflows/agent-picker"
import { checkSpecialistAgainstRouting, describeRoutingProblem, POLICY_REQUIRED_MESSAGE, resolveAgentSpecialty, resolveRoutingPolicy, routingDomainPayload, type RoutingPolicy } from "@/schemas/admin/orchestrator-policy"
import { useBusinessDomainsQuery } from "@/queries/admin/use-business-domain-queries"
import { OrchestratorPolicyFields } from "./orchestrator-policy-fields"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import type { Agent } from "@/schemas/admin/agent.schema"
import { ORCHESTRATOR_INVOCATION_MODE_LABELS, type Orchestrator, type OrchestratorInvocationMode } from "@/schemas/admin/assistant.schema"
import { type StructuredOutputDefinition, type StructuredOutputIssue } from "@/schemas/admin/structured-output"
import { AdminApiError } from "@/lib/admin/admin-api"
import { StructuredOutputBuilder } from "./structured-output-builder"
import type { StructuredOutputImpactDetails } from "./structured-output-impacts"
import { StructuredOutputImpactDialog } from "./structured-output-impacts"
import { SpecialistsTab } from "./orchestrator-editor/specialists-tab"
import { AgentCurrentVersion, type AgentCurrentVersionState } from "./orchestrator-editor/agent-current-version"
import { OrchestratorVersionsPopover } from "./orchestrator-editor/orchestrator-versions-popover"
import { ReappliedNotice, VersionConflictNotice } from "./orchestrator-editor/version-conflict-notice"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useManageableTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { scopesAreCompatible } from "@/lib/admin/scope-compatibility"
import {
  useCreateOrchestratorMutation,
  useDeleteOrchestratorMutation,
  useOrchestratorQuery,
  useStructuredOutputUsageQuery,
  useToggleOrchestratorActiveMutation,
  useUpdateOrchestratorMutation,
} from "@/queries/admin/use-assistant-queries"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

const LIST_HREF = "/admin/assistant"

/**
 * PEN-047: agente nunca publicado não entra em orquestrador. O seletor já o mostra como "Não publicado" e não deixa escolher;
 * aqui a regra entra no motivo dos especialistas para também avisar sobre um já selecionado.
 */
const NOT_PUBLISHED_REASON = "Não publicado — publique o agente antes de usá-lo num orquestrador."
const unpublishedReason = (agent: Agent): string | null => (agent.published ? null : NOT_PUBLISHED_REASON)

/** Tudo o que a pessoa edita no formulário — guardado para reaplicar sobre a versão atual depois de um conflito (PEN-050). */
type OrchestratorFormSnapshot = {
  name: string
  orchestratorAgentId: string
  orgScope: OrgScopeValue
  specialistAgentIds: string[]
  invocationMode: OrchestratorInvocationMode
  recommendSupportMaterials: boolean
  routing: RoutingPolicy
  structuredEnabled: boolean
  structuredDefinition: StructuredOutputDefinition | null
}

function snapshotOf(orchestrator: Orchestrator): OrchestratorFormSnapshot {
  return {
    name: orchestrator.name,
    orchestratorAgentId: orchestrator.orchestratorAgentId,
    orgScope: { scopeType: orchestrator.scopeType, teamId: orchestrator.teamId ?? undefined, subteamId: orchestrator.subteamId ?? undefined },
    specialistAgentIds: orchestrator.specialists.map((specialist) => specialist.agentId),
    invocationMode: orchestrator.invocationMode,
    recommendSupportMaterials: orchestrator.recommendSupportMaterials,
    routing: resolveRoutingPolicy(orchestrator),
    structuredEnabled: orchestrator.structuredOutput !== null && orchestrator.structuredOutput.nodes.length > 0,
    structuredDefinition: orchestrator.structuredOutput,
  }
}

/**
 * Cadastro do Orquestrador — mesma página para criar (`/admin/assistant/new`) e editar
 * (`/admin/assistant/:id`), no padrão das demais telas de Atendimento com IA (Agentes): cabeçalho
 * com voltar, título e ações; o conteúdo em abas na própria página, nunca em pop-up.
 *
 * Versões (PEN-076, com a revisão aprovada de 03/11/2026): toda gravação publica uma versão nova da CONFIGURAÇÃO do orquestrador
 * (especialistas, política, resultado estruturado). Os agentes não ficam fixados: o agente orquestrador e cada especialista rodam
 * sempre na versão vigente, mostrada aqui. A gravação diz em qual versão a edição se baseou e, se outra pessoa gravou no meio,
 * nada é gravado e as alterações são reaplicadas sobre a versão atual.
 */
function OrchestratorForm({ orchestrator, onReload }: { orchestrator?: Orchestrator; onReload?: () => Promise<{ isError: boolean }> }) {
  const router = useRouter()
  const isEditing = Boolean(orchestrator)
  const agentsQuery = useAgentsQuery()
  const manageableTeamsQuery = useManageableTeamsQuery()
  const createMutation = useCreateOrchestratorMutation()
  const updateMutation = useUpdateOrchestratorMutation(orchestrator?.id ?? "")
  const toggleActiveMutation = useToggleOrchestratorActiveMutation()
  const deleteMutation = useDeleteOrchestratorMutation()
  const mutation = isEditing ? updateMutation : createMutation

  const [name, setName] = useState(orchestrator?.name ?? "")
  const [orchestratorAgentId, setOrchestratorAgentId] = useState(orchestrator?.orchestratorAgentId ?? "")
  const [orgScope, setOrgScope] = useState<OrgScopeValue>(
    orchestrator ? { scopeType: orchestrator.scopeType, teamId: orchestrator.teamId ?? undefined, subteamId: orchestrator.subteamId ?? undefined } : { scopeType: "ALL_TEAMS" },
  )
  const [specialistAgentIds, setSpecialistAgentIds] = useState<string[]>(orchestrator?.specialists.map((specialist) => specialist.agentId) ?? [])
  // Escolhido já na criação: só pode existir UM orquestrador ativo atendendo o chat/voz por escopo —
  // um orquestrador de domínio para Workflows ("Só workflows") precisa nascer com esse acionamento,
  // senão a criação é recusada.
  const [invocationMode, setInvocationMode] = useState<OrchestratorInvocationMode>(orchestrator?.invocationMode ?? "BOTH")
  const [recommendSupportMaterials, setRecommendSupportMaterials] = useState(orchestrator?.recommendSupportMaterials ?? false)
  // Política de roteamento (forma alvo, 057) — o legado (policyKind) é traduzido pelo mesmo dual-read do backend.
  // O Orquestrador nasce ATIVO, e ativo nunca fica sem política (migration 054): na criação ela é obrigatória.
  const [routing, setRouting] = useState<RoutingPolicy>(orchestrator ? resolveRoutingPolicy(orchestrator) : { kind: null })
  // Catálogo dinâmico de domínios (só ativos) — o que o registro já tinha continua visível mesmo desativado.
  const businessDomainsQuery = useBusinessDomainsQuery()
  // Resultado estruturado — fonte única (structured-output.ts): o construtor visual é dono do
  // estado de edição; aqui só o que o Salvar precisa (definição atual, problemas, ligado/desligado)
  // e uma chave para remontar o construtor quando o registro (re)carrega do servidor.
  const [structuredEnabled, setStructuredEnabled] = useState(orchestrator ? orchestrator.structuredOutput !== null && orchestrator.structuredOutput.nodes.length > 0 : false)
  const [structuredDefinition, setStructuredDefinition] = useState<StructuredOutputDefinition | null>(orchestrator?.structuredOutput ?? null)
  const [structuredIssues, setStructuredIssues] = useState<StructuredOutputIssue[]>([])
  const [builderKey, setBuilderKey] = useState(0)
  // Definição com que o construtor (re)monta: a do registro, ou a da pessoa quando as alterações são reaplicadas após um conflito.
  const [builderInitialDefinition, setBuilderInitialDefinition] = useState<StructuredOutputDefinition | null>(orchestrator?.structuredOutput ?? null)
  const [pendingImpacts, setPendingImpacts] = useState<StructuredOutputImpactDetails | null>(null)
  const usageQuery = useStructuredOutputUsageQuery(orchestrator?.id ?? null)
  // PEN-050: outra gravação no meio (409) — o formulário continua com o que a pessoa alterou; ao atualizar, reaplica por cima.
  const [conflict, setConflict] = useState<{ message: string; publishedByName: string | null } | null>(null)
  const [reapply, setReapply] = useState<OrchestratorFormSnapshot | null>(null)
  const [reapplied, setReapplied] = useState(false)
  // 422 ORCHESTRATOR_AGENT_NOT_PUBLISHED: o agente recusado aparece marcado como "Não publicado" onde está selecionado.
  const [notPublishedAgentId, setNotPublishedAgentId] = useState<string | null>(null)

  // Escopo Administrativo (Parte 10/11): criando um orquestrador novo, um admin restrito nunca
  // começa em "Todos os grupos".
  const [scopeCheckedFor, setScopeCheckedFor] = useState<typeof manageableTeamsQuery.data>(undefined)
  if (scopeCheckedFor !== manageableTeamsQuery.data) {
    setScopeCheckedFor(manageableTeamsQuery.data)
    if (!orchestrator && manageableTeamsQuery.data && !manageableTeamsQuery.data.unrestricted && orgScope.scopeType === "ALL_TEAMS") {
      setOrgScope({ scopeType: "TEAM" })
    }
  }

  function currentSnapshot(): OrchestratorFormSnapshot {
    return { name, orchestratorAgentId, orgScope, specialistAgentIds, invocationMode, recommendSupportMaterials, routing, structuredEnabled, structuredDefinition }
  }

  function applySnapshot(snapshot: OrchestratorFormSnapshot) {
    setName(snapshot.name)
    setOrchestratorAgentId(snapshot.orchestratorAgentId)
    setOrgScope(snapshot.orgScope)
    setSpecialistAgentIds(snapshot.specialistAgentIds)
    setInvocationMode(snapshot.invocationMode)
    setRecommendSupportMaterials(snapshot.recommendSupportMaterials)
    setRouting(snapshot.routing)
    setStructuredEnabled(snapshot.structuredEnabled)
    setStructuredDefinition(snapshot.structuredDefinition)
    setBuilderInitialDefinition(snapshot.structuredDefinition)
    setStructuredIssues([])
    setBuilderKey((current) => current + 1)
  }

  // Registro recarregado do servidor: o formulário recomeça dele (ou, depois de um conflito, das alterações guardadas da pessoa,
  // agora sobre a versão atual) e o construtor do resultado estruturado remonta — ajuste na renderização, sem render extra (na
  // montagem os valores iniciais já vêm dele).
  const [loadedOrchestrator, setLoadedOrchestrator] = useState(orchestrator)
  if (loadedOrchestrator !== orchestrator) {
    setLoadedOrchestrator(orchestrator)
    if (orchestrator) {
      applySnapshot(reapply ?? snapshotOf(orchestrator))
      setReapplied(reapply !== null)
      if (reapply) setConflict(null)
      setReapply(null)
      setNotPublishedAgentId(null)
    }
  }

  const [reloading, setReloading] = useState(false)
  async function reloadAndReapply() {
    if (!onReload) return
    // Guardado ANTES de buscar: a versão atual chega e o formulário recomeça dela com isto por cima (ajuste acima).
    setReapply(currentSnapshot())
    setReloading(true)
    const result = await onReload()
    setReloading(false)
    if (result.isError) {
      // Não atualizou: nada mudou na tela; o aviso continua para tentar de novo.
      setReapply(null)
      setConflict((current) => current && { ...current, message: "Não foi possível atualizar agora. Suas alterações continuam na tela — tente de novo." })
    }
  }

  const handleStructuredChange = useCallback((definition: StructuredOutputDefinition, issues: StructuredOutputIssue[]) => {
    setStructuredDefinition(definition)
    setStructuredIssues(issues)
  }, [])

  const agentsById = useMemo(() => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent])), [agentsQuery.data])
  // Nunca oferecer um Agent exclusivo de outro grupo (Parte 6/24 do pedido) — o backend também
  // valida na gravação (validateAgentsCompatibleWithScope em assistant-router.ts), isto é só o
  // picker já vindo correto.
  const teamsForCompatibility = useMemo(() => manageableTeamsQuery.data?.teams ?? [], [manageableTeamsQuery.data])
  const orchestratorAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.agentType === "ORCHESTRATOR" && scopesAreCompatible(teamsForCompatibility, orgScope, agent)),
    [agentsQuery.data, teamsForCompatibility, orgScope],
  )
  const specialistAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.agentType !== "ORCHESTRATOR" && scopesAreCompatible(teamsForCompatibility, orgScope, agent)),
    [agentsQuery.data, teamsForCompatibility, orgScope],
  )
  // Política de especialistas (orchestrator-policy.ts): quem não pode entrar aparece desabilitado
  // com o motivo — o backend aplica a mesma regra na gravação (422), isto é só a antecipação.
  // Nunca publicado também não entra (PEN-047; 422 ORCHESTRATOR_AGENT_NOT_PUBLISHED no backend).
  const specialistDisabledReason = (agent: Agent): string | null => {
    const unpublished = unpublishedReason(agent)
    if (unpublished) return unpublished
    const verdict = checkSpecialistAgainstRouting(routing, { name: agent.name, specialty: resolveAgentSpecialty(agent) })
    return verdict.allowed ? null : verdict.reason
  }

  // Versão vigente de cada agente (revisão de 03/11/2026): a do registro gravado (vem do servidor inclusive para agente inativo, sem
  // abrir o cadastro dele) e, para quem acabou de ser escolhido, a da lista de agentes.
  const savedSpecialists = useMemo(() => new Map((orchestrator?.specialists ?? []).map((specialist) => [specialist.agentId, specialist])), [orchestrator])

  function agentVersionState(agentId: string, saved: { versionNumber: number | null; active: boolean | null; published: boolean | null } | null): AgentCurrentVersionState {
    const agent = agentsById.get(agentId)
    return {
      agentId,
      versionNumber: saved?.versionNumber ?? agent?.currentVersionNumber ?? null,
      active: saved?.active ?? agent?.active ?? true,
      published: notPublishedAgentId === agentId ? false : (saved?.published ?? agent?.published ?? true),
    }
  }

  function specialistVersionState(agentId: string): AgentCurrentVersionState {
    const saved = savedSpecialists.get(agentId)
    return agentVersionState(agentId, saved ? { versionNumber: saved.agentCurrentVersionNumber ?? null, active: saved.active ?? null, published: saved.published ?? null } : null)
  }

  const orchestratorAgentVersionState = orchestratorAgentId
    ? agentVersionState(
        orchestratorAgentId,
        orchestrator && orchestrator.orchestratorAgentId === orchestratorAgentId
          ? { versionNumber: orchestrator.orchestratorAgentCurrentVersionNumber ?? null, active: orchestrator.orchestratorAgentActive ?? null, published: orchestrator.orchestratorAgentPublished ?? null }
          : null,
      )
    : null
  const incompatibleSelected = specialistAgentIds
    .map((agentId) => agentsById.get(agentId))
    .filter((agent): agent is Agent => Boolean(agent))
    .map((agent) => ({ agent, reason: specialistDisabledReason(agent) }))
    .filter((entry): entry is { agent: Agent; reason: string } => entry.reason !== null)

  // Ligado com campos = definição; desligado (ou ligado sem nenhum campo) = null (só texto livre).
  const structuredOutputPayload: StructuredOutputDefinition | null = structuredEnabled && structuredDefinition && structuredDefinition.nodes.length > 0 ? structuredDefinition : null
  const structuredBlocking = structuredEnabled && structuredIssues.length > 0

  // 422 ORCHESTRATOR_AGENT_NOT_PUBLISHED: marca o agente recusado (a mensagem do backend já diz qual).
  function markNotPublished(error: unknown) {
    if (error instanceof AdminApiError && error.code === "ORCHESTRATOR_AGENT_NOT_PUBLISHED") {
      setNotPublishedAgentId((error.details as { agentId?: string } | undefined)?.agentId ?? null)
    }
  }

  async function handleSave(acknowledgeStructuredOutputImpacts = false) {
    const finalSpecialistIds = specialistAgentIds.filter((id) => id.length > 0)
    const input = {
      name,
      orgScope,
      orchestratorAgentId,
      specialistAgentIds: finalSpecialistIds,
      invocationMode,
      recommendSupportMaterials,
      // Fonte única: o backend GERA a instrução para a IA e o metadado legado a partir daqui.
      structuredOutput: structuredOutputPayload,
      // Nenhuma versão de agente vai na gravação: os agentes rodam sempre na vigente (revisão de 03/11/2026).
    }
    setNotPublishedAgentId(null)
    if (!orchestrator) {
      try {
        const created = await createMutation.mutateAsync({ ...input, routingPolicy: routing.kind === "DOMAINS" || routing.kind === "OPEN" ? routing.kind : null, ...routingDomainPayload(routing) })
        router.push(`${LIST_HREF}/${created.id}`)
      } catch (error) {
        // já sinalizado via createMutation.isError / toast do useAdminMutation
        markNotPublished(error)
      }
      return
    }
    try {
      await updateMutation.mutateAsync({
        ...input,
        // A versão que esta edição carregou (PEN-050): outra gravação no meio → 409, nada gravado.
        expectedVersionId: orchestrator.currentVersionId,
        ...(acknowledgeStructuredOutputImpacts ? { acknowledgeStructuredOutputImpacts: true } : {}),
        // Forma nova quando o admin escolheu uma das duas respostas; legado intacto caso contrário.
        ...(routing.kind === "DOMAINS" || routing.kind === "OPEN"
          ? { routingPolicy: routing.kind, ...routingDomainPayload(routing) }
          : { policyKind: orchestrator.policyKind ?? null, policyDomains: orchestrator.policyDomains ?? [] }),
      })
      setPendingImpacts(null)
      void usageQuery.refetch()
    } catch (error) {
      // Mudança breaking em uso por Workflow em RASCUNHO: o backend pede confirmação explícita
      // (409 STRUCTURED_OUTPUT_IN_USE_DRAFT) — mostra o impacto e deixa o admin decidir. Versão
      // publicada é bloqueio (STRUCTURED_OUTPUT_IN_USE_PUBLISHED): fica só a mensagem/toast.
      if (error instanceof AdminApiError && error.code === "STRUCTURED_OUTPUT_IN_USE_DRAFT") {
        setPendingImpacts({ message: error.message, impacts: (error.details as { impacts?: StructuredOutputImpactDetails["impacts"] } | undefined)?.impacts ?? [] })
        return
      }
      // Outra pessoa gravou depois que a tela abriu: nada foi gravado e o formulário continua como está.
      if (error instanceof AdminApiError && error.code === "ORCHESTRATOR_VERSION_CONFLICT") {
        setPendingImpacts(null)
        setReapplied(false)
        setConflict({ message: error.message, publishedByName: (error.details as { publishedByName?: string | null } | undefined)?.publishedByName ?? null })
        return
      }
      // demais erros já sinalizados via updateMutation.isError / toast do useAdminMutation
      markNotPublished(error)
    }
  }

  // Coerência da política ANTES do 422 (mesma regra do backend): política incompleta, assistente
  // interativo fora de "Só chat/voz", ou registro ATIVO sem política (legado que precisa ser
  // classificado — o servidor e a constraint do banco recusam ativar sem política). O novo nasce ativo.
  const active = orchestrator?.active ?? true
  const policyProblem = describeRoutingProblem(routing, { active, invocationMode })
  // Na criação, o aviso só aparece depois de escolher uma resposta; o motivo do Criar bloqueado diz o resto.
  const showPolicyProblem = policyProblem !== null && (isEditing || routing.kind !== null)
  // Legado desativado pela migration 054: só volta a ficar ativo depois de classificado (aqui,
  // salvando a política) — o switch de ativo fica travado com o motivo.
  const legacyWithoutPolicy = orchestrator ? !orchestrator.active && orchestrator.policyKind === null : false
  const saveBlockedReason = [
    conflict ? "Outra pessoa gravou este orquestrador: atualize antes de salvar — suas alterações são reaplicadas." : null,
    name.trim().length > 1 ? null : "Informe o nome.",
    orchestratorAgentId ? null : "Escolha o agente orquestrador.",
    policyProblem,
    structuredBlocking ? `Corrija o resultado estruturado: ${structuredIssues[0]!.message}` : null,
  ]
    .filter(Boolean)
    .join(" ")
  const saveLabel = isEditing ? "Salvar alterações" : "Criar orquestrador"
  // O conflito de versão tem aviso próprio (com a ação de atualizar); a mensagem genérica de erro não o repete.
  const showMutationError = mutation.isError && !(mutation.error instanceof AdminApiError && mutation.error.code === "ORCHESTRATOR_VERSION_CONFLICT")

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <BackLink href={LIST_HREF} label="Orquestrador da INIA" />
          <h1 className="mt-1 truncate text-xl">{orchestrator ? orchestrator.name || "Editar orquestrador" : "Novo orquestrador"}</h1>
          {orchestrator ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {orchestrator.currentVersionNumber ? <Badge variant="outline">Versão {orchestrator.currentVersionNumber} em uso</Badge> : null}
              <OrchestratorVersionsPopover orchestratorId={orchestrator.id} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {orchestrator ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{orchestrator.active ? "Ativo" : legacyWithoutPolicy ? "Inativo · sem política" : "Inativo"}</span>
                <Switch
                  checked={orchestrator.active}
                  disabled={toggleActiveMutation.isPending || legacyWithoutPolicy}
                  title={legacyWithoutPolicy ? POLICY_REQUIRED_MESSAGE : undefined}
                  aria-label={orchestrator.active ? "Desativar orquestrador" : "Ativar orquestrador"}
                  onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: orchestrator.id, active: checked })}
                />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Excluir orquestrador">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir {orchestrator.name}?</AlertDialogTitle>
                    <AlertDialogDescription>Operadores no escopo dele voltam a receber a resposta genérica da INIA. {RESTORE_NOTE}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        await deleteMutation.mutateAsync(orchestrator.id)
                        router.push(LIST_HREF)
                      }}
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => router.push(LIST_HREF)}>
            Cancelar
          </Button>
          {saveBlockedReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled>
                    {saveLabel}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{saveBlockedReason}</TooltipContent>
            </Tooltip>
          ) : (
            <Button size="sm" disabled={mutation.isPending} onClick={() => handleSave()}>
              {mutation.isPending ? (isEditing ? "Salvando..." : "Criando...") : saveLabel}
            </Button>
          )}
        </div>
      </div>

      <StructuredOutputImpactDialog details={pendingImpacts} pending={updateMutation.isPending} onCancel={() => setPendingImpacts(null)} onConfirm={() => handleSave(true)} />
      {showMutationError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
      {conflict ? <VersionConflictNotice message={conflict.message} publishedByName={conflict.publishedByName} pending={reloading} onReload={() => void reloadAndReapply()} /> : null}
      {reapplied && !conflict ? <ReappliedNotice versionNumber={orchestrator?.currentVersionNumber ?? null} onDismiss={() => setReapplied(false)} /> : null}

      <Tabs defaultValue="config">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="config">Configuração</TabsTrigger>
            <TabsTrigger value="specialists">Especialistas ({specialistAgentIds.filter((id) => id.length > 0).length})</TabsTrigger>
            <TabsTrigger value="structured-output">Resultado estruturado</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="config" className="mt-4 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Quem é este orquestrador</CardTitle>
              <CardDescription>O agente que identifica o pedido do operador e decide sozinho quais especialistas acionar, o alcance e onde ele atende.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="orchestrator-name">Nome</Label>
                <Input id="orchestrator-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: INIA — Time de Contas" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="orchestrator-agent">Agente orquestrador</Label>
                {/* Sem os grupos administráveis a compatibilidade de escopo ainda não é conhecida: espera, em vez de dizer "nenhum agente". */}
                {!agentsQuery.data || !manageableTeamsQuery.data ? (
                  <Skeleton className="h-10 w-full" />
                ) : orchestratorAgents.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Nenhum agente do tipo &quot;Orquestrador&quot; disponível para este grupo.{" "}
                    <Link href="/admin/agents/new" className="underline underline-offset-2">
                      Crie um em Agentes
                    </Link>{" "}
                    — é ele quem identifica o pedido do operador e decide quais especialistas acionar.
                  </p>
                ) : (
                  <AgentPicker id="orchestrator-agent" agents={orchestratorAgents} value={orchestratorAgentId} onChange={setOrchestratorAgentId} />
                )}
                {orchestratorAgentVersionState ? <AgentCurrentVersion state={orchestratorAgentVersionState} /> : null}
              </div>
              <div className="space-y-1.5">
                <Label>Grupo</Label>
                {manageableTeamsQuery.data ? (
                  <OrgScopeSelect teams={manageableTeamsQuery.data.teams} value={orgScope} onChange={setOrgScope} allowAllTeams={manageableTeamsQuery.data.unrestricted} />
                ) : (
                  <Skeleton className="h-10 w-full" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Onde pode ser acionado</Label>
                <Select value={invocationMode} onValueChange={(value) => setInvocationMode(value as OrchestratorInvocationMode)}>
                  <SelectTrigger className="w-full" aria-label="Onde pode ser acionado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ORCHESTRATOR_INVOCATION_MODE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  &quot;Só workflows&quot; ou &quot;Só chat/voz&quot; evita que este orquestrador dispute o mesmo operador com outro configurado pro outro caminho — um
                  orquestrador de domínio usado por Workflows nasce com &quot;Só workflows&quot;.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Política de roteamento</CardTitle>
                <CardDescription>Quais especialistas este orquestrador pode escolher — a regra vale no servidor ao salvar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <OrchestratorPolicyFields routing={routing} domains={businessDomainsQuery.data ?? []} domainsLoading={businessDomainsQuery.isPending} onChange={setRouting} />
                {showPolicyProblem ? (
                  <p className="text-xs text-destructive" role="alert" data-testid="policy-problem">
                    {policyProblem}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Materiais de apoio</CardTitle>
                <CardDescription>Nas minhas respostas finais, posso selecionar e recomendar materiais encontrados pelos especialistas?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input"
                    aria-label="Recomendar materiais nas respostas"
                    checked={recommendSupportMaterials}
                    onChange={(event) => setRecommendSupportMaterials(event.target.checked)}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium leading-none">Recomendar materiais nas respostas</span>
                    <span className="block text-sm text-muted-foreground">Quando ativado, o Orquestrador poderá recomendar materiais relevantes encontrados nas Bases de Conhecimento consultadas pelos especialistas.</span>
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  A recomendação só aparece quando houver conteúdo realmente pertinente. Vale para chat, voz e Workflows; em cada Output do Workflow, &quot;Incluir materiais de apoio
                  recomendados&quot; decide se aquela entrega os apresenta.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="specialists" className="mt-4">
          <SpecialistsTab
            name={name}
            orchestratorAgentId={orchestratorAgentId}
            specialistAgentIds={specialistAgentIds}
            onSpecialistAgentIdsChange={setSpecialistAgentIds}
            agentsById={agentsById}
            specialistAgents={specialistAgents}
            disabledReason={specialistDisabledReason}
            incompatibleSelected={incompatibleSelected}
            renderAgentVersion={(agentId) => <AgentCurrentVersion state={specialistVersionState(agentId)} />}
          />
        </TabsContent>

        {/* Sempre montada: o construtor é dono do estado de edição — desmontar ao trocar de aba perderia o que não foi salvo. */}
        <TabsContent value="structured-output" forceMount className="mt-4 data-[state=inactive]:hidden">
          <Card>
            <CardContent className="space-y-2">
              <StructuredOutputBuilder
                key={builderKey}
                initialDefinition={builderInitialDefinition}
                enabled={structuredEnabled}
                onEnabledChange={setStructuredEnabled}
                onChange={handleStructuredChange}
                usage={usageQuery.data ?? []}
                source={orchestrator?.structuredOutputSource}
                review={orchestrator?.structuredOutputReview ?? null}
                savedInstructions={orchestrator?.structuredOutputSource === "DEFINITION" ? orchestrator.outputInstructions : null}
                legacyInstructions={orchestrator?.outputInstructions ?? null}
              />
              {structuredBlocking ? (
                <p className="text-xs text-destructive" role="alert" data-testid="structured-output-blocking">
                  Corrija o resultado estruturado antes de salvar: {structuredIssues[0]!.message}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function NewOrchestratorPage() {
  return <OrchestratorForm />
}

export function OrchestratorEditorPage({ orchestratorId }: { orchestratorId: string }) {
  const orchestratorQuery = useOrchestratorQuery(orchestratorId)

  if (orchestratorQuery.isLoading) return <Skeleton className="h-96 w-full" />
  // Uma atualização que falha com o registro já carregado não desmonta o formulário (perderia o que não foi salvo).
  if (!orchestratorQuery.data) {
    return <p className="text-sm text-destructive">Não foi possível carregar o orquestrador.</p>
  }

  return <OrchestratorForm orchestrator={orchestratorQuery.data} onReload={() => orchestratorQuery.refetch()} />
}
