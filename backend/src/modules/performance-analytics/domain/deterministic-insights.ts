import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import { consecutiveFromLatest } from "./achievement-math.js"
import type { Insight } from "./view-models.js"

/**
 * "Pontos positivos" e "Pontos de atenção" gerados SOMENTE a partir de fatos já persistidos
 * (atingimento oficial, meta, quartil, variação entre competências). Nada aqui chama IA nem
 * infere além do dado — cada frase é auditável contra os números exibidos ao lado. A linguagem é
 * descritiva, nunca disciplinar.
 */

/** Variação a partir da qual a evolução (pra cima ou pra baixo) é relevante o bastante pra virar
 * insight/situação. Constante única e documentada — a mesma da classificação de situação. */
export const RELEVANT_DELTA_PP = 5

export type AchievementFacts = {
  label: string
  achievementPercent: number | null
  quartile: Quartile | null
  deltaPp: number | null
  /** Série de atingimento por período, do mais antigo pro mais recente (inclui a atual). */
  history: (number | null)[]
  withinTarget: boolean | null
}

const formatPp = (value: number) => `${Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`
const formatPercent = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`

export function buildAchievementInsights(facts: AchievementFacts): { positives: Insight[]; attentionPoints: Insight[] } {
  const positives: Insight[] = []
  const attentionPoints: Insight[] = []
  const { achievementPercent, quartile, deltaPp, history, label } = facts

  if (achievementPercent === null) {
    attentionPoints.push({ tone: "ATTENTION", text: `Sem dado oficial de atingimento de ${label} neste período.` })
    if (facts.withinTarget === false) attentionPoints.push({ tone: "ATTENTION", text: "Resultado fora da meta vigente." })
    if (facts.withinTarget === true) positives.push({ tone: "POSITIVE", text: "Resultado dentro da meta vigente." })
    return { positives, attentionPoints }
  }

  if (achievementPercent >= 100) positives.push({ tone: "POSITIVE", text: `Atingimento de ${formatPercent(achievementPercent)} — igual ou acima da meta.` })
  else attentionPoints.push({ tone: "ATTENTION", text: `Atingimento de ${formatPercent(achievementPercent)} — faltam ${formatPp(100 - achievementPercent)} para a meta.` })

  if (quartile === "Q1") positives.push({ tone: "POSITIVE", text: "Está no Q1 — melhor quartil da referência oficial." })
  if (quartile === "Q4") attentionPoints.push({ tone: "ATTENTION", text: "Está no Q4 — quartil mais baixo da referência oficial." })

  if (deltaPp !== null) {
    if (deltaPp >= RELEVANT_DELTA_PP) positives.push({ tone: "POSITIVE", text: `Evoluiu ${formatPp(deltaPp)} em relação ao período anterior.` })
    else if (deltaPp <= -RELEVANT_DELTA_PP) attentionPoints.push({ tone: "ATTENTION", text: `Caiu ${formatPp(deltaPp)} em relação ao período anterior.` })
  }

  const aboveStreak = consecutiveFromLatest(history, (value) => value >= 100)
  if (aboveStreak >= 2) positives.push({ tone: "POSITIVE", text: `Atingimento igual ou acima de 100% há ${aboveStreak} períodos.` })
  const belowStreak = consecutiveFromLatest(history, (value) => value < 100)
  if (belowStreak >= 2) attentionPoints.push({ tone: "ATTENTION", text: `Abaixo da meta há ${belowStreak} períodos consecutivos.` })

  return { positives, attentionPoints }
}

export type StructureFacts = {
  consolidatedAchievementPercent: number | null
  deltaPp: number | null
  memberCount: number
  membersWithData: number
  belowReferenceCount: number
  q4Count: number
  weakestIndicator: { name: string; consolidatedAchievementPercent: number } | null
  strongestIndicator: { name: string; consolidatedAchievementPercent: number } | null
}

export function buildStructureInsights(facts: StructureFacts): { positives: Insight[]; attentionPoints: Insight[] } {
  const positives: Insight[] = []
  const attentionPoints: Insight[] = []

  if (facts.consolidatedAchievementPercent === null) {
    attentionPoints.push({ tone: "ATTENTION", text: "Nenhum membro possui dado oficial de atingimento neste período." })
    return { positives, attentionPoints }
  }

  if (facts.consolidatedAchievementPercent >= 100) positives.push({ tone: "POSITIVE", text: `Atingimento consolidado de ${formatPercent(facts.consolidatedAchievementPercent)} — igual ou acima da meta.` })
  else attentionPoints.push({ tone: "ATTENTION", text: `Atingimento consolidado de ${formatPercent(facts.consolidatedAchievementPercent)} — abaixo da meta.` })

  if (facts.deltaPp !== null) {
    if (facts.deltaPp >= RELEVANT_DELTA_PP) positives.push({ tone: "POSITIVE", text: `Consolidado evoluiu ${formatPp(facts.deltaPp)} em relação ao período anterior.` })
    else if (facts.deltaPp <= -RELEVANT_DELTA_PP) attentionPoints.push({ tone: "ATTENTION", text: `Consolidado caiu ${formatPp(facts.deltaPp)} em relação ao período anterior.` })
  }

  const missing = facts.memberCount - facts.membersWithData
  if (missing > 0) attentionPoints.push({ tone: "ATTENTION", text: `${missing} de ${facts.memberCount} ${missing === 1 ? "colaborador está" : "colaboradores estão"} sem dado oficial neste período.` })
  if (facts.belowReferenceCount > 0) attentionPoints.push({ tone: "ATTENTION", text: `${facts.belowReferenceCount} ${facts.belowReferenceCount === 1 ? "colaborador com indicador" : "colaboradores com indicador"} abaixo da referência.` })
  else if (facts.membersWithData > 0) positives.push({ tone: "POSITIVE", text: "Todos os colaboradores com dado estão dentro da referência em todos os indicadores." })
  if (facts.q4Count > 0) attentionPoints.push({ tone: "ATTENTION", text: `${facts.q4Count} ${facts.q4Count === 1 ? "colaborador" : "colaboradores"} no Q4 de PRV.` })
  if (facts.weakestIndicator && facts.weakestIndicator.consolidatedAchievementPercent < 100) {
    attentionPoints.push({ tone: "ATTENTION", text: `Indicador com menor atingimento: ${facts.weakestIndicator.name} (${formatPercent(facts.weakestIndicator.consolidatedAchievementPercent)}).` })
  }
  if (facts.strongestIndicator && facts.strongestIndicator.consolidatedAchievementPercent >= 100) {
    positives.push({ tone: "POSITIVE", text: `Indicador com maior atingimento: ${facts.strongestIndicator.name} (${formatPercent(facts.strongestIndicator.consolidatedAchievementPercent)}).` })
  }

  return { positives, attentionPoints }
}
