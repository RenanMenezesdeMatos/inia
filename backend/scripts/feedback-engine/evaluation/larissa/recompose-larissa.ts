/**
 * REDAÇÃO ATUAL (V17 → V18 com exemplo de como dizer) sobre os diagnósticos JÁ PAGOS dos dois disparos de 05/10 (Workflows "Feedback de monitoria" e "Feedback de indicador",
 * Larissa Monteiro): reaproveita a análise da chamada e a investigação gravadas (pela saída do nó de origem) e paga só a redação
 * (rascunho + verificação, e reparo se houver). Mostra também os exemplos de como dizer (aceitos e recusados, com o motivo). Nada é gravado nem publicado: memória SOBREPOSTA em RAM; "já entregue" é ignorado aqui
 * para o ponto não ser suprimido (os dois feedbacks foram publicados). Teto de 6 chamadas de modelo por caso.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/recompose-larissa.ts
 */
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createEngineDeps, type EngineStores } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { DEFAULT_ENGINE_BUDGET, type EngineMeter } from "../../../../src/modules/feedback-engine/application/engine-meter.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const CASES = [
  { label: "MONITORIA", domain: "MONITORING" as const, enrollmentId: "73012a60-bf98-4558-92f9-e57e921e8832", sourceNodeId: "cf59bd49-4b34-40f6-8e61-091fe2e8974a", interactionId: "88a07d92-d05b-5956-a4d4-91c0aaf3ff5b" },
  { label: "INDICADOR", domain: "INDICATOR" as const, enrollmentId: "453051b6-2691-4d8c-8058-aad9b0e35027", sourceNodeId: "597219cf-426e-4c48-82b6-6fae4703d9ca", interactionId: null },
]

try {
  for (const entry of CASES) {
    const nodeOutputs = (await pool.query<{ node_outputs: Record<string, unknown> }>(`select node_outputs from workflow_enrollments where id = $1`, [entry.enrollmentId])).rows[0]!.node_outputs
    const overlay = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(pool), createInMemoryFeedbackMemoryStore())
    const stores = { ...overlay, deliveredFindings: async () => [] } as unknown as EngineStores
    const deps = createEngineDeps({ db: pool, stores, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 6 } })
    const result = await generateFeedback(deps, {
      organizationId: ORG, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `recompose-${entry.label}`, sourceNodeId: entry.sourceNodeId,
      domain: entry.domain, sourceNodeOutput: nodeOutputs[entry.sourceNodeId], collaboratorId: LARISSA, interactionId: entry.interactionId, indicatorMeasurementId: null,
      configuredAgentId: null, selectionReason: "Redação atual sobre o diagnóstico pago de 05/10.", now: new Date(),
    })
    const meter = (deps.meter as EngineMeter).summary()
    console.log(`\n===== ${entry.label} — ${result.kind} =====`)
    if (result.kind === "ABSTAINED") console.log(`abstenção: ${result.reason}`)
    else {
      const message = result.nodeOutput as { card?: string; text?: string }
      console.log(`CARD: ${message.card}\n\n${message.text}`)
    }
    const record = await overlay.getMessage(ORG, result.messageId)
    const view = (record?.message?.view ?? null) as { developments?: { title: string; suggestedResponse: string | null }[] } | null
    for (const detail of view?.developments ?? []) if (detail.suggestedResponse) console.log(`\nEXEMPLO ACEITO · ${detail.title}: “${detail.suggestedResponse}”`)
    const examples = ((record?.composition ?? {}) as { examples?: { ref: string; accepted: boolean; reasons: string[]; note: string | null }[] }).examples ?? []
    for (const example of examples.filter((entry) => !entry.accepted)) console.log(`EXEMPLO RECUSADO · ${example.ref}: ${example.reasons.join(", ")}${example.note ? ` — ${example.note}` : ""}`)
    console.log(`\n[chamadas de modelo: ${JSON.stringify(meter.byStage)}]`)
  }
} finally {
  await pool.end()
}
