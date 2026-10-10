import type { Database } from "../../../infrastructure/database/pool.js"
import { AiCallBlockedError, createLlmTelemetryStore, runWithLlmTelemetry, type LlmAiPolicy } from "../../../shared/application/llm-telemetry.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createEngineDeps } from "../../feedback-engine/application/engine-wiring.js"
import { DEFAULT_ENGINE_BUDGET } from "../../feedback-engine/application/engine-meter.js"
import { generateFeedback } from "../../feedback-engine/application/generate-feedback.js"
import { investigateIndicator } from "../../feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort } from "../../feedback-engine/application/ports.js"
import type { IndicatorInvestigation } from "../../feedback-engine/domain/indicator-investigation.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, type IndicatorAnalysisNodeOutput } from "../../feedback-engine/domain/node-output.js"
import { createInMemoryFeedbackMemoryStore } from "../../feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadIndicatorCanonicalContext } from "../../indicators/application/load-indicator-canonical-context.js"
import { canonicalFactsOf, periodLabelOf } from "../../indicators/domain/indicator-canonical-context.js"
import { createReadOnlyDatabase } from "../../qa-lab/application/read-only-database.js"
import { diagnosticStrategyConfigSchema, runtimeParametersOf } from "../domain/diagnostic-strategy.js"
import type { ResolvedStrategy } from "./diagnostic-strategy-service.js"

/**
 * TESTAR DIAGNÓSTICO: simula UMA versão da estratégia (rascunho ou publicada) para UMA medição de UM colaborador pelo MESMO
 * motor que o Workflow usa ("Gerar feedback" → investigação do indicador → mensagem), com banco SOMENTE-LEITURA e memória em
 * RAM: nenhuma análise, investigação, mensagem ou Output é gravado, nada é publicado nem notificado. `STOP_BEFORE_AI` mostra
 * a parte determinística (resultado oficial, onde mudou por assunto e por dia, perguntas sem suporte) sem chamar modelo —
 * nenhuma chamada é analisada. Nunca devolve prompt nem raciocínio do modelo.
 */
export type DiagnosisSimulationInput = { indicatorId: string; source: "DRAFT" | "PUBLISHED"; collaboratorId: string; measurementId: string; agentId: string; aiPolicy: LlmAiPolicy }

export type DiagnosisSimulationResult = {
  strategy: { versionId: string; version: number; status: "DRAFT" | "PUBLISHED" }
  officialResult: { indicatorName: string; value: string; target: string | null; comparison: string | null; period: string }
  /** A investigação do motor (onde mudou, o que as chamadas mostram, grupo de referência, perguntas, conclusão). */
  investigation: IndicatorInvestigation | null
  aiExecuted: boolean
  aiStoppedReason: string | null
  /** O que o colaborador receberia: mensagem (READY) ou abstenção com motivo (ABSTAINED) — nunca espera de aprovação. */
  feedback: { disposition: "READY" | "ABSTAINED"; text: string; reason: string | null; supportMaterials: { title: string; reason: string }[] } | null
  usage: { requests: number; promptTokens: number | null; outputTokens: number | null; totalTokens: number | null; models: string[] }
  error: string | null
}

const sum = (values: (number | null)[]) => (values.some((value) => value === null) || values.length === 0 ? (values.length === 0 ? 0 : null) : values.reduce<number>((total, value) => total + (value ?? 0), 0))

export async function simulateDiagnosticStrategy(db: Database, organizationId: string, input: DiagnosisSimulationInput, options: { model?: EngineModelPort; now?: Date } = {}): Promise<DiagnosisSimulationResult> {
  const readDb = createReadOnlyDatabase(db)
  const version = (await readDb.query<{ id: string; version: number; status: "DRAFT" | "PUBLISHED"; config: unknown }>(
    `select v.id, v.version, v.status, v.config from indicator_diagnostic_strategy_versions v join indicator_diagnostic_strategies s on s.id = v.strategy_id
     where s.organization_id = $1 and s.indicator_definition_id = $2 and v.status = $3`,
    [organizationId, input.indicatorId, input.source],
  )).rows[0]
  const config = version ? diagnosticStrategyConfigSchema.safeParse(version.config) : null
  if (!version || !config?.success) throw new DomainError(input.source === "DRAFT" ? "Não há rascunho para testar." : "Não há versão publicada para testar.", "STRATEGY_VERSION_NOT_FOUND", 404)
  const strategy: ResolvedStrategy = { id: version.id, version: version.version, config: config.data }

  const canonical = await loadIndicatorCanonicalContext(readDb, { organizationId, measurementId: input.measurementId, collaboratorId: input.collaboratorId })
  if (!canonical || canonical.indicator.id !== input.indicatorId) throw new DomainError("Medição não encontrada para este indicador e colaborador.", "MEASUREMENT_NOT_FOUND", 404)
  const agent = (await readDb.query<{ active: boolean; updated_at: Date }>(`select active, updated_at from agents where id = $1 and organization_id = $2`, [input.agentId, organizationId])).rows[0]
  if (!agent) throw new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
  if (!agent.active) throw new DomainError("Este agente está inativo — ative-o antes de testar.", "AGENT_INACTIVE", 422)

  const facts = canonicalFactsOf(canonical)
  const result: DiagnosisSimulationResult = {
    strategy: { versionId: strategy.id, version: strategy.version, status: version.status },
    officialResult: { indicatorName: canonical.indicator.name, value: facts.valueText, target: facts.targetText, comparison: facts.comparisonLabel, period: periodLabelOf(canonical.measurement.periodStart, canonical.measurement.periodEnd) },
    investigation: null,
    aiExecuted: false,
    aiStoppedReason: null,
    feedback: null,
    usage: { requests: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, models: [] },
    error: null,
  }

  const stopBeforeAi = input.aiPolicy === "STOP_BEFORE_AI"
  // Memória SOBREPOSTA: lê a memória real (somente leitura) e grava as análises da simulação na RAM — a investigação enxerga as
  // duas; nada é gravado no banco.
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), createInMemoryFeedbackMemoryStore())
  // "Parar antes da IA" = orçamento de modelo ZERO no medidor da execução: nem planejamento, nem análise, nem redação.
  const deps = createEngineDeps({ db: readDb, stores, ...(options.model ? { model: options.model } : {}), ...(stopBeforeAi ? { maxCallAnalyses: 0, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 0 } } : {}) })
  // A versão testada (rascunho ou publicada) — nunca a efetiva da organização.
  deps.investigate.strategy = async () => runtimeParametersOf(strategy)
  const now = options.now ?? new Date()
  const telemetry = createLlmTelemetryStore({ policy: input.aiPolicy, maxCalls: 40 })
  try {
    await runWithLlmTelemetry(telemetry, async () => {
      const investigated = await investigateIndicator(deps.investigate, {
        organizationId, personId: input.collaboratorId, agentId: input.agentId, agentConfiguredAt: agent.updated_at.toISOString(), enrollmentId: null,
        target: { kind: "MEASUREMENT", measurementId: input.measurementId },
        trigger: { kind: "EVALUATION", selectionReason: "Teste da estratégia de diagnóstico" },
        now,
        // Simulação não entrega nada: o teste mostra o diagnóstico mesmo de um período que já teve feedback.
        skipDeliveredPeriods: false,
      })
      const ref = investigated.investigations[0]
      const stored = ref ? await stores.getIndicatorInvestigationByRun(organizationId, ref.runId) : null
      result.investigation = stored?.investigation ?? null
      if (stopBeforeAi) {
        result.aiStoppedReason = "A simulação parou antes da IA: resultado oficial, localização por assunto e por dia e perguntas foram calculados sem chamar modelo; nenhuma chamada foi analisada."
        return
      }
      const sourceNodeOutput: IndicatorAnalysisNodeOutput = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: input.collaboratorId, agentId: input.agentId, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
      const generated = await generateFeedback(deps, { organizationId, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "strategy-test-feedback", sourceNodeId: "strategy-test-agent", domain: "INDICATOR", sourceNodeOutput, collaboratorId: input.collaboratorId, interactionId: null, indicatorMeasurementId: input.measurementId, configuredAgentId: input.agentId, selectionReason: "Teste da estratégia de diagnóstico", now })
      result.aiExecuted = telemetry.calls.length > 0
      const message = await stores.getMessage(organizationId, generated.messageId)
      result.feedback = generated.kind === "PUBLISHABLE"
        ? { disposition: "READY", text: message?.message?.text ?? "", reason: null, supportMaterials: (message?.brief?.materials ?? []).map((material) => ({ title: material.title, reason: material.reason })) }
        : { disposition: "ABSTAINED", text: "", reason: generated.reason, supportMaterials: [] }
    })
  } catch (error) {
    if (error instanceof AiCallBlockedError) result.aiStoppedReason = "A simulação parou antes da IA."
    else result.error = error instanceof Error ? error.message : "Falha na simulação."
  }
  const calls = telemetry.calls
  result.aiExecuted = result.aiExecuted || calls.length > 0
  result.usage = { requests: calls.length, promptTokens: sum(calls.map((call) => call.promptTokens)), outputTokens: sum(calls.map((call) => call.outputTokens)), totalTokens: sum(calls.map((call) => call.totalTokens)), models: [...new Set(calls.map((call) => call.model))] }
  return result
}
