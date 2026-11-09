import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { queryTableMarkdown } from "../../leadership-analytics/application/query-common.js"
import { topChanges, type MetricChange } from "../domain/comparison.js"
import { describePeriod } from "../domain/report-definition.js"
import type { AnalysisClaimMode, DeliveryRecord, ReportRecord, ReportStore } from "./report-store.js"

/**
 * ANÁLISE DA IA de uma entrega: a IA recebe a tabela, os destaques, as limitações e a comparação JÁ CALCULADOS pela aplicação
 * (valores formatados, variações e a avaliação de melhora/piora pela semântica de cada métrica) e escreve um resumo curto. Ela
 * não calcula nem inventa número. Falha preserva a entrega com "análise indisponível"; o worker tenta de novo, sem duplicar. Posse
 * por entrega (`ReportStore.claimAnalysis`): em qualquer processo, só quem reivindicou chama a IA e só a posse vigente grava.
 */
export type AnalysisWriter = (input: { organizationId: string; system: string; user: string }) => Promise<string>

export const gatewayAnalysisWriter: AnalysisWriter = async (input) => {
  const call = async () => {
    const route = routeFor({ purpose: "REPORT_ANALYSIS", phase: "SYNTHESIS", structuredOutputComplexity: "NONE", estimatedInputTokens: estimateTokens(input.system, input.user) })
    const reply = await withLlmScope({ role: "report_analyst", agentId: null }, () =>
      generateForRoute({ classification: { phase: "SYNTHESIS", purpose: "REPORT_ANALYSIS", source: "REPORT", semanticType: "RECURRING_REPORT" }, systemPrompt: input.system, contents: [{ role: "user", text: input.user }], tools: [], structuredOutput: false, route }),
    )
    return reply.kind === "text" ? reply.text : ""
  }
  return currentAiOrganizationId() === input.organizationId ? call() : runWithAiOrganization(input.organizationId, call)
}

export const REPORT_ANALYSIS_SYSTEM = [
  "Você escreve o resumo de um report recorrente para um líder de operação, em português do Brasil, linguagem de negócio, objetiva.",
  "Use SOMENTE os dados fornecidos. Não calcule números novos: cite os valores, as variações e as avaliações como vieram. Nunca invente número, nome, causa ou meta.",
  "Melhora e piora vêm prontas na comparação (pela semântica de cada métrica: subir nem sempre é melhorar). Use essas avaliações.",
  "Diga o período analisado e a referência da comparação. Se não houver comparação, diga o motivo dado. Sinalize mudanças de composição (linhas que entraram/saíram), cobertura e configuração alterada.",
  "Dado ausente nunca é zero nem desempenho ruim. Não faça afirmações de causa sem evidência; hipóteses, se houver, marcadas como hipóteses.",
  "Formato: markdown curto (até ~180 palavras) com **Resumo** (2–4 frases com os principais resultados) e, quando houver, **Evolução** (melhoras e pioras principais com variação absoluta e relativa) e **Atenção** (cobertura, composição, limitações). Sem títulos maiores, sem tabelas (a tabela já aparece na tela).",
].join("\n")

function formatValue(value: number, unit: MetricChange["unit"]): string {
  const text = value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  return unit === "PERCENT" ? `${text}%` : unit === "SECONDS" ? `${text} s` : unit === "STARS" ? `${text} ★` : unit === "POINTS" ? `${text} pts` : text
}

function formatDelta(change: MetricChange): string {
  const sign = change.delta > 0 ? "+" : ""
  const absolute = change.unit === "PERCENT" ? `${sign}${change.delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.` : `${sign}${formatValue(change.delta, change.unit)}`
  return change.deltaPercent === null ? absolute : `${absolute} (${change.deltaPercent > 0 ? "+" : ""}${change.deltaPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`
}

const ASSESSMENT_TEXT = { IMPROVED: "melhora", WORSENED: "piora", STABLE: "estável", NEUTRAL: "variação neutra (sem leitura de melhor/pior)" } as const

export function analysisInput(report: ReportRecord, delivery: DeliveryRecord): string {
  const card = delivery.dataset!
  const comparison = delivery.comparison
  const limitedCard = { ...card, rows: card.rows.slice(0, 25) }
  return JSON.stringify({
    report: report.name,
    objetivo: report.description,
    estrutura: delivery.structureLabel,
    periodo: delivery.periodLabel,
    definicaoDoPeriodo: describePeriod(report.definition.period),
    geradoEm: delivery.createdAt,
    tabela: card.rows.length === 0 ? "Nenhuma linha atende aos filtros (resultado legitimamente vazio, não zero)." : queryTableMarkdown(limitedCard),
    linhasNaTabela: card.totalRows,
    destaques: card.highlights,
    limitacoes: card.limitations,
    metodo: card.methods,
    comparacao: comparison
      ? {
          situacao: comparison.status,
          base: comparison.basis,
          motivo: comparison.reason,
          configuracaoAlterada: comparison.configurationChanged,
          linhasQueEntraram: comparison.rowsAdded.slice(0, 10),
          linhasQueSairam: comparison.rowsRemoved.slice(0, 10),
          resumo: comparison.summary,
          principaisMudancas: topChanges(comparison, 12).map((change) => ({ linha: change.row, metrica: change.columnLabel, atual: formatValue(change.current, change.unit), anterior: formatValue(change.previous, change.unit), variacao: formatDelta(change), avaliacao: ASSESSMENT_TEXT[change.assessment] })),
        }
      : null,
  })
}

/** Análise de uma entrega (logo depois de gravada, ou "Tentar de novo" com MANUAL): sem posse, não chama a IA. */
export async function analyzeDelivery(store: ReportStore, writer: AnalysisWriter, delivery: DeliveryRecord, report: ReportRecord, mode: AnalysisClaimMode = "AUTOMATIC"): Promise<void> {
  if (delivery.kind !== "DELIVERY" || !delivery.dataset) return
  const claimed = await store.claimAnalysis(delivery.id, mode)
  if (claimed) await runClaimedAnalysis(store, writer, claimed, report)
}

async function runClaimedAnalysis(store: ReportStore, writer: AnalysisWriter, claimed: DeliveryRecord, report: ReportRecord | null): Promise<void> {
  let result: { status: "READY" | "FAILED"; text: string | null; error: string | null }
  try {
    if (!report) throw new Error("Report não encontrado.")
    const text = (await writer({ organizationId: report.organizationId, system: REPORT_ANALYSIS_SYSTEM, user: analysisInput(report, claimed) })).trim()
    if (!text) throw new Error("A IA não devolveu texto.")
    result = { status: "READY", text: text.slice(0, 6_000), error: null }
  } catch (error) {
    result = { status: "FAILED", text: null, error: (error as Error).message?.slice(0, 300) ?? "Falha da IA." }
  }
  // Posse vencida no meio da chamada e reivindicada por outro processo: o resultado atrasado não cobre o dele.
  if (!(await store.finishAnalysis(claimed.id, claimed.analysisAttempts, result.status, result.text, result.error))) {
    console.warn(JSON.stringify({ event: "report_analysis_superseded", deliveryId: claimed.id, attempt: claimed.analysisAttempts, status: result.status }))
  }
}

/**
 * Recuperação: entregas com análise pendente/falha (até o limite de tentativas) — a entrega nunca é refeita. Reivindica UMA por vez
 * (o prazo da posse conta a partir da chamada, não do começo da rodada); a "em análise" abandonada que não volta mais à fila vira
 * FAILED. Com `signal` abortado (a tarefa periódica perdeu a trava), para antes da próxima reivindicação.
 */
export async function retryPendingAnalyses(store: ReportStore, writer: AnalysisWriter, options: { limit?: number; signal?: AbortSignal } = {}): Promise<number> {
  await store.closeAbandonedAnalyses()
  const limit = options.limit ?? 10
  let analyzed = 0
  while (analyzed < limit && !options.signal?.aborted) {
    const claimed = await store.claimNextAnalysis()
    if (!claimed) break
    analyzed += 1
    await runClaimedAnalysis(store, writer, claimed, await store.getReport(claimed.reportId, claimed.organizationId))
  }
  return analyzed
}
