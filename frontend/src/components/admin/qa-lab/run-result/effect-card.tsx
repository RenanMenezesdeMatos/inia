"use client"

import { Bot, Send, ShieldCheck, Sparkles } from "lucide-react"
import { FEEDBACK_DISPOSITION_REASON_LABELS, type QaEffect, type QaRun } from "@/schemas/admin/qa-lab.schema"
import { personLabel } from "../qa-lab-format"
import { StructuredOutput } from "../structured-output"
import { scalar, surfaceLabel } from "./run-format"

export function EffectCard({ effect, people }: { effect: QaEffect; people: QaRun["trace"]["people"] }) {
  const recipient = (id: string) => personLabel(people, id)
  let title = ""
  let rows: { label: string; value: React.ReactNode }[] = []
  let Icon = Send
  if (effect.kind === "FEEDBACK") {
    title = "OUTPUT SIMULADO"
    rows = [
      { label: "Destinatário", value: recipient(effect.operatorId) },
      { label: "Surface", value: "Acompanhamento (Feedback + Caso)" },
      { label: "Título", value: effect.title ?? "—" },
      ...(effect.evidenceFound ? [{ label: "Evidência", value: <span className="italic">“{effect.evidenceFound}”</span> }] : []),
      { label: "Conteúdo", value: <span className="whitespace-pre-wrap">{effect.recommendation ?? "—"}</span> },
      ...(effect.supportMaterials?.length
        ? [
            {
              label: effect.supportMaterials.length === 1 ? "Material de apoio" : "Materiais de apoio",
              value: (
                <ul className="space-y-1">
                  {effect.supportMaterials.map((material) => (
                    <li key={material.materialId}>
                      <span className="font-medium">{material.title}</span> — {material.reason}
                    </li>
                  ))}
                </ul>
              ),
            },
          ]
        : []),
    ]
  } else if (effect.kind === "ALERT") {
    Icon = effect.alertType === "WORKFLOW_ESCALATION" ? Send : effect.alertType === "WORKFLOW_HUMAN_REVIEW" ? ShieldCheck : Send
    title = effect.alertType === "WORKFLOW_ESCALATION" ? "ESCALONAMENTO SIMULADO" : effect.alertType === "WORKFLOW_HUMAN_REVIEW" ? "REVISÃO HUMANA SIMULADA" : "OUTPUT SIMULADO"
    rows = [
      { label: effect.alertType === "WORKFLOW_ESCALATION" ? "Destino" : effect.alertType === "WORKFLOW_HUMAN_REVIEW" ? "Revisor que seria utilizado" : "Destinatário", value: recipient(effect.recipientId) },
      { label: "Surfaces", value: effect.surfaces.map(surfaceLabel).join(" + ") },
      { label: effect.alertType === "WORKFLOW_ESCALATION" ? "Motivo" : "Conteúdo", value: <span className="whitespace-pre-wrap">{effect.description}</span> },
      ...(effect.caseId ? [{ label: "Caso vinculado", value: effect.caseId }] : []),
    ]
  } else if (effect.kind === "WORKFLOW_OUTPUT") {
    title = "OUTPUT SIMULADO"
    rows = [
      { label: "Destinatário", value: recipient(effect.recipientId) },
      { label: "Surface", value: `${surfaceLabel(effect.surface)} (${effect.interactionMode})` },
      { label: "Conteúdo", value: <StructuredOutput value={effect.content} /> },
    ]
  } else if (effect.kind === "CONFIG_VALUE") {
    Icon = Sparkles
    title = "CONFIGURAÇÃO — NÃO ALTERADA"
    rows = [
      { label: "Chave", value: effect.configKey },
      { label: "Valor que seria gravado", value: `${scalar(effect.value)} (${effect.valueType})` },
      { label: "Escopo", value: effect.scopeType },
    ]
  } else if (effect.kind === "INTERACTION_FEEDBACK") {
    Icon = Sparkles
    title = "FEEDBACK DE ATENDIMENTO SIMULADO"
    const counts = [
      effect.dispositions.AUTO_DELIVER ? `${effect.dispositions.AUTO_DELIVER} entregue(s) direto` : null,
      effect.dispositions.HOLD_FOR_QA ? `${effect.dispositions.HOLD_FOR_QA} para o QA de feedback` : null,
      effect.dispositions.BLOCKED ? `${effect.dispositions.BLOCKED} não entregável(is)` : null,
    ].filter(Boolean)
    rows = [
      { label: "Resultado", value: effect.status === "NOT_ANALYZABLE" ? "Atendimento sem transcrição — nada a analisar" : counts.length > 0 ? counts.join(" · ") : "Nenhum ponto para o colaborador" },
      ...(effect.reasons.length > 0 ? [{ label: "Motivos", value: <ul className="space-y-0.5">{effect.reasons.map((reason) => <li key={reason}>{FEEDBACK_DISPOSITION_REASON_LABELS[reason] ?? reason}</li>)}</ul> }] : []),
      ...(effect.policyVersion ? [{ label: "Política", value: effect.policyVersion }] : []),
      { label: "Registro", value: "Nada gravado, entregue ou notificado (simulação)" },
    ]
  } else if (effect.kind === "RELIABLE_FEEDBACK") {
    Icon = ShieldCheck
    title = "FEEDBACK CONFIÁVEL SIMULADO"
    const outcome = { READY: "Liberado — o Workflow seguiria para o próximo passo", HOLD_FOR_QA: "Retido para o QA de feedback — o Workflow esperaria a decisão", BLOCKED: "Bloqueado — nunca seria emitido (o Workflow encerraria sem Output)", REJECTED: "Rejeitado no QA — nada seria emitido" }[effect.disposition]
    rows = [
      { label: "Tipo", value: `${effect.domain === "MONITORING" ? "Monitoria" : "Indicador"} · origem: ${effect.sourceType === "AGENT" ? "Chamar agente" : "Orquestrador"}` },
      { label: "Resultado", value: outcome },
      { label: "Itens", value: `${effect.emittableCount} liberado(s) de ${effect.itemCount}${effect.writerInvoked ? "" : " · redator não chamado"}` },
      ...(effect.reasons.length > 0 ? [{ label: "Motivos", value: <ul className="space-y-0.5">{effect.reasons.map((reason) => <li key={reason}>{FEEDBACK_DISPOSITION_REASON_LABELS[reason] ?? reason}</li>)}</ul> }] : []),
      ...(effect.text ? [{ label: "Texto que seguiria", value: <span className="whitespace-pre-wrap">{effect.text}</span> }] : []),
      { label: "Política", value: effect.policyVersion },
      { label: "Registro", value: "Nada gravado, entregue ou notificado (simulação)" },
    ]
  } else if (effect.kind === "RELIABLE_FEEDBACK_EMISSION") {
    Icon = Send
    title = "PUBLICAÇÃO NO ACOMPANHAMENTO SIMULADA"
    rows = [
      { label: "Destinatário", value: recipient(effect.recipientId) },
      { label: "Surface", value: surfaceLabel(effect.surface) },
      { label: "Emissão", value: effect.reused ? "Reaproveitada (este Output já tinha publicado)" : "Uma por nó Output (idempotente)" },
    ]
  } else {
    Icon = Bot
    title = "EXECUÇÃO DE AGENTE SIMULADA"
    rows = [
      { label: "Status", value: effect.status === "COMPLETED" ? "Concluída" : effect.status === "FAILED" ? "Falhou" : "Pendente" },
      ...(effect.errorMessage ? [{ label: "Erro", value: effect.errorMessage }] : []),
      { label: "Registro", value: "Não gravada em agent_runs (não conta no uso do agente)" },
    ]
  }
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-3">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[120px_1fr] gap-2">
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Isso seria executado em produção — nada foi gravado.</p>
    </div>
  )
}
