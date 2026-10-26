import type { ContextLevel } from "./sampling.js"

/**
 * ESCOLHA DAS PRÁTICAS PARA UMA PESSOA (`BEST_PRACTICE_SELECTION_V1`) — domínio puro. Para cada assunto (motivo + submotivo da
 * chamada ou dos assuntos onde a investigação do indicador localizou o problema), o PRIMEIRO nível com prática disponível vence:
 *
 *   1. subgrupo + submotivo   2. grupo + submotivo   3. subgrupo + motivo   4. grupo + motivo   5. nada
 *
 * Amplia primeiro as PESSOAS (o submotivo é o que diz que chamada é aquela) e só depois o tipo de chamada. Os níveis nunca se
 * misturam num assunto, nunca se recua para a organização inteira nem para outro resultado, e a prática diz de onde veio. Os
 * mínimos de evidência de cada nível são os da análise que o sustentou (evidence-criteria.ts) — aqui só se escolhe.
 */
export type PopulationLevel = "SUBGROUP" | "GROUP"
export type SelectionLevel = { population: PopulationLevel; context: ContextLevel }

export const SELECTION_LEVELS: readonly SelectionLevel[] = [
  { population: "SUBGROUP", context: "SUB_REASON" },
  { population: "GROUP", context: "SUB_REASON" },
  { population: "SUBGROUP", context: "REASON" },
  { population: "GROUP", context: "REASON" },
]

/** Onde a pessoa está hoje (cadastro): o Grupo e, quando houver, o Subgrupo. */
export type Placement = { teamId: string; teamName: string; subteamId: string | null; subteamName: string | null }
/** Assunto de uma chamada: o motivo e o submotivo como a fonte os cadastrou (sem submotivo = nulo). */
export type Subject = { reason: string; subReason: string | null }
export type LeveledContext = { cellKey: string; reason: string; subReason: string | null; level?: ContextLevel }

const norm = (text: string | null | undefined) => (text ?? "").trim().toLowerCase()

/** Níveis que valem para a pessoa: sem Subgrupo no cadastro, só os do Grupo. */
export const levelsFor = (placement: Pick<Placement, "subteamId">): SelectionLevel[] => SELECTION_LEVELS.filter((level) => level.population === "GROUP" || placement.subteamId !== null)

/** Nível do contexto sustentado. Contexto gravado antes da V2 (sem o campo): pela chave — "motivo › submotivo" só existe no nível do submotivo. */
export const contextLevelOf = (context: Pick<LeveledContext, "cellKey" | "level">): ContextLevel => context.level ?? (context.cellKey.includes(" › ") ? "SUB_REASON" : "REASON")

/**
 * O contexto sustentado vale para o assunto naquele nível: no do submotivo, mesmo motivo e mesmo submotivo (chamada sem submotivo
 * casa com o contexto "(sem submotivo)" do mesmo motivo); no do motivo, só contexto medido no nível do motivo, mesmo motivo.
 */
export function contextMatches(context: LeveledContext, subject: Subject, level: ContextLevel): boolean {
  if (contextLevelOf(context) !== level || norm(context.reason) !== norm(subject.reason)) return false
  return level === "REASON" || norm(context.subReason) === norm(subject.subReason)
}

/** O padrão foi descoberto na população daquele nível: o Subgrupo da pessoa, ou o Grupo inteiro (padrão de Grupo, sem Subgrupo). */
export function populationMatches(pattern: { teamId: string | null; subteamId: string | null }, placement: Pick<Placement, "teamId" | "subteamId">, population: PopulationLevel): boolean {
  if (pattern.teamId !== placement.teamId) return false
  return population === "SUBGROUP" ? placement.subteamId !== null && pattern.subteamId === placement.subteamId : pattern.subteamId === null
}

/** De onde a prática veio, para a pessoa ler junto da prática. */
export type SelectedFrom = { population: PopulationLevel; populationName: string; context: ContextLevel; subjectLabel: string; outcomeName: string; outcomeKind: "INDICATOR" | "CALL_SIGNAL"; text: string }

export function selectedFromOf(input: { level: SelectionLevel; placement: Placement; subject: Subject; outcomeName: string; outcomeKind?: "INDICATOR" | "CALL_SIGNAL" }): SelectedFrom {
  const subjectLabel = input.level.context === "SUB_REASON" ? input.subject.subReason?.trim() || input.subject.reason.trim() : input.subject.reason.trim()
  const populationName = input.level.population === "SUBGROUP" ? input.placement.subteamName ?? "" : input.placement.teamName
  const where = input.level.population === "SUBGROUP" ? `do seu subgrupo (${populationName})` : `do seu grupo (${populationName})`
  const outcomeKind = input.outcomeKind ?? "INDICATOR"
  // Pelo sinal, "os melhores" são as CHAMADAS com resultado bom — nunca "operadores com melhores resultados".
  const text = outcomeKind === "CALL_SIGNAL" ? `Das chamadas de ${subjectLabel} com resultado bom em ${input.outcomeName}, ${where.replace(/^do /, "no ")}.` : `Dos operadores com melhor ${input.outcomeName} ${where}, em chamadas de ${subjectLabel}.`
  return { population: input.level.population, populationName, context: input.level.context, subjectLabel, outcomeName: input.outcomeName, outcomeKind, text }
}

/**
 * PRODUTO DA PRÁTICA (`BEST_PRACTICE_SELECTION_V2`, 22/10/2026 — `PRODUCT_IN_FEEDBACK_V1`): pelos produtos que a análise da chamada
 * ESTABELECEU nas chamadas em que o comportamento apareceu (codificação PRESENTE nos contextos que casaram). A prática só fica "deste
 * produto" quando a maior parte dessas chamadas tem produto estabelecido e todas elas são do mesmo produto; vista em mais de um produto,
 * ou sem produto estabelecido na maior parte delas, é geral (como antes). Nada aqui lê texto: só conta o que a análise gravou.
 */
export type PracticeProductEvidence = { presentCalls: number; callsWithProduct: number; products: readonly string[] }

export function practiceProductOf(evidence: PracticeProductEvidence): string | null {
  if (evidence.presentCalls === 0 || evidence.callsWithProduct * 2 < evidence.presentCalls) return null
  const keys = new Set(evidence.products.map((name) => norm(name)).filter((key) => key.length > 0))
  return keys.size === 1 ? evidence.products.find((name) => norm(name).length > 0)!.trim() : null
}

/** A prática de um produto só entra no feedback em que esse produto foi estabelecido; sem produto estabelecido, só as gerais. */
export const productMatches = (practiceProduct: string | null, feedbackProducts: readonly string[]): boolean => practiceProduct === null || feedbackProducts.some((name) => norm(name) === norm(practiceProduct))
