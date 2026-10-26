import type { Database } from "../../../infrastructure/database/pool.js"
import { buildCard, queryTableMarkdown } from "../../leadership-analytics/application/query-common.js"
import type { ResolvedStructure } from "../../leadership-analytics/application/references.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { BEST_PRACTICE_RESPONSE_RULES } from "../domain/guidance.js"
import { relevantPracticesFor, type RelevantPractice } from "./recommendations.js"

/**
 * BOAS PRÁTICAS PARA QUEM LIDERA (`leadership_best_practices`) — as práticas DISPONÍVEIS da base para um indicador nos Grupos da
 * estrutura (e num motivo, se pedido), com os números da comparação. Não há evidência individual aqui: a base não diz quem da
 * equipe já faz o comportamento — o texto manda confirmar ouvindo chamadas/monitoria, nunca atribuir a alguém.
 */
export type LeadershipPracticesLoader = (input: { indicatorId: string; teamIds: readonly string[]; reason: string | null }) => Promise<RelevantPractice[]>

export function createLeadershipPracticesLoader(db: Pick<Database, "query">, organizationId: string): LeadershipPracticesLoader {
  return async ({ indicatorId, teamIds, reason }) => {
    const seen = new Set<string>()
    const out: RelevantPractice[] = []
    for (const teamId of [...new Set(teamIds)].slice(0, 6)) {
      for (const practice of await relevantPracticesFor(db, { organizationId, indicatorId, source: { origin: "REAL", teamId }, contexts: reason ? [{ reason, subReason: null }] : null, who: null, limit: 5 })) {
        if (seen.has(practice.row.id)) continue
        seen.add(practice.row.id)
        out.push(practice)
      }
    }
    return out.slice(0, 6)
  }
}

export function leadershipPracticesResult(input: { structure: ResolvedStructure; indicator: { code: string; name: string }; reason: string | null; practices: readonly RelevantPractice[]; now: Date }): { text: string; card: QueryTableCard } {
  const card = buildCard({ structure: input.structure, source: "OFFICIAL", now: input.now }, {
    title: `Boas práticas · ${input.indicator.name}`,
    scopeNote: `${input.structure.ref.label}${input.reason ? ` · motivo ${input.reason}` : ""} · padrões aprovados da base`,
    period: null,
    indicatorCode: input.indicator.code,
    columns: [
      { key: "practice", label: "Boa prática", numeric: false },
      { key: "context", label: "Contexto", numeric: false },
      { key: "association", label: "Melhores × referência", numeric: false },
      { key: "strength", label: "Força", numeric: false },
      { key: "period", label: "Análise", numeric: false },
    ],
    rows: input.practices.map((practice) => {
      const main = practice.contexts[0]!
      return { cells: { practice: practice.item.name, context: practice.item.contexts.join(" · "), association: `${Math.round(main.topRatePercent ?? 0)}% × ${Math.round(main.referenceRatePercent ?? 0)}% (${main.topOperators} × ${main.referenceOperators} operadores)`, strength: practice.item.strength, period: practice.row.periodStart && practice.row.periodEnd ? `${practice.row.periodStart.slice(8, 10)}/${practice.row.periodStart.slice(5, 7)} a ${practice.row.periodEnd.slice(8, 10)}/${practice.row.periodEnd.slice(5, 7)}/${practice.row.periodEnd.slice(0, 4)}` : "—" }, subject: null, personId: null }
    }),
    total: input.practices.length,
    methods: ["Associação observada nas chamadas comparáveis (mesmo Grupo, contexto e período) entre operadores do 1º quartil oficial e o grupo de referência — nunca causa. Só padrões aprovados por uma pessoa, que não são obrigação do processo e com evidência sustentada."],
    limitations: input.practices.length === 0 ? [`A base ainda não tem boa prática aprovada e sustentada para ${input.indicator.name} nos Grupos desta estrutura${input.reason ? ` no motivo ${input.reason}` : ""}.`] : ["A base não diz quem da equipe já faz cada comportamento: confirme ouvindo chamadas ou pela monitoria antes de orientar alguém."],
  })
  const lines = input.practices.flatMap((practice, index) => [
    `${index + 1}. **${practice.item.name}** — ${practice.item.description}`,
    `   - ${practice.item.association} Força: ${practice.item.strength.toLowerCase()}.`,
    `   - Como orientar: ${practice.item.howTo}`,
    ...(practice.item.suggestedPhrasing ? [`   - Sugestão de fala para a equipe experimentar (exemplo, não é fala de nenhuma chamada): "${practice.item.suggestedPhrasing}"`] : []),
    ...(practice.item.notApplicableWhen ? [`   - Não se aplica quando: ${practice.item.notApplicableWhen}`] : []),
  ])
  const text = [
    `[Boas práticas da base para ${input.indicator.name} — calculado pelo sistema; use só o que está aqui]`,
    queryTableMarkdown(card),
    ...lines,
    ...card.limitations,
    "- Quem lidera não atende: transforme as práticas em ação de liderança (ouvir chamadas do contexto, dar o exemplo de fala no feedback, acompanhar) e nunca diga que alguém específico faz ou não faz o comportamento.",
    "",
    BEST_PRACTICE_RESPONSE_RULES,
  ].join("\n")
  return { text, card }
}
