import type { Materiality } from "./call-analysis.js"
import type { RulePerspective } from "./procedure.js"

/**
 * FIRMEZA DO RETORNO (`FEEDBACK_FIRMNESS_V1`) — decidida pelo CÓDIGO, só com fatos; o redator escreve no tom do nível e o verificador
 * confere que o texto não ficou mais mole (erro confirmado vira "vale considerar…") nem mais duro (julgamento da pessoa) que os fatos.
 *
 *   ORIENT  — orientação para a próxima vez, sem cobrança: a regra foi publicada DEPOIS da chamada (nunca se cobra regra que não
 *             existia), ou é a primeira vez e o impacto não é alto.
 *   CORRECT — "puxão de orelha" claro: a regra já valia, e o ponto é de impacto alto ou se repetiu em outras chamadas analisadas.
 *             O texto diz o que não foi feito, por que importa pela regra e o que fazer.
 *   INSIST  — o mesmo ponto já foi orientado num retorno ENTREGUE antes e voltou a acontecer: cobrança firme e respeitosa, com a data.
 *
 * Escalonar ao gestor fica fora daqui (escada OBSERVE → ORIENT → COACH → ACTION_PLAN → MANAGER do produto): este módulo só decide o
 * TOM de um retorno ao próprio colaborador. As justificativas (`basis`) são frases do SISTEMA com fatos — a materialidade é leitura
 * da análise e por isso influi no nível, mas nunca vira justificativa escrita.
 */
export const FEEDBACK_FIRMNESS_VERSION = "FEEDBACK_FIRMNESS_V1" as const

export type FirmnessLevel = "ORIENT" | "CORRECT" | "INSIST"
/** Por que o tom subiu: impacto alto, reincidência (a mesma prática falhou em outras chamadas) ou orientação anterior entregue. A
 * reincidência precisa ser DITA no texto (validação V14D: "não cumprida em 7 das 8 chamadas anteriores" estava no ponto e o texto
 * corrigiu como se fosse a primeira vez). */
export type FirmnessReason = "HIGH_IMPACT" | "RECURRENCE" | "PRIOR_ORIENTATION"
export type Firmness = { level: FirmnessLevel; basis: string[]; dueTo?: FirmnessReason[] }

/** A mesma prática em OUTRAS chamadas analisadas (conclusões confirmadas). Os números vão ao redator pela frase de histórico do
 * próprio ponto (`history`) ou pelos números do padrão do indicador — aqui só decidem o nível. */
export type PracticeRecurrence = { assessed: number; notMet: number }

export type FirmnessInput = {
  ruleBasis: RulePerspective | null
  materiality: Materiality
  recurrence: PracticeRecurrence | null
  /** Último retorno ENTREGUE que trouxe esta prática como ponto de desenvolvimento (antes desta chamada/período). */
  priorOrientation: { dateLabel: string } | null
  /** Ponto de UMA chamada (monitoria) ou padrão das chamadas analisadas de um período (indicador): muda só a redação da base. */
  scope?: "CALL" | "PERIOD"
}

/** Reincidência mínima para endurecer sem impacto alto: a mesma prática não cumprida em pelo menos duas chamadas. */
export const RECURRENCE_FOR_CORRECTION = 2

export function firmnessOf(input: FirmnessInput): Firmness {
  const period = input.scope === "PERIOD"
  if (input.ruleBasis === "CURRENT_RULE_REEVALUATION") return { level: "ORIENT", basis: [`A regra foi publicada depois ${period ? "das chamadas analisadas" : "desta chamada"}: vale como orientação para as próximas, sem cobrança pelo que já passou.`] }
  const inForce = period ? "A regra já valia nas chamadas analisadas do período." : "A regra já valia na data da chamada."
  const recurrent = (input.recurrence?.notMet ?? 0) >= RECURRENCE_FOR_CORRECTION
  const dueTo = (reasons: (FirmnessReason | false)[]) => reasons.filter((reason): reason is FirmnessReason => Boolean(reason))
  if (input.priorOrientation) return { level: "INSIST", basis: [`Este ponto já foi orientado num retorno entregue em ${input.priorOrientation.dateLabel} e voltou a acontecer.`, inForce], dueTo: dueTo(["PRIOR_ORIENTATION", recurrent && "RECURRENCE"]) }
  if (input.materiality === "HIGH" || recurrent) return { level: "CORRECT", basis: [inForce], dueTo: dueTo([input.materiality === "HIGH" && "HIGH_IMPACT", recurrent && "RECURRENCE"]) }
  return { level: "ORIENT", basis: [inForce] }
}

const RANK: Record<FirmnessLevel, number> = { ORIENT: 0, CORRECT: 1, INSIST: 2 }
/** Pontos consolidados (mesmo comportamento): vale o nível mais alto entre os membros. */
export function strongestFirmness(levels: readonly (Firmness | undefined)[]): Firmness | undefined {
  const present = levels.filter((entry): entry is Firmness => Boolean(entry))
  return present.sort((a, b) => RANK[b.level] - RANK[a.level])[0]
}
