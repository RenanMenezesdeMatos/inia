import { createHash } from "node:crypto"
import { isConditionalStep, terms, type RuleContext } from "./verified-omission.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { stripListMarker } from "../../knowledge/domain/knowledge-list.js"
import { actionRelationOf, askedItemMatchOf, isUnderstandingCheckQuestion, isUnderstandingCheckStep, leadingVerbOf, stepActionOf, type ActionRelation } from "./action-semantics.js"
import { closingSectionRoleOf } from "../../knowledge/domain/section-roles.js"
import { ruleActionOf } from "./behavior-presentation.js"
import type { EvidencePolarityAssessment } from "./evidence-polarity.js"

/**
 * V1.7.1f/V1.7.1g — ÂNCORA ESTRUTURADA DA REGRA (domínio puro, sem LLM).
 *
 * A âncora léxica (≥ 2 termos em comum entre o trecho da regra e a fala) deixava como "só literal" etapas com outras palavras
 * ("Cancelar a recorrência" × "desativei o serviço") — e tudo ia ao QA. Aqui o código PROVA o vínculo pela ESTRUTURA que já
 * existe; o requisito escrito pelo modelo nunca entra.
 *
 * ETAPA CANÔNICA (V1.7.1g, `checkpoint`) — o especialista ESCOLHE a etapa citando literalmente UMA linha de lista de uma seção do
 * documento apresentado; o sistema resolve essa citação para a identidade canônica (documento + versão + seção + abertura +
 * posição + texto da linha). Citação que cobre mais de uma linha não escolhe uma etapa (MULTIPLE_CHECKPOINTS → QA). O texto livre
 * do Agent não cria etapa.
 *
 * Condições comuns: trecho de REGRA; linha de lista; processo aplicável (assunto estruturado ancorado no título do documento,
 * OU título + abertura da seção com ≥ 2 termos na conversa). V1.7.1i (V3): palavras do TÍTULO da seção na conversa deixaram de
 * ser exigidas ("reconhecendo" × "reconhecer" mandava etapas claras ao QA) — o vínculo é a etapa canônica + a AÇÃO na fala.
 *
 * CUMPRIDA (FOLLOWED), com fala verificada do operador:
 *   ASKED_ITEM            a lista pede que o cliente explique/informe e uma fala-pergunta do operador tem termo do item;
 *   ACTION_STEP           o verbo da linha aparece na fala do operador (radical: cancelei/cancelar/cancelamento);
 *   CHECKPOINT_SELECTION  V1.7.1g — o verbo não aparece (paráfrase: "desativei" × "Cancelar"): vale a ESCOLHA da etapa canônica
 *                         pelo especialista, desde que a fala não traga a ação de OUTRA etapa da mesma lista (senão a escolha
 *                         é ambígua → EVIDENCE_MATCHES_OTHER_STEP, QA) e, V1.7.1i, REALIZE a ação da etapa pela semântica
 *                         fechada (`action-semantics.ts`: "tirei a renovação" = CANCEL × recorrência) ou trate do objeto dela
 *                         ("O seu protocolo é…") — senão ACTION_NOT_RELATED; ação sobre outro objeto → OBJECT_MISMATCH.
 * NÃO CUMPRIDA com AÇÃO OBSERVADA (NOT_FOLLOWED + OBSERVED), com fala verificada do operador (o que ele disse no lugar):
 *   OBSERVED_DEVIATION    V1.7.1g — a etapa não é condicional (condição que a conversa não mostra não vira descumprimento →
 *                         CONDITIONAL_STEP, QA) e NENHUMA fala do operador na chamada usa um termo PRÓPRIO da etapa (termos
 *                         que também estão no título, na abertura ou no nome do documento não contam) — senão a etapa pode ter
 *                         sido cumprida em outro momento (STEP_TERMS_IN_OPERATOR_SPEECH, QA).
 *   UNDERSTANDING_CHECK   V1.7.1l — etapa canônica CONFIRM_UNDERSTANDING ("As informações ficaram claras?", "confirme se o
 *                         cliente tem mais alguma dúvida") e uma PERGUNTA verificada do operador com formulação controlada de
 *                         confirmação de entendimento ("Ficou claro pra você…?") — flexão e sinônimo fechado, nunca similaridade.
 * NOT_FOLLOWED por OMISSÃO continua no caminho mais forte da omissão verificada (`verified-omission.ts`) — nunca aqui.
 *
 * A classificação "fala → etapa canônica" é só isso: não autoriza causalidade nem fato. Afirmações e orientação continuam
 * presas à regra literal e à evidência verificada.
 */
export const STRUCTURED_ANCHOR_VERSION = "STRUCTURED_ANCHOR_V3" as const

export type StructuredAnchorBasis = /** V1.7.1n — comportamento com detector de polaridade CUMPRIDO na fala verificada (o número do protocolo, o prazo concreto). */ "BEHAVIOR_FULFILLED" | "ACTION_STEP" | "ASKED_ITEM" | "CHECKPOINT_SELECTION" | "OBSERVED_DEVIATION" | /** V1.7.1k — formulação que o procedimento pede EVITAR dita pelo operador. */ "AVOIDED_PHRASE_OBSERVED" | /** V1.7.1k — etapa composta: ≥ 2 itens da própria lista reconhecidos (detector tipado) na fala verificada do operador. */ "COMPOSITE_ITEMS_OBSERVED" | /** V1.7.1l — etapa CONFIRM_UNDERSTANDING e pergunta do operador com formulação controlada de confirmação de entendimento. */ "UNDERSTANDING_CHECK" | /** V1.7.4 — paráfrase: conduta sustentada + relação EQUIVALENT declarada + termo/classe de objeto da regra (`evidence-conduct.ts`). */ "SEMANTIC_CONDUCT" | /** V1.7.4 — "X antes de Y": o operador fez Y sem X antes (conduta observada, não omissão). */ "PREREQUISITE_SKIPPED"
export type StructuredAnchorFailure =
  | "NOT_EVIDENCED"
  | "OMISSION_PATH"
  | "NOT_RULE_CONTENT"
  | "NOT_A_LIST_STEP"
  | "MULTIPLE_CHECKPOINTS"
  | "PROCESS_NOT_APPLICABLE"
  /** Legado (V1.7.1f/g) — não é mais produzido desde a V3: palavras do título da seção na conversa não são prova. */
  | "SECTION_SITUATION_ABSENT"
  | "ITEM_NOT_ASKED"
  /** V1.7.1i — a fala verificada não realiza a ação da etapa (nem forma da família do verbo, nem objeto da etapa). */
  | "ACTION_NOT_RELATED"
  /** V1.7.1i — a fala trata de OUTRO objeto conhecido (ex.: assinatura × portabilidade). */
  | "OBJECT_MISMATCH"
  | "EVIDENCE_MATCHES_OTHER_STEP"
  | "CONDITIONAL_STEP"
  | "STEP_TERMS_IN_OPERATOR_SPEECH"
  | "CHECKPOINT_CONFLICT"
  /** V1.7.1k — conteúdo "evitar" nunca sustenta etapa CUMPRIDA (não dizer algo não se prova pela fala). */
  | "AVOID_CANNOT_SUPPORT_FOLLOWED"
  /** V1.7.1k — nenhuma fala verificada do operador contém a formulação que o procedimento pede evitar. */
  | "AVOIDED_CONTENT_NOT_OBSERVED"
  /** V1.7.1n — polaridade: a fala citada não CUMPRE o comportamento (mencionar/negar/não saber ≠ cumprir). */
  | "EVIDENCE_DOES_NOT_FULFILL"
  /** V1.7.1n — polaridade: há fala do operador que CUMPRE o comportamento (contraprova real, nunca palavra solta). */
  | "BEHAVIOR_FULFILLED_IN_OPERATOR_SPEECH"

/** Identidade canônica da etapa escolhida (auditoria; nunca vai ao colaborador). */
export type CanonicalCheckpoint = { identity: string; heading: string | null; leadIn: string | null; stepPosition: number; stepText: string }

export type StructuredAnchor = {
  version: typeof STRUCTURED_ANCHOR_VERSION
  anchored: boolean
  basis: StructuredAnchorBasis | null
  failure: StructuredAnchorFailure | null
  checkpoint: CanonicalCheckpoint | null
  proof: { /** V1.7.1k — UNIVERSAL_SCOPE: a própria regra declara valer para toda chamada ("Antes de encerrar qualquer chamada:"). */ processAnchor: "SUBJECT" | "SECTION" | "UNIVERSAL_SCOPE" | null; /** V1.7.1k */ avoidedPhrases?: string[]; actionStem: string | null; operatorTurns: string[]; situationTerms: string[]; itemTerms: string[]; otherStepStems: string[]; stepTermsInSpeech: string[]; /** V1.7.1i — relação etapa × fala pela semântica de ação. */ actionRelation?: (ActionRelation & { family: string | null; stepObjects: string[] }) | null; /** V1.7.1n */ polarity?: { behavior: string; evidence: string; fulfilledTurns: string[] } | null; /** V1.7.1o — pergunta reconhecida pela semântica tipada do item. */ askedIntent?: { classes: string[]; subject: string | null; via: string }[] | null }
}

export type StructuredAnchorInput = {
  status: string
  /** V1.7.1g — tipo de evidência DECLARADO pelo especialista (OBSERVED | OMISSION | null). */
  declaredEvidenceType?: string | null
  contentKind: string | null | undefined
  rule: RuleContext | null
  /** V1.7.1g — o trecho da base citado (para saber quantas linhas da lista ele cobre). Ausente = uma linha. */
  citedQuote?: string | null
  documentTitle: string
  subject: string | null
  /** Falas do operador VERIFICADAS nesta etapa (turno + texto). */
  operatorEvidence: readonly { turnRef: string; text: string }[]
  /** Todas as falas da conversa (operador e cliente) — onde a situação da seção precisa existir. */
  conversation: readonly string[]
  /** V1.7.1g — todas as falas do OPERADOR na chamada (contraprova da etapa não cumprida). Ausente = só a evidência. */
  operatorConversation?: readonly string[]
  /** V1.7.1n — polaridade da evidência (comportamentos com detector): substitui a contraprova léxica por cumprimento REAL. */
  polarity?: EvidencePolarityAssessment | null
  /** V1.7.1o — falas da conversa em ordem (turno + texto): contexto da anáfora na pergunta ("alguma delas"). Ausente = sem contexto. */
  turns?: readonly { turnRef: string; text: string }[]
}

const INTERROGATIVE = /^(?:qual|quais|quando|como|onde|quanto|quantos|quantas|o\s+que|por\s+que|se)(?!\p{L})/iu
const ASKS_CLIENT = /(?<!\p{L})(?:explique|explicar|informe|informar|pergunt\p{L}*|questione|confirme|confirmar|verificar|verifique)(?!\p{L})/iu
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const wordsOf = (text: string) => fold(text).match(/\p{L}{4,}/gu) ?? []
/** Palavras de conteúdo (≥ 4 letras, sem as palavras vazias da âncora). */
export const contentWords = (text: string) => { const stop = terms(text); return wordsOf(text).filter((word) => stop.has(word.slice(0, 5))) }
/** Mesma palavra, admitindo flexão: uma é início da outra, com ≥ 4 letras em comum ("paga" ⊂ "pagar", "servico" ⊂ "servicos"). */
const sameWord = (left: string, right: string) => Math.min(left.length, right.length) >= 4 && (left.startsWith(right) || right.startsWith(left))
export const sharedWords = (source: readonly string[], target: readonly string[]) => [...new Set(source.filter((word) => target.some((other) => sameWord(word, other))))]

const stepBodyOf = (text: string) => stripListMarker(text).replace(/[;:.,]+$/, "").trim()
/** Radical do verbo no infinitivo que abre a linha ("Cancelar…" → "cancel"); null sem verbo reconhecido ou radical curto. */
export function actionStemOf(stepText: string): string | null {
  // Linha de procedimento começa pelo verbo: fora do vocabulário conhecido, um infinitivo regular (-ar/-er/-ir, ≥ 5 letras) conta.
  // V1.7.1k — o IMPERATIVO de checklist ("confirme", "informe") conta como o mesmo verbo (só verbos conhecidos).
  const verb = leadingVerbOf(stepBodyOf(stepText))
  if (!verb) return null
  const stem = verb.replace(/(?:ar|er|ir|or)$/u, "")
  return stem.length >= 4 ? stem : null
}
const speechHasStem = (texts: readonly string[], stem: string) => texts.some((text) => wordsOf(text).some((word) => word.startsWith(stem)))

/** Identidade canônica de uma linha de lista (estável: mesma seção, abertura, posição e texto → mesma identidade). */
export function canonicalCheckpointOf(rule: RuleContext | null): CanonicalCheckpoint | null {
  if (!rule || rule.listKind === "NONE" || rule.stepPosition === null) return null
  return identityOf(rule.heading, rule.leadIn, rule.stepPosition, stepBodyOf(rule.stepText))
}
function identityOf(heading: string | null, leadIn: string | null, position: number, stepText: string): CanonicalCheckpoint {
  const key = [heading ?? "", leadIn ?? "", String(position), stepText].map((part) => fold(part)).join("|")
  return { identity: `CP:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`, heading, leadIn, stepPosition: position, stepText }
}
/**
 * V1.7.1j — etapa de FRASE ÚNICA (regra normativa fora de lista: "Sempre informar prazo de forma objetiva:"): a ação da regra
 * vira a etapa canônica (posição 0). Só para a etapa NÃO cumprida com ação observada — a cumprida continua exigindo linha de lista.
 */
function sentenceCheckpointOf(rule: RuleContext, citedRule: string | null | undefined): CanonicalCheckpoint | null {
  const action = ruleActionOf(citedRule ?? rule.stepText)
  if (!action || action.items.length > 0) return null
  return identityOf(rule.heading, rule.leadIn, 0, action.action)
}
/** Palavras do OBJETO de uma linha de etapa (sem o verbo inicial e sem a condição final). */
const objectWordsOf = (stepText: string) => contentWords(stepBodyOf(stepText).replace(/,\s*(?:quando|se|caso|desde\s+que)(?!\p{L}).*$/iu, "").split(/\s+/).slice(1).join(" "))

/** Quantas linhas da lista o trecho citado cobre (comparação literal estrutural). */
function coveredSteps(rule: RuleContext, citedQuote: string | null | undefined): number {
  if (!citedQuote) return 1
  const quote = normalizeForLiteralQuote(citedQuote)
  return rule.items.filter((item) => { const line = normalizeForLiteralQuote(item.text); return line.length > 0 && quote.includes(line) }).length
}

/** V1.7.1k — escopo UNIVERSAL declarado pela própria regra ("qualquer chamada", "todo atendimento"): o processo se aplica a
 * toda interação — prova estrutural de aplicabilidade, como o assunto e a seção. */
const UNIVERSAL_SCOPE = /(?<!\p{L})(?:qualquer|toda|todo|todas|todos)\s+(?:as\s+|os\s+)?(?:chamadas?|atendimentos?|ligacao|ligacoes|contatos?|interacao|interacoes)(?!\p{L})/u
const phraseFold = (text: string) => fold(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
/**
 * V1.7.1k — formulações que uma linha "evitar" proíbe: as falas entre aspas da linha ("- “É só aguardar.”") ou, sem aspas, a
 * própria linha; cada uma com ≥ 2 palavras (palavra solta não é formulação).
 */
export function forbiddenPhrasesOf(stepText: string): string[] {
  const quoted = [...stepText.matchAll(/[“"«]([^”"»]+)[”"»]/g)].map((match) => match[1]!)
  const phrases = (quoted.length > 0 ? quoted : [stepBodyOf(stepText)]).map((text) => text.replace(/[.?!;:,]+$/u, "").trim())
  return phrases.filter((text) => phraseFold(text).split(" ").length >= 2)
}
/** A fala CONTÉM a formulação (sem acento/pontuação, palavras inteiras e contíguas; o resto da fala pode continuar). */
export const speechContainsPhrase = (speech: string, phrase: string) => ` ${phraseFold(speech)} `.includes(` ${phraseFold(phrase)} `)

/**
 * Processo APLICÁVEL a esta interação (prova estrutural): assunto estruturado ancorado no título do documento; título + abertura
 * da seção com ≥ 2 termos na conversa; ou (V1.7.1k) escopo universal declarado pela própria regra.
 */
export function processAnchorOf(input: { documentTitle: string; subject: string | null; heading: string | null; leadIn: string | null; conversation: readonly string[] }): "SUBJECT" | "SECTION" | "UNIVERSAL_SCOPE" | null {
  const titleTerms = terms(input.documentTitle)
  const subjectAnchored = input.subject ? [...terms(input.subject)].some((term) => titleTerms.has(term)) : false
  const conversationTerms = new Set(input.conversation.flatMap((text) => [...terms(text)]))
  const sectionAnchored = [...new Set([...terms(input.heading ?? ""), ...terms(input.leadIn ?? "")])].filter((term) => conversationTerms.has(term)).length >= 2
  const universal = UNIVERSAL_SCOPE.test(fold(input.leadIn ?? "")) || UNIVERSAL_SCOPE.test(fold(input.heading ?? ""))
  return subjectAnchored ? "SUBJECT" : sectionAnchored ? "SECTION" : universal ? "UNIVERSAL_SCOPE" : null
}

export function structuredAnchorOf(input: StructuredAnchorInput): StructuredAnchor {
  const proof: StructuredAnchor["proof"] = { processAnchor: null, actionStem: null, operatorTurns: [], situationTerms: [], itemTerms: [], otherStepStems: [], stepTermsInSpeech: [] }
  const checkpoint = canonicalCheckpointOf(input.rule)
  let resolved = checkpoint
  const fail = (failure: StructuredAnchorFailure): StructuredAnchor => ({ version: STRUCTURED_ANCHOR_VERSION, anchored: false, basis: null, failure, checkpoint: resolved, proof })
  const pass = (basis: StructuredAnchorBasis): StructuredAnchor => ({ version: STRUCTURED_ANCHOR_VERSION, anchored: true, basis, failure: null, checkpoint: resolved, proof })
  const followed = input.status === "FOLLOWED"
  const deviation = input.status === "NOT_FOLLOWED"
  if ((!followed && !deviation) || input.operatorEvidence.length === 0) return fail("NOT_EVIDENCED")
  if (deviation && input.declaredEvidenceType === "OMISSION") return fail("OMISSION_PATH")
  // V1.7.1k — AVOID é regra procedimental legítima para comportamento proibido/desaconselhado: sustenta só NÃO CUMPRIDA.
  const avoid = input.contentKind === "DO_NOT_CONTENT"
  if (avoid && followed) return fail("AVOID_CANNOT_SUPPORT_FOLLOWED")
  if (!avoid && (input.contentKind ?? "RULE_CONTENT") !== "RULE_CONTENT") return fail("NOT_RULE_CONTENT")
  const rule = input.rule
  const polarity = input.polarity ?? null
  if (polarity) proof.polarity = { behavior: polarity.behavior, evidence: polarity.evidence, fulfilledTurns: polarity.fulfilledTurns }
  // V1.7.1n — cumprida sem fala que CUMPRA o comportamento ("não sei informar o prazo" nunca é "informou o prazo").
  if (followed && polarity?.conflict) return fail("EVIDENCE_DOES_NOT_FULFILL")
  const sentence = !checkpoint && (deviation || (followed && polarity?.evidence === "FULFILLED")) && rule && rule.listKind === "NONE"
    ? (avoid ? identityOf(rule.heading, rule.leadIn, 0, stepBodyOf(rule.stepText)) : sentenceCheckpointOf(rule, input.citedQuote))
    : null
  if (!rule || (!checkpoint && !sentence)) return fail("NOT_A_LIST_STEP")
  if (checkpoint && coveredSteps(rule, input.citedQuote) > 1) return fail("MULTIPLE_CHECKPOINTS")
  const canonical = checkpoint ?? sentence!
  resolved = canonical

  // PROCESSO APLICÁVEL (a mesma prova da omissão verificada).
  const titleTerms = terms(input.documentTitle)
  proof.processAnchor = processAnchorOf({ documentTitle: input.documentTitle, subject: input.subject, heading: rule.heading, leadIn: rule.leadIn, conversation: input.conversation })
  if (!proof.processAnchor) return fail("PROCESS_NOT_APPLICABLE")

  // V1.7.1k — ETAPA "EVITAR" não cumprida com ação observada: a formulação proibida está numa fala VERIFICADA do operador
  // ("é só aguardar a análise" contém "É só aguardar."). Nunca igualdade total; nunca similaridade livre.
  if (avoid) {
    // A citação pode ser a lista "Evitar:" inteira: as formulações são as falas entre aspas do trecho citado; senão, a da linha.
    const cited = input.citedQuote && /[“"«]/.test(input.citedQuote) ? forbiddenPhrasesOf(input.citedQuote) : []
    const phrases = cited.length > 0 ? cited : forbiddenPhrasesOf(canonical.stepText)
    const hits = input.operatorEvidence.filter((unit) => phrases.some((phrase) => speechContainsPhrase(unit.text, phrase)))
    proof.avoidedPhrases = phrases.filter((phrase) => hits.some((unit) => speechContainsPhrase(unit.text, phrase)))
    proof.operatorTurns = hits.map((unit) => unit.turnRef)
    return hits.length > 0 ? pass("AVOIDED_PHRASE_OBSERVED") : fail("AVOIDED_CONTENT_NOT_OBSERVED")
  }

  // V1.7.1n — etapa canônica + comportamento com detector CUMPRIDO na fala verificada ("o seu protocolo é 2026…"): prova estrutural
  // quando as provas anteriores não bastam (ex.: a recapitulação traz a ação de outras etapas na mesma fala, ou a etapa é frase).
  const fulfilled = (fallback: StructuredAnchor): StructuredAnchor => {
    if (fallback.anchored || !followed || polarity?.evidence !== "FULFILLED") return fallback
    proof.operatorTurns = polarity.evidenceUnits.filter((unit) => unit.polarity === "FULFILLED").map((unit) => unit.turnRef)
    return { version: STRUCTURED_ANCHOR_VERSION, anchored: true, basis: "BEHAVIOR_FULFILLED", failure: null, checkpoint: resolved, proof }
  }
  if (followed && !checkpoint && sentence) return fulfilled(fail("NOT_A_LIST_STEP"))
  const step = canonical.stepText
  const operatorTexts = input.operatorEvidence.map((unit) => unit.text)
  // V1.7.1l — CONFIRMAR ENTENDIMENTO: a ação canônica, não as palavras ("ficou claro" × "ficaram claras").
  if (followed && isUnderstandingCheckStep(step, { understandingSection: closingSectionRoleOf(rule.heading ?? "", "") === "UNDERSTANDING_CHECK", asksToAsk: ASKS_CLIENT.test(rule.leadIn ?? "") })) {
    const asked = input.operatorEvidence.filter((unit) => isUnderstandingCheckQuestion(unit.text))
    if (asked.length > 0) {
      proof.operatorTurns = asked.map((unit) => unit.turnRef)
      return pass("UNDERSTANDING_CHECK")
    }
  }
  // ITEM A PERGUNTAR — a lista pede que o cliente explique/informe; o operador perguntou (fala com "?") algo do item.
  if (followed && INTERROGATIVE.test(step) && ASKS_CLIENT.test(rule.leadIn ?? "")) {
    const itemWords = contentWords(step)
    // V1.7.1o — além das palavras do item, a MESMA intenção tipada (classe de objeto + assunto) numa frase interrogativa do operador
    // ("Se a conta já foi paga" × "Você já pagou alguma dessas faturas?").
    const precedingOf = (turnRef: string) => { const turns = input.turns ?? []; const at = turns.findIndex((turn) => turn.turnRef === turnRef); return at > 0 ? turns.slice(0, at).map((turn) => turn.text) : [] }
    const typed = input.operatorEvidence.map((unit) => ({ unit, match: askedItemMatchOf(step, unit.text, precedingOf(unit.turnRef)) }))
    const asked = input.operatorEvidence.filter((unit, index) => (unit.text.includes("?") && sharedWords(itemWords, contentWords(unit.text)).length > 0) || typed[index]!.match !== null)
    if (asked.length === 0) return fulfilled(fail("ITEM_NOT_ASKED"))
    const intents = typed.flatMap((entry) => (entry.match ? [{ classes: entry.match.classes, subject: entry.match.subject, via: entry.match.via }] : []))
    if (intents.length > 0) proof.askedIntent = intents
    proof.itemTerms = sharedWords(itemWords, asked.flatMap((unit) => contentWords(unit.text)))
    proof.operatorTurns = asked.map((unit) => unit.turnRef)
    return pass("ASKED_ITEM")
  }

  const stem = actionStemOf(step)
  proof.actionStem = stem
  // V1.7.1i — a situação da seção NÃO é exigida (palavras do título na conversa não provam nada: "reconhecendo" × "reconhecer").
  // O vínculo é a etapa canônica escolhida + a relação de AÇÃO com a fala verificada (semântica fechada, `action-semantics.ts`).
  proof.operatorTurns = input.operatorEvidence.map((unit) => unit.turnRef)
  const action = stepActionOf(step)
  const relation = actionRelationOf(action, operatorTexts)
  proof.actionRelation = { ...relation, family: action.family, stepObjects: action.objectClasses }

  if (followed) {
    if (relation.objectMismatch) return fulfilled(fail("OBJECT_MISMATCH"))
    if (stem && speechHasStem(operatorTexts, stem)) {
      proof.operatorTurns = input.operatorEvidence.filter((unit) => speechHasStem([unit.text], stem)).map((unit) => unit.turnRef)
      return pass("ACTION_STEP")
    }
    // Paráfrase: a escolha da etapa canônica vale se a fala não traz a ação de OUTRA etapa da mesma lista. V1.7.1j — AÇÃO + OBJETO:
    // o verbo da outra etapa sozinho não basta ("pro faturamento analisar" ≠ "Analisar valores…"); a fala precisa tratar também
    // do objeto dela (classe conhecida ou palavra do objeto).
    const spokenWords = operatorTexts.flatMap(contentWords)
    // V1.7.1m — quando a fala trata do OBJETO da própria etapa (classe fechada: titular, pagamento, protocolo…), outra linha só
    // disputa a fala com a AÇÃO + o objeto dela por CLASSE; coincidência léxica ("contato" ⊃ "conta") não desfaz a escolha.
    const ownObjectSpoken = relation.objectClasses.length > 0
    const conflicting = rule.items.filter((item) => item.position !== rule.stepPosition).flatMap((item) => {
      const otherStem = actionStemOf(item.text)
      if (!otherStem || otherStem === stem || !speechHasStem(operatorTexts, otherStem)) return []
      const objectSpoken = actionRelationOf(stepActionOf(item.text), operatorTexts).objectClasses.length > 0 || (!ownObjectSpoken && sharedWords(objectWordsOf(item.text), spokenWords).length > 0)
      return objectSpoken ? [otherStem] : []
    })
    proof.otherStepStems = [...new Set(conflicting)]
    if (proof.otherStepStems.length > 0) return fulfilled(fail("EVIDENCE_MATCHES_OTHER_STEP"))
    // …e a fala REALIZA a ação da etapa (forma da família do verbo) ou trata do objeto dela ("O seu protocolo é…").
    if (!relation.related) return fulfilled(fail("ACTION_NOT_RELATED"))
    return pass("CHECKPOINT_SELECTION")
  }

  // NÃO CUMPRIDA com ação observada.
  if (isConditionalStep(step)) return fail("CONDITIONAL_STEP")
  // V1.7.1n — comportamento com detector: a contraprova é uma fala que CUMPRE (prazo concreto, número do protocolo) — a palavra
  // "prazo" em "Não sei te dizer um prazo certinho" não é contraprova; é evidência do não cumprimento.
  if (polarity) {
    if (polarity.conflict) { proof.operatorTurns = polarity.fulfilledTurns; return fail("BEHAVIOR_FULFILLED_IN_OPERATOR_SPEECH") }
    return pass("OBSERVED_DEVIATION")
  }
  // Etapa de frase única: o assunto da seção É a etapa ("prazo") — só o nome do documento sai da contraprova.
  const shared = new Set(sentence ? [...titleTerms] : [...terms(rule.heading ?? ""), ...terms(rule.leadIn ?? ""), ...titleTerms])
  const ownTerms = [...terms(step)].filter((term) => !shared.has(term))
  const operatorSpeech = new Set((input.operatorConversation ?? operatorTexts).flatMap((text) => [...terms(text)]))
  proof.stepTermsInSpeech = ownTerms.filter((term) => operatorSpeech.has(term))
  if (ownTerms.length === 0 || proof.stepTermsInSpeech.length > 0) return fail("STEP_TERMS_IN_OPERATOR_SPEECH")
  return pass("OBSERVED_DEVIATION")
}
