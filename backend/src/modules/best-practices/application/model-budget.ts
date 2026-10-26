import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import type { BestPracticeModelPort, BestPracticeModelRequest, BestPracticeModelResponse, BestPracticeStage } from "./ports.js"

/**
 * ORÇAMENTO DA ANÁLISE — teto de chamadas ao modelo por análise (cada tentativa conta) e UMA nova tentativa só para falha
 * TRANSITÓRIA do provedor. Sem orçamento ou com falha, a etapa devolve null e a análise segue com o que tem, registrando a limitação
 * (nunca inventa a resposta que faltou). Uso e custo somados vão para a proveniência da análise.
 */
/** `costUnknownCalls`: respostas sem custo estimado (modelo fora da tabela estática) — o custo real fica no uso de IA da organização. */
export type ModelUsageSummary = { calls: number; inputTokens: number; outputTokens: number; costUsd: number; costUnknownCalls: number; models: string[]; failures: { stage: BestPracticeStage; tag: string | null; error: string }[]; budgetExhausted: boolean }

export class AnalysisModelBudget {
  private readonly usage: ModelUsageSummary = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costUnknownCalls: 0, models: [], failures: [], budgetExhausted: false }

  constructor(
    private readonly model: BestPracticeModelPort,
    private readonly maxCalls: number,
  ) {}

  get exhausted(): boolean {
    return this.usage.calls >= this.maxCalls
  }

  summary(): ModelUsageSummary {
    return { ...this.usage, costUsd: Math.round(this.usage.costUsd * 1_000_000) / 1_000_000, models: [...this.usage.models], failures: [...this.usage.failures] }
  }

  async call(request: BestPracticeModelRequest): Promise<BestPracticeModelResponse | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.exhausted) {
        this.usage.budgetExhausted = true
        this.usage.failures.push({ stage: request.stage, tag: request.tag ?? null, error: "MODEL_BUDGET_EXHAUSTED" })
        return null
      }
      this.usage.calls += 1
      try {
        const response = await this.model.generate(request)
        this.usage.inputTokens += response.inputTokens ?? 0
        this.usage.outputTokens += response.outputTokens ?? 0
        this.usage.costUsd += response.costUsd ?? 0
        if (response.costUsd === null) this.usage.costUnknownCalls += 1
        if (response.model && !this.usage.models.includes(response.model)) this.usage.models.push(response.model)
        return response
      } catch (error) {
        const transient = classifyExecutionError(error).category === "TRANSIENT_PROVIDER_ERROR"
        if (transient && attempt === 0) continue
        this.usage.failures.push({ stage: request.stage, tag: request.tag ?? null, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "erro desconhecido" })
        return null
      }
    }
    return null
  }
}
