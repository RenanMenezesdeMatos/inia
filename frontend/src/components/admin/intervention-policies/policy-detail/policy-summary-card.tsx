"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { PolicyView } from "@/schemas/admin/intervention-policy.schema"

import { Note } from "../shared/fields"
import { latestPublishedVersion } from "../shared/helpers"
import { usePolicyDescriber } from "../shared/use-policy-describer"

/**
 * O QUE A POLÍTICA FAZ e ONDE ELA RODA, em texto — para quem abre a política entender sem ler o editor de regras.
 *
 * "O que faz" descreve a versão em vigor (ou a última publicada; sem publicação, o rascunho): cada regra, na ordem de prioridade,
 * com o que a INIA faz, para quem vai e se pede aprovação. "Onde roda" lista os Workflows com o nó que cita a política: uma
 * política só é avaliada quando um Workflow chega a esse nó — publicada e sem Workflow, ela não faz nada, e isso fica dito aqui.
 */
function WorkflowState({ workflow }: { workflow: NonNullable<PolicyView["workflows"]>["items"][number] }) {
  if (workflow.published && workflow.active) return <Badge variant="secondary">Publicado e ligado</Badge>
  if (workflow.published) return <Badge variant="outline">Publicado, mas desligado</Badge>
  return <Badge variant="outline">Só no rascunho do editor</Badge>
}

export function PolicySummaryCard({ policy }: { policy: PolicyView }) {
  const described = policy.inForce ?? latestPublishedVersion(policy.versions) ?? policy.draft
  const definition = described?.definition ?? null
  const which = !described ? null : policy.inForce?.id === described.id ? `Versão em vigor (v${described.version}).` : described.status === "PUBLISHED" ? `Versão publicada v${described.version}, ainda não em vigor.` : "Rascunho: nada disto vale até publicar."
  const describer = usePolicyDescriber(definition?.indicatorCode ?? null)
  const indicator = definition?.indicatorCode ? describer.indicatorName(definition.indicatorCode) : null
  const rules = definition ? [...definition.rules].sort((a, b) => a.priority - b.priority) : []
  const workflows = policy.workflows

  return (
    <Card data-testid="policy-summary">
      <CardHeader>
        <CardTitle className="text-base">O que esta política faz</CardTitle>
        <CardDescription>
          {which ? `${which} ` : ""}
          {indicator ? `Assunto: ${indicator}. ` : definition ? "Política geral (sem indicador principal). " : ""}
          Vale para: {policy.scopeLabel}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {rules.length === 0 ? (
          <p className="text-muted-foreground">Ainda não há regras: a política não faz nada.</p>
        ) : (
          <>
            <ol className="space-y-2">
              {rules.map((rule, index) => (
                <li key={rule.key} className="flex gap-2">
                  <span className="font-medium text-muted-foreground">{index + 1}.</span>
                  <div className="space-y-0.5">
                    <p className="font-medium">{rule.name}</p>
                    <p>{describer.rule(rule)}</p>
                    {rule.inconclusiveActions.length > 0 ? <p className="text-xs text-muted-foreground">Se faltarem dados para concluir, a INIA {describer.actions(rule.inconclusiveActions)}.</p> : null}
                  </div>
                </li>
              ))}
            </ol>
            {rules.length > 1 ? <p className="text-xs text-muted-foreground">{definition!.matchStrategy === "FIRST_MATCH" ? "Se mais de uma regra for atendida, vale só a primeira desta lista." : "Se mais de uma regra for atendida, valem todas."}</p> : null}
            <p className="text-xs text-muted-foreground">Em toda ação aberta ou sugerida, quem lidera recebe no Acompanhamento o resumo da INIA: a situação, o que já foi feito, a evolução medida e o próximo passo.</p>
          </>
        )}

        {workflows ? (
          <div className="space-y-2 border-t pt-4" data-testid="policy-workflows">
            <p className="font-medium">Onde esta política roda</p>
            {!workflows.running ? (
              <Note tone="warning">
                {workflows.items.length + workflows.outOfScope === 0 ? "Esta política ainda não roda: nenhum Workflow passa por ela." : "Esta política não está rodando: nenhum Workflow publicado e ligado passa por ela."} Uma política só é avaliada quando um Workflow chega ao nó “Avaliar política de acompanhamento” — é o Workflow que diz quando olhar e para quem.{" "}
                <Link href="/admin/workflows" className="font-medium text-primary hover:underline">
                  Abrir Workflows
                </Link>
              </Note>
            ) : null}
            {workflows.items.length > 0 ? (
              <ul className="space-y-1.5">
                {workflows.items.map((workflow) => (
                  <li key={workflow.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/workflows/${workflow.id}`} className="text-primary hover:underline">
                      {workflow.name}
                    </Link>
                    <WorkflowState workflow={workflow} />
                    {workflow.published && workflow.inDraft === false ? <span className="text-xs text-muted-foreground">o rascunho do editor não usa mais esta política</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {workflows.outOfScope > 0 ? <p className="text-xs text-muted-foreground">Mais {workflows.outOfScope} Workflow(s) fora do seu escopo de gestão.</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
