import { evaluateAttainment } from "../../indicators/domain/evaluate-attainment.js"
import { isRecognitionRankingSelection } from "../domain/graph-schema.js"
import { NO_PARTITION_ID, type EmployeeCollectionOutput, type RankingPartition } from "./select-employees-executor.js"

/**
 * Formato "Reconhecimento" de "Chamar agente". Quem é reconhecido é decidido por regra, nunca pela IA: o ranking de "Selecionar
 * colaboradores" escolhe, e estes fatos dizem ao agente por que a pessoa foi escolhida e como cada resultado ficou frente à meta.
 * Ser o melhor basta para o reconhecimento, mesmo abaixo da meta: por isso a meta é dita por código, para o texto nunca tratar
 * um resultado abaixo dela como meta batida. Mas reconhecer exige um motivo: sem comparação, sem evolução e sem meta batida, não há
 * reconhecimento (`hasRecognitionGround`), a IA não é chamada e a execução segue com o motivo na saída do nó.
 */
export const RECOGNITION_FEEDBACK_VERSION = "RECOGNITION_FEEDBACK_V1"

export type TargetStatus = "MET" | "NOT_MET" | "UNKNOWN"

export const TARGET_STATUS_TEXT: Record<TargetStatus, string> = {
  MET: "dentro da meta",
  NOT_MET: "fora da meta",
  UNKNOWN: "sem leitura de meta",
}

/**
 * O atingimento oficial decide quando existe; sem ele, valor × meta pela direção oficial (`isWithinReference` faz o mesmo no analytics).
 * Meta por faixa ("TARGET") sem atingimento fica sem leitura, porque dado que falta nunca é resultado ruim.
 */
export function targetStatusOf(input: { achievementPercent: number | null; value: number; target: number | null; direction: string }): TargetStatus {
  if (input.achievementPercent !== null) return input.achievementPercent >= 100 ? "MET" : "NOT_MET"
  if (input.direction !== "HIGHER" && input.direction !== "LOWER") return "UNKNOWN"
  const within = evaluateAttainment(input.value, input.target, input.direction)
  return within === null ? "UNKNOWN" : within ? "MET" : "NOT_MET"
}

export type RecognitionFact = {
  contractVersion: typeof RECOGNITION_FEEDBACK_VERSION
  basis: "BEST" | "IMPROVED"
  /** O que foi ranqueado, em palavras ("Atingimento do PRV"). */
  subject: string
  /** O indicador ranqueado. `null` = o PRV. */
  indicatorCode: string | null
  periodLabel: string
  /** Onde a posição vale ("no Subgrupo Voz"). */
  scope: string
  position: number
  rankedCount: number
  previousValue: number | null
  currentValue: number | null
  /** "%" quando o ranking é de atingimento. O valor bruto de um indicador fica sem unidade: a coleção não a guarda. */
  valueSuffix: string
}

function scopeOf(partitionBy: "NONE" | "TEAM" | "SUBTEAM", partition: RankingPartition): string {
  if (partitionBy === "NONE" || !partition.name) return "na estrutura avaliada"
  if (partition.id === NO_PARTITION_ID) return `entre quem está em "${partition.name}"`
  return `${partitionBy === "TEAM" ? "no Grupo" : "no Subgrupo"} ${partition.name}`
}

const displayNumber = (value: number) => Number(value.toFixed(2))

/** A posição da pessoa na coleção congelada da execução. `null` = a pessoa não foi escolhida por um ranking de reconhecimento. */
export function recognitionFactOf(collection: EmployeeCollectionOutput, employeeId: string, subject: string): RecognitionFact | null {
  if (collection.mode !== "RANKING" || !isRecognitionRankingSelection(collection.ranking.selection)) return null
  for (const partition of collection.partitions) {
    const member = partition.members.find((candidate) => candidate.employeeId === employeeId)
    if (!member) continue
    const change = "previousValue" in member
    return {
      contractVersion: RECOGNITION_FEEDBACK_VERSION,
      basis: collection.ranking.selection,
      subject,
      indicatorCode: collection.ranking.source === "PRV_ACHIEVEMENT" ? null : (collection.ranking.indicatorCode ?? null),
      periodLabel: partition.calculation?.periodLabel ?? "período da seleção",
      scope: scopeOf(collection.partitionBy, partition),
      position: member.position,
      rankedCount: partition.rankedCount,
      previousValue: change ? displayNumber(member.previousValue) : null,
      currentValue: change ? displayNumber(member.currentValue) : null,
      valueSuffix: collection.ranking.source === "PRV_ACHIEVEMENT" || collection.ranking.source === "INDICATOR_ACHIEVEMENT" ? "%" : "",
    }
  }
  return null
}

/** A frase do sistema: vai ao contexto do agente e ao campo "Comportamento observado" do feedback. Nunca escrita pela IA. */
export function describeRecognitionFact(fact: RecognitionFact): string {
  // Sem mais ninguém com dados não existe "melhor" nem "maior": a frase não pode sugerir uma disputa que não houve.
  if (fact.rankedCount === 1) {
    const change = fact.previousValue !== null && fact.currentValue !== null ? `, de ${fact.previousValue}${fact.valueSuffix} para ${fact.currentValue}${fact.valueSuffix}` : ""
    return `${fact.basis === "IMPROVED" ? "Evolução" : "Único resultado com dados"} em ${fact.subject} ${fact.scope} (${fact.periodLabel.toLowerCase()})${change}: não houve comparação com outras pessoas.`
  }
  const first = fact.position === 1
  const lead = fact.basis === "IMPROVED" ? (first ? "Maior evolução" : "Entre as maiores evoluções") : first ? "Melhor resultado" : "Entre os melhores resultados"
  const movement = fact.previousValue !== null && fact.currentValue !== null ? `, de ${fact.previousValue}${fact.valueSuffix} para ${fact.currentValue}${fact.valueSuffix}` : ""
  return `${lead} em ${fact.subject} ${fact.scope} (${fact.periodLabel.toLowerCase()})${movement}: posição ${fact.position} entre ${fact.rankedCount} pessoas com dados.`
}

/** Reconhecer exige um motivo: uma comparação com outras pessoas, uma evolução ou a meta batida. Dado ausente não é resultado ruim, mas também não é motivo. */
export function hasRecognitionGround(fact: RecognitionFact, rankedResult: TargetStatus): boolean {
  return fact.rankedCount > 1 || fact.basis === "IMPROVED" || rankedResult === "MET"
}

export const RECOGNITION_SKIPPED_REASON = "NO_COMPARISON_AND_TARGET_NOT_MET"

/** A saída do nó quando não há motivo: nada foi pedido à IA. O Output não publica, e a síntese sabe por quê. */
export type RecognitionSkippedOutput = { kind: "RECOGNITION_SKIPPED"; personId: string; reason: typeof RECOGNITION_SKIPPED_REASON; text: string; fact: RecognitionFact }

export function recognitionSkippedOutput(fact: RecognitionFact, personId: string, rankedResult: TargetStatus): RecognitionSkippedOutput {
  const text = `Sem reconhecimento: único resultado com dados em ${fact.subject} ${fact.scope} (${fact.periodLabel.toLowerCase()}), ${TARGET_STATUS_TEXT[rankedResult]}. Não houve comparação com outras pessoas nem meta batida.`
  return { kind: "RECOGNITION_SKIPPED", personId, reason: RECOGNITION_SKIPPED_REASON, text, fact }
}

export const isRecognitionSkippedOutput = (value: unknown): value is RecognitionSkippedOutput => Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "RECOGNITION_SKIPPED"
