import { projectTranscript, type TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { listMarkerOf, structuralLinesOf } from "../../knowledge/domain/knowledge-list.js"
import { isConditionalStepText } from "./step-semantics.js"

/**
 * V1.7.1 — VERIFIED OMISSION (domínio puro, sem LLM).
 *
 * Ausência de ação não pode exigir uma fala que não existe. Antes, uma etapa não cumprida por OMISSÃO só conseguia a âncora
 * léxica "regra × fala do operador" por acaso (a fala que existe é o que o operador disse NO LUGAR da etapa) e caía sempre em
 * QA. Agora o Agent PROPÕE a omissão (`evidenceType: OMISSION`) e o sistema VERIFICA, por código, cinco condições:
 *
 *   PROCESS_APPLICABLE      o processo estava em curso: outra etapa do MESMO documento cumprida com regra ancorada na
 *                           conversa (VERIFIED) E a condição da seção (título + frase de abertura) ancorada na conversa OU o
 *                           assunto estruturado da interação ancorado no título do documento. Nunca só um sinal léxico.
 *   CHECKPOINT_REQUIRED     a LINHA da etapa não é condicional ("quando permitido", "se disponível e autorizado"): condição
 *                           que a conversa não mostra não vira descumprimento.
 *   OBSERVATION_WINDOW      a transcrição cobre a janela: sem turno omitido, sem marca de corte/trecho incompleto, sem fala
 *                           final interrompida.
 *   OPPORTUNITY_TO_PERFORM  a etapa ficou devida e houve chance de cumpri-la: numa lista ORDENADA, a etapa anterior foi
 *                           cumprida e o operador ainda falou depois dela; sem queda/interrupção da ligação depois disso.
 *   NO_MATCHING_ACTION      nenhuma fala do operador na janela (do início da tratativa ao fim) usa um termo PRÓPRIO da etapa
 *                           ou do trecho que diz como cumpri-la (termos que também aparecem no título, na abertura, nas
 *                           outras etapas ou no nome do documento não contam). É CONTRAPROVA: a ausência é julgada pelo
 *                           Agent (semântica, "nem com outras palavras"); o código recusa quando a conversa sugere o
 *                           contrário. Paráfrase sem nenhum termo próprio depende do julgamento do Agent — limite registrado.
 *
 * Falha estrutural (etapa condicional, janela incompleta, sem oportunidade) ⇒ NOT_OBSERVABLE: não dá para afirmar.
 * Falha de prova (processo não verificado, contraprova, termos próprios ausentes) ⇒ a etapa continua NOT_FOLLOWED como
 * omissão NÃO verificada — vai ao QA, nunca é autônoma.
 */
export const VERIFIED_OMISSION_VERSION = "VERIFIED_OMISSION_V1" as const

export type OmissionFailure =
  | "KNOWLEDGE_NOT_VERIFIED"
  | "RULE_CONTEXT_NOT_FOUND"
  | "CHECKPOINT_CONDITIONAL"
  | "TRANSCRIPT_INCOMPLETE"
  | "NO_OPPORTUNITY"
  | "PROCESS_APPLICABILITY_UNVERIFIED"
  | "ABSENCE_UNVERIFIABLE"
  | "MATCHING_ACTION_FOUND"
  /** V1.7.1c — a avaliação da chamada chegou PARCIAL (etapas propostas fora do contrato): uma etapa descartada poderia ser a
   * contraprova da ausência, então a omissão fica como hipótese para o QA — nunca autônoma. */
  | "ASSESSMENT_PARTIAL"

/** Falhas que tornam a etapa NÃO OBSERVÁVEL (não dá para afirmar nada); as demais mantêm a omissão como hipótese para o QA. */
export const OMISSION_NOT_OBSERVABLE_FAILURES: readonly OmissionFailure[] = ["CHECKPOINT_CONDITIONAL", "TRANSCRIPT_INCOMPLETE", "NO_OPPORTUNITY"]

export type OmissionVerification = {
  version: typeof VERIFIED_OMISSION_VERSION
  verified: boolean
  failure: OmissionFailure | null
  checks: {
    processApplicable: boolean | null
    checkpointRequired: boolean | null
    windowComplete: boolean | null
    opportunity: boolean | null
    noMatchingAction: boolean | null
  }
  signals: {
    siblingFollowedVerified: boolean
    sectionAnchorTerms: string[]
    subjectAnchorTerms: string[]
    predecessorTurn: string | null
    successorPerformed: boolean
    windowStartTurn: string | null
    windowEndTurn: string | null
    distinctiveTerms: string[]
    matchingTurns: string[]
  }
}

// ---------------------------------------------------------------------------------------------
// Contexto da regra no documento publicado (título da seção, frase de abertura, lista, posição da etapa)
// ---------------------------------------------------------------------------------------------

export type RuleContext = {
  heading: string | null
  /** Frase literal que abre a lista da etapa ("Se o cliente não reconhecer:"), quando existe. */
  leadIn: string | null
  listKind: "ORDERED" | "UNORDERED" | "NONE"
  items: { position: number; text: string }[]
  /** Posição (1..n) da etapa na lista; null fora de lista. */
  stepPosition: number | null
  /** Texto literal da linha da etapa (sem o marcador da lista). */
  stepText: string
}

const HEADING = /^\s*#{1,6}\s+(.*)$/
const clean = (text: string) => text.replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim()
const normalize = (text: string) => text.replace(/[“”‘’"'`*_#>]/g, "").replace(/\s+/g, " ").trim().toLowerCase()

/**
 * Contexto da regra no documento publicado. V1.7.1k — lê as LINHAS ESTRUTURAIS da representação canônica de lista
 * (`knowledge/domain/knowledge-list.ts`): enumeração em linha ("…: (1) …; (2) …") vira abertura + itens, com o marcador original;
 * "(n)" é marcador como "n." e "-". Citação = abertura + UM item ("Antes de encerrar qualquer chamada: (1) confirme…") escolhe
 * esse item. `preferredHeading` (a seção do trecho APRESENTADO onde a citação foi achada) desempata texto repetido em duas
 * seções ("É só aguardar." está na 35 e na 51) — a proveniência é a do trecho que o especialista viu.
 */
export function ruleContextOf(content: string, quote: string, preferredHeading?: string | null): RuleContext | null {
  const target = normalize(quote)
  if (target.length === 0) return null
  const lines = structuralLinesOf(content).map((line) => line.text)
  const probe = target.slice(0, Math.min(40, target.length))
  const matches = (line: string) => { const value = normalize(line); return value.length > 0 && (value.includes(probe) || target.includes(value)) }
  // V1.7.1g — localização EXATA: a linha onde a citação inteira COMEÇA (a citação continua literal nas linhas seguintes). Antes,
  // a primeira linha curta do documento contida na citação ("- Valor;") podia estar em OUTRA seção e trazia o contexto errado.
  const literalTarget = normalizeForLiteralQuote(quote)
  const headingAt = (index: number) => { for (let cursor = index; cursor >= 0; cursor -= 1) { const match = HEADING.exec(lines[cursor]!); if (match) return { heading: clean(match[1]!), sectionStart: cursor + 1 } } return { heading: null, sectionStart: 0 } }
  const exactAll = lines.flatMap((line, index) => {
    if (!matches(line)) return []
    const first = normalizeForLiteralQuote(line)
    const window = normalizeForLiteralQuote(lines.slice(index, index + 80).join("\n"))
    const at = window.indexOf(literalTarget)
    return at >= 0 && at <= first.length ? [index] : []
  })
  const preferred = preferredHeading ? normalize(preferredHeading) : null
  const exact = (preferred ? exactAll.find((index) => normalize(headingAt(index).heading ?? "") === preferred) : undefined) ?? exactAll[0] ?? -1
  let index = exact >= 0 ? exact : lines.findIndex(matches)
  if (index < 0) return null
  const { heading, sectionStart } = headingAt(index)
  // V1.7.1k — citação que começa na ABERTURA da lista e segue num item: a etapa é o item coberto (dois ou mais itens = a âncora
  // recusa por MULTIPLE_CHECKPOINTS).
  if (!listMarkerOf(lines[index]!) && lines[index]!.trim().endsWith(":")) {
    const covered: number[] = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!
      if (line.trim().length === 0) continue
      const item = listMarkerOf(line)
      if (!item) break
      const body = normalizeForLiteralQuote(item.body)
      if (body.length > 0 && literalTarget.includes(body)) covered.push(cursor)
    }
    // Só UM item coberto escolhe a etapa; a lista inteira citada continua sendo a abertura (etapa composta, sem etapa única).
    if (covered.length === 1) index = covered[0]!
  }
  const stepMatch = listMarkerOf(lines[index]!)
  if (!stepMatch) return { heading, leadIn: null, listKind: "NONE", items: [], stepPosition: null, stepText: clean(lines[index]!) }
  // Bloco contíguo de itens de lista em volta da etapa (linhas vazias não quebram a lista).
  const isItem = (line: string) => listMarkerOf(line) !== null
  let start = index
  while (start - 1 >= sectionStart && (isItem(lines[start - 1]!) || lines[start - 1]!.trim() === "")) start -= 1
  let end = index
  while (end + 1 < lines.length && (isItem(lines[end + 1]!) || (lines[end + 1]!.trim() === "" && end + 2 < lines.length && isItem(lines[end + 2]!)))) end += 1
  const items: RuleContext["items"] = []
  let stepPosition: number | null = null
  let ordered = true
  for (let cursor = start; cursor <= end; cursor += 1) {
    const match = listMarkerOf(lines[cursor]!)
    if (!match) continue
    if (match.marker.ordinal === null) ordered = false
    const position = items.length + 1
    items.push({ position, text: clean(match.body) })
    if (cursor === index) stepPosition = position
  }
  let leadIn: string | null = null
  for (let cursor = start - 1; cursor >= sectionStart; cursor -= 1) {
    const value = lines[cursor]!.trim()
    if (value.length === 0) continue
    if (value.endsWith(":")) leadIn = clean(value)
    break
  }
  return { heading, leadIn, listKind: ordered ? "ORDERED" : "UNORDERED", items, stepPosition, stepText: clean(stepMatch.body) }
}

/**
 * A LINHA da etapa depende de condição ("quando permitido", "se disponível e autorizado", "caso…", "desde que…"). V1.7.4 — lida por
 * ESTRUTURA (`step-semantics.ts`): "confirmar se…" é seletor de ramo (obrigatória); numa etapa de várias frases, só é condicional
 * quando TODAS as frases com ação são condicionais ("X. Caso …, Y." mantém X obrigatória).
 */
export const isConditionalStep = (stepText: string) => isConditionalStepText(stepText)

// ---------------------------------------------------------------------------------------------
// Termos (mesma regra conservadora da âncora da base: ≥ 4 letras, sem acento, radical de 5)
// ---------------------------------------------------------------------------------------------

const STOPWORDS = new Set(["para", "pelo", "pela", "pelos", "pelas", "como", "quando", "sobre", "entre", "após", "antes", "depois", "também", "ainda", "mesmo", "mesma", "esse", "essa", "este", "esta", "isso", "isto", "aquele", "aquela", "você", "voce", "cliente", "operador", "deve", "devem", "pode", "podem", "será", "serão", "está", "estão", "foram", "sendo", "caso", "casos", "qual", "quais", "cada", "todo", "toda", "todos", "todas", "mais", "menos", "muito", "sempre", "nunca", "apenas", "somente", "então", "porque", "assim", "onde", "seus", "suas", "dele", "dela", "nosso", "nossa", "deverá", "devera", "atendimento", "procedimento", "operacional"])
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
export function terms(text: string): Set<string> {
  const found = new Set<string>()
  for (const word of fold(text).match(/\p{L}{4,}/gu) ?? []) if (!STOPWORDS.has(word)) found.add(word.slice(0, 5))
  return found
}
const union = (...texts: (string | null | undefined)[]) => new Set(texts.flatMap((text) => (text ? [...terms(text)] : [])))

// ---------------------------------------------------------------------------------------------
// Janela da transcrição
// ---------------------------------------------------------------------------------------------

/** Marca de transcrição incompleta/cortada (fonte) — a janela não pode ser julgada. */
const TRUNCATION = /\[(?:\.{3}|…|[^\]]*(?:cortad|interrompid|incomplet|inaud[íi]vel|trecho\s+perdido)[^\]]*)\]|\((?:inaud[íi]vel|trecho\s+cortado)\)/iu
const CUT_ENDING = /(?:\.{3}|…|—|-)\s*$/
/** Evento de queda/interrupção da ligação. */
const DROP = /(?:liga[çc][ãa]o|chamada)\s+(?:caiu|cai|interrompid\p{L}*|encerrad\p{L}*\s+abruptamente|derrubad\p{L}*)|queda\s+d[ae]\s+(?:liga|chamad)|desconect\p{L}*|sem\s+[áa]udio|mudo\s+prolongado/iu

export const turnIndexOf = (turnRef: string) => Number.parseInt(turnRef.replace(/^T/i, ""), 10)

/** V1.7.1d — a chamada CHEGOU À FASE DE FECHAMENTO (transcrição completa, sem corte): as seções que avaliam o fechamento
 * (checklist, recapitulação, confirmação, encerramento) entram no plano de cobertura da base. */
export function closingPhaseReached(transcript: string): boolean {
  return transcript.trim().length > 0 && transcriptWindowComplete(projectTranscript(transcript))
}

export function transcriptWindowComplete(projection: TranscriptProjection): boolean {
  if (projection.truncatedTurns > 0 || projection.turns.length === 0) return false
  if (projection.turns.some((turn) => TRUNCATION.test(turn.text))) return false
  return !CUT_ENDING.test(projection.turns[projection.turns.length - 1]!.text)
}

// ---------------------------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------------------------

/** Outra etapa do MESMO processo (já verificada) — âncora de aplicabilidade e de oportunidade. */
export type SiblingCheckpoint = { status: string; knowledgeApplicability: string | null; operatorTurns: number[]; stepPosition: number | null; sameList: boolean; requirement: string }

export type OmissionInput = {
  knowledgeUsable: boolean
  rule: RuleContext | null
  detailQuote: string | null
  requirement: string
  documentTitle: string
  subject: string | null
  projection: TranscriptProjection
  siblings: readonly SiblingCheckpoint[]
  /** V1.7.1n — comportamento com detector de polaridade: a contraprova é a fala que CUMPRE (nunca termo solto). */
  fulfilled?: (text: string) => boolean
}

const EMPTY_SIGNALS: OmissionVerification["signals"] = { siblingFollowedVerified: false, sectionAnchorTerms: [], subjectAnchorTerms: [], predecessorTurn: null, successorPerformed: false, windowStartTurn: null, windowEndTurn: null, distinctiveTerms: [], matchingTurns: [] }
const NO_CHECKS: OmissionVerification["checks"] = { processApplicable: null, checkpointRequired: null, windowComplete: null, opportunity: null, noMatchingAction: null }

export function verifyOmission(input: OmissionInput): OmissionVerification {
  const fail = (failure: OmissionFailure, checks: Partial<OmissionVerification["checks"]> = {}, signals: Partial<OmissionVerification["signals"]> = {}): OmissionVerification => ({ version: VERIFIED_OMISSION_VERSION, verified: false, failure, checks: { ...NO_CHECKS, ...checks }, signals: { ...EMPTY_SIGNALS, ...signals } })
  if (!input.knowledgeUsable) return fail("KNOWLEDGE_NOT_VERIFIED")
  const rule = input.rule
  if (!rule) return fail("RULE_CONTEXT_NOT_FOUND")

  // CHECKPOINT_REQUIRED — a linha da etapa sem condição.
  if (isConditionalStep(rule.stepText)) return fail("CHECKPOINT_CONDITIONAL", { checkpointRequired: false })

  // OBSERVATION_WINDOW — a transcrição cobre a janela.
  const turns = input.projection.turns
  if (!transcriptWindowComplete(input.projection)) return fail("TRANSCRIPT_INCOMPLETE", { checkpointRequired: true, windowComplete: false })

  // OPPORTUNITY — a etapa ficou devida (etapa anterior cumprida) e o operador falou depois; sem queda da ligação.
  const followed = input.siblings.filter((sibling) => sibling.status === "FOLLOWED" && sibling.operatorTurns.length > 0)
  const processStart = followed.length > 0 ? Math.min(...followed.flatMap((sibling) => sibling.operatorTurns)) : null
  const ordered = rule.listKind === "ORDERED" && rule.stepPosition !== null
  const predecessors = ordered ? followed.filter((sibling) => sibling.sameList && sibling.stepPosition !== null && sibling.stepPosition < rule.stepPosition!) : []
  const anchorTurn = predecessors.length > 0 ? Math.max(...predecessors.flatMap((sibling) => sibling.operatorTurns)) : processStart
  const successorPerformed = ordered && followed.some((sibling) => sibling.sameList && sibling.stepPosition !== null && sibling.stepPosition > rule.stepPosition! && anchorTurn !== null && sibling.operatorTurns.some((turn) => turn > anchorTurn))
  const windowEndTurn = turns.length > 0 ? turns[turns.length - 1]!.handle : null
  const base = { checkpointRequired: true, windowComplete: true }
  const signalsBase = { predecessorTurn: anchorTurn !== null ? `T${anchorTurn}` : null, successorPerformed, windowStartTurn: processStart !== null ? `T${processStart}` : null, windowEndTurn }
  if (anchorTurn === null) return fail("NO_OPPORTUNITY", { ...base, opportunity: false }, signalsBase)
  const after = turns.filter((turn) => turnIndexOf(turn.handle) > anchorTurn)
  const operatorAfter = after.some((turn) => turn.speaker === "OPERADOR")
  if (!operatorAfter || after.some((turn) => DROP.test(turn.text))) return fail("NO_OPPORTUNITY", { ...base, opportunity: false }, signalsBase)

  // PROCESS_APPLICABLE — processo em curso + condição da seção ou assunto ancorados.
  const siblingFollowedVerified = followed.some((sibling) => sibling.knowledgeApplicability === "VERIFIED")
  const conversation = union(...turns.filter((turn) => turn.speaker === "CLIENTE" || turn.speaker === "OPERADOR").map((turn) => turn.text))
  const sectionAnchorTerms = [...union(rule.heading, rule.leadIn)].filter((term) => conversation.has(term)).sort()
  const titleTerms = terms(input.documentTitle)
  const subjectAnchorTerms = input.subject ? [...terms(input.subject)].filter((term) => titleTerms.has(term)).sort() : []
  const applicable = siblingFollowedVerified && (sectionAnchorTerms.length >= 2 || subjectAnchorTerms.length >= 1)
  const signals = { ...signalsBase, siblingFollowedVerified, sectionAnchorTerms, subjectAnchorTerms }
  if (!applicable) return fail("PROCESS_APPLICABILITY_UNVERIFIED", { ...base, opportunity: true, processApplicable: false }, signals)

  const window = turns.filter((turn) => turn.speaker === "OPERADOR" && processStart !== null && turnIndexOf(turn.handle) >= processStart)
  // V1.7.1n — NO_MATCHING_ACTION por POLARIDADE: só uma fala que cumpre o comportamento contradiz a omissão.
  if (input.fulfilled) {
    const fulfilledTurns = window.filter((turn) => input.fulfilled!(turn.text)).map((turn) => turn.handle)
    if (fulfilledTurns.length > 0) return fail("MATCHING_ACTION_FOUND", { ...base, opportunity: true, processApplicable: true, noMatchingAction: false }, { ...signals, matchingTurns: fulfilledTurns })
    return { version: VERIFIED_OMISSION_VERSION, verified: true, failure: null, checks: { processApplicable: true, checkpointRequired: true, windowComplete: true, opportunity: true, noMatchingAction: true }, signals: { ...signals, distinctiveTerms: [], matchingTurns: [] } }
  }
  // NO_MATCHING_ACTION — contraprova com termos PRÓPRIOS da etapa/detalhe, na janela inteira (início da tratativa → fim).
  const context = union(rule.heading, rule.leadIn, input.documentTitle, ...rule.items.filter((item) => item.position !== rule.stepPosition).map((item) => item.text), ...input.siblings.map((sibling) => sibling.requirement))
  const distinctiveTerms = [...union(rule.stepText, input.requirement, input.detailQuote)].filter((term) => !context.has(term)).sort()
  if (distinctiveTerms.length === 0) return fail("ABSENCE_UNVERIFIABLE", { ...base, opportunity: true, processApplicable: true }, { ...signals, distinctiveTerms })
  const matchingTurns = window.filter((turn) => distinctiveTerms.some((term) => terms(turn.text).has(term))).map((turn) => turn.handle)
  if (matchingTurns.length > 0) return fail("MATCHING_ACTION_FOUND", { ...base, opportunity: true, processApplicable: true, noMatchingAction: false }, { ...signals, distinctiveTerms, matchingTurns })
  return { version: VERIFIED_OMISSION_VERSION, verified: true, failure: null, checks: { processApplicable: true, checkpointRequired: true, windowComplete: true, opportunity: true, noMatchingAction: true }, signals: { ...signals, distinctiveTerms, matchingTurns: [] } }
}

// ---------------------------------------------------------------------------------------------
// Tipo da evidência do item
// ---------------------------------------------------------------------------------------------

/**
 * OBSERVED_ACTION       a fala É a ação (perguntou, informou, orientou) ou é o que foi feito no lugar da etapa;
 * OBSERVED_DECLARATION  a fala DECLARA uma execução em sistema que ninguém verificou ("vou registrar", "já cancelei", "foi
 *                       cancelado") — o texto só pode dizer que o operador informou/declarou;
 * VERIFIED_OMISSION     omissão verificada pelas cinco condições;
 * UNVERIFIED_OMISSION   omissão proposta que não passou (vai ao QA).
 */
export type CheckpointEvidenceType = "OBSERVED_ACTION" | "OBSERVED_DECLARATION" | "VERIFIED_OMISSION" | "UNVERIFIED_OMISSION"
export const EVIDENCE_TYPE_LABELS: Record<CheckpointEvidenceType, string> = {
  OBSERVED_ACTION: "Ação observada na fala",
  OBSERVED_DECLARATION: "Ação declarada pelo operador",
  VERIFIED_OMISSION: "Omissão verificada",
  UNVERIFIED_OMISSION: "Omissão não verificada",
}

/** Futuro perifrástico ("vou registrar", "já vou cancelar") e resultado declarado ("já foi cancelado", "está registrado"). */
const PERIPHRASTIC_FUTURE = /(?<!\p{L})(?:vou|irei|vamos)\s+(?:j[áa]\s+)?\p{L}+(?:ar|er|ir)(?!\p{L})/iu
const DECLARED_RESULT = /(?<!\p{L})(?:foi|foram|est[áa]|ficou)\s+(?:\p{L}+(?:ad|id)[oa]s?)(?!\p{L})/iu
const FIRST_PERSON_PAST = /(?<!\p{L})(?:registrei|cancelei|enviei|alterei|abri|solicitei|encaminhei|bloqueei|estornei|ativei|desativei|cadastrei|atualizei|inclu[íi]|exclu[íi]|conclu[íi]|fiz|gerei|lancei|agendei)(?!\p{L})/iu

export function isDeclaration(text: string): boolean {
  return FIRST_PERSON_PAST.test(text) || PERIPHRASTIC_FUTURE.test(text) || DECLARED_RESULT.test(text)
}
