"use client"

import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { scopesAreCompatible } from "@/lib/admin/scope-compatibility"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { useOrchestratorVersionsQuery } from "@/queries/admin/use-assistant-queries"
import { PROCESS_ASSESSMENT_HINT, SPECIALIST_OUTPUT_CONTRACT_LABELS, type SpecialistOutputContract, type FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { triggerDataOrigin, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"

/**
 * Versão do Orquestrador que a etapa executa (PEN-076, com a revisão de 03/11/2026): a versão guarda a CONFIGURAÇÃO do Orquestrador
 * (lista de especialistas, política, resultado estruturado) e continua referenciada pela etapa — gravar o Orquestrador de novo não
 * muda esta etapa; sem versão fixada, o Workflow fixa a vigente ao publicar. Os agentes (o orquestrador e os especialistas) NÃO
 * ficam fixados: cada execução usa a versão vigente de cada um no momento em que começa.
 */
function OrchestratorVersionNote({ orchestrator, versionId, onUseVigente }: { orchestrator: Orchestrator | null; versionId: string | undefined; onUseVigente: (versionId: string) => void }) {
  const versionsQuery = useOrchestratorVersionsQuery(orchestrator?.id ?? null, Boolean(orchestrator && versionId))
  if (!orchestrator) return null
  const pinned = versionsQuery.data?.find((version) => version.id === versionId)
  const vigente = orchestrator.currentVersionNumber ?? null
  const newer = pinned && vigente && vigente > pinned.number && orchestrator.currentVersionId ? orchestrator.currentVersionId : null
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {versionId
          ? `Esta etapa usa a configuração da versão ${pinned?.number ?? "fixada"} do Orquestrador (especialistas, política e resultado estruturado); gravar o Orquestrador de novo não muda esta etapa.`
          : `Ao publicar o Workflow, esta etapa fica fixada na configuração da versão vigente do Orquestrador${vigente ? ` (versão ${vigente})` : ""}.`}
      </p>
      <p data-testid="orchestrator-agents-vigente">
        O agente orquestrador e os especialistas rodam sempre na versão vigente de cada um: publicar um deles vale nas próximas execuções, sem republicar o Workflow.
      </p>
      {newer ? (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onUseVigente(newer)}>
          Usar a versão {vigente} (vigente) nesta etapa
        </Button>
      ) : null}
    </div>
  )
}

export function OrchestratorForm({
  node,
  orchestrators,
  teams,
  scope,
  trigger,
  onChange,
}: {
  node: Extract<FlowNode, { type: "orchestrator" }>
  orchestrators: Orchestrator[]
  teams: Team[]
  scope?: { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string; subteamId?: string }
  trigger?: WorkflowTrigger
  onChange: (next: FlowNode) => void
}) {
  // Nunca oferecer um Orchestrator exclusivo de outro grupo (Parte 6/24 do pedido) — o backend
  // também valida no publish (scopesAreCompatible em workflow-router.ts), isto é só o picker já
  // vindo correto. Sem `scope` (ex.: workflow ainda carregando), não filtra por grupo.
  const workflowOrchestrators = orchestrators.filter(
    (orchestrator) => orchestrator.invocationMode !== "INTERACTIVE" && (!scope || scopesAreCompatible(teams, scope, orchestrator)),
  )
  const fieldId = useId()
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-orchestrator`}>Orquestrador</Label>
        {workflowOrchestrators.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Nenhum orquestrador habilitado para workflow — crie ou libere um em Orquestradores.
          </p>
        ) : (
          <Select
            value={node.config.orchestratorId}
            onValueChange={(orchestratorId) => {
              // Trocar de Orquestrador fixa a versão vigente do novo (PEN-076); a versão do anterior nunca vale para outro.
              const { orchestratorVersionId: _previous, ...rest } = node.config
              void _previous
              const vigente = orchestrators.find((candidate) => candidate.id === orchestratorId)?.currentVersionId
              onChange({ ...node, config: { ...rest, orchestratorId, ...(vigente ? { orchestratorVersionId: vigente } : {}) } })
            }}
          >
            <SelectTrigger id={`${fieldId}-orchestrator`} className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {workflowOrchestrators.map((orchestrator) => (
                <SelectItem key={orchestrator.id} value={orchestrator.id}>
                  {orchestrator.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <OrchestratorVersionNote
        orchestrator={orchestrators.find((candidate) => candidate.id === node.config.orchestratorId) ?? null}
        versionId={node.config.orchestratorVersionId}
        onUseVigente={(orchestratorVersionId) => onChange({ ...node, config: { ...node.config, orchestratorVersionId } })}
      />
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-instruction`}>Instrução</Label>
        <Input
          id={`${fieldId}-instruction`}
          value={node.config.instruction}
          onChange={(event) => onChange({ ...node, config: { ...node.config, instruction: event.target.value } })}
          placeholder="ex.: Analise esta ocorrência, identifique a causa e gere recomendações."
        />
        <p className="text-xs text-muted-foreground">
          Essa instrução será enviada automaticamente ao orquestrador quando o fluxo chegar aqui. Ele decidirá quais agentes utilizar e disponibilizará o
          resultado para as próximas etapas do workflow.
        </p>
      </div>
      {trigger && triggerDataOrigin(trigger) === "channel_flag" ? (
        <div className="space-y-1.5">
          <Label>Formato dos especialistas</Label>
          <Select
            value={node.config.specialistOutputContract ?? "FEEDBACK"}
            onValueChange={(value) => onChange({ ...node, config: { ...node.config, specialistOutputContract: value === "PROCESS_ASSESSMENT" ? "PROCESS_ASSESSMENT" : undefined } })}
          >
            <SelectTrigger className="w-full" aria-label="Formato dos especialistas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SPECIALIST_OUTPUT_CONTRACT_LABELS) as SpecialistOutputContract[]).map((contract) => (
                <SelectItem key={contract} value={contract}>
                  {SPECIALIST_OUTPUT_CONTRACT_LABELS[contract]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {node.config.specialistOutputContract === "PROCESS_ASSESSMENT" ? PROCESS_ASSESSMENT_HINT : "Cada especialista devolve um feedback de monitoria com evidência literal da transcrição."}
          </p>
        </div>
      ) : null}
      <OrchestratorRoutingField node={node} orchestrator={orchestrators.find((orchestrator) => orchestrator.id === node.config.orchestratorId) ?? null} onChange={onChange} />
    </div>
  )
}

/**
 * V1.7.1 — ROTEAMENTO do nó: "Decidido pela IA" (padrão) ou "Domínios fixos deste disparo" — quando o gatilho já determina o
 * assunto (ex.: Flag de contestação → Faturamento), o especialista de cada domínio é acionado direto, sem chamada de IA para
 * escolher. Só domínios com EXATAMENTE um especialista ativo no Orquestrador podem ser marcados (o backend valida no publish).
 */
function OrchestratorRoutingField({ node, orchestrator, onChange }: { node: Extract<FlowNode, { type: "orchestrator" }>; orchestrator: Orchestrator | null; onChange: (next: FlowNode) => void }) {
  const routing = node.config.routing
  const selected = routing?.mode === "DOMAINS" ? routing.businessDomainIds : []
  const domains = new Map<string, { name: string; specialists: string[] }>()
  for (const specialist of orchestrator?.specialists ?? []) {
    if (specialist.specialtyKind !== "DOMAIN" || !specialist.businessDomainId) continue
    const entry = domains.get(specialist.businessDomainId) ?? { name: specialist.businessDomain?.name ?? specialist.domain ?? "Domínio", specialists: [] }
    entry.specialists.push(specialist.agentName)
    domains.set(specialist.businessDomainId, entry)
  }
  const setRouting = (next: Extract<FlowNode, { type: "orchestrator" }>["config"]["routing"]) => onChange({ ...node, config: { ...node.config, routing: next } })
  return (
    <div className="space-y-1.5">
      <Label>Roteamento</Label>
      <Select value={routing?.mode === "DOMAINS" ? "DOMAINS" : "MODEL"} onValueChange={(value) => setRouting(value === "DOMAINS" ? { mode: "DOMAINS", businessDomainIds: [] } : undefined)}>
        <SelectTrigger className="w-full" aria-label="Roteamento">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MODEL">Decidido pela IA</SelectItem>
          <SelectItem value="DOMAINS">Domínios fixos deste disparo</SelectItem>
        </SelectContent>
      </Select>
      {routing?.mode === "DOMAINS" ? (
        <div className="space-y-2 rounded-md border p-3">
          {domains.size === 0 ? (
            <p className="text-xs text-muted-foreground">Este Orquestrador não tem especialistas de domínio.</p>
          ) : (
            [...domains.entries()].map(([id, domain]) => {
              const usable = domain.specialists.length === 1
              return (
                <div key={id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{domain.name}</p>
                    <p className="text-xs text-muted-foreground">{usable ? `Especialista: ${domain.specialists[0]}` : `${domain.specialists.length} especialistas desse domínio — escolha pela IA`}</p>
                  </div>
                  <Switch
                    aria-label={`Acionar ${domain.name} neste disparo`}
                    checked={selected.includes(id)}
                    disabled={!usable && !selected.includes(id)}
                    onCheckedChange={(checked) => setRouting({ mode: "DOMAINS", businessDomainIds: checked ? [...selected, id] : selected.filter((entry) => entry !== id) })}
                  />
                </div>
              )
            })
          )}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {routing?.mode === "DOMAINS"
          ? "O especialista de cada domínio marcado é acionado direto, sem chamada de IA para escolher. Use quando o gatilho já determina o assunto (ex.: Flag de contestação → Faturamento). Com um único especialista e avaliação de processo, a síntese também é dispensada."
          : "O Orquestrador escolhe os especialistas com IA a cada execução."}
      </p>
    </div>
  )
}
