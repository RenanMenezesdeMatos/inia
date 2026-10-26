import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { queryTableMarkdown } from "../../leadership-analytics/application/indicator-query.js"
import { PRV_CODE } from "../../leadership-analytics/application/official-query.js"
import type { LeadershipToolResult } from "../../leadership-analytics/application/leadership-toolset.js"
import { resolveAnalysisPeriod, resolveIndicatorReference } from "../../leadership-analytics/application/references.js"
import { buildSelfResults } from "../../leadership-analytics/application/self-results.js"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import type { AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { referencePeriodWindow } from "../../performance-analytics/domain/reference-period.js"
import { guidanceTextOf } from "../domain/guidance.js"
import { recentContextsOf, relevantPracticesFor, type ContextFilter, type PracticeSource } from "./recommendations.js"

/**
 * FERRAMENTA DO OPERADOR `my_best_practices` (chat de texto e voz, via `self_ask`) — "como melhoro meu TMA?". Combina, sempre da
 * PRÓPRIA pessoa da sessão (nenhum parâmetro alcança outra): (1) o resultado oficial e a tendência das últimas competências,
 * (2) as boas práticas DISPONÍVEIS da base para aquele indicador, no Grupo e nos contextos das chamadas dela, e (3) o que as chamadas
 * dela analisadas mostram + a sugestão de fala (marcada como sugestão). Sem prática sustentada, o texto diz isso — a INIA não
 * inventa conselho como se fosse da base.
 */
export const SELF_PRACTICES_TOOL = "my_best_practices"

export const SELF_PRACTICES_DECLARATION: FunctionDeclaration = {
  name: SELF_PRACTICES_TOOL,
  description:
    "Boas práticas observadas nas chamadas dos operadores com melhores resultados de UM indicador, para a PRÓPRIA pessoa: traz o resultado e a tendência dela no indicador, as práticas aprovadas da base que valem para os contextos das chamadas dela, o que as chamadas dela analisadas mostram e uma sugestão de fala. Use quando a pessoa perguntar como melhorar um indicador, o que os melhores fazem, dicas ou exemplos de como agir num indicador (\"como melhoro meu TMA?\", \"o que os melhores fazem na Nota da URA?\").",
  parameters: {
    type: "object",
    properties: {
      indicador: { type: "string", description: "Nome ou código do indicador (um só)." },
      motivo: { type: "string", description: "Motivo de contato, só se a pessoa citar um (ex.: \"Fatura\")." },
    },
    required: ["indicador"],
  },
}

export const SELF_PRACTICES_RULE = `- Como melhorar um indicador, o que os melhores fazem, dicas para um indicador: acione ${SELF_PRACTICES_TOOL} (ele já traz o resultado e a tendência) e siga as regras de boas práticas que vêm com ele.`

/** Fonte dos padrões para o chat: reais do Grupo da pessoa; em desenvolvimento, um dataset sintético configurado (rotulado). */
export async function chatPracticeSource(db: Pick<Database, "query">, organizationId: string, teamId: string | null): Promise<PracticeSource> {
  const key = env.INIA_BEST_PRACTICES_CHAT_SYNTHETIC_DATASET
  if (key && process.env.NODE_ENV !== "production") {
    const dataset = (await db.query<{ id: string }>(`select id from best_practice_synthetic_datasets where organization_id = $1 and dataset_key = $2`, [organizationId, key])).rows[0]
    if (dataset) return { origin: "SYNTHETIC", datasetId: dataset.id }
  }
  return { origin: "REAL", teamId }
}

export async function executeSelfPractices(db: Database, repository: AnalyticsReadRepository, input: { scope: ViewerScope; closure: { lastClosedPeriod: string; now: Date; timeZone: string }; args: Record<string, unknown> }): Promise<LeadershipToolResult> {
  const { scope, closure } = input
  const person = { id: scope.viewer.id, name: scope.viewer.name }
  const definitions = await repository.loadIndicatorDefinitions(scope.organizationId)
  const outcome = resolveIndicatorReference(definitions, typeof input.args.indicador === "string" ? input.args.indicador : null)
  if (outcome.kind === "AMBIGUOUS") return { text: `Ambiguidade (indicador): ${outcome.candidates.join("; ")}. Pergunte qual.`, card: null, issue: { kind: "AMBIGUOUS", message: outcome.candidates.join("; "), candidates: outcome.candidates } }
  if (outcome.kind === "NOT_FOUND") return { text: `${outcome.message} Diga isso à pessoa.`, card: null, issue: { kind: "NOT_FOUND", message: outcome.message, candidates: [] } }
  const indicator = outcome.value
  if (indicator.code === PRV_CODE) return { text: "Boas práticas são observadas por indicador (TMA, Nota da URA…), não pelo PRV. Pergunte qual indicador a pessoa quer melhorar.", card: null, issue: { kind: "INVALID", message: "PRV não tem boas práticas próprias.", candidates: [] } }

  // (1) Resultado e tendência: últimas 3 competências oficiais, pela MESMA tabela de `my_results`.
  const period = await resolveAnalysisPeriod(repository, scope, [person.id], null, closure)
  const results = await buildSelfResults(repository, { organizationId: scope.organizationId, person, indicators: [indicator], periods: referencePeriodWindow(period.period, 3), source: "OFFICIAL", window: "MONTH", now: closure.now })

  // (2) e (3) Práticas disponíveis no Grupo e nos contextos das chamadas da pessoa, com a evidência das chamadas dela.
  const motivo = typeof input.args.motivo === "string" && input.args.motivo.trim() ? input.args.motivo.trim() : null
  const contexts: ContextFilter[] = motivo ? [{ reason: motivo, subReason: null }] : await recentContextsOf(db, scope.organizationId, person.id, closure.now)
  const source = await chatPracticeSource(db, scope.organizationId, scope.viewer.teamId)
  const practices = contexts.length > 0 ? await relevantPracticesFor(db, { organizationId: scope.organizationId, indicatorId: indicator.id, source, contexts, who: { personId: person.id }, limit: 3 }) : []
  const items = practices.map((practice) => practice.item)
  const contextsLabel = contexts.length > 0 ? [...new Set(contexts.map((context) => context.reason))].slice(0, 4).join(", ") : null
  const noPatternReason = contexts.length === 0 ? `Não há chamadas suas nos últimos 90 dias para saber os seus contextos de atendimento; sem isso, a base não indica uma boa prática de ${indicator.name}.` : null
  const guidance = guidanceTextOf({ indicatorName: indicator.name, contextsLabel, items, noPatternReason })
  const resultsText = ["[Seu resultado e tendência no indicador — calculado pelo sistema]", `${results.title} · ${results.scopeNote}`, "", queryTableMarkdown(results), ...(results.limitations.length > 0 ? ["", `Limitações: ${results.limitations.join(" ")}`] : [])].join("\n")

  const card: QueryTableCard =
    items.length === 0
      ? results
      : {
          ...results,
          title: `Boas práticas · ${indicator.name}`,
          columns: [
            { key: "practice", label: "Boa prática", numeric: false },
            { key: "context", label: "Contexto", numeric: false },
            { key: "association", label: "Melhores × referência", numeric: false },
            { key: "strength", label: "Força", numeric: false },
            { key: "you", label: "Nas suas chamadas", numeric: false },
          ],
          rows: practices.map((practice) => {
            const main = practice.contexts[0]!
            return { cells: { practice: `${practice.item.name}${practice.item.synthetic ? " (sintético)" : ""}`, context: practice.item.contexts.join(" · "), association: `${Math.round(main.topRatePercent ?? 0)}% × ${Math.round(main.referenceRatePercent ?? 0)}%`, strength: practice.item.strength, you: practice.item.you }, subject: null, personId: null }
          }),
          totalRows: practices.length,
          highlights: [],
          methods: ["Associação observada nas chamadas comparáveis (mesmo Grupo, contexto e período) entre operadores com melhores resultados e o grupo de referência — nunca causa.", ...results.methods],
          limitations: [...(items.some((item) => item.synthetic) ? ["Dados sintéticos de teste: não são prova e não valem em produção."] : []), ...results.limitations],
        }
  return { text: [resultsText, "", guidance].join("\n"), card }
}
