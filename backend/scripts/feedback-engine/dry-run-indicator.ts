/**
 * ENSAIO da investigação de indicador do motor de feedback sobre dados reais, SEM GRAVAR NADA (memória em RAM).
 * Chama o modelo real apenas se a investigação decidir analisar chamadas (orçamento --max-calls, padrão 4).
 *
 *   npx tsx scripts/feedback-engine/dry-run-indicator.ts --matricula <matrícula> --indicator TMA [--agent "<especialista>"] [--max-calls 4] [--period 2026-08]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { createEngineDeps } from "../../src/modules/feedback-engine/application/engine-wiring.js"
import { investigateIndicator } from "../../src/modules/feedback-engine/application/investigate-indicator.js"
import { composeFeedback } from "../../src/modules/feedback-engine/application/compose-feedback.js"
import { buildIndicatorBrief } from "../../src/modules/feedback-engine/domain/indicator-brief.js"
import { createInMemoryFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import type { ModelCallMetric } from "../../src/modules/feedback-engine/application/ports.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const matricula = option("matricula")
const indicator = option("indicator")
if (!matricula || !indicator) throw new Error("uso: dry-run-indicator.ts --matricula <m> --indicator <CODE> [--agent <nome>] [--max-calls n] [--period YYYY-MM]")
try {
  const person = (await pool.query<{ id: string; organization_id: string }>(`select id, organization_id from people where matricula = $1`, [matricula])).rows[0]
  if (!person) throw new Error("pessoa não encontrada")
  const agentName = option("agent")
  const agent = agentName ? (await pool.query<{ id: string; updated_at: Date }>(`select id, updated_at from agents where organization_id = $1 and name = $2`, [person.organization_id, agentName])).rows[0] : undefined
  const stores = createInMemoryFeedbackMemoryStore()
  const deps = createEngineDeps({ db: pool, stores, maxCallAnalyses: Number(option("max-calls") ?? 4) })
  const result = await investigateIndicator(deps.investigate, { organizationId: person.organization_id, personId: person.id, agentId: agent?.id ?? null, agentConfiguredAt: agent ? new Date(agent.updated_at).toISOString() : null, enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: indicator, referencePeriod: option("period") ?? null }, trigger: { kind: "EVALUATION", selectionReason: "Ensaio de calibração" }, now: new Date() })
  console.log(JSON.stringify({ skipped: result.skippedReason, investigations: result.investigations }, null, 1))
  for (const ref of result.investigations) {
    const stored = await stores.getIndicatorInvestigationByRun(person.organization_id, ref.runId)
    if (!stored) continue
    const investigation = stored.investigation
    console.log(`\n=== ${investigation.official.name} ${investigation.official.periodLabel}: ${investigation.official.value} (meta ${investigation.official.target}, ${investigation.official.withinTarget ? "dentro" : "fora"}; anterior ${investigation.official.previous?.value}; ${investigation.official.movement})`)
    console.log(`Proxy: ${investigation.localization.proxy.label} · geral ${JSON.stringify(investigation.localization.overall)} · concordância ${investigation.localization.officialAgreement} · decomposição ${JSON.stringify(investigation.localization.decomposition)}`)
    for (const segment of investigation.localization.segments.slice(0, 8)) console.log(`  ${segment.label}: ${JSON.stringify(segment.previous)} → ${JSON.stringify(segment.current)} · ${segment.changeDirection} within=${segment.withinContribution?.toFixed(1)} mix=${segment.mixContribution?.toFixed(1)} ${segment.sufficient ? "" : "(insuficiente)"}`)
    console.log(`Foco: ${JSON.stringify(investigation.localization.focus)} · diário ${investigation.localization.daily.available ? `${investigation.localization.daily.points.length} dias, fora do padrão ${JSON.stringify(investigation.localization.daily.outliers)}` : "indisponível"}`)
    for (const entry of investigation.evidence) console.log(`  Evidência ${entry.segmentLabel}: ${entry.analyzedCalls}/${entry.universe} (${entry.newlyAnalyzed} novas) · padrões ${entry.patterns.filter((pattern) => pattern.classification !== "NONE").map((pattern) => `${pattern.classification}:${pattern.text.slice(0, 50)} (${pattern.notMet + pattern.partial}/${pattern.eligible})`).join(" | ")}`)
    console.log(`Referência: ${JSON.stringify(investigation.reference && { basis: investigation.reference.basis, members: investigation.reference.members, population: investigation.reference.population, practices: investigation.reference.practices.length, limitations: investigation.reference.limitations })}`)
    console.log(`Conclusão: ${investigation.conclusion} · perguntas ${investigation.questions.map((question) => `${question.id}:${question.answered ? "✓" : "—"}`).join(" ")} · orçamento ${JSON.stringify(investigation.budget)}`)
    console.log(`Limitações: ${investigation.limitations.join(" | ")}`)
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    const metrics: ModelCallMetric[] = []
    if (brief.developments.length + brief.strengths.length > 0 || brief.tone === "INFORMATIVE") {
      const composed = await composeFeedback(deps.model, brief, metrics)
      if (!composed.message) console.log(`\n--- sem mensagem: abstenção (${composed.audit.reason})`)
      else {
        console.log(`\n--- MENSAGEM (${composed.message.source}, tom ${brief.tone}) · card: ${composed.message.card}`)
        for (const paragraph of composed.message.paragraphs) console.log(`\n${paragraph}`)
      }
      console.log(`\nverificação ${JSON.stringify(composed.audit.verdicts)} · erros ${composed.audit.errors.join(",") || "—"}`)
    }
  }
} finally {
  await pool.end()
}
