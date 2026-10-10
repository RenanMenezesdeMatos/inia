"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react"

import { useReactFlowColorMode } from "@/hooks/use-react-flow-color-mode"
import { useIsMobile } from "@/hooks/use-mobile"
import "@xyflow/react/dist/style.css"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { ArrowLeft, Bot, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
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
import { AGENT_TYPE_ICONS } from "@/components/admin/agents/agent-visuals"
import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, type Agent } from "@/schemas/admin/agent.schema"
import { ORCHESTRATOR_INVOCATION_MODE_LABELS, type OrchestratorInvocationMode } from "@/schemas/admin/assistant.schema"
import { type StructuredOutputDefinition, type StructuredOutputIssue } from "@/schemas/admin/structured-output"
import { AdminApiError } from "@/lib/admin/admin-api"
import { StructuredOutputBuilder } from "./structured-output-builder"
import type { StructuredOutputImpactDetails } from "./structured-output-impacts"
import { StructuredOutputImpactDialog } from "./structured-output-impacts"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useManageableTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { scopesAreCompatible } from "@/lib/admin/scope-compatibility"
import {
  useDeleteOrchestratorMutation,
  useOrchestratorQuery,
  useStructuredOutputUsageQuery,
  useToggleOrchestratorActiveMutation,
  useUpdateOrchestratorMutation,
} from "@/queries/admin/use-assistant-queries"
import { cn } from "@/lib/utils"

type OrchestratorNodeData = { name: string; agentName: string }
type SpecialistNodeData = { agentName: string; agentType: Agent["agentType"] | null }

function OrchestratorNodeCard({ data, selected }: NodeProps & { data: OrchestratorNodeData }) {
  return (
    <div
      className={cn(
        "w-56 rounded-xl border-2 border-primary/50 bg-card p-3 shadow-sm ring-4 ring-primary/10",
        selected && "border-primary ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.name || "Orquestrador"}</p>
          <p className="truncate text-[11px] text-muted-foreground">{data.agentName || "Sem agente definido"}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  )
}

function SpecialistNodeCard({ data, selected }: NodeProps & { data: SpecialistNodeData }) {
  const Icon = data.agentType ? AGENT_TYPE_ICONS[data.agentType] : Sparkles
  const colors = data.agentType ? AGENT_TYPE_COLORS[data.agentType] : { icon: "text-muted-foreground", iconBg: "bg-muted" }
  return (
    <div className={cn("w-52 rounded-xl border bg-card p-2.5 shadow-sm", selected && "border-primary ring-4 ring-primary/20")}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", colors.iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", colors.icon)} />
        </span>
        <p className="min-w-0 truncate text-sm">{data.agentName || "Selecione um agente"}</p>
      </div>
    </div>
  )
}

const nodeTypes = { orchestrator: OrchestratorNodeCard, specialist: SpecialistNodeCard }

function buildGraph(
  name: string,
  orchestratorAgentName: string,
  specialists: { agentName: string; agentType: Agent["agentType"] | null }[],
  selectedNodeId: string | null,
) {
  const specialistHeight = 84
  const totalHeight = Math.max(specialists.length * specialistHeight, specialistHeight)
  const nodes: Node[] = [
    {
      id: "orchestrator",
      type: "orchestrator",
      position: { x: 0, y: totalHeight / 2 - 34 },
      data: { name, agentName: orchestratorAgentName },
      draggable: false,
      selected: selectedNodeId === "orchestrator",
    },
    ...specialists.map((specialist, index) => ({
      id: `specialist-${index}`,
      type: "specialist",
      position: { x: 340, y: index * specialistHeight },
      data: specialist,
      draggable: false,
      selected: selectedNodeId === `specialist-${index}`,
    })),
  ]
  const edges: Edge[] = specialists.map((_, index) => ({
    id: `e-orchestrator-specialist-${index}`,
    source: "orchestrator",
    target: `specialist-${index}`,
    animated: true,
  }))
  return { nodes, edges }
}

function AgentDetailPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const Icon = AGENT_TYPE_ICONS[agent.agentType]
  const colors = AGENT_TYPE_COLORS[agent.agentType]
  return (
    <Card className="flex h-full flex-col rounded-none border-0 border-l shadow-none">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", colors.iconBg)}>
            <Icon className={cn("h-4 w-4", colors.icon)} />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{agent.name}</CardTitle>
            <Badge variant="outline" className="mt-1">
              {AGENT_TYPE_LABELS[agent.agentType]}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar detalhes" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <ScrollArea className="min-h-0 flex-1">
        <CardContent className="space-y-4 pb-6">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Objetivo</Label>
            <p className="text-sm">{agent.objective}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Descrição</Label>
            <p className="text-sm">{agent.description}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prompt (contexto)</Label>
            <p className="rounded-md border bg-muted/40 p-2 text-sm whitespace-pre-wrap">{agent.contextPrompt}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Bases de conhecimento consultadas</Label>
            {agent.knowledgeDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma base associada.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {agent.knowledgeDocuments.map((doc) => (
                  <li key={doc.id}>{doc.title}</li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </ScrollArea>
    </Card>
  )
}

export function OrchestratorEditorPage({ orchestratorId }: { orchestratorId: string }) {
  const colorMode = useReactFlowColorMode()
  // No celular o split lado a lado deixava a configuração com ~250px (ilegível): empilha
  // configuração em cima e mapa embaixo. Só orientação — nenhum estado/regra muda.
  const isMobile = useIsMobile()
  const router = useRouter()
  const orchestratorQuery = useOrchestratorQuery(orchestratorId)
  const agentsQuery = useAgentsQuery()
  const manageableTeamsQuery = useManageableTeamsQuery()
  const updateMutation = useUpdateOrchestratorMutation(orchestratorId)
  const toggleActiveMutation = useToggleOrchestratorActiveMutation()
  const deleteMutation = useDeleteOrchestratorMutation()

  const [name, setName] = useState("")
  const [orchestratorAgentId, setOrchestratorAgentId] = useState("")
  const [orgScope, setOrgScope] = useState<OrgScopeValue>({ scopeType: "ALL_TEAMS" })
  const [specialistAgentIds, setSpecialistAgentIds] = useState<string[]>([])
  const [invocationMode, setInvocationMode] = useState<OrchestratorInvocationMode>("BOTH")
  const [recommendSupportMaterials, setRecommendSupportMaterials] = useState(false)
  // Política de roteamento (forma alvo, 057) — o legado (policyKind) é traduzido pelo mesmo dual-read do backend.
  const [routing, setRouting] = useState<RoutingPolicy>({ kind: null })
  // Catálogo dinâmico de domínios (só ativos) — o que o registro já tinha continua visível mesmo desativado.
  const businessDomainsQuery = useBusinessDomainsQuery()
  // Resultado estruturado — fonte única (structured-output.ts): o construtor visual é dono do
  // estado de edição; aqui só o que o Salvar precisa (definição atual, problemas, ligado/desligado)
  // e uma chave para remontar o construtor quando o registro (re)carrega do servidor.
  const [structuredEnabled, setStructuredEnabled] = useState(false)
  const [structuredDefinition, setStructuredDefinition] = useState<StructuredOutputDefinition | null>(null)
  const [structuredIssues, setStructuredIssues] = useState<StructuredOutputIssue[]>([])
  const [builderKey, setBuilderKey] = useState(0)
  const [pendingImpacts, setPendingImpacts] = useState<StructuredOutputImpactDetails | null>(null)
  const usageQuery = useStructuredOutputUsageQuery(orchestratorId)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null)
  const [configCollapsed, setConfigCollapsed] = useState(false)
  const configPanelRef = useRef<PanelImperativeHandle>(null)

  // Registro carregado (ou recarregado) do servidor: o formulário recomeça dele e o construtor do resultado estruturado
  // remonta — ajuste na renderização, sem render extra.
  const [loadedOrchestrator, setLoadedOrchestrator] = useState<typeof orchestratorQuery.data>(undefined)
  if (loadedOrchestrator !== orchestratorQuery.data) {
    setLoadedOrchestrator(orchestratorQuery.data)
    const orchestrator = orchestratorQuery.data
    if (orchestrator) {
      setName(orchestrator.name)
      setOrchestratorAgentId(orchestrator.orchestratorAgentId)
      setOrgScope({ scopeType: orchestrator.scopeType, teamId: orchestrator.teamId ?? undefined, subteamId: orchestrator.subteamId ?? undefined })
      setSpecialistAgentIds(orchestrator.specialists.map((specialist) => specialist.agentId))
      setInvocationMode(orchestrator.invocationMode)
      setRecommendSupportMaterials(orchestrator.recommendSupportMaterials)
      setRouting(resolveRoutingPolicy(orchestrator))
      setStructuredEnabled(orchestrator.structuredOutput !== null && orchestrator.structuredOutput.nodes.length > 0)
      setStructuredDefinition(orchestrator.structuredOutput)
      setStructuredIssues([])
      setBuilderKey((current) => current + 1)
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
  const specialistDisabledReason = (agent: Agent): string | null => {
    const verdict = checkSpecialistAgainstRouting(routing, { name: agent.name, specialty: resolveAgentSpecialty(agent) })
    return verdict.allowed ? null : verdict.reason
  }
  const incompatibleSelected = specialistAgentIds
    .map((agentId) => agentsById.get(agentId))
    .filter((agent): agent is Agent => Boolean(agent))
    .map((agent) => ({ agent, reason: specialistDisabledReason(agent) }))
    .filter((entry): entry is { agent: Agent; reason: string } => entry.reason !== null)

  const { nodes, edges } = useMemo(
    () =>
      buildGraph(
        name,
        agentsById.get(orchestratorAgentId)?.name ?? "",
        specialistAgentIds.map((agentId) => {
          const agent = agentsById.get(agentId)
          return { agentName: agent?.name ?? "", agentType: agent?.agentType ?? null }
        }),
        selectedNodeId,
      ),
    [name, orchestratorAgentId, specialistAgentIds, agentsById, selectedNodeId],
  )

  const detailAgent = useMemo(() => {
    if (!detailNodeId) return null
    if (detailNodeId === "orchestrator") return agentsById.get(orchestratorAgentId) ?? null
    const index = Number(detailNodeId.replace("specialist-", ""))
    return agentsById.get(specialistAgentIds[index] ?? "") ?? null
  }, [detailNodeId, orchestratorAgentId, specialistAgentIds, agentsById])

  function updateSpecialist(index: number, agentId: string) {
    setSpecialistAgentIds((current) => current.map((id, i) => (i === index ? agentId : id)))
  }

  function removeSpecialist(index: number) {
    setSpecialistAgentIds((current) => current.filter((_, i) => i !== index))
    setSelectedNodeId(null)
    setDetailNodeId(null)
  }

  // Del/Backspace com um especialista selecionado remove ele do orquestrador — não é o
  // ReactFlow que gerencia isso (os nós são derivados do estado local a cada render, não do
  // estado interno dele), então isso escuta no document inteiro, e ignora quando o foco está
  // num campo de texto (senão um Backspace normal ao digitar em qualquer input da tela
  // apagaria o especialista selecionado). O orquestrador nunca é removido por essa tecla — só
  // pelo botão de excluir no topo, que já tem sua própria confirmação.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return
      if (!selectedNodeId?.startsWith("specialist-")) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      event.preventDefault()
      removeSpecialist(Number(selectedNodeId.replace("specialist-", "")))
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId])

  function toggleConfigPanel() {
    const panel = configPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) {
      panel.expand()
      setConfigCollapsed(false)
    } else {
      panel.collapse()
      setConfigCollapsed(true)
    }
  }

  // Ligado com campos = definição; desligado (ou ligado sem nenhum campo) = null (só texto livre).
  const structuredOutputPayload: StructuredOutputDefinition | null = structuredEnabled && structuredDefinition && structuredDefinition.nodes.length > 0 ? structuredDefinition : null
  const structuredBlocking = structuredEnabled && structuredIssues.length > 0

  async function handleSave(acknowledgeStructuredOutputImpacts = false) {
    try {
      await updateMutation.mutateAsync({
        name,
        orgScope,
        orchestratorAgentId,
        specialistAgentIds: specialistAgentIds.filter((id) => id.length > 0),
        invocationMode,
        recommendSupportMaterials,
        // Fonte única: o backend GERA a instrução para a IA e o metadado legado a partir daqui.
        structuredOutput: structuredOutputPayload,
        ...(acknowledgeStructuredOutputImpacts ? { acknowledgeStructuredOutputImpacts: true } : {}),
        // Forma nova quando o admin escolheu uma das duas respostas; legado intacto caso contrário.
        ...(routing.kind === "DOMAINS" || routing.kind === "OPEN"
          ? { routingPolicy: routing.kind, ...routingDomainPayload(routing) }
          : { policyKind: orchestratorQuery.data?.policyKind ?? null, policyDomains: orchestratorQuery.data?.policyDomains ?? [] }),
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
      // demais erros já sinalizados via updateMutation.isError / toast do useAdminMutation
    }
  }

  if (orchestratorQuery.isLoading || !agentsQuery.data || !manageableTeamsQuery.data) {
    return <Skeleton className="h-96 w-full" />
  }
  if (orchestratorQuery.isError || !orchestratorQuery.data) {
    return <p className="text-sm text-destructive">Não foi possível carregar o orquestrador.</p>
  }

  // Coerência da política ANTES do 422 (mesma regra do backend): política incompleta, assistente
  // interativo fora de "Só chat/voz", ou registro ATIVO sem política (legado que precisa ser
  // classificado — o servidor e a constraint do banco recusam ativar sem política).
  const policyProblem = describeRoutingProblem(routing, { active: orchestratorQuery.data.active, invocationMode })
  // Legado desativado pela migration 054: só volta a ficar ativo depois de classificado (aqui,
  // salvando a política) — o switch de ativo fica travado com o motivo.
  const legacyWithoutPolicy = !orchestratorQuery.data.active && orchestratorQuery.data.policyKind === null
  const canSave = name.trim().length > 1 && Boolean(orchestratorAgentId) && policyProblem === null && !structuredBlocking

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/assistant">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Input value={name} onChange={(event) => setName(event.target.value)} className="max-w-sm text-base font-semibold" />
        <Button variant="ghost" size="icon" aria-label={configCollapsed ? "Expandir configuração" : "Recolher configuração"} onClick={toggleConfigPanel}>
          {configCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={orchestratorQuery.data.active}
              disabled={toggleActiveMutation.isPending || legacyWithoutPolicy}
              title={legacyWithoutPolicy ? POLICY_REQUIRED_MESSAGE : undefined}
              aria-label={orchestratorQuery.data.active ? "Desativar orquestrador" : "Ativar orquestrador"}
              onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: orchestratorId, active: checked })}
            />
            <span className="text-sm text-muted-foreground">{orchestratorQuery.data.active ? "Ativo" : legacyWithoutPolicy ? "Inativo · sem política" : "Inativo"}</span>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Excluir orquestrador">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir {orchestratorQuery.data.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Essa ação não pode ser desfeita. Operadores no escopo dele voltam a receber a resposta genérica da INIA.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await deleteMutation.mutateAsync(orchestratorId)
                    router.push("/admin/assistant")
                  }}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={() => handleSave()} disabled={!canSave || updateMutation.isPending}>
            {updateMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      <StructuredOutputImpactDialog details={pendingImpacts} pending={updateMutation.isPending} onCancel={() => setPendingImpacts(null)} onConfirm={() => handleSave(true)} />

      <div className="h-[calc(100vh-13rem)] min-h-[520px]">
        <ResizablePanelGroup key={isMobile ? "vertical" : "horizontal"} orientation={isMobile ? "vertical" : "horizontal"} className="rounded-lg border">
          <ResizablePanel
            panelRef={configPanelRef}
            defaultSize={isMobile ? "65" : "38"}
            minSize="28"
            maxSize={isMobile ? "85" : "60"}
            collapsible
            collapsedSize="0"
            className="overflow-y-auto"
          >
            <Card className="rounded-none border-0 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Configuração</CardTitle>
                <CardDescription>O orquestrador identifica o pedido do operador e decide sozinho quais especialistas acionar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Agente orquestrador</Label>
              {orchestratorAgents.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Nenhum agente do tipo &quot;Orquestrador&quot; disponível — crie um em Agentes.
                </p>
              ) : (
                <AgentPicker agents={orchestratorAgents} value={orchestratorAgentId} onChange={setOrchestratorAgentId} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Grupo</Label>
              <OrgScopeSelect
                teams={manageableTeamsQuery.data?.teams ?? []}
                value={orgScope}
                onChange={setOrgScope}
                allowAllTeams={manageableTeamsQuery.data?.unrestricted ?? true}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Onde pode ser acionado</Label>
              <Select value={invocationMode} onValueChange={(value) => setInvocationMode(value as OrchestratorInvocationMode)}>
                <SelectTrigger className="w-full">
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
                &quot;Só workflows&quot; ou &quot;Só chat/voz&quot; evita que este orquestrador dispute o mesmo operador com outro configurado pro outro caminho.
              </p>
            </div>
            <OrchestratorPolicyFields routing={routing} domains={businessDomainsQuery.data ?? []} domainsLoading={businessDomainsQuery.isPending} onChange={setRouting} />
            <div className="space-y-2">
              <Label>Materiais de apoio</Label>
              <p className="text-xs text-muted-foreground">Nas minhas respostas finais, posso selecionar e recomendar materiais encontrados pelos especialistas?</p>
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
              <p className="text-xs text-muted-foreground">A recomendação só aparece quando houver conteúdo realmente pertinente. Vale para chat, voz e Workflows; em cada Output do Workflow, &quot;Incluir materiais de apoio recomendados&quot; decide se aquela entrega os apresenta.</p>
            </div>
            <div className="space-y-1.5">
              {policyProblem ? (
                <p className="text-xs text-destructive" role="alert" data-testid="policy-problem">
                  {policyProblem}
                </p>
              ) : null}
              {incompatibleSelected.length > 0 ? (
                <p className="text-xs text-destructive" role="alert">
                  {incompatibleSelected.map(({ agent, reason }) => `${agent.name}: ${reason}`).join(" ")}
                </p>
              ) : null}
            </div>
            <StructuredOutputBuilder
              key={builderKey}
              initialDefinition={orchestratorQuery.data.structuredOutput}
              enabled={structuredEnabled}
              onEnabledChange={setStructuredEnabled}
              onChange={handleStructuredChange}
              usage={usageQuery.data ?? []}
              source={orchestratorQuery.data.structuredOutputSource}
              review={orchestratorQuery.data.structuredOutputReview}
              savedInstructions={orchestratorQuery.data.structuredOutputSource === "DEFINITION" ? orchestratorQuery.data.outputInstructions : null}
              legacyInstructions={orchestratorQuery.data.outputInstructions}
            />
            {structuredBlocking ? (
              <p className="text-xs text-destructive" role="alert" data-testid="structured-output-blocking">
                Corrija o resultado estruturado antes de salvar: {structuredIssues[0]!.message}
              </p>
            ) : null}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Especialistas</Label>
                <Button variant="outline" size="sm" onClick={() => setSpecialistAgentIds((current) => [...current, ""])}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>
              {specialistAgentIds.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Nenhum especialista ainda — o orquestrador responde sozinho, sem tools.</p>
              ) : null}
              <div className="space-y-3">
                {specialistAgentIds.map((agentId, index) => (
                  <div key={index} className="flex items-start gap-2 rounded-md border p-2">
                    <div className="min-w-0 flex-1">
                      <AgentPicker agents={specialistAgents} value={agentId} onChange={(value) => updateSpecialist(index, value)} disabledReason={specialistDisabledReason} />
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0" aria-label="Remover especialista" onClick={() => removeSpecialist(index)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
                {updateMutation.isError ? <p className="text-sm text-destructive">{(updateMutation.error as Error).message}</p> : null}
              </CardContent>
            </Card>
          </ResizablePanel>
          <ResizableHandle withHandle />

          <ResizablePanel minSize="30">
            <div className="h-full min-w-0 bg-muted/20">
              <ReactFlowProvider>
                <ReactFlow
                  colorMode={colorMode}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.3 }}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  // Sem isso, o duplo clique do React Flow entra em conflito com o nosso próprio
                  // duplo clique de nó (abrir o painel de detalhes) — o padrão da biblioteca é
                  // dar zoom no ponto clicado, inclusive quando o clique cai em cima de um nó,
                  // então o zoom "vencia" e o painel nunca chegava a abrir de forma perceptível.
                  zoomOnDoubleClick={false}
                  onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                  onNodeDoubleClick={(_event, node) => {
                    setSelectedNodeId(node.id)
                    setDetailNodeId(node.id)
                  }}
                  onPaneClick={() => setSelectedNodeId(null)}
                >
                  <Background />
                  <Controls />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </ResizablePanel>

          {detailAgent ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="28" minSize="20" maxSize="40" className="overflow-hidden">
                <AgentDetailPanel agent={detailAgent} onClose={() => setDetailNodeId(null)} />
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
