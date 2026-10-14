"use client"

import { useMutation } from "@tanstack/react-query"
import { ExternalLink, FlaskConical, Info } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { PolicySimulationView } from "@/components/interventions/policy-simulation-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminApiError } from "@/lib/admin/admin-api"
import { cn } from "@/lib/utils"
import { usePublishedPolicySummariesQuery, useSimulationPeopleQuery } from "@/queries/admin/use-intervention-policy-queries"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { ESCALATION_ROLE_LABELS, RESPONSIBLE_ROLE_LABELS } from "@/schemas/admin/intervention-policy.schema"
import { findAncestorNodeIds, INTERVENTION_POLICY_MODE_LABELS, NODE_TYPE_LABELS, type FlowGraph, type FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { simulatePolicy } from "@/services/admin/intervention-policy-service"

type PolicyNode = Extract<FlowNode, { type: "intervention_policy" }>

/**
 * Painel do nó "Avaliar política de acompanhamento". O nó NÃO tem critérios, prazos, responsáveis nem aprovações próprios —
 * são da política (sem configuração concorrente). Aqui só: qual política publicada, o modo, as referências de análise e a
 * prévia/simulação para quem monta o Workflow.
 */
export function InterventionPolicyForm({ node, graph, onChange }: { node: PolicyNode; graph: FlowGraph; onChange: (next: FlowNode) => void }) {
  const policiesQuery = usePublishedPolicySummariesQuery()
  const capabilities = useCurrentUserQuery().data?.access.capabilities
  const policies = policiesQuery.data ?? []
  const selected = policies.find((policy) => policy.id === node.config.policyId) ?? null
  const ancestors = [...findAncestorNodeIds(graph, node.id)].map((id) => graph.nodes.find((candidate) => candidate.id === id)).filter((candidate): candidate is FlowNode => Boolean(candidate) && candidate!.type !== "trigger")
  const set = (config: Partial<PolicyNode["config"]>) => onChange({ ...node, config: { ...node.config, ...config } })

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Política de acompanhamento</Label>
        {policiesQuery.isLoading ? <p className="text-xs text-muted-foreground">Carregando políticas…</p> : null}
        {!policiesQuery.isLoading && policies.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nenhuma política publicada disponível no seu escopo. Publique uma em Administração › Políticas de acompanhamento.</p>
        ) : (
          <Select value={node.config.policyId || undefined} onValueChange={(policyId) => set({ policyId })}>
            <SelectTrigger className="w-full" aria-label="Política de acompanhamento">
              <SelectValue placeholder="Selecione a política" />
            </SelectTrigger>
            <SelectContent>
              {policies.map((policy) => (
                <SelectItem key={policy.id} value={policy.id} disabled={!policy.active && policy.id !== node.config.policyId}>
                  {policy.name} · {policy.scopeLabel}
                  {policy.inForceVersion ? ` · v${policy.inForceVersion}` : " · vigência futura"}
                  {policy.active ? "" : " (inativa)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {node.config.policyId && !selected && !policiesQuery.isLoading ? <p className="text-xs text-destructive">A política escolhida não está mais disponível (inativa, sem versão publicada ou fora do seu escopo).</p> : null}
      </div>

      {selected ? (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{selected.name}</span>
            {capabilities?.canAccessInterventionPolicies ? (
              <Link href={`/admin/intervention-policies/${selected.id}`} target="_blank" className="flex items-center gap-1 text-xs text-primary hover:underline">
                Abrir configuração <ExternalLink className="size-3" />
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">A configuração é de quem gerencia políticas</span>
            )}
          </div>
          {selected.description ? <p className="text-xs text-muted-foreground">{selected.description}</p> : null}
          <p className="text-xs text-muted-foreground">
            {selected.indicatorCode ? `Indicador: ${selected.indicatorCode} · ` : ""}
            {selected.matchStrategy === "FIRST_MATCH" ? "Vale a primeira regra atendida, pela prioridade" : "Valem todas as regras atendidas"}
            {selected.scheduledVersions.length > 0 ? ` · ${selected.scheduledVersions.length} versão(ões) com vigência futura` : ""}
          </p>
          <ul className="space-y-0.5 text-xs">
            {selected.rules.map((rule) => (
              <li key={rule.key}>
                {rule.priority}. {rule.name} → {rule.actions.map((action) => selected.types.find((type) => type.key === action.typeKey)?.name ?? action.typeKey).join(", ") || "—"}
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t pt-2">
            <p className="text-xs font-medium">Intervenções possíveis</p>
            {selected.types.map((type) => (
              <div key={type.key} className="flex flex-wrap items-center gap-2 text-xs">
                <span>{type.name}</span>
                {type.responsibleRole ? <Badge variant="outline">Responsável: {RESPONSIBLE_ROLE_LABELS[type.responsibleRole]}</Badge> : null}
                {type.sensitive ? (
                  <Badge variant="outline">Decisão humana restrita</Badge>
                ) : type.approval?.required ? (
                  <Badge variant="outline">Aprovação: {ESCALATION_ROLE_LABELS[type.approval.approverRole]}</Badge>
                ) : (
                  <Badge variant="outline">Sem aprovação</Badge>
                )}
                {!type.active ? <span className="text-destructive">tipo inativo</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Modo</Label>
        <RadioGroup value={node.config.mode} onValueChange={(mode) => set({ mode: mode as PolicyNode["config"]["mode"] })} className="space-y-1">
          {(["RECOMMEND_ONLY", "APPLY_POLICY"] as const).map((mode) => (
            <label key={mode} className="flex items-start gap-2 text-sm">
              <RadioGroupItem value={mode} className="mt-0.5" />
              <span>
                {INTERVENTION_POLICY_MODE_LABELS[mode]}
                <span className="block text-xs text-muted-foreground">
                  {mode === "RECOMMEND_ONLY" ? "Toda intervenção nasce como recomendação: o responsável aceita ou descarta." : "Abre conforme cada regra da política (inclusive aguardando aprovação, quando o tipo exige)."}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <Label>Referências de análise (opcional)</Label>
        <p className="text-xs text-muted-foreground">Nós anteriores cujos registros verificáveis (feedback publicado, caso, atendimento) entram como fonte do relatório. Texto gerado por IA nunca é evidência.</p>
        {ancestors.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum nó antes deste.</p> : null}
        {ancestors.map((candidate) => {
          const checked = node.config.analysisSourceNodeIds.includes(candidate.id)
          return (
            <label key={candidate.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                onChange={() => set({ analysisSourceNodeIds: checked ? node.config.analysisSourceNodeIds.filter((id) => id !== candidate.id) : [...node.config.analysisSourceNodeIds, candidate.id].slice(0, 5) })}
              />
              {candidate.label || NODE_TYPE_LABELS[candidate.type]}
            </label>
          )
        })}
      </div>

      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Use o resultado em Conditions posteriores: <strong>Resultado geral</strong> (criada, aprovação pendente, recomendada, existente, nenhuma regra, inconclusiva, conflito, carência, não aplicável), os indicadores sim/não por resultado e a <strong>Decisão de cada tipo de intervenção</strong> (ex.: &quot;Decisão — Plano de ação&quot; é &quot;Recomendada ao responsável&quot;), escolhidos na lista de campos. A versão da política é fixada no disparo; retry e retomada não reavaliam.
        </span>
      </div>

      {selected ? <PolicySimulationPanel policyId={selected.id} mode={node.config.mode} /> : null}
    </div>
  )
}

function PolicySimulationPanel({ policyId, mode }: { policyId: string; mode: PolicyNode["config"]["mode"] }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [personId, setPersonId] = useState<string | null>(null)
  const [asOf, setAsOf] = useState("")
  const peopleQuery = useSimulationPeopleQuery(search, open)
  const simulation = useMutation({ mutationFn: () => simulatePolicy(policyId, { personId: personId!, asOf: asOf ? new Date(`${asOf}T23:59:00`).toISOString() : null, version: "IN_FORCE", mode }) })
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border p-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium">
        <FlaskConical className="size-4 text-muted-foreground" /> Simular com um colaborador
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">Sem efeitos: nada é gravado, nenhuma intervenção é aberta, ninguém é avisado. Só aparecem colaboradores que você já pode consultar.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="simulation-search">Colaborador</Label>
            <Input id="simulation-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pelo nome" />
            <div className="max-h-32 overflow-y-auto">
              {(peopleQuery.data ?? []).map((person) => (
                <button key={person.id} type="button" onClick={() => setPersonId(person.id)} className={cn("block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted", personId === person.id && "bg-muted font-medium")}>
                  {person.name}
                  {person.teamName ? ` · ${person.teamName}` : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="simulation-date">Período analisado até</Label>
            <Input id="simulation-date" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
            <p className="text-xs text-muted-foreground">Vazio = agora. As janelas da política terminam nesta data.</p>
          </div>
        </div>
        <Button size="sm" disabled={!personId || simulation.isPending} onClick={() => simulation.mutate()}>
          {simulation.isPending ? "Simulando…" : "Simular"}
        </Button>
        {simulation.error ? <p className="text-xs text-destructive">{simulation.error instanceof AdminApiError ? simulation.error.message : "Não foi possível simular."}</p> : null}
        {simulation.data ? <PolicySimulationView result={simulation.data} /> : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
