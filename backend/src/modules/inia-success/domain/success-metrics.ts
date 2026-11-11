import { funnelRatio, FUNNEL_MIN_SAMPLE, type FunnelRatio } from "../../assistant/application/reply-funnel.js"

/**
 * INDICADORES DE SUCESSO DA INIA — regras de cálculo puras (sem banco). Inventário de fontes e fórmulas:
 * `docs/dev/indicadores-de-sucesso-da-inia.md`. Regras que valem para todos os indicadores da tela:
 *  - taxa = numerador ÷ denominador, sempre com os dois; denominador 0 = "sem base" (nunca 0%); denominador < 5 = amostra pequena
 *    (a taxa fica oculta) — a MESMA regra do funil das respostas e do painel do apoio (`funnelRatio`, `FUNNEL_MIN_SAMPLE`);
 *  - média = soma das observações válidas ÷ quantidade de observações (nunca média de médias de dias ou grupos); sem observação =
 *    "sem base"; com menos de 5 observações, amostra pequena (como a média de estrelas do apoio);
 *  - ausente nunca é zero: quem não tem medida fica fora do numerador E do denominador e aparece na cobertura.
 */
export const SUCCESS_MIN_SAMPLE = FUNNEL_MIN_SAMPLE
export type Rate = FunnelRatio
export const rate = (numerator: number, denominator: number): Rate => funnelRatio(numerator, denominator)

export type Average = { sum: number; count: number; value: number | null; status: Rate["status"] }

/** Média ponderada pelas observações: soma de todas as somas ÷ soma de todas as contagens. */
export function weightedAverage(parts: readonly { sum: number; count: number }[]): Average {
  const sum = parts.reduce((total, part) => total + part.sum, 0)
  const count = parts.reduce((total, part) => total + part.count, 0)
  if (count === 0) return { sum, count, value: null, status: "NO_DATA" }
  if (count < SUCCESS_MIN_SAMPLE) return { sum, count, value: null, status: "SMALL_SAMPLE" }
  return { sum, count, value: sum / count, status: "OK" }
}

// -------------------------------------------------------------------------------------------------
// Período e agrupamento no tempo
// -------------------------------------------------------------------------------------------------

/** Período em datas civis no fuso da organização (mesmo limite do funil e do painel do apoio: 1 a 92 dias). */
export const SUCCESS_MAX_DAYS = 92
/** Até 31 dias a evolução é por dia; acima, por semana (segunda a domingo). */
export const DAILY_MAX_DAYS = 31
export type Granularity = "DAY" | "WEEK"
/** `partial` = a semana começa antes ou termina depois do período (contém menos de 7 dias do período). */
export type Bucket = { key: string; from: string; to: string; days: number; partial: boolean }

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000
const civilOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10)
/** Segunda-feira da semana da data (ISO: segunda = 1). */
const mondayOf = (day: number) => day - ((new Date(day * 86_400_000).getUTCDay() + 6) % 7)

export const periodDays = (from: string, to: string) => dayNumber(to) - dayNumber(from) + 1

export function periodBuckets(from: string, to: string): { granularity: Granularity; buckets: Bucket[] } {
  const first = dayNumber(from)
  const last = dayNumber(to)
  const days = last - first + 1
  if (days <= DAILY_MAX_DAYS) {
    return { granularity: "DAY", buckets: Array.from({ length: days }, (_, index) => ({ key: civilOf(first + index), from: civilOf(first + index), to: civilOf(first + index), days: 1, partial: false })) }
  }
  const buckets: Bucket[] = []
  for (let monday = mondayOf(first); monday <= last; monday += 7) {
    const start = Math.max(monday, first)
    const end = Math.min(monday + 6, last)
    buckets.push({ key: civilOf(start), from: civilOf(start), to: civilOf(end), days: end - start + 1, partial: end - start + 1 < 7 })
  }
  return { granularity: "WEEK", buckets }
}

/** Chave do intervalo (o `key` de `periodBuckets`) de uma data civil do período. */
export function bucketKeyOf(date: string, from: string, granularity: Granularity): string {
  if (granularity === "DAY") return date
  return civilOf(Math.max(mondayOf(dayNumber(date)), dayNumber(from)))
}

/**
 * Soma por intervalo: as consultas devolvem uma linha por DIA civil; aqui os dias viram os intervalos da tela. Intervalo sem linha
 * fica com os campos zerados — quem desenha decide, pela base, se mostra "sem base" (nunca 0%).
 */
export function foldByBucket<Row extends { day: string }, Totals extends Record<string, number>>(
  rows: readonly Row[],
  period: { from: string; to: string },
  empty: () => Totals,
  add: (totals: Totals, row: Row) => void,
): { bucket: Bucket; totals: Totals }[] {
  const { granularity, buckets } = periodBuckets(period.from, period.to)
  const byKey = new Map(buckets.map((bucket) => [bucket.key, { bucket, totals: empty() }]))
  for (const row of rows) {
    const entry = byKey.get(bucketKeyOf(row.day, period.from, granularity))
    if (entry) add(entry.totals, row)
  }
  return [...byKey.values()]
}

// -------------------------------------------------------------------------------------------------
// Motivos de procura: rótulos das rotas que a INIA acionou para responder
// -------------------------------------------------------------------------------------------------

/**
 * Ferramentas diretas do backend que a INIA escolhe pela intenção da pergunta (nomes como gravados em `tool_calls`). Só rótulo de
 * apresentação: a categoria é a própria ferramenta (nenhuma classificação nova). Especialistas não estão aqui: vêm da participação
 * gravada (`assistant_interaction_agents`), com o nome do Agent e o domínio de negócio dele.
 */
export const DIRECT_ROUTE_LABELS: Record<string, string> = {
  my_results: "Consulta aos próprios resultados",
  my_best_practices: "Boas práticas do próprio colaborador",
  leadership_priorities: "Liderança · onde atuar hoje",
  leadership_structure_overview: "Liderança · visão da estrutura",
  leadership_indicator_analysis: "Liderança · análise de indicador",
  leadership_indicator_query: "Liderança · consulta de indicadores",
  leadership_indicator_diagnosis: "Liderança · diagnóstico de indicador",
  leadership_people: "Liderança · pessoas",
  leadership_workforce: "Liderança · força de trabalho",
  leadership_best_practices: "Liderança · boas práticas",
  leadership_process: "Liderança · processos",
  report_proposal: "Proposta de report recorrente",
  knowledge_clarification: "Esclarecimento da pergunta pelas bases",
}
/** O que fica gravado em `tool_calls` mas não é rota de resposta (conferência da resposta, escolha do operador, especialista). */
export const NON_ROUTE_TOOLS = ["response_check", "knowledge_clarification_answer"] as const
export const isSpecialistTool = (name: string) => /^agent_[0-9a-f]{32}$/.test(name)
export const directRouteLabel = (name: string) => DIRECT_ROUTE_LABELS[name] ?? `Ferramenta ${name}`

export type RouteRow = { kind: "SPECIALIST" | "DIRECT" | "NONE"; key: string; label: string; detail: string | null; answers: number }
export type RouteItem = RouteRow & { share: number | null }

/**
 * Ranking das rotas. `answers` = respostas do período (a base de toda participação). Uma resposta pode ter várias rotas (especialista
 * + ferramenta), então as participações podem somar mais de 100%; "sem especialista nem ferramenta" é uma rota à parte.
 */
export function rankRoutes(rows: readonly RouteRow[], answers: number, limit = 12): { items: RouteItem[]; others: { routes: number; answers: number } | null } {
  const share = (count: number) => (answers >= SUCCESS_MIN_SAMPLE ? count / answers : null)
  const sorted = [...rows].sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label, "pt-BR"))
  const items = sorted.slice(0, limit).map((row) => ({ ...row, share: share(row.answers) }))
  const rest = sorted.slice(limit)
  return { items, others: rest.length > 0 ? { routes: rest.length, answers: rest.reduce((total, row) => total + row.answers, 0) } : null }
}
