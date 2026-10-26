import { STRENGTH_LABELS, strongestOf, type EvidenceStrength } from "./evidence-criteria.js"
import type { DataOrigin } from "./pattern.js"

/**
 * ORIENTAÇÃO AO OPERADOR (`BEST_PRACTICE_GUIDANCE_V1`) — o MESMO texto alimenta o chat (texto e voz), o feedback e a
 * pré-visualização da tela. Regras que o texto já carrega (e que a INIA recebe junto):
 *  - só padrões disponíveis (aprovados, sustentados, não-obrigação, dados reais) e do indicador + contexto pedidos;
 *  - associação, nunca causa: "observamos maior frequência…", com os números do sistema e o período;
 *  - o comportamento do operador só com evidência DAS CHAMADAS DELE codificadas na análise; sem isso, dizer que não foram analisadas;
 *  - exemplo de fala é sugestão, nunca transcrição;
 *  - sem padrão relevante: dizer que a base não tem — nunca um conselho genérico apresentado como descoberta.
 * `BEST_PRACTICE_GUIDANCE_V4` (22/10/2026, `BEST_PRACTICE_HOW_IT_HELPS_V1`): "Como ajuda no resultado" (texto aprovado na revisão) é o
 * ÚNICO fundamento para ligar a prática ao resultado; sem ele, a ligação não é feita.
 */
export type GuidanceContext = { label: string; topRatePercent: number | null; referenceRatePercent: number | null; topOperators: number; referenceOperators: number; topCalls: number; referenceCalls: number; strength: EvidenceStrength }
export type GuidancePattern = {
  id: string
  name: string
  description: string
  guidance: string
  suggestedPhrasing: string | null
  notApplicableWhen: string | null
  additionalBehavior: string | null
  /** `BEST_PRACTICE_HOW_IT_HELPS_V1`: como a prática ajuda no resultado, escrito (ou aprovado a partir do rascunho da IA) por quem revisou. */
  howItHelps?: string | null
  indicatorName: string
  /** Pelo sinal da chamada (V2), a associação é entre chamadas boas e ruins, não entre operadores. */
  outcomeKind?: "INDICATOR" | "CALL_SIGNAL"
  strength: EvidenceStrength
  periodLabel: string
  contexts: GuidanceContext[]
  dataOrigin: DataOrigin
}
/** Codificações das chamadas DO PRÓPRIO operador na análise vigente do padrão (null = nenhuma chamada dele foi analisada). */
export type OperatorEvidence = { callsWithSituation: number; present: number; callsAnalyzed: number }

export type GuidanceItem = {
  patternId: string
  name: string
  description: string
  contexts: string[]
  association: string
  strength: string
  you: string
  youKind: "OFTEN" | "SOMETIMES" | "RARELY" | "NO_SITUATION" | "NOT_ANALYZED"
  howTo: string
  /** Partes do "como aplicar" para a tela: a orientação e, na execução diferenciada, o que vai além da etapa obrigatória. */
  guidance: string
  additionalBehavior: string | null
  suggestedPhrasing: string | null
  notApplicableWhen: string | null
  /** `BEST_PRACTICE_HOW_IT_HELPS_V1`: como ajuda no resultado (aprovado na revisão); nulo = não ligar a prática ao resultado. */
  howItHelps: string | null
  synthetic: boolean
  /** As taxas do contexto principal (melhores × referência) — para quem precisa dizer a comparação em palavras, sem a frase técnica. */
  comparison: { topRatePercent: number | null; referenceRatePercent: number | null } | null
}

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value)}%`)

export function associationSentenceOf(pattern: Pick<GuidancePattern, "periodLabel" | "outcomeKind" | "indicatorName">, context: GuidanceContext): string {
  if (pattern.outcomeKind === "CALL_SIGNAL") return `Nas chamadas comparáveis de ${context.label} analisadas (${pattern.periodLabel}), o comportamento apareceu em ${pct(context.topRatePercent)} das chamadas com resultado bom em ${pattern.indicatorName} em que a situação existiu (${context.topOperators} operadores, ${context.topCalls} chamadas) e em ${pct(context.referenceRatePercent)} das chamadas com resultado ruim (${context.referenceOperators} operadores, ${context.referenceCalls} chamadas).`
  return `Nas chamadas comparáveis de ${context.label} analisadas (${pattern.periodLabel}), o comportamento apareceu em ${pct(context.topRatePercent)} das chamadas em que a situação existiu entre os operadores com melhores resultados (${context.topOperators} operadores, ${context.topCalls} chamadas) e em ${pct(context.referenceRatePercent)} no grupo de referência (${context.referenceOperators} operadores, ${context.referenceCalls} chamadas).`
}

export function operatorEvidenceSentenceOf(evidence: OperatorEvidence | null): { text: string; kind: GuidanceItem["youKind"] } {
  if (!evidence || evidence.callsAnalyzed === 0) return { kind: "NOT_ANALYZED", text: "Suas chamadas não estavam nesta análise: não há evidência sobre como você faz isso hoje." }
  if (evidence.callsWithSituation === 0) return { kind: "NO_SITUATION", text: `Em ${evidence.callsAnalyzed} chamada(s) sua(s) analisada(s), a situação não aconteceu: não há evidência sobre como você faz isso.` }
  const share = evidence.present / evidence.callsWithSituation
  const kind = share >= 0.5 ? "OFTEN" : share > 0 ? "SOMETIMES" : "RARELY"
  return { kind, text: `Nas suas chamadas analisadas, o comportamento apareceu em ${evidence.present} de ${evidence.callsWithSituation} em que a situação existiu.` }
}

export function guidanceItemOf(pattern: GuidancePattern, evidence: OperatorEvidence | null): GuidanceItem {
  const you = operatorEvidenceSentenceOf(evidence)
  const main = [...pattern.contexts].sort((a, b) => (b.topCalls + b.referenceCalls) - (a.topCalls + a.referenceCalls))[0]
  return {
    patternId: pattern.id,
    name: pattern.name,
    description: pattern.description,
    contexts: pattern.contexts.map((context) => context.label),
    association: main ? associationSentenceOf(pattern, main) : "",
    // A força é a do CONTEXTO que casou com o pedido (`BEST_PRACTICE_GUIDANCE_V3`): o padrão pode ser forte num assunto e moderado noutro.
    strength: STRENGTH_LABELS[pattern.contexts.length > 0 ? strongestOf(pattern.contexts.map((context) => context.strength)) : pattern.strength],
    you: you.text,
    youKind: you.kind,
    howTo: pattern.additionalBehavior ? `${pattern.guidance} (O diferencial é o que vai além da etapa obrigatória: ${pattern.additionalBehavior})` : pattern.guidance,
    guidance: pattern.guidance,
    additionalBehavior: pattern.additionalBehavior,
    suggestedPhrasing: pattern.suggestedPhrasing,
    notApplicableWhen: pattern.notApplicableWhen,
    howItHelps: pattern.howItHelps ?? null,
    synthetic: pattern.dataOrigin === "SYNTHETIC",
    comparison: main ? { topRatePercent: main.topRatePercent, referenceRatePercent: main.referenceRatePercent } : null,
  }
}

export const BEST_PRACTICE_RESPONSE_RULES = [
  "[Boas práticas — regra do sistema]",
  "- Ao orientar sobre um indicador, combine: (1) o resultado e a tendência da pessoa, (2) as boas práticas relevantes desta lista e (3) uma sugestão concreta para as chamadas dela.",
  "- Apresente sempre como ASSOCIAÇÃO observada (\"observamos maior frequência… entre operadores com melhores resultados\"), nunca como causa: não diga que o comportamento faz o indicador melhorar, garante ou explica o resultado.",
  "- Como a prática ajuda no resultado, só com o texto de \"Como ajuda no resultado\" (aprovado por quem revisou a prática), com as suas palavras e sem ir além dele; sem esse texto, não ligue a prática ao resultado. Nunca prometa o resultado (\"vai baixar seu TMA\", \"garante\").",
  "- Sobre o que a pessoa faz, diga só o que está em \"Nas suas chamadas\". Sem análise das chamadas dela, diga que elas não foram analisadas — nunca suponha.",
  "- O exemplo de fala é uma SUGESTÃO para experimentar, não uma fala real de nenhuma chamada; apresente-o assim.",
  "- Sem boa prática na lista, diga claramente que a base ainda não tem uma prática sustentada para isso; não ofereça conselho genérico como se fosse descoberta da base.",
  "- Nunca sugira pular etapa do processo, omitir informação ou buscar nota/avaliação.",
].join("\n")

export function guidanceTextOf(input: { indicatorName: string; contextsLabel: string | null; items: readonly GuidanceItem[]; noPatternReason: string | null }): string {
  const header = `[Boas práticas da base para ${input.indicatorName} — calculado pelo sistema; use só o que está aqui]`
  if (input.items.length === 0) {
    return [header, input.noPatternReason ?? `A base ainda não tem boa prática aprovada e sustentada para ${input.indicatorName}${input.contextsLabel ? ` nos contextos ${input.contextsLabel}` : ""}.`, "Diga isso claramente; não substitua por conselho genérico apresentado como descoberta.", "", BEST_PRACTICE_RESPONSE_RULES].join("\n")
  }
  const lines = input.items.flatMap((item, index) => [
    `${index + 1}. **${item.name}**${item.synthetic ? " (DADO SINTÉTICO — teste, não é prova)" : ""} — ${item.description}`,
    `   - Contexto: ${item.contexts.join(" · ")}. Força da evidência: ${item.strength.toLowerCase()}.`,
    `   - ${item.association}`,
    `   - Nas suas chamadas: ${item.you}`,
    `   - Como aplicar: ${item.howTo}`,
    ...(item.howItHelps ? [`   - Como ajuda no resultado (aprovado na revisão da prática): ${item.howItHelps}`] : []),
    ...(item.suggestedPhrasing ? [`   - Sugestão de fala (exemplo para experimentar, não é fala de nenhuma chamada): "${item.suggestedPhrasing}"`] : []),
    ...(item.notApplicableWhen ? [`   - Não se aplica quando: ${item.notApplicableWhen}`] : []),
  ])
  return [header, `Associação observada, nunca causa${input.contextsLabel ? ` · contextos considerados: ${input.contextsLabel}` : ""}.`, ...lines, "", BEST_PRACTICE_RESPONSE_RULES].join("\n")
}
