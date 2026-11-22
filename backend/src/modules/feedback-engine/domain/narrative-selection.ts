import { RULES_PER_POINT, STRENGTHS_ALONE, STRENGTHS_WITH_DEVELOPMENT, type BriefFinding, type BriefOpenPoint, type FeedbackBrief, type MergeConflict } from "./feedback-brief.js"
import { strongestFirmness } from "./firmness.js"

/**
 * `NARRATIVE_TOP_FAILURES_V1` (21/11/2026, decisão do responsável — substitui a de setembro de "todo erro confiável no texto"): o TEXTO
 * da monitoria fala das no máximo 3 falhas operacionais mais graves; TODAS as falhas continuam nos cards de "Entenda este feedback"
 * (`additionalDevelopments`, montados só com fatos do sistema), no registro da mensagem e no Diagnóstico da liderança. Vale para toda
 * monitoria — com um especialista ou com vários.
 *
 * Gravidade, nesta ordem: (1) caminho do atendimento errado; (2) materialidade alta antes de média; (3) reincidência — ponto já
 * orientado e repetido (`INSIST`) ou não cumprido em outras chamadas; (4) a ordem em que aconteceu na chamada (primeiro turno citado);
 * (5) a ordem do brief.
 */
export const NARRATIVE_FAILURES_LIMIT = 3

const MATERIALITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

const isRecurring = (finding: BriefFinding) => finding.firmness?.level === "INSIST" || (finding.recurrence?.notMet ?? 0) > 0

/** Primeiro turno citado pelo ponto (ou pelas etapas dele); sem fala citada (ausência), depois dos que têm. */
function firstTurnOf(finding: BriefFinding): number {
  const turns = [...finding.quotes, ...(finding.steps ?? []).flatMap((step) => step.quotes)]
    .map((quote) => Number(/\d+/u.exec(quote.turn ?? "")?.[0] ?? Number.NaN))
    .filter((turn) => Number.isFinite(turn))
  return turns.length > 0 ? Math.min(...turns) : Number.POSITIVE_INFINITY
}

/** Ordena os ajustes do mais grave para o menos grave (estável). */
export function bySeverity(findings: readonly BriefFinding[]): BriefFinding[] {
  return findings
    .map((finding, index) => ({ finding, index, turn: firstTurnOf(finding) }))
    .sort((a, b) =>
      Number(a.finding.origin !== "PATH") - Number(b.finding.origin !== "PATH") ||
      (MATERIALITY_RANK[a.finding.materiality] ?? 1) - (MATERIALITY_RANK[b.finding.materiality] ?? 1) ||
      Number(!isRecurring(a.finding)) - Number(!isRecurring(b.finding)) ||
      a.turn - b.turn ||
      a.index - b.index,
    )
    .map((entry) => entry.finding)
}

/**
 * Aplica o teto do texto: os 3 ajustes mais graves ficam em `developments` (vão ao redator e ao verificador, como sempre); os demais vão
 * para `additionalDevelopments` (só cards, nunca ao redator). Refs renumeradas na ordem de gravidade (A1…A3 no texto, A4… nos cards).
 */
export function limitNarrativeFailures(brief: FeedbackBrief, limit = NARRATIVE_FAILURES_LIMIT): FeedbackBrief {
  if (brief.domain !== "MONITORING") return brief
  const ordered = bySeverity([...brief.developments, ...(brief.additionalDevelopments ?? [])])
  const renumbered = ordered.map((finding, index) => ({ ...finding, ref: `A${index + 1}` }))
  const narrated = renumbered.slice(0, limit)
  const additional = renumbered.slice(limit)
  const limited: FeedbackBrief = { ...brief, developments: narrated }
  if (additional.length > 0) limited.additionalDevelopments = additional
  else delete limited.additionalDevelopments
  return limited
}

const keysOf = (finding: BriefFinding) => [finding.findingKey, ...(finding.memberFindingKeys ?? []), ...(finding.steps ?? []).flatMap((step) => (step.findingKey ? [step.findingKey] : []))]

const MATERIALITY_ORDER = ["HIGH", "MEDIUM", "LOW"] as const
const uniqueBy = <T>(items: readonly T[], keyOf: (item: T) => string) => items.filter((item, index, all) => all.findIndex((other) => keyOf(other) === keyOf(item)) === index)

/** Um ponto com as regras, as falas e as chaves dos dois — a prova de cada base continua lá (nada some da memória nem dos detalhes).
 * Todas as chaves do outro (achado, membros e etapas) entram em `memberFindingKeys`: o que for comunicado fica entregue por inteiro. */
function joinSamePractice(lead: BriefFinding, other: BriefFinding): BriefFinding {
  const materiality = MATERIALITY_ORDER.find((level) => lead.materiality === level || other.materiality === level) ?? lead.materiality
  const recurrence = (other.recurrence?.notMet ?? -1) > (lead.recurrence?.notMet ?? -1) ? other.recurrence : lead.recurrence
  const firmness = strongestFirmness([lead.firmness, other.firmness])
  return {
    ...lead,
    materiality,
    quotes: uniqueBy([...lead.quotes, ...other.quotes], (quote) => `${quote.turn}|${quote.text}`).slice(0, 3),
    rules: uniqueBy([...lead.rules, ...other.rules], (rule) => `${rule.documentId}|${rule.text}`).slice(0, RULES_PER_POINT),
    criterionKeys: [...new Set([...lead.criterionKeys, ...other.criterionKeys])],
    memberFindingKeys: [...new Set([...(lead.memberFindingKeys ?? []), ...keysOf(other)])].filter((key) => key !== lead.findingKey),
    practiceKeys: [...new Set([...(lead.practiceKeys ?? []), ...(other.practiceKeys ?? [])])],
    ...(recurrence ? { recurrence } : {}),
    ...(firmness ? { firmness } : {}),
  }
}

/**
 * Junta os achados de vários especialistas numa lista só (`MULTI_SPECIALIST_MERGE_V2`):
 *  - todas as chaves já vistas = o mesmo fato visto por dois → entra uma vez;
 *  - PARTE das chaves já vista (run-9, SFW-03) → o achado é juntado ao dono dessas chaves, e as chaves próprias dele vão junto (antes ele
 *    sumia inteiro e as chaves dele nunca ficavam entregues);
 *  - mesma PRÁTICA vinda de OUTRO especialista (`samePractice`) → um ponto só (dentro de um brief a consolidação dele já decidiu).
 */
function mergeFindings(perBrief: readonly (readonly BriefFinding[])[], options: { samePractice: boolean }): BriefFinding[] {
  const out: BriefFinding[] = []
  const ownerOfKey = new Map<string, number>()
  const ownerOfPractice = new Map<string, { index: number; brief: number }>()
  const register = (finding: BriefFinding, index: number, brief: number) => {
    for (const key of keysOf(finding)) if (!ownerOfKey.has(key)) ownerOfKey.set(key, index)
    for (const key of finding.practiceKeys ?? []) if (!ownerOfPractice.has(key)) ownerOfPractice.set(key, { index, brief })
  }
  perBrief.forEach((findings, brief) => {
    for (const finding of findings) {
      const keys = keysOf(finding)
      const byKey = keys.map((key) => ownerOfKey.get(key)).find((index) => index !== undefined)
      if (byKey !== undefined && keys.every((key) => ownerOfKey.has(key))) continue
      const byPractice = options.samePractice ? (finding.practiceKeys ?? []).map((key) => ownerOfPractice.get(key)).find((owner) => owner !== undefined && owner.brief !== brief)?.index : undefined
      const target = byKey ?? byPractice
      if (target !== undefined) {
        out[target] = joinSamePractice(out[target]!, finding)
        register(finding, target, brief)
        continue
      }
      out.push(finding)
      register(finding, out.length - 1, brief)
    }
  })
  return out
}

/**
 * `MULTI_SPECIALIST_MERGE_V1`: junta os briefs das análises de VÁRIOS especialistas da mesma chamada (Orquestrador) num brief só — antes
 * o feedback usava só a análise do primeiro especialista e as dos outros, pagas, só iam para o Diagnóstico. O mesmo fato visto por dois
 * especialistas entra uma vez: pela mesma chave de critério (a mesma base ligada aos dois) ou pela mesma PRÁTICA (`practiceKeys`, a
 * identidade semântica da conduta que o motor já atribui — a mesma recapitulação escrita na base de Qualidade e na de Retenção). A
 * mesma prática vira UM ponto com as regras e as falas das duas bases (validação paga de 21/11: a recapitulação aparecia 2× nos cards).
 * O teto do texto é aplicado depois (`limitNarrativeFailures`), sobre os ajustes de todos.
 *
 * `MULTI_SPECIALIST_MERGE_V2` (22/11/2026, run-9 SFW-03): (1) a mesma conduta nunca sai como ajuste E como reconhecimento — um
 * especialista diz que faltou e outro que foi feita (bases escritas de jeitos diferentes): fica só o AJUSTE; o reconhecimento sai com
 * as chaves dele livres (não comunicado = não entregue) e o conflito fica registrado em `mergeConflicts` (auditoria, nunca vai ao
 * redator). (2) Achado com chave parcialmente repetida é juntado ao dono, nunca descartado inteiro.
 */
export function mergeMonitoringBriefs(briefs: readonly FeedbackBrief[]): FeedbackBrief {
  const [primary, ...others] = briefs
  if (!primary) throw new Error("mergeMonitoringBriefs: nenhum brief.")
  if (others.length === 0) return primary
  const developments = mergeFindings(briefs.map((brief) => [...brief.developments, ...(brief.additionalDevelopments ?? [])]), { samePractice: true })
  // A mesma conduta como ajuste (de um especialista) e reconhecimento (de outro): pela prática ou por uma chave do ajuste.
  const developmentKeys = new Set(developments.flatMap(keysOf))
  const developmentOfPractice = new Map(developments.flatMap((finding) => (finding.practiceKeys ?? []).map((key) => [key, finding] as const)))
  const conflicts: MergeConflict[] = []
  const contradicts = (strength: BriefFinding) => {
    const byPractice = (strength.practiceKeys ?? []).find((key) => developmentOfPractice.has(key))
    const development = byPractice ? developmentOfPractice.get(byPractice)! : developments.find((finding) => keysOf(strength).some((key) => keysOf(finding).includes(key)))
    if (!development) return false
    conflicts.push({ kind: "STRENGTH_VS_DEVELOPMENT", kept: development.findingKey, dropped: strength.findingKey, practiceKey: byPractice ?? null, sharedKeys: keysOf(strength).filter((key) => developmentKeys.has(key)) })
    return true
  }
  // Reconhecimentos: os de cada brief já vêm escolhidos e ordenados; juntos, o mesmo limite de um brief só.
  const strengths = mergeFindings(briefs.map((brief) => brief.strengths.filter((strength) => !contradicts(strength))), { samePractice: false })
    .slice(0, developments.length > 0 ? STRENGTHS_WITH_DEVELOPMENT : STRENGTHS_ALONE)
    .map((finding, index) => ({ ...finding, ref: `S${index + 1}` }))
  const openPoints: BriefOpenPoint[] = uniqueBy(briefs.flatMap((brief) => brief.openPoints ?? []), (point) => point.findingKey).map((point, index) => ({ ...point, ref: `O${index + 1}` }))
  const scenarioQuotes = uniqueBy(briefs.flatMap((brief) => brief.scenarioQuotes ?? []), (quote) => `${quote.turn}|${quote.text}`).slice(0, 4)
  const materials = uniqueBy(briefs.flatMap((brief) => brief.materials), (material) => material.documentId)
  const coverageLimits = briefs.flatMap((brief) => brief.coverageLimits ?? [])
  const reevaluated = briefs.some((brief) => brief.rulePerspective === "CURRENT_RULE_REEVALUATION")
  return {
    ...primary,
    context: [...new Set(briefs.flatMap((brief) => brief.context))],
    situation: briefs.map((brief) => brief.situation).find(Boolean) ?? null,
    scenarioQuotes,
    ...(openPoints.length > 0 ? { openPoints } : {}),
    readerNotes: [...new Set(briefs.flatMap((brief) => brief.readerNotes ?? []))],
    ...(coverageLimits.length > 0 ? { coverageLimits } : {}),
    centralNeedOpen: briefs.map((brief) => brief.centralNeedOpen).find(Boolean) ?? null,
    developments: developments.map((finding, index) => ({ ...finding, ref: `A${index + 1}` })),
    strengths,
    limitations: [...new Set(briefs.flatMap((brief) => brief.limitations))],
    materials,
    tone: developments.length === 0 ? "RECOGNITION" : strengths.length === 0 ? "DEVELOPMENT" : "MIXED",
    suppressed: uniqueBy(briefs.flatMap((brief) => brief.suppressed), (entry) => entry.findingKey),
    rulePerspective: reevaluated ? "CURRENT_RULE_REEVALUATION" : primary.rulePerspective ?? null,
    ...(conflicts.length > 0 ? { mergeConflicts: uniqueBy(conflicts, (conflict) => `${conflict.kept}|${conflict.dropped}`) } : {}),
  }
}
