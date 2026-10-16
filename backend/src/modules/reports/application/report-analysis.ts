import type { Database } from "../../../infrastructure/database/pool.js"
import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { queryTableMarkdown } from "../../leadership-analytics/application/query-common.js"
import { topChanges, type MetricChange } from "../domain/comparison.js"
import { describePeriod } from "../domain/report-definition.js"
import type { DeliveryRecord, ReportRecord, ReportStore } from "./report-store.js"
import { DELIVERY_COLUMNS, toDelivery } from "./report-store.js"

/**
 * ANÁLISE DA IA de uma entrega: a IA recebe a tabela, os destaques, as limitações e a comparação JÁ CALCULADOS pela aplicação
 * (valores formatados, variações e a avaliação de melhora/piora pela semântica de cada métrica) e escreve um resumo curto. Ela
 * não calcula nem inventa número. Falha preserva a entrega com "análise indisponível"; o worker tenta de novo, sem duplicar.
 */
export type AnalysisWriter = (input: { organizationId: string; system: string; user: string }) => Promise<string>
export const MAX_ANALYSIS_ATTEMPTS = 3

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

export async function analyzeDelivery(store: ReportStore, writer: AnalysisWriter, delivery: DeliveryRecord, report: ReportRecord): Promise<void> {
  if (delivery.kind !== "DELIVERY" || !delivery.dataset) return
  try {
    const text = (await writer({ organizationId: report.organizationId, system: REPORT_ANALYSIS_SYSTEM, user: analysisInput(report, delivery) })).trim()
    if (!text) throw new Error("A IA não devolveu texto.")
    await store.setAnalysis(delivery.id, "READY", text.slice(0, 6_000), null)
  } catch (error) {
    await store.setAnalysis(delivery.id, "FAILED", null, (error as Error).message?.slice(0, 300) ?? "Falha da IA.")
  }
}

/** Recuperação: entregas com análise pendente/falha (até o limite de tentativas) — a entrega nunca é refeita. */
export async function retryPendingAnalyses(db: Database, store: ReportStore, writer: AnalysisWriter, limit = 10): Promise<number> {
  const result = await db.query<Parameters<typeof toDelivery>[0]>(
    `select ${DELIVERY_COLUMNS} from report_deliveries
      where kind = 'DELIVERY' and analysis_status in ('PENDING', 'FAILED') and analysis_attempts < $1
        and (analysis_updated_at is null or analysis_updated_at < now() - interval '10 minutes')
        and created_at > now() - interval '7 days'
      order by created_at limit $2`,
    [MAX_ANALYSIS_ATTEMPTS, limit],
  )
  for (const row of result.rows) {
    const delivery = toDelivery(row)
    const report = await store.getReport(delivery.reportId, delivery.organizationId)
    if (report) await analyzeDelivery(store, writer, delivery, report)
  }
  return result.rows.length
}
