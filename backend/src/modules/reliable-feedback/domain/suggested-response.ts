import { createHash } from "node:crypto"
import { INTERNAL_REF_PATTERN } from "../../investigation/domain/interaction-feedback.js"
import { JSON_LEAKAGE, TURN_REF } from "../../investigation/domain/interaction-feedback-writer.js"
import { detectUnsupportedEffectClaims } from "./effect-claims.js"
import { peerClaimsWithoutEvidence } from "./indicator-diagnosis-claims.js"
import { hasPersonalData, type ReliableItemDraft } from "./reliable-feedback-item.js"
import { terms } from "./verified-omission.js"
import { hasTypedNumber, typedNumbersIn, unsupportedTypedNumbers, type TypedNumber } from "./typed-number-grounding.js"

/**
 * V1.7.1a — EXEMPLO DE CONDUÇÃO (`suggestedResponse`) de um ponto de desenvolvimento (domínio puro, sem LLM).
 *
 * O feedback de supervisor responde "como eu poderia ter falado isso ao cliente?". O exemplo é FORMULAÇÃO do redator — nunca
 * evidência, nunca citação da chamada, nunca texto oficial — e por isso tem ESCOPO calculado pelo código antes de o redator
 * escrever e VALIDAÇÃO depois (redator, edição do QA e publicação usam as mesmas funções):
 *
 *   ESCOPO     só ponto de desenvolvimento de MONITORIA nascido de etapa de processo, com a etapa nomeada, regra da base
 *              usável e orientação oficial (OFFICIAL_*). Fora disso o campo precisa vir vazio.
 *   CONTEÚDO   o conteúdo OPERACIONAL (número, prazo, canal, valor, crédito, estorno, protocolo, resultado da análise…) só
 *              quando o termo está na REGRA verificada do item ou nas falas verificadas da chamada. A linguagem conversacional
 *              ("Vou te explicar…", "Ficou claro?") é livre.
 *   EXEMPLO DA BASE  trecho do documento que é ILUSTRAÇÃO (fala-modelo entre aspas, "Exemplo:", seção de exemplos) nunca
 *              sustenta fato da chamada: número/canal que só aparece ali = EXAMPLE_CONTENT_AS_FACT (em QUALQUER campo).
 *   FORMA      é uma fala ao cliente — nunca "Procure/Tente/Explique ao cliente…" (isso é orientação, e orientação genérica
 *              é justamente o que o exemplo substitui); sem marcador de lacuna ([prazo], X dias).
 *   GUARDAS    efeito garantido/causal, afirmação sobre colegas, dado pessoal, ref interna e JSON — como no resto do feedback.
 *
 * Sem escopo ou com violação: sem exemplo. Filler ("Seja mais claro.") nunca substitui o exemplo.
 */
export const SUGGESTED_RESPONSE_VERSION = "SUGGESTED_RESPONSE_V1" as const

/**
 * V1.7.1d — TIPO DO TRECHO da base: REGRA (o que fazer), EXEMPLO (ilustração: fala-modelo, "Exemplo:", seção de exemplos) e
 * EVITAR (lista do que não dizer/fazer: "Evitar:", "É proibido", "Frases que devem ser evitadas"). Exemplo nunca cria
 * obrigação nem sustenta fato; "evitar" é normativo, mas as frases listadas são o que NÃO dizer (nunca modelo de fala).
 */
export type KnowledgeContentKind = "RULE_CONTENT" | "EXAMPLE_CONTENT" | "DO_NOT_CONTENT"

const normalizeLine = (text: string) => text.replace(/[“”‘’"'`*_#>]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
const EXAMPLE_MARKER = /(?<!\p{L})(?:exemplos?|ex\.|modelo\s+de\s+fala|sugest[ãa]o\s+de\s+fala|frase\s+sugerida|script)(?!\p{L})/iu
const SPOKEN_LINE = /^\s*(?:[-*•>]\s*|\d{1,2}[.)]\s+)?[“"«]/
const HEADING_LINE = /^\s*#{1,6}\s+(.*)$/
/** Abertura/título que introduz o que NÃO fazer. */
const DO_NOT_MARKER = /^(?:evit(?:ar|e)\b|(?:é\s+)?proibid[oa]s?\b|n[ãa]o\s+(?:dever[áa]|deve|pode)\b|frases?\s+(?:que\s+)?(?:devem\s+ser\s+)?evitad|condutas?\s+proibid|express[õo]es\s+n[ãa]o\s+recomendad|situa[çc][õo]es\s+que\s+devem\s+ser\s+evitad)/iu
const headingText = (heading: string) => heading.replace(/^[\d.\s]+/, "").trim()

/**
 * RULE_CONTENT × EXAMPLE_CONTENT de um trecho LITERAL no documento publicado: é exemplo quando a linha é uma fala-modelo entre
 * aspas, quando a própria linha ou a frase que a introduz ("Exemplo:") marca exemplo, ou quando a seção é de exemplos.
 * Conservador: na dúvida o trecho é regra — mas o que é marcado como exemplo só RESTRINGE o que o feedback pode afirmar.
 */
export function knowledgeContentKindOf(content: string, quote: string): KnowledgeContentKind {
  const target = normalizeLine(quote)
  if (target.length === 0) return "RULE_CONTENT"
  const lines = content.split(/\r?\n/)
  const probe = target.slice(0, Math.min(40, target.length))
  const index = lines.findIndex((line) => { const value = normalizeLine(line); return value.length > 0 && (value.includes(probe) || target.includes(value)) })
  if (index < 0) return "RULE_CONTENT"
  const line = lines[index]!
  // V1.7.1d — "Evitar:" (a própria linha, a frase que abre a lista ou o título da seção) vence a fala entre aspas: as frases
  // listadas ali são o que NÃO dizer, nunca um modelo.
  if (DO_NOT_MARKER.test(normalizeLine(line))) return "DO_NOT_CONTENT"
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const value = lines[cursor]!.trim()
    if (value.length === 0 || /^\s*(?:[-*•]|\d{1,2}[.)])\s+/.test(value)) continue
    const heading = HEADING_LINE.exec(value)
    if (heading) { if (DO_NOT_MARKER.test(normalizeLine(headingText(heading[1]!)))) return "DO_NOT_CONTENT"; break }
    if (value.endsWith(":") && DO_NOT_MARKER.test(normalizeLine(value))) return "DO_NOT_CONTENT"
    break
  }
  if (SPOKEN_LINE.test(line) || (EXAMPLE_MARKER.test(line) && /:\s*/.test(line.slice(0, 40)))) return "EXAMPLE_CONTENT"
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const value = lines[cursor]!.trim()
    if (value.length === 0) continue
    const heading = HEADING_LINE.exec(value)
    if (heading) return EXAMPLE_MARKER.test(heading[1]!) ? "EXAMPLE_CONTENT" : "RULE_CONTENT"
    if (value.endsWith(":") && EXAMPLE_MARKER.test(value)) return "EXAMPLE_CONTENT"
    break
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const heading = HEADING_LINE.exec(lines[cursor]!)
    if (heading) return EXAMPLE_MARKER.test(heading[1]!) ? "EXAMPLE_CONTENT" : "RULE_CONTENT"
  }
  return "RULE_CONTENT"
}

export type SuggestedResponseNotAllowedReason = "NOT_MONITORING_PROCESS_ITEM" | "NOT_DEVELOPMENT_POINT" | "NO_STEP" | "NO_VERIFIED_RULE" | "NO_OFFICIAL_GUIDANCE" | "RULE_IS_EXAMPLE_ONLY"

export type SuggestedResponseScope = {
  version: typeof SUGGESTED_RESPONSE_VERSION
  allowed: boolean
  notAllowedReason: SuggestedResponseNotAllowedReason | null
  stepTitle: string | null
  /** Textos LITERAIS da regra verificada que são REGRA (abertura, etapa, como cumprir) — fonte do conteúdo operacional. */
  ruleTexts: string[]
  /** Textos LITERAIS da base que são EXEMPLO (ilustração) — nunca fato da chamada. */
  exampleTexts: string[]
  /** Falas verificadas e exibíveis desta chamada (fatos da interação). */
  evidenceTexts: string[]
  knowledgeRuleRefs: { documentId: string; heading: string | null; quoteSha256: string }[]
  /** Fatos de SISTEMA já tipados (ex.: protocolo registrado vindo de fonte estruturada) — sustentam número do mesmo papel. */
  systemFacts?: TypedNumber[]
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const SYSTEM_ROLES = new Set(["DADO_OFICIAL", "ANALISE", "REFERENCIA"])

/**
 * V1.7.1b — o escopo cobre também:
 *   PADRÃO DE DESENVOLVIMENTO do diagnóstico de indicador (INDICATOR_DEVELOPMENT_PATTERN) com etapa, regra verificada e
 *   orientação oficial — o exemplo nasce do ACHADO DE PROCESSO, nunca do KPI fora da meta (números do indicador não são fonte);
 *   PONTO DE APLICABILIDADE: o exemplo é de DESAMBIGUAÇÃO ("vou confirmar qual produto…"), com os produtos candidatos verificados
 *   como única fonte — nunca o valor de um candidato.
 */
export function suggestedResponseScopeOf(item: Pick<ReliableItemDraft, "domain" | "section" | "process" | "knowledge" | "grounding" | "facts"> & Partial<Pick<ReliableItemDraft, "kind" | "applicability">>): SuggestedResponseScope {
  if (item.section === "ATTENTION" && item.applicability) {
    const products = item.applicability.candidates.map((candidate) => candidate.product)
    return {
      version: SUGGESTED_RESPONSE_VERSION,
      allowed: products.length > 0,
      notAllowedReason: products.length > 0 ? null : "NO_VERIFIED_RULE",
      stepTitle: "Confirmar o produto vinculado à solicitação",
      ruleTexts: [`produto serviço procedimento ${products.join(" ")}`],
      exampleTexts: item.applicability.candidates.map((candidate) => candidate.quote),
      evidenceTexts: [],
      knowledgeRuleRefs: item.applicability.candidates.map((candidate) => ({ documentId: candidate.documentId, heading: candidate.heading, quoteSha256: sha(candidate.quote) })),
    }
  }
  const knowledge = item.knowledge
  const quoteKind = knowledge?.contentKind ?? "RULE_CONTENT"
  const detailKind = knowledge?.detail?.contentKind ?? "RULE_CONTENT"
  // V1.7.1g — a regra operacional (mesma seção ou backfill da etapa, sempre literal e do mesmo documento/versão) também é REGRA.
  const ruleTexts = knowledge ? [knowledge.leadIn ?? null, quoteKind === "RULE_CONTENT" ? knowledge.quote : null, knowledge.detail && detailKind === "RULE_CONTENT" ? knowledge.detail.quote : null, knowledge.operativeRule?.quote ?? null].filter((text): text is string => Boolean(text)) : []
  // V1.7.1f — + os EXEMPLOS da mesma seção (falas-modelo do documento que não foram citadas, mas estão no material).
  const exampleTexts = knowledge ? [quoteKind === "EXAMPLE_CONTENT" ? knowledge.quote : null, knowledge.detail && detailKind === "EXAMPLE_CONTENT" ? knowledge.detail.quote : null, ...(knowledge.sectionExamples ?? [])].filter((text): text is string => Boolean(text)) : []
  const base = {
    version: SUGGESTED_RESPONSE_VERSION,
    stepTitle: item.process?.stepTitle ?? null,
    ruleTexts,
    exampleTexts,
    evidenceTexts: item.facts.filter((fact) => !SYSTEM_ROLES.has(fact.role)).map((fact) => fact.text),
    knowledgeRuleRefs: knowledge ? [{ documentId: knowledge.documentId, heading: knowledge.heading, quoteSha256: sha(knowledge.quote) }, ...(knowledge.operativeRule ? [{ documentId: knowledge.documentId, heading: knowledge.operativeRule.heading, quoteSha256: sha(knowledge.operativeRule.quote) }] : [])] : [],
  }
  const indicatorPattern = item.domain === "INDICATOR" && item.kind === "INDICATOR_DEVELOPMENT_PATTERN"
  const reason: SuggestedResponseNotAllowedReason | null =
    !indicatorPattern && (item.domain !== "MONITORING" || !item.process?.evidenceType) ? "NOT_MONITORING_PROCESS_ITEM"
    : item.section !== "OPPORTUNITY" ? "NOT_DEVELOPMENT_POINT"
    : !item.process?.stepTitle ? "NO_STEP"
    : !knowledge ? "NO_VERIFIED_RULE"
    : item.grounding !== "OFFICIAL_PROCEDURE" && item.grounding !== "OFFICIAL_SERVICE_GUIDELINE" ? "NO_OFFICIAL_GUIDANCE"
    : ruleTexts.length === 0 ? "RULE_IS_EXAMPLE_ONLY"
    : null
  return { ...base, allowed: reason === null, notAllowedReason: reason }
}

export type SuggestedResponseViolation =
  | "SUGGESTED_RESPONSE_NOT_ALLOWED"
  | "SUGGESTED_RESPONSE_NOT_SPEECH"
  | "SUGGESTED_RESPONSE_PLACEHOLDER"
  /** V1.7.4 — o exemplo promete uma AÇÃO do operador ("vou verificar no sistema…") que a regra da etapa não cobre: exemplo
   * improvisado introduz etapa sem base — sai (o ponto continua). */
  | "SUGGESTED_RESPONSE_UNCOVERED_ACTION"
  | "UNSUPPORTED_NUMBER"
  | "UNSUPPORTED_FACT"
  | "EXAMPLE_CONTENT_AS_FACT"
  | "GUARANTEED_EFFECT"
  | "PEER_CLAIM_WITHOUT_EVIDENCE"
  | "PRIVACY_DATA"
  | "GENERIC_WORDING"
  | "INTERNAL_REF"
  | "INTERNAL_JSON_LEAKAGE"

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const NUMBER = /\d+(?:[.,]\d+)*/g
const SPELLED_QUANTITY = /(?<!\p{L})(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte(?:\s+e\s+(?:um|dois|quatro|cinco))?|trinta|quarenta(?:\s+e\s+oito)?|sessenta|setenta(?:\s+e\s+duas)?|noventa)\s+(?:dias?|horas?|semanas?|mes(?:es)?|minutos?)(?!\p{L})/gu

/**
 * CONTEÚDO OPERACIONAL que o exemplo só pode afirmar com fonte (lista fechada, por radical — nenhuma interpretação livre).
 * O radical precisa aparecer na regra verificada do item ou nas falas verificadas da chamada.
 */
const OPERATIONAL_FACTS: readonly { label: string; pattern: RegExp; stems: readonly string[] }[] = [
  { label: "SMS", pattern: /(?<!\p{L})sms(?!\p{L})/u, stems: ["sms", "mensagem de texto"] },
  { label: "e-mail", pattern: /(?<!\p{L})e-?mail(?!\p{L})/u, stems: ["mail"] },
  { label: "WhatsApp", pattern: /whats\s?app/u, stems: ["whats"] },
  { label: "aplicativo", pattern: /(?<!\p{L})(?:aplicativo|app)(?!\p{L})/u, stems: ["aplicativ", "app"] },
  { label: "site", pattern: /(?<!\p{L})(?:site|portal)(?!\p{L})/u, stems: ["site", "portal"] },
  { label: "carta", pattern: /(?<!\p{L})(?:carta|correio|correspondencia)(?!\p{L})/u, stems: ["carta", "correio", "correspond"] },
  { label: "retorno/contato futuro", pattern: /(?<!\p{L})(?:retorn\p{L}*|ligaremos|vamos\s+(?:te\s+|lhe\s+)?ligar|entrar(?:emos)?\s+em\s+contato|contataremos)(?!\p{L})/u, stems: ["retorn", "contat", "ligar", "ligac"] },
  { label: "prazo", pattern: /(?<!\p{L})prazos?(?!\p{L})/u, stems: ["prazo"] },
  { label: "data/período", pattern: /(?<!\p{L})(?:amanha|dias?\s+uteis|horas?|semanas?|mes(?:es)?)(?!\p{L})/u, stems: ["amanha$", "dia$", "dias$", "uteis$", "hora$", "horas$", "semana$", "semanas$", "mes$", "meses$"] },
  { label: "crédito", pattern: /(?<!\p{L})credit\p{L}*/u, stems: ["credit"] },
  { label: "estorno", pattern: /(?<!\p{L})estorn\p{L}*/u, stems: ["estorn"] },
  { label: "reembolso/devolução", pattern: /(?<!\p{L})(?:reembols\p{L}*|devolu\p{L}*|devolv\p{L}*|de\s+volta)(?!\p{L})/u, stems: ["reembols", "devol", "de volta"] },
  { label: "desconto/abatimento", pattern: /(?<!\p{L})(?:descont\p{L}*|abatiment\p{L}*|isen\p{L}*)(?!\p{L})/u, stems: ["descont", "abatiment", "isen"] },
  { label: "multa/taxa/juros", pattern: /(?<!\p{L})(?:multas?|taxas?|juros)(?!\p{L})/u, stems: ["multa", "taxa", "juros"] },
  { label: "protocolo", pattern: /(?<!\p{L})protocol\p{L}*/u, stems: ["protocol"] },
  { label: "resultado da análise", pattern: /(?<!\p{L})(?:procedente|improcedente|aprovad\p{L}*|deferid\p{L}*)(?!\p{L})/u, stems: ["procedent", "aprovad", "deferid"] },
  {
    label: "resultado prometido",
    pattern: /(?<!\p{L})(?:vai|vao|ira|irao|sera|serao|fica(?:ra)?)\s+(?:voltar|receber|creditad\p{L}*|estornad\p{L}*|devolvid\p{L}*|reembolsad\p{L}*|cancelad\p{L}*|resolvid\p{L}*|ajustad\p{L}*|corrigid\p{L}*|isent\p{L}*)(?!\p{L})/u,
    stems: [],
  },
]
/**
 * Radical presente num texto (já sem acento, minúsculo): no começo de uma palavra ("credit" ⊂ "crédito"); "…$" = palavra
 * exata ("dia" não casa com "mediante"); com espaço = expressão.
 */
const hasStem = (folded: string, stem: string) => (stem.includes(" ") ? folded.includes(stem) : stem.endsWith("$") ? new RegExp(`(?<!\\p{L})${stem.slice(0, -1)}(?!\\p{L})`, "u").test(folded) : new RegExp(`(?<!\\p{L})${stem}`, "u").test(folded))
/** Radical (5 letras) do verbo/particípio do resultado prometido — precisa estar na regra ou nas falas. */
const promiseStem = (match: string) => fold(match).split(/\s+/).slice(-1)[0]!.slice(0, 5)

const NOT_SPEECH = /^\s*(?:procure|tente|busque|seja|evite|lembre(?:-se)?|recomenda-se|e\s+importante|voce\s+(?:pode|deve|poderia|deveria)|informe|explique|inclua|diga|fale|oriente|mencione|nos\s+proximos)(?!\p{L})/u
const THIRD_PERSON_CUSTOMER = /(?<!\p{L})(?:ao|o|do|para\s+o|com\s+o)\s+cliente(?!\p{L})/u
/**
 * Marcador de LACUNA: [prazo], <valor>, {x}, X/N soltos e — V1.7.1m — reticências ("O prazo de análise é de...", "[...]", "…"):
 * não há forma segura de distinguir reticência estilística de lacuna numa fala-modelo, então na dúvida não é exemplo.
 */
const PLACEHOLDER = /\[[^\]]{1,60}\]|<[^>]{1,60}>|\{[^}]{0,60}\}|(?<!\p{L})[XN](?!\p{L})|\.{3}|…/u
/** V1.7.1m — o exemplo tem marcador de lacuna? (defesa na emissão: exemplo com lacuna nunca chega ao colaborador). */
export const hasSuggestedResponsePlaceholder = (text: string | null | undefined) => PLACEHOLDER.test(suggestedResponseProse(text ?? ""))
const QUOTE_MARKS = /[“”"«»]/g

/** O exemplo sem as aspas externas (é uma fala proposta, não citação — as aspas nunca escondem conteúdo das checagens). */
export const suggestedResponseProse = (text: string) => text.replace(QUOTE_MARKS, "").replace(/\s+/g, " ").trim()

/**
 * V1.7.4 — AÇÃO PROMETIDA SEM COBERTURA DA REGRA (`SUGGESTED_RESPONSE_COVERAGE_V1`): no exemplo de condução, o operador só pode se
 * comprometer ("vou …", "vamos …", "irei …") com ações que a própria regra da etapa nomeia; verbos de FALA (informar, explicar,
 * dizer, confirmar…) são a própria condução e não contam. "Vou verificar agora no sistema as opções de parcelamento" para "Não
 * garantir condições… antes da consulta" introduz uma etapa que a base não pede (e que contradiz o canal de consulta indicado).
 */
const COMMITTED_ACTION = /(?<!\p{L})(?:vou|vamos|irei|iremos)\s+(?:(?:te|lhe|ja|agora|so|primeiro|aqui|rapidinho|entao)\s+){0,2}(\p{L}{4,})/gu
const SPEECH_ACTIONS = /^(?:inform|explic|diz|dize|fal|confirm|anot|repet|resum|recapitul|orient|esclarec|pass|indic|mostr|contar|cont|reforc|lembr|detalh|ajud)/u
export function uncoveredCommittedActions(text: string, ruleTexts: readonly string[]): string[] {
  const covered = new Set(ruleTexts.flatMap((rule) => [...terms(rule)]))
  const found: string[] = []
  for (const match of fold(text).matchAll(COMMITTED_ACTION)) {
    const verb = match[1]!
    if (SPEECH_ACTIONS.test(verb)) continue
    if (!covered.has(verb.slice(0, 5)) && ![...covered].some((term) => term.length >= 4 && verb.startsWith(term.slice(0, 4)))) found.push(verb)
  }
  return [...new Set(found)]
}

export function suggestedResponseViolations(text: string | null | undefined, scope: SuggestedResponseScope | null | undefined): SuggestedResponseViolation[] {
  const raw = (text ?? "").trim()
  if (raw.length === 0) return []
  if (!scope?.allowed) return ["SUGGESTED_RESPONSE_NOT_ALLOWED"]
  const prose = suggestedResponseProse(raw)
  const folded = fold(prose)
  const violations = new Set<SuggestedResponseViolation>()
  if (INTERNAL_REF_PATTERN.test(prose) || TURN_REF.test(prose)) violations.add("INTERNAL_REF")
  if (JSON_LEAKAGE.some((pattern) => pattern.test(prose))) violations.add("INTERNAL_JSON_LEAKAGE")
  if (PLACEHOLDER.test(prose)) violations.add("SUGGESTED_RESPONSE_PLACEHOLDER")
  if (NOT_SPEECH.test(folded) || THIRD_PERSON_CUSTOMER.test(folded)) violations.add("SUGGESTED_RESPONSE_NOT_SPEECH")
  // Específico: fala da ETAPA (compartilha termo com o nome da etapa ou a regra), não uma frase que serviria a qualquer chamada.
  const stepTerms = new Set([...terms(scope.stepTitle ?? ""), ...scope.ruleTexts.flatMap((rule) => [...terms(rule)])])
  if (![...terms(prose)].some((term) => stepTerms.has(term))) violations.add("GENERIC_WORDING")
  const grounding = [...scope.ruleTexts, ...scope.evidenceTexts]
  const groundingFolded = fold([...grounding, scope.stepTitle ?? ""].join(" \n "))
  const exampleJoined = scope.exampleTexts.join(" ")
  const exampleFolded = fold(exampleJoined)
  // TYPED_NUMBER_GROUNDING_V1 — o número só vale com fonte do MESMO papel: "seu protocolo é 7" nunca é sustentado por "7 dias
  // úteis" (prazo) nem por "7. Registrar protocolo." (numeração de lista). Antes era `includes` global — a causa do "protocolo 7".
  for (const entry of unsupportedTypedNumbers(prose, grounding, scope.systemFacts ?? [])) {
    violations.add(hasTypedNumber(entry, scope.exampleTexts) ? "EXAMPLE_CONTENT_AS_FACT" : "UNSUPPORTED_NUMBER")
  }
  for (const match of folded.matchAll(SPELLED_QUANTITY)) {
    if (groundingFolded.includes(match[0])) continue
    violations.add(exampleFolded.includes(match[0]) ? "EXAMPLE_CONTENT_AS_FACT" : "UNSUPPORTED_NUMBER")
  }
  for (const fact of OPERATIONAL_FACTS) {
    const match = fact.pattern.exec(folded)
    if (!match) continue
    const stems = fact.stems.length > 0 ? fact.stems : [promiseStem(match[0])]
    if (stems.some((stem) => hasStem(groundingFolded, stem))) continue
    violations.add(stems.some((stem) => hasStem(exampleFolded, stem)) ? "EXAMPLE_CONTENT_AS_FACT" : "UNSUPPORTED_FACT")
  }
  if (detectUnsupportedEffectClaims(prose, scope.ruleTexts).length > 0) violations.add("GUARANTEED_EFFECT")
  if (peerClaimsWithoutEvidence(prose, false).length > 0) violations.add("PEER_CLAIM_WITHOUT_EVIDENCE")
  if (hasPersonalData(prose)) violations.add("PRIVACY_DATA")
  // V1.7.4 — ação prometida que a regra não cobre (só quando nada mais já recusou o exemplo; fala-modelo literal da base é base).
  const literalBaseExample = scope.exampleTexts.some((example) => { const a = fold(example).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim(); const b = folded.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim(); return a.length > 0 && (a.includes(b) || b.includes(a)) })
  if (violations.size === 0 && !literalBaseExample && uncoveredCommittedActions(prose, [...scope.ruleTexts, scope.stepTitle ?? ""]).length > 0) violations.add("SUGGESTED_RESPONSE_UNCOVERED_ACTION")
  return [...violations]
}

/**
 * EXEMPLO DA BASE COMO FATO em qualquer campo do texto: número ou conteúdo operacional que SÓ aparece num trecho de exemplo
 * da base (nunca na regra nem nas falas da chamada). "Seu protocolo é 202609130184" de uma fala-modelo do documento nunca vira
 * o protocolo desta chamada. Vale para itens com a base carregada (monitoria de processo).
 */
export function exampleContentAsFactIn(fields: readonly string[], scope: Pick<SuggestedResponseScope, "ruleTexts" | "exampleTexts" | "evidenceTexts">): boolean {
  return exampleOnlyFactsIn(fields, scope).length > 0
}

/**
 * V1.7.1f — FATO QUE SÓ EXISTE EM EXEMPLO (fonte única): número, quantidade por extenso ("cinco dias") ou conteúdo
 * operacional da lista fechada (canal como SMS/e-mail, prazo, protocolo, crédito…) presente num EXEMPLO da base e ausente da
 * regra verificada e das falas da chamada. Exemplo/script NUNCA autoriza fato operacional — em nenhum campo (exemplo de
 * condução, "o que aconteceu", "como aplicar", abertura, fechamento). Devolve o que foi encontrado (vazio = nada).
 */
export function exampleOnlyFactsIn(fields: readonly string[], scope: Pick<SuggestedResponseScope, "ruleTexts" | "exampleTexts" | "evidenceTexts">): string[] {
  if (scope.exampleTexts.length === 0) return []
  const groundingJoined = [...scope.ruleTexts, ...scope.evidenceTexts].join(" ")
  const groundingFolded = fold(groundingJoined)
  const example = scope.exampleTexts.join(" ")
  const exampleFolded = fold(example)
  // Aspas = citação literal (conferida por outro validador), não afirmação.
  const prose = fields.map((field) => field.replace(/[“"«][^”"»]*[”"»]/g, " ")).join(" \n ")
  const folded = fold(prose)
  const found = new Set<string>()
  for (const entry of typedNumbersIn(prose, { spelled: false })) if (hasTypedNumber(entry, scope.exampleTexts) && !hasTypedNumber(entry, [...scope.ruleTexts, ...scope.evidenceTexts])) found.add(entry.raw)
  for (const match of folded.matchAll(SPELLED_QUANTITY)) if (exampleFolded.includes(match[0]) && !groundingFolded.includes(match[0])) found.add(match[0])
  for (const fact of OPERATIONAL_FACTS) {
    if (fact.stems.length === 0) continue
    if (!fact.pattern.test(folded)) continue
    if (fact.stems.some((stem) => hasStem(groundingFolded, stem))) continue
    if (fact.stems.some((stem) => hasStem(exampleFolded, stem))) found.add(fact.label)
  }
  return [...found]
}

export type SuggestedResponseGroundingSource = "KNOWLEDGE_RULE" | "KNOWLEDGE_DETAIL" | "CHECKPOINT" | "TRANSCRIPT_EVIDENCE"
export type SuggestedResponseProvenance = {
  version: typeof SUGGESTED_RESPONSE_VERSION
  generatedBy: "WRITER" | "HUMAN_QA"
  groundingSources: SuggestedResponseGroundingSource[]
  knowledgeRuleRefs: SuggestedResponseScope["knowledgeRuleRefs"]
  supportedNumbers: string[]
  supportedFacts: string[]
}

/** Proveniência DETERMINÍSTICA de um exemplo aceito: de onde vem cada conteúdo operacional que ele cita. */
export function suggestedResponseProvenanceOf(text: string, scope: SuggestedResponseScope, generatedBy: SuggestedResponseProvenance["generatedBy"]): SuggestedResponseProvenance {
  const prose = suggestedResponseProse(text)
  const folded = fold(prose)
  const evidenceTerms = new Set(scope.evidenceTexts.flatMap((entry) => [...terms(entry)]))
  const sources: SuggestedResponseGroundingSource[] = ["KNOWLEDGE_RULE"]
  if (scope.ruleTexts.length > 1) sources.push("KNOWLEDGE_DETAIL")
  if (scope.stepTitle) sources.push("CHECKPOINT")
  if ([...terms(prose)].some((term) => evidenceTerms.has(term))) sources.push("TRANSCRIPT_EVIDENCE")
  return {
    version: SUGGESTED_RESPONSE_VERSION,
    generatedBy,
    groundingSources: sources,
    knowledgeRuleRefs: scope.knowledgeRuleRefs,
    supportedNumbers: [...new Set(prose.match(NUMBER) ?? [])],
    supportedFacts: OPERATIONAL_FACTS.filter((fact) => fact.pattern.test(folded)).map((fact) => fact.label),
  }
}
