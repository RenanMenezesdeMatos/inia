"use client"

import { useState } from "react"
import { qaInteractionEvidenceSchema, type QaRun } from "@/schemas/admin/qa-lab.schema"
import { InteractionConversationDialog, InteractionEvidenceSummary, type FrozenTranscript, type TranscriptHighlight } from "../interaction-evidence"
import { formatDateTime, formatNumber, personLabel, roleLabel } from "../qa-lab-format"
import { scalar } from "./run-format"

/**
 * Painel "Contexto utilizado". PONTO DE EXTENSÃO (documentado, não implementado): hoje o
 * sujeito é `context.operator` (EMPLOYEE) OU `context.unit` (STRUCTURE). Quando existir
 * STRUCTURE → EMPLOYEE_COLLECTION → EMPLOYEE, a coleção deve entrar como uma seção própria
 * (`context.collection`, lista de colaboradores selecionados) entre as duas — o resto do painel
 * já é orientado por seções independentes e não precisa mudar.
 */
/**
 * Trechos que a IA usou como evidência NESTE run — só de dado já estruturado e validado pelo
 * runtime: o Feedback de monitoria carrega `evidenceFound`, cuja literalidade contra a
 * transcrição o backend confere antes de aceitar a resposta (run-agent.ts). Nenhuma inferência
 * nova; sem evidência estruturada não há destaque.
 */
export function highlightsOfRun(run: Pick<QaRun, "trace">): TranscriptHighlight[] {
  const highlights: TranscriptHighlight[] = []
  for (const effect of run.trace.effects) {
    if (effect.kind === "FEEDBACK" && effect.evidenceFound) {
      highlights.push({ text: effect.evidenceFound, reason: `Trecho utilizado como evidência pelo Agent${effect.title ? ` — ${effect.title}` : ""}` })
    }
  }
  return highlights
}

/** Transcrição congelada no run (state.session.inputContext) — o histórico mostra ESTA versão. */
export function frozenTranscriptOfRun(run: Pick<QaRun, "state" | "context">): FrozenTranscript | undefined {
  const session = (run.state as { session?: { inputContext?: unknown; evidence?: { transcript?: { checksum?: string | null } } } } | null)?.session
  if (!session || typeof session.inputContext !== "string" || session.inputContext.length === 0) return undefined
  return { content: session.inputContext, checksum: session.evidence?.transcript?.checksum ?? null }
}

export function ContextPanel({ context, people, highlights, frozenTranscript }: { context: Record<string, unknown>; people: QaRun["trace"]["people"]; highlights: TranscriptHighlight[]; frozenTranscript: FrozenTranscript | undefined }) {
  const [inspecting, setInspecting] = useState<string | null>(null)
  const operator = context.operator as { name?: string; role?: string; teamName?: string | null; subteamName?: string | null; hierarchy?: { name: string; role: string }[] } | null | undefined
  const indicators = context.indicators as { code: string; name: string; value: number | null; targetValue: number | null; achievementPercent: number | null; quartile: string | null; referencePeriod: string }[] | undefined
  const shift = context.shift as { startTime: string; workMinutes: number } | null | undefined
  const trigger = context.trigger as Record<string, unknown> | undefined
  const interactionRaw = context.interaction as Record<string, unknown> | undefined
  const interaction = interactionRaw && qaInteractionEvidenceSchema.safeParse(interactionRaw).success ? qaInteractionEvidenceSchema.parse(interactionRaw) : null
  const unit = context.unit as { label: string; memberCount: number; measurementsLast30Days: number } | undefined
  const orchestratorContext = context.orchestrator as { name: string; invocationContext: string } | undefined
  const specialists = context.availableSpecialists as { name: string; toolName: string }[] | undefined
  const agent = context.agent as { name: string; agentType: string; objective: string } | undefined
  const knowledge = context.knowledgeDocuments as { title: string }[] | undefined
  const operatorId = context.operatorId as string | undefined

  const sections: { title: string; lines: string[] }[] = []
  if (operator?.name) {
    sections.push({
      title: "Colaborador",
      lines: [
        `${operator.name}`,
        operator.teamName ? `Grupo: ${operator.teamName}${operator.subteamName ? ` · Subgrupo: ${operator.subteamName}` : ""}` : "Sem grupo",
        ...(operator.hierarchy ?? []).map((person) => `${roleLabel(person.role)}: ${person.name}`),
      ],
    })
  } else if (operatorId && people[operatorId]) {
    sections.push({ title: "Colaborador", lines: [personLabel(people, operatorId)] })
  }
  if (unit) sections.push({ title: "Unidade de análise", lines: [unit.label, `${unit.memberCount} colaborador(es)`, `${unit.measurementsLast30Days} medição(ões) nos últimos 30 dias`] })
  if (indicators && indicators.length > 0) {
    sections.push({
      title: "Indicadores (performance mais recente)",
      lines: indicators.map((row) => {
        const parts = [row.name]
        if (row.value !== null) parts.push(`${formatNumber(row.value, 2)}`)
        if (row.achievementPercent !== null) parts.push(`${formatNumber(row.achievementPercent, 1)}% de atingimento`)
        if (row.targetValue !== null) parts.push(`meta ${formatNumber(row.targetValue, 2)}`)
        if (row.quartile) parts.push(row.quartile)
        return `${parts.join(" · ")} (${row.referencePeriod})`
      }),
    })
  }
  if (shift) sections.push({ title: "Jornada", lines: [`${shift.startTime} · ${Math.round(shift.workMinutes / 60)}h de carga`] })
  if (trigger) {
    const lines: string[] = []
    if (trigger.kind === "channel_flag") lines.push(`Flag ${trigger.channel ? `${String(trigger.channel)}.` : ""}${String(trigger.flagName)}: ${scalar(trigger.value)}`)
    if (trigger.kind === "indicator") lines.push(`${String(trigger.indicatorName)}: ${scalar(trigger.value)} ${String(trigger.unit ?? "")}`, `Meta: ${scalar(trigger.targetValue)}`)
    if (trigger.kind === "schedule") lines.push(`Disparo simulado: ${formatDateTime(String(trigger.scheduledFor))}`)
    if (trigger.kind === "manual") {
      lines.push(`Manual (simulado) · ${trigger.context === "INTERACTION" ? "interação escolhida" : trigger.context === "INDICATOR_MEASUREMENT" ? "medição escolhida" : "colaborador escolhido"}`)
      if (trigger.context === "INDICATOR_MEASUREMENT") lines.push(`${String(trigger.indicatorName)}: ${scalar(trigger.value)} ${String(trigger.unit ?? "")}`, `Meta: ${scalar(trigger.targetValue)}`)
    }
    if (lines.length > 0) sections.push({ title: "Gatilho", lines })
  }
  if (interaction) {
    const hasTranscript = interaction.transcript?.available ?? interaction.hasTranscript ?? false
    sections.push({
      title: "Transcrição (contexto disponível para IA)",
      lines: hasTranscript
        ? [
            `Disponível · ${interaction.transcript ? `${formatNumber(interaction.transcript.length)} caracteres · versão ${interaction.transcript.version ?? "?"} · ${interaction.transcript.checksum ?? ""}` : "enviada integralmente como contexto do Agent"}`,
            ...(interaction.transcriptChangedSinceOriginalRun ? ["O texto persistido mudou desde o QA Run original — a versão original foi reutilizada nesta reexecução."] : []),
          ]
        : ["Não disponível — nenhum texto de transcrição foi enviado à IA."],
    })
  }
  if (agent) sections.push({ title: "Agent", lines: [agent.name, agent.objective, ...(knowledge && knowledge.length > 0 ? [`Bases: ${knowledge.map((doc) => doc.title).join(", ")}`] : ["Nenhuma base associada"])] })
  if (orchestratorContext) sections.push({ title: "Orchestrator", lines: [orchestratorContext.name, `Contexto de invocação: ${orchestratorContext.invocationContext}`, ...(specialists ? [`Agents disponíveis: ${specialists.map((s) => s.name).join(", ") || "nenhum"}`] : [])] })
  if (typeof context.simulatedNow === "string") sections.push({ title: "Relógio simulado", lines: [formatDateTime(context.simulatedNow)] })
  if (sections.length === 0 && !interaction) return null
  const flagLabel = interaction && trigger?.kind === "channel_flag" ? `${trigger.channel ? `${String(trigger.channel)}.` : ""}${String(trigger.flagName)}` : (interaction?.flag?.name ?? "")
  return (
    <div className="space-y-3">
      {interaction ? (
        // Seção "Interação" (evidência do Trigger por Flag) — responde "qual interação testei?"
        // e abre a MESMA conversa do Contexto do teste, com a transcrição congelada neste run e
        // os trechos usados como evidência por ESTE resultado.
        <>
          <InteractionEvidenceSummary evidence={interaction} flagLabel={flagLabel} onInspect={() => setInspecting(interaction.id)} highlightCount={highlights.length} />
          <InteractionConversationDialog interactionId={inspecting} onOpenChange={(open) => !open && setInspecting(null)} requiredFlagLabel={flagLabel} highlights={highlights} frozenTranscript={frozenTranscript} />
        </>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {section.lines.map((line, index) => (
                <li key={`${section.title}-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
