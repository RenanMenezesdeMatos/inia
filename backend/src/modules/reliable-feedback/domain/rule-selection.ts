import { cleanSectionHeading } from "./process-items.js"
import { knowledgeContentKindOf, type KnowledgeContentKind } from "./suggested-response.js"
import { terms, type RuleContext } from "./verified-omission.js"
import { actionStemOf, contentWords, sharedWords } from "./structured-anchor.js"
import { LEADING_LIST_MARKER } from "../../knowledge/domain/knowledge-list.js"
import { isExecutableSectionRole, sectionProcessRoleIn } from "../../knowledge/domain/section-roles.js"

/**
 * V1.7.1e — SELEÇÃO DETERMINÍSTICA DA REGRA OPERACIONAL (`RULE_SELECTION_V1`, domínio puro, sem modelo).
 *
 * O especialista cita UM trecho da base para a etapa, e às vezes cita a frase de ABERTURA de um exemplo ("Sempre informar prazo
 * de forma objetiva:") em vez da regra normativa da MESMA seção ("O operador deverá informar o prazo exibido na ferramenta.").
 * Quando a estrutura do documento publicado permite resolver isso, o sistema não depende da escolha textual do modelo:
 *
 *   NORMATIVA      frase com verbo de obrigação (deverá, deve, precisa, é obrigatório…) ou item de lista de procedimento;
 *   INTRODUTÓRIA   frase de abertura (termina em ":" sem itens) ou frase genérica sem verbo de obrigação;
 *   EXEMPLO        nunca substitui regra (pode ser mostrado à parte, rotulado);
 *   EVITAR         complementa a regra, nunca a substitui.
 *
 *   NORMATIVA > INTRODUTÓRIA > (EXEMPLO nunca) — o trecho citado continua no item (proveniência), a regra operacional é um
 *   trecho LITERAL a mais, da MESMA seção da MESMA versão publicada do MESMO documento, escolhido por regra fixa:
 *     citado NORMATIVO                 → nenhuma troca (a regra citada já é a operacional);
 *     citado INTRODUTÓRIO              → a frase normativa da seção com mais termos em comum com o citado (≥ 1); empate = a primeira;
 *     citado EVITAR                    → a primeira frase normativa da seção (é o que fazer no lugar);
 *     nenhuma frase normativa na seção → nenhuma troca.
 */
export const RULE_SELECTION_VERSION = "RULE_SELECTION_V1" as const

export type RuleSpecificity = "NORMATIVE" | "INTRODUCTORY" | "EXAMPLE" | "DO_NOT"
export type OperativeRule = {
  /** Trecho LITERAL da versão publicada (mesmo documento, mesma versão; seção do trecho citado ou, no backfill, a seção da etapa). */
  quote: string
  heading: string | null
  /** SECTION_NORMATIVE_RULE = mesma seção do trecho citado (V1.7.1e); CHECKPOINT_RULE_BACKFILL = seção do mesmo documento dedicada ao
   * objeto da etapa canônica (V1.7.1g — "5. Explicar prazo" → "35. Prazo da análise"). */
  basis: "SECTION_NORMATIVE_RULE" | "CHECKPOINT_RULE_BACKFILL"
  /** Por que houve troca: o trecho citado era abertura/genérico, a lista do que evitar, ou uma linha de lista sem a regra de como cumprir. */
  replaced: "INTRODUCTORY_CITATION" | "DO_NOT_CITATION" | "LIST_STEP_WITHOUT_RULE"
  selection: typeof RULE_SELECTION_VERSION | typeof CHECKPOINT_RULE_BACKFILL_VERSION
  /** V1.7.1g — proveniência própria (documento, versão e hash do conteúdo publicado de onde a regra foi lida). Ausente antes. */
  documentId?: string | null
  version?: number | null
  contentSha256?: string | null
}

export const NORMATIVE = /(?<!\p{L})(?:dever[áa]o?|devem|deve|precisa(?:m|r[áa])?|é\s+obrigatóri[oa]|são\s+obrigatóri[oa]s|obrigatoriamente|é\s+necessário|é\s+proibido)(?!\p{L})/iu
/** V1.7.1k — marcador da representação canônica de lista. */
const LIST_LINE = LEADING_LIST_MARKER
const HEADING = /^\s*(#{1,6})\s+(.*)$/
const QUOTED_LINE = /^\s*[“"«]/

/** Especificidade de um trecho citado (a partir do próprio trecho e do tipo verificado no documento). */
export function ruleSpecificityOf(quote: string, kind: KnowledgeContentKind | null | undefined): RuleSpecificity {
  if (kind === "EXAMPLE_CONTENT") return "EXAMPLE"
  if (kind === "DO_NOT_CONTENT") return "DO_NOT"
  const lines = quote.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && line !== "…" && line !== "...")
  if (lines.some((line) => LIST_LINE.test(line))) return "NORMATIVE"
  if (NORMATIVE.test(quote)) return "NORMATIVE"
  return "INTRODUCTORY"
}

const normalizeHeading = (text: string) => cleanSectionHeading(text).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

/** Linhas da seção cujo título é `heading` (até o próximo título de nível igual ou maior). */
export function sectionLinesOf(content: string, heading: string | null): string[] | null {
  if (!heading) return null
  const lines = content.split(/\r?\n/)
  const target = normalizeHeading(heading)
  const start = lines.findIndex((line) => { const match = HEADING.exec(line); return Boolean(match && normalizeHeading(match[2]!) === target) })
  if (start < 0) return null
  const level = HEADING.exec(lines[start]!)![1]!.length
  const section: string[] = []
  for (const line of lines.slice(start + 1)) {
    const match = HEADING.exec(line)
    if (match && match[1]!.length <= level) break
    section.push(line)
  }
  return section
}

/**
 * A regra operacional da seção para um trecho citado (null = o citado já é a regra, ou a seção não tem frase normativa).
 * Candidata: parágrafo da seção (não item de lista, não título, não fala entre aspas, não abertura com ":"), com verbo de
 * obrigação e classificado como REGRA no documento publicado.
 */
export function selectOperativeRule(input: { content: string; heading: string | null; citedQuote: string; citedKind: KnowledgeContentKind | null | undefined }): OperativeRule | null {
  const specificity = ruleSpecificityOf(input.citedQuote, input.citedKind)
  if (specificity !== "INTRODUCTORY" && specificity !== "DO_NOT") return null
  const section = sectionLinesOf(input.content, input.heading)
  if (!section) return null
  const cited = input.citedQuote.replace(/\s+/g, " ").trim()
  const candidates = section
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !LIST_LINE.test(line) && !HEADING.test(line) && !QUOTED_LINE.test(line) && !line.endsWith(":") && NORMATIVE.test(line))
    .filter((line) => !cited.includes(line) && !line.includes(cited))
    .filter((line) => knowledgeContentKindOf(input.content, line) === "RULE_CONTENT")
  if (candidates.length === 0) return null
  const citedTerms = terms(input.citedQuote)
  const scored = candidates.map((line, order) => ({ line, order, shared: [...terms(line)].filter((term) => citedTerms.has(term)).length }))
  const eligible = specificity === "DO_NOT" ? scored : scored.filter((entry) => entry.shared >= 1)
  if (eligible.length === 0) return null
  const chosen = [...eligible].sort((a, b) => b.shared - a.shared || a.order - b.order)[0]!
  return { quote: chosen.line, heading: input.heading, basis: "SECTION_NORMATIVE_RULE", replaced: specificity === "DO_NOT" ? "DO_NOT_CITATION" : "INTRODUCTORY_CITATION", selection: RULE_SELECTION_VERSION }
}

/**
 * V1.7.1f — EXEMPLOS da seção: linhas LITERAIS da mesma seção que o documento marca como exemplo (fala-modelo, "Exemplo:").
 * Nunca são mostradas como regra nem autorizam fato: servem para a proteção contra FATO DE EXEMPLO (número, prazo, canal que só
 * o exemplo traz) no texto do redator, na edição do QA e na abertura/fechamento.
 */
export function sectionExamplesOf(content: string, heading: string | null): string[] {
  const section = sectionLinesOf(content, heading)
  if (!section) return []
  return [...new Set(section.map((line) => line.trim()).filter((line) => line.length > 0 && !HEADING.test(line) && knowledgeContentKindOf(content, line) === "EXAMPLE_CONTENT").map((line) => line.replace(/^(?:[-*•+]\s*)?[“"«]|[”"»]$/g, "").trim()).filter((line) => line.length >= 12))]
}

const QUOTED_SPAN = /[“"«]([^”"»]{12,})[”"»]/g
/**
 * V1.7.1f — tira da ORIENTAÇÃO do especialista (texto de modelo que segue ao redator como interpretação) as falas-modelo
 * citadas que o documento marca como EXEMPLO. Frases de "evitar" e regras ficam (não são exemplo). Só troca trechos entre aspas
 * que existem literalmente no documento — nunca reescreve o resto.
 */
export function withoutExampleSpans(text: string, content: string): string {
  return text.replace(QUOTED_SPAN, (whole, inner: string) => (knowledgeContentKindOf(content, inner) === "EXAMPLE_CONTENT" && content.replace(/\s+/g, " ").includes(inner.replace(/\s+/g, " ").trim()) ? "(exemplo do material omitido)" : whole)).replace(/\s+/g, " ").trim()
}

/**
 * V1.7.1g — BACKFILL DETERMINÍSTICO DA REGRA DA ETAPA (`CHECKPOINT_RULE_BACKFILL_V1`, sem modelo).
 *
 * O especialista classifica a fala contra uma etapa canônica (linha de lista, ex.: "5. Explicar prazo;"), mas a regra de COMO
 * cumprir a etapa pode estar em outra seção do MESMO documento ("## 35. Prazo da análise → O operador deverá informar o prazo
 * exibido na ferramenta.") que nem entrou nos trechos daquela execução. O retrieval inicial serve para o Agent investigar; depois
 * que a etapa está identificada, a apresentação não depende de o modelo ter citado a melhor frase:
 *
 *   ETAPA        linha única de lista de procedimento, trecho de REGRA; o OBJETO da etapa = a linha sem o verbo inicial e sem a
 *                condição final ("Orientar sobre conta ajustada" → conta, ajustada);
 *   SEÇÃO        títulos do MESMO documento (outra seção) que contêm TODOS os termos do objeto e têm ao menos uma regra normativa;
 *                nenhuma → nada; mais de uma → AMBIGUOUS_SECTION (nunca escolhe em silêncio);
 *   REGRA        frase NORMATIVA da seção (verbo de obrigação), classificada como REGRA no documento, nunca exemplo, fala entre
 *                aspas nem lista do que evitar; abertura com ":" seguida de lista entra com a lista (literal). Preferência pela
 *                regra dirigida ao operador ("O operador deverá…"), depois por termos do objeto; empate = AMBIGUOUS_RULE.
 *
 * O trecho é LITERAL da mesma versão publicada usada na verificação, com a própria seção; não atravessa para outro documento.
 *
 * V1.7.1l — só seções EXECUTÁVEIS são candidatas (`section-roles.ts`): a regra de como cumprir uma etapa nunca vem de objetivo,
 * abrangência, conceitos, resultado esperado, referência ou exemplos ("3.5 Conta ajustada", em Conceitos, deixa de disputar com
 * "32. Conta ajustada").
 */
export const CHECKPOINT_RULE_BACKFILL_VERSION = "CHECKPOINT_RULE_BACKFILL_V1" as const
export type RuleBackfillStatus = "BACKFILLED" | "NOT_A_LIST_STEP" | "NO_OBJECT_TERMS" | "NO_MATCHING_SECTION" | "AMBIGUOUS_SECTION" | "AMBIGUOUS_RULE"
export type RuleBackfillAudit = { version: typeof CHECKPOINT_RULE_BACKFILL_VERSION; status: RuleBackfillStatus; objectTerms: string[]; candidateSections: string[] }

const OPERATOR_DIRECTED = /^(?:o|a)\s+(?:operador|operadora|atendente|colaborador|colaboradora)\s+/iu
const STEP_CONDITION_TAIL = /,\s*(?:quando|se|caso|desde\s+que)(?!\p{L}).*$/iu
const HEADING_LINE = /^\s*(#{1,6})\s+(.*)$/

/** Linhas da seção que começa na linha `start` (título), até o próximo título de nível igual ou maior. */
function sectionAt(lines: readonly string[], start: number): string[] {
  const level = HEADING.exec(lines[start]!)![1]!.length
  const section: string[] = []
  for (const line of lines.slice(start + 1)) {
    const match = HEADING.exec(line)
    if (match && match[1]!.length <= level) break
    section.push(line)
  }
  return section
}

/** Regras normativas de uma seção, cada uma LITERAL (abertura com ":" leva a lista que a segue). */
function normativeRulesOf(content: string, section: readonly string[]): string[] {
  const rules: string[] = []
  section.forEach((raw, index) => {
    const line = raw.trim()
    if (line.length === 0 || LIST_LINE.test(line) || HEADING.test(line) || QUOTED_LINE.test(line) || !NORMATIVE.test(line)) return
    if (knowledgeContentKindOf(content, line) !== "RULE_CONTENT") return
    if (!line.endsWith(":")) { rules.push(line); return }
    const items: string[] = []
    for (const next of section.slice(index + 1)) {
      const value = next.trim()
      if (value.length === 0 && items.length === 0) continue
      if (!LIST_LINE.test(value)) break
      items.push(value)
    }
    if (items.length > 0) rules.push([line, ...items].join("\n"))
  })
  return rules
}

export function backfillCheckpointRule(input: { content: string; rule: RuleContext | null; citedKind: KnowledgeContentKind | null | undefined }): { operativeRule: OperativeRule | null; audit: RuleBackfillAudit } {
  const audit = (status: RuleBackfillStatus, objectTerms: string[] = [], candidateSections: string[] = []): RuleBackfillAudit => ({ version: CHECKPOINT_RULE_BACKFILL_VERSION, status, objectTerms, candidateSections })
  const rule = input.rule
  if (!rule || rule.listKind === "NONE" || rule.stepPosition === null || (input.citedKind ?? "RULE_CONTENT") !== "RULE_CONTENT") return { operativeRule: null, audit: audit("NOT_A_LIST_STEP") }
  const step = rule.stepText.replace(STEP_CONDITION_TAIL, "").replace(/[;:.,]+$/, "").trim()
  const words = step.split(/\s+/)
  const object = actionStemOf(step) ? words.slice(1).join(" ") : step
  const objectTerms = [...new Set(contentWords(object))]
  if (objectTerms.length === 0) return { operativeRule: null, audit: audit("NO_OBJECT_TERMS") }
  const own = rule.heading ? normalizeHeading(rule.heading) : null
  const lines = input.content.split(/\r?\n/)
  // Por POSIÇÃO do título (dois títulos podem ter o mesmo texto limpo: "3.5 Conta ajustada" e "32. Conta ajustada").
  const candidates = lines
    .map((line, index) => ({ heading: HEADING_LINE.exec(line)?.[2] ?? null, index }))
    .filter((entry): entry is { heading: string; index: number } => entry.heading !== null && normalizeHeading(entry.heading) !== own)
    .filter((entry) => isExecutableSectionRole(sectionProcessRoleIn(input.content, entry.heading, "")))
    .filter((entry) => { const headingWords = contentWords(cleanSectionHeading(entry.heading)); return objectTerms.every((term) => sharedWords([term], headingWords).length > 0) })
    .map((entry) => ({ heading: entry.heading, rules: normativeRulesOf(input.content, sectionAt(lines, entry.index)) }))
    .filter((candidate) => candidate.rules.length > 0)
  const candidateSections = candidates.map((candidate) => cleanSectionHeading(candidate.heading))
  if (candidates.length === 0) return { operativeRule: null, audit: audit("NO_MATCHING_SECTION", objectTerms) }
  if (candidates.length > 1) return { operativeRule: null, audit: audit("AMBIGUOUS_SECTION", objectTerms, candidateSections) }
  const chosenSection = candidates[0]!
  const scored = chosenSection.rules.map((text) => ({ text, directed: OPERATOR_DIRECTED.test(text) ? 1 : 0, shared: sharedWords(objectTerms, contentWords(text)).length }))
  const best = [...scored].sort((a, b) => b.directed - a.directed || b.shared - a.shared)[0]!
  if (scored.filter((entry) => entry.directed === best.directed && entry.shared === best.shared).length > 1) return { operativeRule: null, audit: audit("AMBIGUOUS_RULE", objectTerms, candidateSections) }
  return {
    operativeRule: { quote: best.text, heading: chosenSection.heading.trim(), basis: "CHECKPOINT_RULE_BACKFILL", replaced: "LIST_STEP_WITHOUT_RULE", selection: CHECKPOINT_RULE_BACKFILL_VERSION },
    audit: audit("BACKFILLED", objectTerms, candidateSections),
  }
}
