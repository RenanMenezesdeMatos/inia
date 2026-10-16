import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { resolveOfficialClosure } from "../../indicators/application/official-closure.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { OperationalComparison } from "../../performance-analytics/domain/operational-comparison.js"
import { referencePeriodWindow } from "../../performance-analytics/domain/reference-period.js"
import { queryTableMarkdown } from "./indicator-query.js"
import type { DirectToolset } from "./leadership-context.js"
import type { LeadershipToolResult } from "./leadership-toolset.js"
import { resolveAnalysisPeriod, resolveIndicatorReference } from "./references.js"
import { buildSelfResults } from "./self-results.js"

/**
 * INIA para o OPERADOR — a mesma arquitetura da liderança (a IA escolhe a ferramenta, o backend calcula, a IA explica), com UMA
 * ferramenta sempre restrita à pessoa da sessão: `my_results`. Nenhum parâmetro alcança outra pessoa.
 */
export const SELF_TOOL = "my_results"

export const SELF_TOOL_DECLARATION: FunctionDeclaration = {
  name: SELF_TOOL,
  description:
    "Os resultados da PRÓPRIA pessoa, calculados pelo sistema: PRV e quartil geral, cada indicador com resultado, meta, atingimento, quartil oficial e situação (dentro/fora da meta), comparação com o mês anterior, evolução nas últimas competências e o período em curso pela medição diária (com a posição entre os pares). Use para qualquer pergunta sobre os próprios números: \"qual meu pior indicador\", \"estou na meta em TMA?\", \"meu quartil\", \"como evoluí nos últimos 3 meses\", \"como estou indo este mês\".",
  parameters: {
    type: "object",
    properties: {
      indicadores: { type: "array", items: { type: "string" }, description: "Nomes ou códigos (\"PRV\" = resultado geral). Vazio = PRV e todos os indicadores com dado." },
      competencia: { type: "string", description: "AAAA-MM, só se a pessoa pedir um mês." },
      ultimas_competencias: { type: "integer", description: "Evolução nas últimas N competências (1 a 6)." },
      fonte: { type: "string", description: "Omita (= OFICIAL, o último fechamento mensal) para \"meu pior indicador\", \"estou na meta\", \"meu quartil\", evolução. OPERACIONAL só quando a pessoa perguntar do período EM CURSO (\"este mês\", \"esta semana\", \"hoje\").", enum: ["OFICIAL", "OPERACIONAL"] },
      janela: { type: "string", description: "Só com fonte OPERACIONAL.", enum: ["MES_CORRENTE", "SEMANA_CORRENTE", "ULTIMOS_7_DIAS"] },
    },
  },
}

export const SELF_RESPONSE_RULES = [
  "[Seus resultados — regra do sistema]",
  `- Perguntas sobre os próprios números (PRV, quartil, indicadores, meta, evolução, este mês): acione ${SELF_TOOL} antes de responder e use exatamente os números dele; nunca invente.`,
  "- Responda em markdown, completo: frase direta com o número em negrito e a competência, tabela quando houver 3+ números, e o que fazer para melhorar (com o conhecimento dos especialistas quando for de processo). Sem dado nunca é desempenho ruim.",
  "- \"Pior indicador\" = o de menor atingimento (a tabela já vem do menor para o maior, depois do PRV); \"melhor\" = o de maior. Diga qual é, com o número.",
  "- \"Este mês\" ainda não tem fechamento oficial: use a medição diária (fonte OPERACIONAL) e diga que é parcial.",
].join("\n")

/** Voz do operador: UMA ferramenta que leva a pergunta à mesma orquestração do chat de texto (`my_results` + especialistas), no
 * backend — chamadas soltas deixavam o especialista sem os números (respondia "não há definição de qual é o pior"). */
export const SELF_ASK_TOOL = "self_ask"
export const SELF_ASK_DECLARATION: FunctionDeclaration = {
  name: SELF_ASK_TOOL,
  description:
    "Responde com os dados reais da própria pessoa e com a base de conhecimento qualquer pergunta sobre o trabalho dela: os próprios resultados (PRV, quartil, indicadores, metas, pior ou melhor indicador, evolução, este mês), como melhorar, processos, procedimentos e regras do atendimento. Passe a pergunta completa, já com o contexto da conversa (qual indicador ou mês foi falado antes).",
  parameters: { type: "object", properties: { query: { type: "string", description: "A pergunta do usuário, completa e com o contexto da conversa." } }, required: ["query"] },
}

/** Voz do operador: o modelo de voz só encaminha; quem consulta os números e escreve a resposta é a orquestração do chat. */
export const SELF_VOICE_RULES = [
  "Como conduzir a voz:",
  `- Para QUALQUER pergunta sobre os próprios resultados (PRV, quartil, indicadores, metas, pior ou melhor indicador, evolução, este mês), como melhorar, processos, procedimentos ou regras do atendimento, acione ${SELF_ASK_TOOL} com a pergunta completa e o contexto da conversa (indicador e mês já falados).`,
  "- Acione a ferramenta IMEDIATAMENTE, na mesma resposta, SEM falar nada antes (nem \"vou consultar\"): uma frase sem a chamada encerra o turno e a pessoa fica sem resposta. Nunca fale números, metas ou procedimentos que não vieram da ferramenta.",
  "- Quando a resposta chegar, ela já está completa na tela: fale um resumo curto e fiel e diga que o detalhe está na tela.",
].join("\n")

const WINDOWS: Record<string, OperationalComparison> = { MES_CORRENTE: "MONTH", SEMANA_CORRENTE: "WEEK", ULTIMOS_7_DIAS: "ROLLING_7_DAYS" }

export type SelfChatContext = {
  instructions: string
  /** Sessão de voz: a regra de levar toda pergunta de trabalho a `self_ask` (a resposta é montada no backend). */
  voiceInstructions: string
  toolset: DirectToolset
}

export async function loadSelfChatContext(db: Database, user: AuthTokenPayload, options: { repository?: AnalyticsReadRepository; now?: Date } = {}): Promise<SelfChatContext | null> {
  const repository = options.repository ?? new PgAnalyticsReadRepository(db)
  let scope
  try {
    scope = await loadViewerScope(repository, user, "indicators.view")
  } catch (error) {
    if (error instanceof DomainError && error.code === "PERSON_NOT_FOUND") return null
    throw error
  }
  const closure = await resolveOfficialClosure(db, scope.organizationId, options.now ?? new Date())
  const person = { id: scope.viewer.id, name: scope.viewer.name }
  const execute = async (name: string, args: Record<string, unknown>): Promise<LeadershipToolResult> => {
    if (name !== SELF_TOOL) return { text: "Ferramenta desconhecida.", card: null, issue: { kind: "INVALID", message: "Ferramenta desconhecida.", candidates: [] } }
    const definitions = await repository.loadIndicatorDefinitions(scope.organizationId)
    const requested = Array.isArray(args.indicadores) ? args.indicadores.filter((value): value is string => typeof value === "string" && value.trim() !== "") : []
    const indicators = []
    for (const text of requested) {
      const outcome = resolveIndicatorReference(definitions, text)
      if (outcome.kind === "AMBIGUOUS") return { text: `Ambiguidade (indicador): ${outcome.candidates.join("; ")}. Pergunte qual.`, card: null, issue: { kind: "AMBIGUOUS", message: outcome.candidates.join("; "), candidates: outcome.candidates } }
      if (outcome.kind === "NOT_FOUND") return { text: `${outcome.message} Diga isso à pessoa.`, card: null, issue: { kind: "NOT_FOUND", message: outcome.message, candidates: [] } }
      indicators.push(outcome.value)
    }
    const period = await resolveAnalysisPeriod(repository, scope, [person.id], typeof args.competencia === "string" ? args.competencia : null, closure)
    const count = Math.min(6, Math.max(1, typeof args.ultimas_competencias === "number" ? Math.round(args.ultimas_competencias) : 1))
    const input = { organizationId: scope.organizationId, person, indicators, periods: referencePeriodWindow(period.period, count), window: WINDOWS[String(args.janela ?? "")] ?? "MONTH", now: closure.now }
    let card = await buildSelfResults(repository, { ...input, source: args.fonte === "OPERACIONAL" ? "OPERATIONAL" : "OFFICIAL" })
    // Período em curso ainda sem medição: a resposta útil é o último fechamento oficial (dito como tal), não uma tabela de traços.
    if (card.source === "OPERATIONAL" && card.rows.every((row) => row.cells.current === "—")) {
      const official = await buildSelfResults(repository, { ...input, source: "OFFICIAL" })
      card = { ...official, limitations: ["Ainda não há medição diária sua no período em curso; abaixo, o último fechamento oficial.", ...official.limitations] }
    }
    const text = ["[Seus resultados, calculados pelo sistema — use exatamente estes números]", `${card.title} · ${card.scopeNote}`, "", queryTableMarkdown(card), ...(card.limitations.length > 0 ? ["", `Limitações: ${card.limitations.join(" ")}`] : []), `Base: ${card.methods.join(" ")}`].join("\n")
    return { text, card }
  }
  return { instructions: SELF_RESPONSE_RULES, voiceInstructions: SELF_VOICE_RULES, toolset:{ declarations: [SELF_TOOL_DECLARATION], handles: (name) => name === SELF_TOOL, execute } }
}
