/**
 * ENSAIO do motor de feedback sobre UMA chamada real do banco, SEM GRAVAR NADA (memória em RAM): análise → brief → composição.
 * Chama o modelo real (custo de uma análise + redação + verificação). Uso de desenvolvimento/calibração.
 *
 *   npx tsx scripts/feedback-engine/dry-run-call.ts --external <external_id> --agent "<nome do especialista>" [--json]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { createEngineDeps } from "../../src/modules/feedback-engine/application/engine-wiring.js"
import { analyzeCall } from "../../src/modules/feedback-engine/application/analyze-call.js"
import { composeFeedback } from "../../src/modules/feedback-engine/application/compose-feedback.js"
import { buildMonitoringBrief } from "../../src/modules/feedback-engine/domain/feedback-brief.js"
import { createInMemoryFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import type { ModelCallMetric } from "../../src/modules/feedback-engine/application/ports.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const external = option("external")
const agentName = option("agent")
if (!external || !agentName) throw new Error('uso: dry-run-call.ts --external <external_id> --agent "<nome>" [--json]')
try {
  const interaction = (await pool.query<{ id: string; organization_id: string; operator_id: string }>(`select id, organization_id, operator_id from interactions where external_id = $1`, [external])).rows[0]
  if (!interaction) throw new Error(`interação ${external} não encontrada`)
  const agent = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name = $2`, [interaction.organization_id, agentName])).rows[0]
  if (!agent) throw new Error(`especialista ${agentName} não encontrado`)
  const stores = createInMemoryFeedbackMemoryStore()
  const deps = createEngineDeps({ db: pool, stores })
  const started = Date.now()
  const result = await analyzeCall(deps.analyze, { organizationId: interaction.organization_id, interactionId: interaction.id, collaboratorId: interaction.operator_id, agentId: agent.id, trigger: { kind: "EVALUATION", selectionReason: "Ensaio de calibração do motor de feedback." } })
  const analysis = result.assessment!.analysis
  const runMetrics = stores.runs.get(result.runId)!.metrics
  const brief = buildMonitoringBrief({ analysis, interactionId: interaction.id, label: result.assessment!.snapshot.subjectRaw ?? "Atendimento", dateLabel: "hoje", selectionReason: "Ensaio", criterionKeys: new Map(Object.entries(result.assessment!.criterionKeys)), documentTitles: new Map((await pool.query<{ id: string; title: string }>(`select id, title from knowledge_documents`)).rows.map((row) => [row.id, row.title])), documentVersions: new Map(), history: new Map(), delivered: new Set() })
  const metrics: ModelCallMetric[] = []
  const composed = brief.developments.length + brief.strengths.length > 0 ? await composeFeedback(deps.model, brief, metrics) : null
  if (args.includes("--json")) console.log(JSON.stringify({ analysis, brief, composed, runMetrics, compositionMetrics: metrics }, null, 2))
  else {
    console.log(`\n=== ${external} · ${analysis.outcome} (${analysis.outcomeReasons.join(", ") || "ok"}) · ${Date.now() - started} ms`)
    console.log(`Procedimento: ${analysis.scenario.procedureTitle} · caminho ${analysis.scenario.declaredPathAssessment} → ${analysis.scenario.pathAssessment} · checagem: ${analysis.checks.procedureSelection}`)
    console.log(`Necessidade: ${analysis.scenario.customerNeed}`)
    console.log(`Caminho correto: ${analysis.scenario.correctPath}`)
    console.log(`Caminho seguido: ${analysis.scenario.pathTaken}`)
    console.log(`Seções: ${analysis.scenario.pathSections.map((section) => section.heading).join(" | ")}`)
    console.log(`Cobertura: ${analysis.coverage.status} (faltaram ${analysis.coverage.missing.length}; reparo ${analysis.coverage.repairAttempted})`)
    const counts = analysis.criteria.reduce<Record<string, number>>((acc, criterion) => ({ ...acc, [criterion.status]: (acc[criterion.status] ?? 0) + 1 }), {})
    console.log(`Critérios: ${JSON.stringify(counts)} · não exigência: ${analysis.notRequirements.length}`)
    for (const criterion of analysis.criteria.filter((entry) => entry.status !== "NOT_APPLICABLE" || entry.materiality !== "LOW")) console.log(`  [${criterion.status}${criterion.declaredStatus !== criterion.status ? ` ← ${criterion.declaredStatus} (${criterion.downgrades.join(",")})` : ""}] ${criterion.materiality} ${criterion.text.slice(0, 110)}${criterion.rationale ? `\n      ↳ ${criterion.rationale.slice(0, 220)}` : ""}${criterion.guidance ? `\n      → ${criterion.guidance.moment}: ${criterion.guidance.action}` : ""}`)
    console.log(`Limitações: ${analysis.limitations.join(" | ") || "—"}`)
    console.log(`Análise: ${JSON.stringify({ calls: (runMetrics as { modelCalls?: number }).modelCalls, input: (runMetrics as { inputTokens?: number }).inputTokens, output: (runMetrics as { outputTokens?: number }).outputTokens })}`)
    if (composed?.message) {
      console.log(`\n--- MENSAGEM (${composed.message.source}) · card: ${composed.message.card}`)
      for (const paragraph of composed.message.paragraphs) console.log(`\n${paragraph}`)
      console.log(`\nverificação: ${JSON.stringify(composed.audit.verdicts)} · utilidade ${JSON.stringify(composed.audit.usefulness)} · erros ${composed.audit.errors.join(",") || "—"}`)
      console.log(`Composição: ${JSON.stringify(metrics.map((metric) => ({ stage: metric.stage, tag: metric.tag, in: metric.inputTokens, out: metric.outputTokens, ms: metric.durationMs })))}`)
    } else console.log(`\n--- sem mensagem: ${composed ? `abstenção (${composed.audit.reason})` : "sem ponto material"}`)
  }
} finally {
  await pool.end()
}
