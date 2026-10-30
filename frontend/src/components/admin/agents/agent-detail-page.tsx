"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ChevronDown, Copy, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { CharacterCounter, characterCountState } from "@/components/ui/character-counter"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { OrgScopeSelect, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { ActionLimitsCard } from "@/components/admin/agents/action-limits-card"
import { describeBusinessDomain, type BusinessDomainRef } from "@/schemas/admin/business-domain.schema"
import { resolveAgentSpecialty, SPECIALTY_KIND_HELP, SPECIALTY_KIND_LABELS, type SpecialtyKind } from "@/schemas/admin/orchestrator-policy"
import { useBusinessDomainsQuery } from "@/queries/admin/use-business-domain-queries"
import { INVESTIGATION_CAPABILITIES, INVESTIGATION_CAPABILITY_DESCRIPTIONS, INVESTIGATION_CAPABILITY_LABELS, toolsForCapabilities, type InvestigationCapability } from "@/schemas/admin/investigation.schema"
import { useManageableTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import { useKnowledgeDocumentsQuery } from "@/queries/admin/use-knowledge-queries"
import {
  useAgentHistoryQuery,
  useAgentQuery,
  useAgentRunsQuery,
  useCreateAgentMutation,
  useTestAgentMutation,
  useToggleAgentActiveMutation,
  useUpdateAgentMutation,
} from "@/queries/admin/use-agent-queries"
import {
  AGENT_TEXT_LIMITS,
  AGENT_TYPE_LABELS,
  AGENT_HISTORY_ACTION_LABELS,
  AGENT_RUN_SOURCE_LABELS,
  type Agent,
  type AgentTextField,
  type AgentType,
} from "@/schemas/admin/agent.schema"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"
import { cn } from "@/lib/utils"

const COMING_SOON_TABS = [
  { value: "capabilities", label: "Capacidades" },
  { value: "proposals", label: "Propostas" },
]

function formatChangeValue(field: string, value: string) {
  if (field === "agentType") return AGENT_TYPE_LABELS[value as AgentType] ?? value
  return value
}

function teamDefaultDocumentIds(documents: KnowledgeDocument[], orgScope: OrgScopeValue): string[] {
  if (orgScope.scopeType === "ALL_TEAMS") return []
  return documents
    .filter((document) =>
      document.orgScopes.some((scope) => {
        if (scope.scopeType === "ALL_TEAMS") return true
        if (orgScope.scopeType === "SUBTEAM") return scope.subteamId === orgScope.subteamId
        return scope.teamId === orgScope.teamId
      }),
    )
    .map((document) => document.id)
}

function KnowledgeBaseMover({
  documents,
  selectedIds,
  onChange,
}: {
  documents: { id: string; title: string }[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const available = documents.filter((document) => !selectedIds.includes(document.id))
  const selected = documents.filter((document) => selectedIds.includes(document.id))

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Disponíveis</p>
        <ScrollArea className="h-48 rounded-lg border">
          <div className="space-y-1 p-2">
            {available.length ? (
              available.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => onChange([...selectedIds, document.id])}
                >
                  <span>{document.title}</span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))
            ) : (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma base disponível.</p>
            )}
          </div>
        </ScrollArea>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Selecionadas</p>
        <ScrollArea className="h-48 rounded-lg border">
          <div className="space-y-1 p-2">
            {selected.length ? (
              selected.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => onChange(selectedIds.filter((id) => id !== document.id))}
                >
                  <span>{document.title}</span>
                  <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))
            ) : (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma base selecionada.</p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function AgentHistoryTimeline({ agentId }: { agentId: string }) {
  const historyQuery = useAgentHistoryQuery(agentId)

  if (historyQuery.isLoading) return <Skeleton className="h-40 w-full" />
  if (historyQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
  if (!historyQuery.data?.length) return <p className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>

  return (
    <div className="space-y-4">
      {historyQuery.data.map((entry) => (
        <div key={entry.id} className="flex gap-3 border-b border-border pb-4 last:border-0">
          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {entry.changedByName} · {AGENT_HISTORY_ACTION_LABELS[entry.action]}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            </p>
            {entry.changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {entry.changes.map((change) => (
                  <li key={change.field}>
                    <span className="font-medium text-foreground">{change.label}:</span>{" "}
                    {/* prohibitedTopicIds: registros antigos de "Restrições específicas" (marcação removida na migration 124). */}
                    {change.field === "knowledgeDocumentIds" || change.field === "prohibitedTopicIds" ? (
                      change.to
                    ) : (
                      <>
                        “{formatChangeValue(change.field, change.from)}” → “{formatChangeValue(change.field, change.to)}”
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentTestPanel({ agentId }: { agentId: string }) {
  const testMutation = useTestAgentMutation(agentId)
  const [input, setInput] = useState("")

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="agent-test-input">Transcrição ou cenário de teste</Label>
        <Textarea
          id="agent-test-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={8}
          placeholder="Cole aqui a transcrição de uma chamada, ou descreva o cenário que o agente deve avaliar."
        />
      </div>
      <div className="flex justify-end">
        <Button disabled={input.trim().length < 10 || testMutation.isPending} onClick={() => testMutation.mutate(input)}>
          {testMutation.isPending ? "Executando..." : "Executar teste"}
        </Button>
      </div>

      {testMutation.data ? (
        <Card className={testMutation.data.status === "FAILED" ? "border-destructive/40" : undefined}>
          <CardHeader>
            <CardTitle className="text-base">{testMutation.data.status === "FAILED" ? "Falha na execução" : "Resposta do agente"}</CardTitle>
          </CardHeader>
          <CardContent>
            {testMutation.data.status === "FAILED" ? (
              <p className="text-sm text-destructive">{testMutation.data.errorMessage}</p>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{testMutation.data.outputText}</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {testMutation.isError ? <p className="text-sm text-destructive">{(testMutation.error as Error).message}</p> : null}
    </div>
  )
}

function AgentRunsTimeline({ agentId }: { agentId: string }) {
  const runsQuery = useAgentRunsQuery(agentId)

  if (runsQuery.isLoading) return <Skeleton className="h-40 w-full" />
  if (runsQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar as execuções.</p>
  if (!runsQuery.data?.length) return <p className="text-sm text-muted-foreground">Nenhuma execução registrada ainda.</p>

  return (
    <div className="space-y-4">
      {runsQuery.data.map((run) => (
        <div key={run.id} className="flex gap-3 border-b border-border pb-4 last:border-0">
          <div className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", run.status === "FAILED" ? "bg-destructive" : "bg-primary")} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">
              {AGENT_RUN_SOURCE_LABELS[run.source]} · {run.status === "FAILED" ? "Falhou" : run.status === "PENDING" ? "Em execução" : "Concluído"}
            </p>
            <p className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
            <p className="truncate text-sm text-muted-foreground">{run.inputContext}</p>
            {run.status === "FAILED" ? (
              <p className="text-sm text-destructive">{run.errorMessage}</p>
            ) : run.outputText ? (
              <p className="whitespace-pre-wrap text-sm">{run.outputText}</p>
            ) : null}
            {run.caseId ? (
              <Link href={`/supervisor/cases/${run.caseId}`} className="text-xs text-primary underline underline-offset-2">
                Ver caso gerado
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentForm({ agent, duplicateFrom, onSaved }: { agent?: Agent; duplicateFrom?: Agent; onSaved: (id: string) => void }) {
  const router = useRouter()
  const manageableTeamsQuery = useManageableTeamsQuery()
  const knowledgeQuery = useKnowledgeDocumentsQuery()
  const createMutation = useCreateAgentMutation()
  const updateMutation = useUpdateAgentMutation()
  const toggleActiveMutation = useToggleAgentActiveMutation()
  const isEditing = Boolean(agent)
  const mutation = isEditing ? updateMutation : createMutation
  const source = agent ?? duplicateFrom

  const [name, setName] = useState(agent ? agent.name : duplicateFrom ? `${duplicateFrom.name} (cópia)` : "")
  const [agentType, setAgentType] = useState<AgentType>(source?.agentType ?? "CALL_FEEDBACK")
  // Especialidade (forma alvo, 057/060): tipo + domínio de negócio (do catálogo)/competência; legados
  // só com `specialty` são traduzidos pelo mesmo dual-read do backend (resolveAgentSpecialty) — o
  // save nunca quebra. O select de domínio é DINÂMICO (só ativos); o domínio que o Agent já tem
  // continua na lista mesmo desativado, marcado "(desativado)" — nunca some.
  const sourceSpecialty = source ? resolveAgentSpecialty(source) : null
  const [specialtyKind, setSpecialtyKind] = useState<SpecialtyKind | null>(sourceSpecialty?.kind ?? null)
  const [domain, setDomain] = useState<BusinessDomainRef | null>(sourceSpecialty?.domain ?? null)
  const businessDomainsQuery = useBusinessDomainsQuery()
  const domainOptions: BusinessDomainRef[] = [...(businessDomainsQuery.data ?? []).filter((candidate) => candidate.active), ...(domain && !(businessDomainsQuery.data ?? []).some((candidate) => candidate.active && candidate.code === domain.code) ? [domain] : [])]
  const [capability, setCapability] = useState<string>(sourceSpecialty?.capability ?? "")
  const [consolidatedInput, setConsolidatedInput] = useState<boolean>(sourceSpecialty?.acceptsConsolidated ?? false)
  const [recommendSupportMaterials, setRecommendSupportMaterials] = useState<boolean>(source?.recommendSupportMaterials ?? false)
  // Ferramentas de investigação: o Agent é DONO das capacidades (Workflow só restringe; chat usa como está).
  const [investigationCapabilities, setInvestigationCapabilities] = useState<InvestigationCapability[]>(source?.investigationCapabilities ?? [])
  const [showTools, setShowTools] = useState(false)
  function toggleCapability(capability: InvestigationCapability) {
    setInvestigationCapabilities((current) => INVESTIGATION_CAPABILITIES.filter((item) => (item === capability ? !current.includes(item) : current.includes(item))))
  }
  const [objective, setObjective] = useState(source?.objective ?? "")
  const [description, setDescription] = useState(source?.description ?? "")
  const [contextPrompt, setContextPrompt] = useState(source?.contextPrompt ?? "")
  const [orgScope, setOrgScope] = useState<OrgScopeValue>(
    source ? { scopeType: source.scopeType, teamId: source.teamId ?? undefined, subteamId: source.subteamId ?? undefined } : { scopeType: "ALL_TEAMS" },
  )
  const [knowledgeDocumentIds, setKnowledgeDocumentIds] = useState<string[]>(source?.knowledgeDocuments.map((doc) => doc.id) ?? [])
  // Limites de atuação: interruptor + texto. Desligado, o texto fica guardado (volta ao religar) e não vale.
  const [actionLimitsEnabled, setActionLimitsEnabled] = useState<boolean>(source?.actionLimitsEnabled ?? false)
  const [actionLimits, setActionLimits] = useState<string>(source?.actionLimits ?? "")

  // Escopo Administrativo (Parte 10/11): criando um agente novo, um admin restrito nunca deve
  // ficar com "Todos os grupos" pré-selecionado.
  const [scopeCheckedFor, setScopeCheckedFor] = useState<{ agent: Agent | undefined; teams: typeof manageableTeamsQuery.data } | null>(null)
  if (scopeCheckedFor === null || scopeCheckedFor.agent !== agent || scopeCheckedFor.teams !== manageableTeamsQuery.data) {
    setScopeCheckedFor({ agent, teams: manageableTeamsQuery.data })
    if (!agent && manageableTeamsQuery.data && !manageableTeamsQuery.data.unrestricted && orgScope.scopeType === "ALL_TEAMS") {
      setOrgScope({ scopeType: "TEAM" })
    }
  }

  // Agente recarregado do servidor: o formulário recomeça dele (ajuste na renderização, sem render extra; na montagem os
  // valores iniciais já vêm dele).
  const [loadedAgent, setLoadedAgent] = useState(agent)
  if (loadedAgent !== agent) {
    setLoadedAgent(agent)
    if (agent) {
      setName(agent.name)
      setAgentType(agent.agentType)
      const loaded = resolveAgentSpecialty(agent)
      setSpecialtyKind(loaded.kind)
      setDomain(loaded.domain)
      setCapability(loaded.capability ?? "")
      setConsolidatedInput(loaded.acceptsConsolidated)
      setObjective(agent.objective)
      setDescription(agent.description)
      setContextPrompt(agent.contextPrompt)
      setOrgScope({ scopeType: agent.scopeType, teamId: agent.teamId ?? undefined, subteamId: agent.subteamId ?? undefined })
      setKnowledgeDocumentIds(agent.knowledgeDocuments.map((doc) => doc.id))
      setActionLimitsEnabled(agent.actionLimitsEnabled)
      setActionLimits(agent.actionLimits ?? "")
    }
  }

  function handleOrgScopeChange(nextScope: OrgScopeValue) {
    setOrgScope(nextScope)
    if (!isEditing && knowledgeQuery.data) {
      setKnowledgeDocumentIds(teamDefaultDocumentIds(knowledgeQuery.data, nextScope))
    }
  }

  async function handleSubmit() {
    const input = {
      name,
      agentType,
      specialtyKind,
      businessDomainId: specialtyKind === "DOMAIN" ? (domain?.id ?? null) : null,
      capability: specialtyKind === "CROSS_CUTTING" && capability.trim() ? capability.trim() : null,
      consolidatedInput: specialtyKind === "SYNTHESIS" ? true : consolidatedInput,
      recommendSupportMaterials,
      investigationCapabilities,
      objective,
      description,
      contextPrompt,
      orgScope,
      knowledgeDocumentIds,
      actionLimitsEnabled,
      actionLimits: actionLimits.trim() ? actionLimits.trim() : null,
    }
    if (agent) {
      await updateMutation.mutateAsync({ id: agent.id, input })
      onSaved(agent.id)
    } else {
      const created = await createMutation.mutateAsync(input)
      onSaved(created.id)
    }
  }

  // Mesmos limites do backend (AGENT_TEXT_LIMITS): fora deles o Salvar fica desabilitado e diz por quê.
  const textValues: Partial<Record<AgentTextField, string>> = {
    name,
    objective,
    description,
    contextPrompt,
    ...(specialtyKind === "CROSS_CUTTING" ? { capability } : {}),
    actionLimits,
  }
  const textChecks = (Object.entries(textValues) as [AgentTextField, string][]).map(([field, value]) => ({
    label: AGENT_TEXT_LIMITS[field].label,
    ...characterCountState(value, AGENT_TEXT_LIMITS[field]),
  }))
  const overLimit = textChecks.filter((check) => check.over).map((check) => check.label)
  const belowMin = textChecks.filter((check) => check.belowMin).map((check) => check.label)
  const saveBlockedReason = [
    overLimit.length ? `Acima do limite de caracteres: ${overLimit.join(", ")}.` : null,
    belowMin.length ? `Preencha o mínimo de caracteres: ${belowMin.join(", ")}.` : null,
    specialtyKind === "DOMAIN" && !domain?.id ? "Escolha o domínio de negócio." : null,
    actionLimitsEnabled && !actionLimits.trim() ? "Descreva até onde este agente vai ou desligue os limites de atuação." : null,
  ]
    .filter(Boolean)
    .join(" ")
  const canSubmit = !saveBlockedReason

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/admin/agents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Agentes
          </Link>
          <h1 className="mt-1 text-xl">{isEditing ? agent!.name || "Editar agente" : "Novo agente"}</h1>
        </div>
        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{agent!.active ? "Ativo" : "Inativo"}</span>
                <Switch
                  checked={agent!.active}
                  disabled={toggleActiveMutation.isPending}
                  aria-label={agent!.active ? "Desativar agente" : "Ativar agente"}
                  onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: agent!.id, active: checked })}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push(`/admin/agents/new?duplicateFrom=${agent!.id}`)}>
                <Copy className="h-3.5 w-3.5" /> Duplicar
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/agents")}>
            Cancelar
          </Button>
          {canSubmit ? (
            <Button size="sm" disabled={mutation.isPending} onClick={handleSubmit}>
              {mutation.isPending ? "Salvando..." : isEditing ? "Salvar alterações" : "Criar agente"}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled>
                    {isEditing ? "Salvar alterações" : "Criar agente"}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{saveBlockedReason}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          {isEditing ? (
            <TabsTrigger value="test">Teste</TabsTrigger>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value="test" disabled>
                    Teste
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Disponível depois que o agente for criado.</TooltipContent>
            </Tooltip>
          )}
          {isEditing ? (
            <TabsTrigger value="runs">Execuções</TabsTrigger>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value="runs" disabled>
                    Execuções
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Disponível depois que o agente for criado.</TooltipContent>
            </Tooltip>
          )}
          {isEditing ? (
            <TabsTrigger value="history">Histórico</TabsTrigger>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value="history" disabled>
                    Histórico
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Disponível depois que o agente for criado.</TooltipContent>
            </Tooltip>
          )}
          {COMING_SOON_TABS.map((tab) => (
            <Tooltip key={tab.value}>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value={tab.value} disabled>
                    {tab.label}
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Chega em uma próxima etapa.</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>

        <TabsContent value="config" className="mt-4 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Quem é este agente</CardTitle>
              <CardDescription>Nome, tipo e o que ele deve alcançar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-name">Nome</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Agente de Feedback de Chamadas"
                  aria-describedby="agent-name-count"
                  aria-invalid={characterCountState(name, AGENT_TEXT_LIMITS.name).over || undefined}
                />
                <CharacterCounter id="agent-name-count" value={name} limits={AGENT_TEXT_LIMITS.name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-type">Tipo</Label>
                <Select value={agentType} onValueChange={(value) => setAgentType(value as AgentType)}>
                  <SelectTrigger id="agent-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AGENT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo de especialidade</Label>
                <Select
                  value={specialtyKind ?? "NONE"}
                  onValueChange={(value) => {
                    const next = value === "NONE" ? null : (value as SpecialtyKind)
                    setSpecialtyKind(next)
                    if (next !== "DOMAIN") setDomain(null)
                    if (next === "SYNTHESIS") setConsolidatedInput(true)
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Tipo de especialidade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Sem classificação</SelectItem>
                    {(Object.keys(SPECIALTY_KIND_LABELS) as SpecialtyKind[]).map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {SPECIALTY_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {specialtyKind === "DOMAIN" ? (
                  <div className="space-y-1">
                    <Select value={domain?.code ?? ""} onValueChange={(code) => setDomain(domainOptions.find((candidate) => candidate.code === code) ?? null)}>
                      <SelectTrigger className="w-full" aria-label="Domínio de negócio">
                        <SelectValue placeholder={businessDomainsQuery.isPending ? "Carregando domínios…" : "Domínio de negócio"} />
                      </SelectTrigger>
                      <SelectContent>
                        {domainOptions.map((candidate) => (
                          <SelectItem key={candidate.code} value={candidate.code}>
                            {describeBusinessDomain(candidate)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Lista do catálogo de <Link href="/admin/business-domains" className="underline underline-offset-2">Domínios de negócio</Link> — cadastre um novo lá e ele aparece aqui.
                      {domain && !domain.id ? " Este Agent referencia um código legado ainda sem registro no catálogo — escolha um domínio para salvar." : ""}
                    </p>
                  </div>
                ) : null}
                {specialtyKind === "CROSS_CUTTING" ? (
                  <div className="space-y-1.5">
                    <Input
                      value={capability}
                      onChange={(event) => setCapability(event.target.value)}
                      placeholder="Competência (ex.: Qualidade, Experiência, Eficiência)"
                      aria-label="Competência"
                      aria-describedby="agent-capability-count"
                      aria-invalid={characterCountState(capability, AGENT_TEXT_LIMITS.capability).over || undefined}
                    />
                    <CharacterCounter id="agent-capability-count" value={capability} limits={AGENT_TEXT_LIMITS.capability} />
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {specialtyKind ? SPECIALTY_KIND_HELP[specialtyKind] : "Sem classificação: não entra em Orquestradores por domínios (só nos abertos) e não roda depois de \"Consolidar resultados\"."}
                  {specialtyKind === "DOMAIN" && !domain ? " Escolha o domínio de negócio para salvar." : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-objective">Objetivo</Label>
                <Textarea
                  id="agent-objective"
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  rows={3}
                  placeholder="O que esse agente deve alcançar"
                  aria-describedby="agent-objective-count"
                  aria-invalid={characterCountState(objective, AGENT_TEXT_LIMITS.objective).over || undefined}
                />
                <CharacterCounter id="agent-objective-count" value={objective} limits={AGENT_TEXT_LIMITS.objective} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-description">Descrição</Label>
                <Textarea
                  id="agent-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="Como ele funciona, em linhas gerais"
                  aria-describedby="agent-description-count"
                  aria-invalid={characterCountState(description, AGENT_TEXT_LIMITS.description).over || undefined}
                />
                <CharacterCounter id="agent-description-count" value={description} limits={AGENT_TEXT_LIMITS.description} />
              </div>
              <div className="space-y-1.5">
                <Label>Grupo</Label>
                {manageableTeamsQuery.data ? (
                  <OrgScopeSelect
                    teams={manageableTeamsQuery.data.teams}
                    value={orgScope}
                    onChange={handleOrgScopeChange}
                    allowAllTeams={manageableTeamsQuery.data.unrestricted}
                  />
                ) : (
                  <Skeleton className="h-10 w-full" />
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Contexto (prompt)</CardTitle>
                <CardDescription>Instruções detalhadas de como o agente deve raciocinar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <Textarea
                  value={contextPrompt}
                  onChange={(event) => setContextPrompt(event.target.value)}
                  rows={10}
                  placeholder="Você é o Agente de..."
                  aria-label="Contexto (prompt)"
                  aria-describedby="agent-prompt-count"
                  aria-invalid={characterCountState(contextPrompt, AGENT_TEXT_LIMITS.contextPrompt).over || undefined}
                />
                <CharacterCounter id="agent-prompt-count" value={contextPrompt} limits={AGENT_TEXT_LIMITS.contextPrompt} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bases de conhecimento consultadas</CardTitle>
                <CardDescription>
                  Ao escolher um grupo, as bases já associadas a ele entram pré-selecionadas — mova para “Disponíveis” se não quiser usar alguma.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {knowledgeQuery.data?.length ? (
                  <KnowledgeBaseMover documents={knowledgeQuery.data} selectedIds={knowledgeDocumentIds} onChange={setKnowledgeDocumentIds} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma base de conhecimento cadastrada ainda.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Materiais de apoio</CardTitle>
                <CardDescription>Quando eu responder diretamente, posso recomendar materiais?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input"
                    aria-label="Recomendar materiais quando este Agente responder diretamente"
                    checked={recommendSupportMaterials}
                    onChange={(event) => setRecommendSupportMaterials(event.target.checked)}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium leading-none">Recomendar materiais quando este Agente responder diretamente</span>
                    <span className="block text-sm text-muted-foreground">Quando ativado, o Agente poderá indicar materiais relevantes das Bases de Conhecimento que consultar durante a execução.</span>
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">Quando este Agente atuar como especialista de um Orquestrador, a seleção final dos materiais será responsabilidade do Orquestrador.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ferramentas de investigação</CardTitle>
                <CardDescription>O que posso investigar nos dados antes de concluir? As ferramentas calculam fatos; eu interpreto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-3" role="group" aria-label="Ferramentas de investigação">
                  {INVESTIGATION_CAPABILITIES.map((capability) => (
                    <label key={capability} className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-input"
                        aria-label={INVESTIGATION_CAPABILITY_LABELS[capability]}
                        checked={investigationCapabilities.includes(capability)}
                        onChange={() => toggleCapability(capability)}
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium leading-none">{INVESTIGATION_CAPABILITY_LABELS[capability]}</span>
                        <span className="block text-sm text-muted-foreground">{INVESTIGATION_CAPABILITY_DESCRIPTIONS[capability]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Sem nenhuma capacidade marcada, o Agente responde como sempre (uma chamada, contexto pré-montado). Com capacidades, ele investiga
                  dinamicamente antes de responder — só o necessário, nunca todas por obrigação. Um Workflow pode restringir as capacidades numa
                  execução, nunca conceder novas; no chat e no avatar valem as marcadas aqui.
                </p>
                <Collapsible open={showTools} onOpenChange={setShowTools}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-expanded={showTools}>
                      <ChevronDown className={cn("mr-1 h-3.5 w-3.5 transition-transform", showTools && "rotate-180")} aria-hidden="true" />
                      Ferramentas liberadas (avançado, somente leitura)
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {investigationCapabilities.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">Nenhuma ferramenta liberada.</p>
                    ) : (
                      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2" data-testid="investigation-tools">
                        {toolsForCapabilities(investigationCapabilities).map((tool) => (
                          <li key={tool.key}>
                            <span className="font-medium text-foreground">{tool.label}</span> <span className="font-mono">({tool.key})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            <ActionLimitsCard enabled={actionLimitsEnabled} text={actionLimits} onEnabledChange={setActionLimitsEnabled} onTextChange={setActionLimits} />

            {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
          </div>
        </TabsContent>

        <TabsContent value="test" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Testar agente</CardTitle>
              <CardDescription>Execute o agente agora, com a configuração atual, contra um cenário de exemplo.</CardDescription>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <AgentTestPanel agentId={agent!.id} />
              ) : (
                <p className="text-sm text-muted-foreground">O teste fica disponível depois que o agente for criado.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Execuções</CardTitle>
              <CardDescription>Testes manuais e disparos por gatilho já executados por este agente.</CardDescription>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <AgentRunsTimeline agentId={agent!.id} />
              ) : (
                <p className="text-sm text-muted-foreground">As execuções aparecem depois que o agente for criado.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de alterações</CardTitle>
              <CardDescription>Quem criou, quem alterou, o que mudou e quando.</CardDescription>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <AgentHistoryTimeline agentId={agent!.id} />
              ) : (
                <p className="text-sm text-muted-foreground">O histórico aparece depois que o agente for criado.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {COMING_SOON_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {tab.label} chega em uma próxima etapa.
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export function NewAgentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const duplicateFromId = searchParams.get("duplicateFrom")
  const duplicateFromQuery = useAgentQuery(duplicateFromId)

  if (duplicateFromId && duplicateFromQuery.isLoading) return <Skeleton className="h-96 w-full" />

  return <AgentForm duplicateFrom={duplicateFromQuery.data} onSaved={(id) => router.push(`/admin/agents/${id}`)} />
}

export function EditAgentPage({ agentId }: { agentId: string }) {
  const router = useRouter()
  const agentQuery = useAgentQuery(agentId)

  if (agentQuery.isLoading) return <Skeleton className="h-96 w-full" />
  if (agentQuery.isError || !agentQuery.data) {
    return <p className="text-sm text-destructive">Não foi possível carregar este agente.</p>
  }

  return <AgentForm agent={agentQuery.data} onSaved={() => router.push("/admin/agents")} />
}
