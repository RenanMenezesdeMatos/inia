import { DomainError } from "../../../shared/domain/domain-error.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import type { EngineModelPort, EngineModelRequest, EngineModelResponse, EngineModelStage } from "./ports.js"

/**
 * ORÇAMENTO COMPARTILHADO DA EXECUÇÃO (`ENGINE_BUDGET_V1`).
 *
 * Toda chamada de modelo do motor — análise, revisão, planejamento da investigação, análise disparada por uma ferramenta,
 * redação, verificação, coerência — passa por UM medidor por execução (nó do Workflow, simulação, avaliação). Os limites são
 * TETOS, nunca metas: nada no motor tenta gastar até o teto.
 *   - chamadas de modelo, tokens de entrada, tokens de saída e duração; custo só quando há preço configurado;
 *   - a RESERVA vem antes da chamada (entrada estimada pelo tamanho do texto; saída = o teto da etapa): se não cabe, a chamada
 *     não sai (`EngineBudgetExhaustedError`) — inclusive quando quem pede é uma ferramenta, dentro de outra etapa;
 *   - consumo desconhecido (provedor não informou) conta como a reserva, nunca como zero;
 *   - nova tentativa por falha TRANSITÓRIA do provedor é uma chamada nova: passa pela mesma reserva e é contada. O adaptador do
 *     gateway não repete nada por conta própria (retries = 0), então nenhuma tentativa fica invisível.
 */
export const ENGINE_BUDGET_VERSION = "ENGINE_BUDGET_V2" as const

export type EngineBudgetLimits = {
  maxModelCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  /** null = sem teto de custo no motor (a organização continua sujeita ao orçamento de IA do gateway). */
  maxCostUsd: number | null
  maxDurationMs: number
  /** Novas tentativas por falha transitória, por chamada (cada uma contada como chamada). */
  transientRetries: number
  /**
   * `ENGINE_BUDGET_V2` — RESERVA da redação: o que a análise, a revisão, a confirmação e a investigação NÃO podem gastar, para a
   * mensagem ter ao menos uma redação e uma verificação (rodada real V10: a investigação/revisão consumiram o orçamento e a mensagem
   * ficou sem verificação). Só as etapas de redação/verificação usam a reserva. Ausente = sem reserva (comportamento V1).
   */
  compositionReserve?: { calls: number; inputTokens: number; outputTokens: number } | null
}

/** Tetos padrão de UMA execução (a investigação de indicador é a mais cara: planejamento + análises + composição). */
/**
 * Reserva padrão: uma redação + uma verificação. Entrada ≈ 2× o maior PAR medido nas rodadas reais V8–V10 (redação 5,9 mil + verificação
 * 5,0 mil tokens estimados, V9 cenário B); saída = o que a admissão das duas reserva (`STAGE_MAX_OUTPUT_TOKENS`). Os 30 mil da primeira
 * versão (≈ 3× o medido) recusaram o planejamento da investigação no replay da V10 sob o teto de custo do ensaio.
 */
export const DEFAULT_COMPOSITION_RESERVE = { calls: 2, inputTokens: 24_000, outputTokens: 16_384 } as const
export const DEFAULT_ENGINE_BUDGET: EngineBudgetLimits = { maxModelCalls: 40, maxInputTokens: 1_500_000, maxOutputTokens: 500_000, maxCostUsd: null, maxDurationMs: 15 * 60_000, transientRetries: 1, compositionReserve: { ...DEFAULT_COMPOSITION_RESERVE } }
/** Etapas que podem usar a reserva da redação. */
const RESERVE_STAGES: readonly EngineModelStage[] = ["COMPOSITION", "VERIFICATION"]

/** Teto de saída por etapa (o mesmo que o adaptador envia ao provedor) — base da reserva. */
// PRACTICE_IDENTITY 16.384 → 32.768 (carga do dev, 05/10): 38 regras contra 28 práticas conhecidas — o raciocínio gastou ~15 mil e a
// resposta parou em 1.369 tokens (MAX_TOKENS). O primeiro lote (40 regras, catálogo vazio) coube. PRACTICE_THEMES nasce com o mesmo teto
// (até 60 práticas contra os temas conhecidos — o mesmo tipo de raciocínio contra um catálogo).
// CALL_CONFIRMATION 8.192 → 16.384 (rodada real V12, cenário B): a confirmação de 3 achados + 1 divergência raciocinou 7.866 tokens e
// a resposta foi cortada (MAX_TOKENS) com 312 — o teto conta saída + raciocínio. O teto da revisão (12.288) teve folga (≈ 7,5 mil usados).
// CALL_ANALYSIS 24.576 → 32.768 (cenário TESTE PRODUTOS, 21/10/2026): 3 de 17 análises pararam no teto — a do conflito "internet" ×
// conta de outro produto raciocinou 23,6 mil e a resposta foi cortada com 969 (as outras duas pagaram a análise de novo). As completas
// usaram 8–23 mil (20 bases + 6 argumentários no contexto). Análise cortada = análise inteira paga e jogada fora.
// CALL_REVIEW 12.288 → 24.576 (mesmo cenário): no conflito, a revisão — que agora também relê o produto de cada pedido com as
// evidências — parou no teto com 3.198 tokens de resposta (JSON cortado no meio de uma citação).
export const STAGE_MAX_OUTPUT_TOKENS: Record<EngineModelStage, number> = { CALL_ANALYSIS: 32_768, CALL_REVIEW: 24_576, CALL_CONFIRMATION: 16_384, INVESTIGATION_PLANNING: 4_096, PRACTICE_IDENTITY: 32_768, PRACTICE_THEMES: 32_768, COMPOSITION: 8_192, VERIFICATION: 8_192 }

export type EnginePrice = { inputPerMillion: number; outputPerMillion: number }

export class EngineBudgetExhaustedError extends DomainError {
  constructor(readonly limit: keyof EngineBudgetLimits | "COST", readonly stage: EngineModelStage) {
    super(`Orçamento da execução atingido (${limit}) — a chamada de ${stage} não foi feita.`, "FEEDBACK_ENGINE_BUDGET_EXHAUSTED", 422)
    this.name = "EngineBudgetExhaustedError"
  }
}

export type MeterEntry = { stage: EngineModelStage; tag: string | null; attempt: number; status: "OK" | "FAILED" | "REFUSED"; inputTokens: number | null; outputTokens: number | null; usageKnown: boolean; reservedInputTokens: number; reservedOutputTokens: number; costUsd: number | null; durationMs: number | null; error: string | null }

export type MeterSummary = {
  version: typeof ENGINE_BUDGET_VERSION
  limits: EngineBudgetLimits
  calls: number
  failed: number
  refused: number
  retries: number
  inputTokens: number
  outputTokens: number
  unknownUsage: number
  costUsd: number | null
  byStage: Record<string, { calls: number; inputTokens: number; outputTokens: number }>
  exhausted: string | null
  entries: MeterEntry[]
}

const estimateInputTokens = (request: EngineModelRequest) => Math.ceil((request.systemPrompt.length + request.contents.reduce((sum, part) => sum + part.text.length, 0)) / 3)

export class EngineMeter {
  readonly entries: MeterEntry[] = []
  private inputTokens = 0
  private outputTokens = 0
  private cost = 0
  private costKnown = true
  private exhausted: string | null = null
  private readonly startedAt: number

  constructor(readonly limits: EngineBudgetLimits = DEFAULT_ENGINE_BUDGET, private readonly now: () => number = () => Date.now(), private readonly price: EnginePrice | null = null) {
    this.startedAt = now()
  }

  get callsMade(): number {
    return this.entries.filter((entry) => entry.status !== "REFUSED").length
  }

  /** A chamada cabe no orçamento? Sem efeito colateral — quem decide pular uma etapa pode perguntar antes. */
  /** Reserva da redação que esta etapa precisa deixar livre (nenhuma para as próprias etapas de redação/verificação). */
  private heldFor(stage: EngineModelStage) {
    const reserve = this.limits.compositionReserve
    return reserve && !RESERVE_STAGES.includes(stage) ? reserve : { calls: 0, inputTokens: 0, outputTokens: 0 }
  }

  fits(stage: EngineModelStage, reservedInput: number): keyof EngineBudgetLimits | "COST" | null {
    const reservedOutput = STAGE_MAX_OUTPUT_TOKENS[stage]
    const held = this.heldFor(stage)
    if (this.callsMade + 1 + held.calls > this.limits.maxModelCalls) return "maxModelCalls"
    if (this.now() - this.startedAt > this.limits.maxDurationMs) return "maxDurationMs"
    if (this.inputTokens + reservedInput + held.inputTokens > this.limits.maxInputTokens) return "maxInputTokens"
    if (this.outputTokens + reservedOutput + held.outputTokens > this.limits.maxOutputTokens) return "maxOutputTokens"
    if (this.limits.maxCostUsd !== null && this.price) {
      const reservedCost = ((reservedInput + held.inputTokens) * this.price.inputPerMillion + (reservedOutput + held.outputTokens) * this.price.outputPerMillion) / 1_000_000
      if (this.cost + reservedCost > this.limits.maxCostUsd) return "COST"
    }
    return null
  }

  /** Um CONJUNTO de chamadas (ex.: reescrita + nova verificação) cabe inteiro? Sem efeito colateral — quem decide se vale começar pergunta. */
  fitsAll(requests: readonly { stage: EngineModelStage; inputChars: number }[]): boolean {
    const held = requests.length > 0 ? this.heldFor(requests[0]!.stage) : { calls: 0, inputTokens: 0, outputTokens: 0 }
    const input = requests.reduce((sum, request) => sum + Math.ceil(request.inputChars / 3), 0)
    const output = requests.reduce((sum, request) => sum + STAGE_MAX_OUTPUT_TOKENS[request.stage], 0)
    if (this.callsMade + requests.length + held.calls > this.limits.maxModelCalls) return false
    if (this.now() - this.startedAt > this.limits.maxDurationMs) return false
    if (this.inputTokens + input + held.inputTokens > this.limits.maxInputTokens) return false
    if (this.outputTokens + output + held.outputTokens > this.limits.maxOutputTokens) return false
    if (this.limits.maxCostUsd !== null && this.price && this.cost + ((input + held.inputTokens) * this.price.inputPerMillion + (output + held.outputTokens) * this.price.outputPerMillion) / 1_000_000 > this.limits.maxCostUsd) return false
    return true
  }

  remainingCalls(): number {
    return Math.max(0, this.limits.maxModelCalls - this.callsMade)
  }
  /** Chamadas que ainda cabem para ESTA etapa (descontada a reserva da redação quando a etapa não é de redação). */
  remainingCallsFor(stage: EngineModelStage): number {
    return Math.max(0, this.limits.maxModelCalls - this.callsMade - this.heldFor(stage).calls)
  }

  admit(request: EngineModelRequest, attempt: number): { reservedInput: number; reservedOutput: number } {
    const reservedInput = estimateInputTokens(request)
    const reservedOutput = STAGE_MAX_OUTPUT_TOKENS[request.stage]
    const blocked = this.fits(request.stage, reservedInput)
    if (blocked) {
      this.exhausted = this.exhausted ?? blocked
      this.entries.push({ stage: request.stage, tag: request.tag ?? null, attempt, status: "REFUSED", inputTokens: null, outputTokens: null, usageKnown: false, reservedInputTokens: reservedInput, reservedOutputTokens: reservedOutput, costUsd: null, durationMs: null, error: `BUDGET:${blocked}` })
      throw new EngineBudgetExhaustedError(blocked, request.stage)
    }
    return { reservedInput, reservedOutput }
  }

  record(request: EngineModelRequest, attempt: number, reservation: { reservedInput: number; reservedOutput: number }, result: { response: EngineModelResponse } | { error: unknown }): void {
    const response = "response" in result ? result.response : null
    const usageKnown = Boolean(response?.usage && response.usage.inputTokens !== null && response.usage.outputTokens !== null)
    // Consumo desconhecido nunca é zero: vale a reserva (inclusive quando a chamada falhou depois de sair).
    const input = usageKnown ? response!.usage!.inputTokens! : reservation.reservedInput
    const output = usageKnown ? response!.usage!.outputTokens! : reservation.reservedOutput
    this.inputTokens += input
    this.outputTokens += output
    const cost = response?.costUsd ?? (this.price ? (input * this.price.inputPerMillion + output * this.price.outputPerMillion) / 1_000_000 : null)
    if (cost === null) this.costKnown = false
    else this.cost += cost
    this.entries.push({ stage: request.stage, tag: request.tag ?? null, attempt, status: response ? "OK" : "FAILED", inputTokens: usageKnown ? input : null, outputTokens: usageKnown ? output : null, usageKnown, reservedInputTokens: reservation.reservedInput, reservedOutputTokens: reservation.reservedOutput, costUsd: cost, durationMs: response?.durationMs ?? null, error: "error" in result ? (result.error instanceof DomainError ? result.error.code : result.error instanceof Error ? result.error.name : "UNKNOWN") : null })
  }

  summary(): MeterSummary {
    const byStage: MeterSummary["byStage"] = {}
    for (const entry of this.entries.filter((item) => item.status !== "REFUSED")) {
      const stage = (byStage[entry.stage] ??= { calls: 0, inputTokens: 0, outputTokens: 0 })
      stage.calls += 1
      stage.inputTokens += entry.inputTokens ?? entry.reservedInputTokens
      stage.outputTokens += entry.outputTokens ?? entry.reservedOutputTokens
    }
    return {
      version: ENGINE_BUDGET_VERSION,
      limits: this.limits,
      calls: this.callsMade,
      failed: this.entries.filter((entry) => entry.status === "FAILED").length,
      refused: this.entries.filter((entry) => entry.status === "REFUSED").length,
      retries: this.entries.filter((entry) => entry.attempt > 1 && entry.status !== "REFUSED").length,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      unknownUsage: this.entries.filter((entry) => entry.status !== "REFUSED" && !entry.usageKnown).length,
      costUsd: this.costKnown ? Math.round(this.cost * 1e6) / 1e6 : null,
      byStage,
      exhausted: this.exhausted,
      entries: [...this.entries],
    }
  }
}

/**
 * Modelo MEDIDO: a única porta de modelo que o motor usa. Reserva → chamada → registro; falha transitória = nova chamada
 * contada (até `transientRetries`); contrato inválido ou erro da aplicação nunca é repetido aqui.
 */
export function meteredModel(model: EngineModelPort, meter: EngineMeter): EngineModelPort & { meter: EngineMeter } {
  return {
    meter,
    async generate(request) {
      for (let attempt = 1; ; attempt++) {
        const reservation = meter.admit(request, attempt)
        try {
          const response = await model.generate(request)
          meter.record(request, attempt, reservation, { response })
          return response
        } catch (error) {
          meter.record(request, attempt, reservation, { error })
          const transient = classifyExecutionError(error).category === "TRANSIENT_PROVIDER_ERROR"
          if (!transient || attempt > meter.limits.transientRetries) throw error
        }
      }
    },
  }
}

export const isBudgetExhausted = (error: unknown): error is EngineBudgetExhaustedError => error instanceof EngineBudgetExhaustedError
