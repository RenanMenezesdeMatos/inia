import type { AnalysisOutcome, PathAssessment } from "./call-analysis.js"
import type { InvestigationConclusion } from "./indicator-investigation.js"

/**
 * CONTRATOS COM O WORKFLOW (o que o motor de feedback devolve aos nós). Nenhum deles espera decisão humana:
 *
 *   FEEDBACK_ENGINE_CALL_ANALYSIS        "Chamar agente"/Orquestrador com avaliação de processo: a análise da chamada já está
 *                                         gravada na memória; o nó carrega a referência e um resumo (Condition/Revisão humana
 *                                         leem o texto).
 *   FEEDBACK_ENGINE_INDICATOR_ANALYSIS   "Chamar agente" com diagnóstico de indicador: as investigações gravadas.
 *   FEEDBACK_ENGINE_MESSAGE               "Gerar feedback" com mensagem PUBLICÁVEL — segue pela aresta; o Output publica.
 *
 * Abstenção (nada material, evidência insuficiente, já entregue) encerra a execução sem Output, com o motivo no evento.
 * Falha técnica lança erro classificado — o motor aplica a política de nova tentativa.
 */
export const CALL_ANALYSIS_NODE_OUTPUT_KIND = "FEEDBACK_ENGINE_CALL_ANALYSIS" as const
export const INDICATOR_ANALYSIS_NODE_OUTPUT_KIND = "FEEDBACK_ENGINE_INDICATOR_ANALYSIS" as const
export const ENGINE_MESSAGE_NODE_OUTPUT_KIND = "FEEDBACK_ENGINE_MESSAGE" as const
/** Monitoria aleatória sem chamada para sortear (nenhuma elegível ou todas já monitoradas): o "Gerar feedback" se abstém. */
export const NO_ELIGIBLE_CALL_NODE_OUTPUT_KIND = "FEEDBACK_ENGINE_NO_ELIGIBLE_CALL" as const
export const NO_ELIGIBLE_CALL = "NO_ELIGIBLE_CALL" as const

/**
 * Registro do SORTEIO da monitoria aleatória (`RANDOM_MONITORING_SAMPLE_V2`, run-9 ARQ-04): com qual regra a chamada foi escolhida — ou
 * por que nenhuma foi. Gravado na saída do nó e no `trigger` da análise (a nova tentativa da mesma execução reaproveita a escolha).
 */
export type RandomMonitoringSample = {
  version: string
  minimumSeconds: number
  period: string
  window: { start: string; end: string }
  timeZone: string
  seed: string
  /** Elegíveis no período (todas as que passaram nos critérios) e, entre elas, as que ainda não tinham monitoria. */
  eligible: number
  unmonitored: number
  /** true = nova tentativa: a chamada é a que esta execução já tinha sorteado. */
  reusedPick?: boolean
}

export type CallAnalysisNodeOutput = {
  kind: typeof CALL_ANALYSIS_NODE_OUTPUT_KIND
  analysisRunId: string
  callAssessmentId: string | null
  interactionId: string
  personId: string
  agentId: string | null
  outcome: AnalysisOutcome
  reused: boolean
  summary: { procedure: string | null; pathAssessment: PathAssessment; met: number; notMet: number; partial: number; notObservable: number; coverage: "COMPLETE" | "PARTIAL" }
  /** Texto legível (Condition/Revisão humana/QA Lab) — o diagnóstico em frases do sistema, nunca o prompt. */
  text: string
  /** Só na monitoria aleatória: o registro do sorteio que escolheu esta chamada. */
  randomSample?: RandomMonitoringSample
}

export type IndicatorAnalysisNodeOutput = {
  kind: typeof INDICATOR_ANALYSIS_NODE_OUTPUT_KIND
  personId: string
  agentId: string | null
  investigations: { analysisRunId: string; investigationId: string | null; indicatorCode: string; periodLabel: string; conclusion: InvestigationConclusion | null; reused: boolean }[]
  /** Nada a investigar (sem fechamento/indicador triado): o "Gerar feedback" se abstém com o motivo. */
  skippedReason: string | null
  text: string
}

export type NoEligibleCallNodeOutput = {
  kind: typeof NO_ELIGIBLE_CALL_NODE_OUTPUT_KIND
  personId: string
  skippedReason: typeof NO_ELIGIBLE_CALL
  /** Por que nada foi sorteado: nenhuma chamada passou nos critérios, ou todas as que passaram já tinham monitoria. */
  detail: "NO_ELIGIBLE_CALL" | "ALL_ELIGIBLE_ALREADY_MONITORED"
  eligible: number
  minimumSeconds: number
  period: { start: string; end: string }
  text: string
  /** Registro do sorteio (a mesma regra da chamada sorteada). Ausente nas saídas gravadas antes da V2. */
  randomSample?: RandomMonitoringSample
}

export type EngineMessageNodeOutput = {
  kind: typeof ENGINE_MESSAGE_NODE_OUTPUT_KIND
  messageId: string
  domain: "MONITORING" | "INDICATOR"
  /** Compatibilidade com os leitores do Output: sempre READY — mensagem retida não existe neste motor. */
  disposition: "READY"
  label: string
  card: string
  text: string
  analysisRunIds: string[]
  /** `beyondNarrative`: ajustes além dos 3 do texto, mostrados só nos cards (`NARRATIVE_TOP_FAILURES_V1`). */
  findings: { developments: number; strengths: number; suppressed: number; beyondNarrative?: number }
  limitations: string[]
  reused: boolean
}

const hasKind = (value: unknown, kind: string) => Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === kind
export const isCallAnalysisNodeOutput = (value: unknown): value is CallAnalysisNodeOutput => hasKind(value, CALL_ANALYSIS_NODE_OUTPUT_KIND)
export const isIndicatorAnalysisNodeOutput = (value: unknown): value is IndicatorAnalysisNodeOutput => hasKind(value, INDICATOR_ANALYSIS_NODE_OUTPUT_KIND)
export const isNoEligibleCallNodeOutput = (value: unknown): value is NoEligibleCallNodeOutput => hasKind(value, NO_ELIGIBLE_CALL_NODE_OUTPUT_KIND)
export const isEngineMessageNodeOutput = (value: unknown): value is EngineMessageNodeOutput => hasKind(value, ENGINE_MESSAGE_NODE_OUTPUT_KIND)

/** Referência da análise de chamada na saída de um nó de origem: direta (Chamar agente) ou dentro do Orquestrador (resultado do especialista). */
export function callAnalysisRefOf(sourceNodeOutput: unknown): CallAnalysisNodeOutput | null {
  if (isCallAnalysisNodeOutput(sourceNodeOutput)) return sourceNodeOutput
  const results = sourceNodeOutput && typeof sourceNodeOutput === "object" ? (sourceNodeOutput as { results?: unknown }).results : null
  if (Array.isArray(results)) {
    for (const result of results) {
      const structured = result && typeof result === "object" ? (result as { structured?: unknown }).structured : null
      const ref = structured && typeof structured === "object" ? (structured as { callAnalysis?: unknown }).callAnalysis : null
      if (isCallAnalysisNodeOutput(ref)) return ref
    }
  }
  return null
}

/**
 * `MULTI_SPECIALIST_MERGE_V1`: TODAS as análises de chamada da origem — a do "Chamar agente" ou a de cada especialista que o Orquestrador
 * acionou (na ordem dele, sem repetir a mesma execução). `callAnalysisRefOf` continua devolvendo só a primeira.
 */
export function callAnalysisRefsOf(sourceNodeOutput: unknown): CallAnalysisNodeOutput[] {
  if (isCallAnalysisNodeOutput(sourceNodeOutput)) return [sourceNodeOutput]
  const results = sourceNodeOutput && typeof sourceNodeOutput === "object" ? (sourceNodeOutput as { results?: unknown }).results : null
  if (!Array.isArray(results)) return []
  const refs: CallAnalysisNodeOutput[] = []
  for (const result of results) {
    const structured = result && typeof result === "object" ? (result as { structured?: unknown }).structured : null
    const ref = structured && typeof structured === "object" ? (structured as { callAnalysis?: unknown }).callAnalysis : null
    if (isCallAnalysisNodeOutput(ref) && !refs.some((other) => other.analysisRunId === ref.analysisRunId)) refs.push(ref)
  }
  return refs
}

/** Agente especialista da origem: o configurado no "Chamar agente" ou o acionado pelo Orquestrador (primeiro especialista com agente). */
export function sourceAgentIdOf(sourceNodeOutput: unknown, configuredAgentId: string | null): string | null {
  if (configuredAgentId) return configuredAgentId
  const results = sourceNodeOutput && typeof sourceNodeOutput === "object" ? (sourceNodeOutput as { results?: unknown }).results : null
  if (Array.isArray(results)) for (const result of results) {
    const agentId = result && typeof result === "object" ? (result as { agentId?: unknown }).agentId : null
    if (typeof agentId === "string" && agentId.length > 0) return agentId
  }
  const agentId = sourceNodeOutput && typeof sourceNodeOutput === "object" ? (sourceNodeOutput as { agentId?: unknown }).agentId : null
  return typeof agentId === "string" && agentId.length > 0 ? agentId : null
}
