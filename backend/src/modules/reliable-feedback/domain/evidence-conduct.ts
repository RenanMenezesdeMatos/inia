import { terms } from "./verified-omission.js"
import { primaryObligationOf, stepSemanticsOf } from "./step-semantics.js"
import { facetPolarityOf } from "./evidence-polarity.js"
import { askedItemMatchOf } from "./action-semantics.js"

/**
 * V1.7.4 — CONDUTA DA EVIDÊNCIA (`EVIDENCE_CONDUCT_V1`, domínio puro, sem LLM).
 *
 * P0 da Golden Demo "Argumentário": a regra pedia "avaliar se a funcionalidade está disponível" e a fala só AFIRMAVA "essa opção
 * está disponível pra você". A âncora léxica (≥ 2 termos em comum: pagamento, aplicativo, disponível) aceitou, o feedback publicou
 * "você verificou a disponibilidade" e a observação foi gravada como VERIFIED. Compartilhar substantivos não prova o VERBO da
 * etapa: afirmar um resultado não é verificar a condição.
 *
 * Aqui a evidência precisa sustentar a CONDUTA exigida — com o mesmo rigor para ponto forte e para ponto de desenvolvimento:
 *
 *   CHECAGEM DE CONDIÇÃO  etapa cuja obrigação é checar algo ("verificar/avaliar/confirmar/validar SE …", "… disponibilidade/
 *                         elegibilidade/condições"): CUMPRIDA exige na fala citada um ATO de checagem do operador ("vou verificar",
 *                         "verifiquei", "estou consultando", "deixa eu conferir") ou uma PERGUNTA ao cliente sobre o objeto da
 *                         checagem. Resultado afirmado ≠ validação (`ASSERTED_RESULT_IS_NOT_VALIDATION`).
 *   PROIBIÇÃO             etapa "Não prometer/garantir/afirmar …": CUMPRIDA exige abstenção EXPLÍCITA na fala ("não consigo te
 *                         garantir…") — ausência de falha nunca é ponto forte (`PROHIBITION_COMPLIANCE_NOT_PROVEN`); NÃO CUMPRIDA
 *                         exige que a fala faça o que é proibido (a abstenção citada contradiz a acusação: `EVIDENCE_ACTION_MISMATCH`).
 *                         "…sem realizar as validações": a acusação cai se houve ato de checagem do operador antes da fala.
 *   DEMAIS                sem exigência adicional (a âncora de sempre decide).
 *
 * O papel e a relação DECLARADOS pelo especialista (`conductEvidence`, contrato V4) só PODEM restringir: papel incompatível ou
 * relação incompatível com o status (dedução; "cumprida" sem EQUIVALENT) derrubam a etapa; nunca a promovem sozinhos. Paráfrase (poucas palavras em comum) só é aceita
 * quando a conduta está sustentada por estas pistas estruturais, o especialista declarou EQUIVALENT e há ao menos um termo ou
 * classe de objeto em comum com a regra (`semanticConductAnchorOf`).
 */
export const EVIDENCE_CONDUCT_VERSION = "EVIDENCE_CONDUCT_V1" as const

export const EVIDENCE_ROLES = ["ACTION_PERFORMED", "RESULT_ASSERTED", "INFORMATION_PROVIDED", "PROMISE_MADE", "QUESTION_ASKED", "CONDITION_VALIDATED", "CUSTOMER_RESPONSE"] as const
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number]
export const CONDUCT_RELATIONS = ["EQUIVALENT", "INFERRED", "DIFFERENT"] as const
export type ConductRelation = (typeof CONDUCT_RELATIONS)[number]
export type DeclaredConduct = { role: EvidenceRole; relation: ConductRelation }

export type RequiredConduct = "CONDITION_CHECK" | "PROHIBITION" | "NONE"
export type ConductFailure =
  | "ASSERTED_RESULT_IS_NOT_VALIDATION"
  | "OBSERVED_ACTION_NOT_PROVEN"
  | "PROHIBITION_COMPLIANCE_NOT_PROVEN"
  | "EVIDENCE_ACTION_MISMATCH"
  | "DECLARED_ROLE_INCOMPATIBLE"
  /** A relação declarada não sustenta o status: cumprida exige EQUIVALENT; descumprida aceita DIFFERENT (a fala mostra a conduta
   * contrária/diferente) ou EQUIVALENT; INFERRED (dedução) nunca sustenta nenhuma das duas. */
  | "DECLARED_RELATION_INCOMPATIBLE"
  /** A MESMA fala do operador é a prova de um descumprimento verificado na MESMA seção: a conduta positiva está misturada à
   * violação (ex.: "é porque a sua franquia acabou… compre um pacote") — não vira ponto forte. */
  | "EVIDENCE_SHARED_WITH_VIOLATION"

export type ConductAssessment = {
  version: typeof EVIDENCE_CONDUCT_VERSION
  required: RequiredConduct
  /** Obrigação principal da etapa (sem a ação seguinte "antes de …"). */
  obligation: string | null
  verdict: "SUPPORTED" | "MISMATCH" | "NOT_REQUIRED"
  failure: ConductFailure | null
  cues: { checkActTurns: string[]; questionTurns: string[]; abstentionTurns: string[]; assertionTurns: string[]; priorCheckTurns: string[] }
  declared: DeclaredConduct | null
  /** Status que a evidência precisa sustentar (define a relação aceita). */
  claimedStatus?: string
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const CHECK_LEAD = /^(?:nao\s+)?(?:confirm|verific|avali|valid|chec|confer|pergunt|question|consult|identific|apur|certific)\p{L}*/u
const CHECK_OBJECT = /(?<!\p{L})(?:se|qual|quais|dispon\p{L}*|elegib\p{L}*|condic\p{L}*|aplicab\p{L}*)(?!\p{L})/u
const PROHIBITION_LEAD = /^(?:nao|nunca|jamais)\s+\p{L}+/u
/** Ato de checagem do OPERADOR (1ª pessoa, futuro próximo, progressivo ou pretérito) — nunca "você pode verificar". */
const CHECK_VERBS = "(?:verific\\p{L}*|consult\\p{L}*|confer\\p{L}*|chec\\p{L}*|cheq\\p{L}*|valid\\p{L}*|avali\\p{L}*|olh\\p{L}*|pesquis\\p{L}*|procur\\p{L}*|ver)"
const CHECK_ACT: RegExp[] = [
  new RegExp(`(?<!\\p{L})(?:vou|vamos|irei|deixa\\s+eu|deixe\\s+eu|deixa\\s+que\\s+eu|preciso|eu\\s+vou)\\s+(?:(?:te|lhe|ja|so|primeiro|agora|aqui|rapidinho)\\s+){0,2}${CHECK_VERBS}(?!\\p{L})`, "u"),
  /(?<!\p{L})(?:estou|to|tou|estamos|eu\s+to|eu\s+estou)\s+(?:(?:aqui|agora|so)\s+)?(?:verificando|consultando|conferindo|checando|validando|avaliando|olhando|pesquisando|procurando|realizando\s+uma\s+(?:verificacao|consulta|checagem|validacao))(?!\p{L})/u,
  /(?<!\p{L})(?:verifiquei|consultei|conferi|chequei|validei|avaliei|olhei|pesquisei|procurei|achei|encontrei)(?!\p{L})/u,
  /(?<!\p{L})(?:realizar|realizando|fazer|fazendo|fiz)\s+(?:uma\s+|a\s+)?(?:verificacao|consulta|checagem|validacao)(?!\p{L})/u,
]
const NEGATION = /(?<!\p{L})(?:nao|nunca|nem|jamais)(?!\p{L})/u
const COMMITMENT = /(?<!\p{L})(?:prometer|prometo|garantir|garanto|assegurar|asseguro|afirmar|confirmar|consigo|posso|tenho\s+como|da\s+pra|da\s+para)(?!\p{L})/u
const WITHOUT_VALIDATION = /(?<!\p{L})sem\s+(?:(?:realizar|fazer|antes)\s+)?(?:as\s+|a\s+)?(?:valida\p{L}*|verifica\p{L}*|consulta\p{L}*|confer\p{L}*|checag\p{L}*)/u
const sentencesOf = (text: string) => fold(text).split(/(?<=[.!?;])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean)

/** Relação declarada × status: FOLLOWED só com EQUIVALENT; NOT_FOLLOWED com DIFFERENT (conduta contrária) ou EQUIVALENT; nunca INFERRED. */
export const relationSupports = (status: string, relation: ConductRelation) => relation !== "INFERRED" && (status !== "FOLLOWED" || relation === "EQUIVALENT")
export const isCheckAct = (text: string) => CHECK_ACT.some((pattern) => pattern.test(fold(text)))

export function requiredConductOf(stepText: string): { required: RequiredConduct; obligation: string | null } {
  const obligation = primaryObligationOf(stepText) ?? stepText
  const folded = fold(obligation).trim()
  if (PROHIBITION_LEAD.test(folded)) return { required: "PROHIBITION", obligation }
  const primary = stepSemanticsOf(obligation).primary
  if (CHECK_LEAD.test(folded) && !folded.startsWith("nao ") && (primary?.branchSelector || CHECK_OBJECT.test(folded))) return { required: "CONDITION_CHECK", obligation }
  return { required: "NONE", obligation }
}

/** Termos próprios da obrigação (sem o verbo que a abre e sem as palavras vazias). */
const obligationTermsOf = (obligation: string) => { const all = [...terms(obligation)]; return new Set(all.slice(1)) }

type Unit = { turnRef: string; text: string }
export type ConductInput = {
  stepText: string
  status: string
  evidenceType: string | null
  /** Falas VERIFICADAS do operador citadas nesta etapa. */
  evidence: readonly Unit[]
  /** Todas as falas do operador na chamada, em ordem (checagem ANTES da fala citada). */
  operatorTurns: readonly Unit[]
  declared?: DeclaredConduct | null
  /** MONITORING V2 — contrato V5: a semântica é DECLARADA pelo especialista (papel + relação). O código confere só a coerência do
   * papel com a conduta exigida e três pistas objetivas: ato de checagem, "?" na pergunta, negação na abstenção. Ausente = léxico (V4). */
  mode?: "DECLARED" | "LEXICAL"
}

const turnNumber = (turnRef: string) => Number.parseInt(turnRef.replace(/^T/i, ""), 10)

export function assessConduct(input: ConductInput): ConductAssessment {
  if (input.mode === "DECLARED") return assessDeclaredConduct(input)
  const { required, obligation } = requiredConductOf(input.stepText)
  const own = obligationTermsOf(obligation ?? input.stepText)
  const sharesOwn = (text: string) => [...terms(text)].some((term) => own.has(term))
  const checkActTurns = input.evidence.filter((unit) => isCheckAct(unit.text)).map((unit) => unit.turnRef)
  // Pergunta ao cliente SOBRE o objeto da checagem (termo próprio ou a mesma intenção tipada: "se a conta foi paga" × "já pagou?").
  const questionTurns = input.evidence.filter((unit) => unit.text.includes("?") && (sharesOwn(unit.text) || askedItemMatchOf(obligation ?? input.stepText, unit.text) !== null)).map((unit) => unit.turnRef)
  const abstentionTurns = input.evidence.filter((unit) => sentencesOf(unit.text).some((sentence) => NEGATION.test(sentence) && (COMMITMENT.test(sentence) || sharesOwn(sentence)))).map((unit) => unit.turnRef)
  const assertionTurns = input.evidence.filter((unit) => sentencesOf(unit.text).some((sentence) => !sentence.includes("?") && !NEGATION.test(sentence) && sharesOwn(sentence))).map((unit) => unit.turnRef)
  const firstEvidence = input.evidence.length > 0 ? Math.min(...input.evidence.map((unit) => turnNumber(unit.turnRef))) : Number.POSITIVE_INFINITY
  const priorCheckTurns = input.operatorTurns.filter((unit) => turnNumber(unit.turnRef) < firstEvidence && isCheckAct(unit.text)).map((unit) => unit.turnRef)
  const declared = input.declared ?? null
  const base = { version: EVIDENCE_CONDUCT_VERSION, required, obligation, cues: { checkActTurns, questionTurns, abstentionTurns, assertionTurns, priorCheckTurns }, declared, claimedStatus: input.status } as const
  const pass = (): ConductAssessment => ({ ...base, verdict: "SUPPORTED", failure: null })
  const fail = (failure: ConductFailure): ConductAssessment => ({ ...base, verdict: "MISMATCH", failure })
  const followed = input.status === "FOLLOWED"
  const observedDeviation = input.status === "NOT_FOLLOWED" && input.evidenceType !== "OMISSION"
  if (!followed && !observedDeviation) return { ...base, verdict: "NOT_REQUIRED", failure: null }
  // O especialista só pode RESTRINGIR: dedução nunca é prova; "cumprida" com fala de OUTRA conduta não se sustenta.
  if (declared && !relationSupports(input.status, declared.relation)) return fail("DECLARED_RELATION_INCOMPATIBLE")
  if (declared?.role === "CUSTOMER_RESPONSE") return fail("DECLARED_ROLE_INCOMPATIBLE")

  if (required === "CONDITION_CHECK") {
    const checked = checkActTurns.length > 0 || questionTurns.length > 0
    if (followed) {
      if (declared && (declared.role === "RESULT_ASSERTED" || declared.role === "PROMISE_MADE" || declared.role === "INFORMATION_PROVIDED") && !checked) return fail("ASSERTED_RESULT_IS_NOT_VALIDATION")
      if (!checked) return fail(assertionTurns.length > 0 || input.evidence.some((unit) => /(?<!\p{L})(?:dispon\p{L}*|liberad\p{L}*|habilitad\p{L}*|elegivel)(?!\p{L})/u.test(fold(unit.text))) ? "ASSERTED_RESULT_IS_NOT_VALIDATION" : "OBSERVED_ACTION_NOT_PROVEN")
      return pass()
    }
    // Não cumprida: a fala citada não pode ser justamente a checagem feita.
    return checked ? fail("EVIDENCE_ACTION_MISMATCH") : pass()
  }
  if (required === "PROHIBITION") {
    if (followed) return abstentionTurns.length > 0 ? pass() : fail("PROHIBITION_COMPLIANCE_NOT_PROVEN")
    // Não cumprida: a evidência precisa FAZER o proibido — uma abstenção citada contradiz a acusação.
    if (abstentionTurns.length > 0 && assertionTurns.every((turn) => abstentionTurns.includes(turn))) return fail("EVIDENCE_ACTION_MISMATCH")
    if (WITHOUT_VALIDATION.test(fold(obligation ?? "")) && priorCheckTurns.length > 0) return fail("EVIDENCE_ACTION_MISMATCH")
    return pass()
  }
  return { ...base, verdict: "NOT_REQUIRED", failure: null }
}

/** Papéis que podem sustentar uma CHECAGEM cumprida (o resultado afirmado nunca: P0 da Golden Demo "Argumentário"). */
const CHECK_ROLES: readonly EvidenceRole[] = ["QUESTION_ASKED", "CONDITION_VALIDATED", "ACTION_PERFORMED"]
/**
 * MONITORING V2 — conduta DECLARADA (contrato V5). O especialista, com a chamada inteira, já disse o papel da fala e a relação com a
 * conduta; aqui não se reconstrói semântica por termos. Ficam só as provas objetivas que já barraram erro real:
 *   CHECAGEM cumprida   papel de checagem/pergunta E, na fala, um ato de checagem ("verifiquei", "vou verificar") ou uma pergunta ("?")
 *                       — "essa opção está disponível" nunca vira verificação, qualquer que seja o papel declarado;
 *   CHECAGEM não cumprida  a fala citada não pode ser o próprio ato de checagem;
 *   PROIBIÇÃO cumprida  abstenção explícita (negação na fala) — ausência de falha não é ponto forte;
 *   relação             cumprida = EQUIVALENT; não cumprida = DIFFERENT/EQUIVALENT; INFERRED nunca sustenta; fala do cliente nunca.
 */
function assessDeclaredConduct(input: ConductInput): ConductAssessment {
  const { required, obligation } = requiredConductOf(input.stepText)
  const checkActTurns = input.evidence.filter((unit) => isCheckAct(unit.text)).map((unit) => unit.turnRef)
  const questionTurns = input.evidence.filter((unit) => unit.text.includes("?")).map((unit) => unit.turnRef)
  const abstentionTurns = input.evidence.filter((unit) => NEGATION.test(fold(unit.text))).map((unit) => unit.turnRef)
  const declared = input.declared ?? null
  const base = { version: EVIDENCE_CONDUCT_VERSION, required, obligation, cues: { checkActTurns, questionTurns, abstentionTurns, assertionTurns: [] as string[], priorCheckTurns: [] as string[] }, declared, claimedStatus: input.status } as const
  const pass = (): ConductAssessment => ({ ...base, verdict: "SUPPORTED", failure: null })
  const fail = (failure: ConductFailure): ConductAssessment => ({ ...base, verdict: "MISMATCH", failure })
  const followed = input.status === "FOLLOWED"
  if (!followed && !(input.status === "NOT_FOLLOWED" && input.evidenceType !== "OMISSION")) return { ...base, verdict: "NOT_REQUIRED", failure: null }
  if (!declared || !relationSupports(input.status, declared.relation)) return fail("DECLARED_RELATION_INCOMPATIBLE")
  if (declared.role === "CUSTOMER_RESPONSE") return fail("DECLARED_ROLE_INCOMPATIBLE")
  const checked = checkActTurns.length > 0 || questionTurns.length > 0
  if (required === "CONDITION_CHECK") {
    if (followed) return CHECK_ROLES.includes(declared.role) && checked ? pass() : fail("ASSERTED_RESULT_IS_NOT_VALIDATION")
    return checkActTurns.length > 0 ? fail("EVIDENCE_ACTION_MISMATCH") : pass()
  }
  if (required === "PROHIBITION" && followed) return abstentionTurns.length > 0 ? pass() : fail("PROHIBITION_COMPLIANCE_NOT_PROVEN")
  return required === "NONE" ? { ...base, verdict: "NOT_REQUIRED", failure: null } : pass()
}

/**
 * PARÁFRASE sustentada (âncora `SEMANTIC_CONDUCT`): a regra e a fala têm poucas palavras em comum, mas (1) a conduta exigida está
 * sustentada pelas pistas estruturais (ou a etapa não exige conduta específica), (2) o especialista declarou a relação compatível com o
 * status (EQUIVALENT na cumprida; DIFFERENT ou EQUIVALENT na descumprida) e
 * (3) há ao menos um termo próprio ou uma classe de objeto em comum (prazo concreto para "prazo") — nunca relação vazia.
 */
export function semanticConductAnchorOf(input: { conduct: ConductAssessment; stepText: string; evidence: readonly Unit[] }): { anchored: boolean; sharedTerms: string[]; objectClasses: string[]; reason: string | null } {
  const { conduct } = input
  if (conduct.verdict === "MISMATCH") return { anchored: false, sharedTerms: [], objectClasses: [], reason: conduct.failure }
  if (!conduct.declared || !relationSupports(conduct.claimedStatus ?? "FOLLOWED", conduct.declared.relation)) return { anchored: false, sharedTerms: [], objectClasses: [], reason: "RELATION_NOT_DECLARED" }
  const own = obligationTermsOf(conduct.obligation ?? input.stepText)
  const evidenceTerms = new Set(input.evidence.flatMap((unit) => [...terms(unit.text)]))
  const sharedTerms = [...own].filter((term) => evidenceTerms.has(term)).sort()
  const objectClasses: string[] = []
  if (/(?<!\p{L})prazos?(?!\p{L})/u.test(fold(conduct.obligation ?? "")) && input.evidence.some((unit) => facetPolarityOf("DEADLINE", unit.text).polarity === "FULFILLED")) objectClasses.push("DEADLINE")
  const anchored = sharedTerms.length > 0 || objectClasses.length > 0
  return { anchored, sharedTerms, objectClasses, reason: anchored ? null : "NO_SHARED_OBJECT" }
}

/**
 * ETAPA PULADA observada (`PREREQUISITE_SKIPPED`): a etapa diz "X antes de Y" (ou "X. <frase com Y>") e o operador FEZ Y — a fala
 * citada realiza a ação seguinte — sem nenhuma fala anterior com os termos próprios de X e sem ato de checagem antes. É conduta
 * OBSERVADA (o que foi feito no lugar de X), não omissão: não depende de uma etapa irmã cumprida para marcar o início do processo
 * (foi o que derrubava "Confirmar se é fatura ou parcelamento antes de orientar o aplicativo" quando o operador ia direto ao app).
 * Termos que X e Y compartilham, e os do título/abertura/documento, nunca contam.
 */
export type PrerequisiteSkip = {
  version: typeof EVIDENCE_CONDUCT_VERSION
  proven: boolean
  failure: "NO_OBLIGATION" | "NO_SUCCESSOR" | "SUCCESSOR_NOT_OBSERVED" | "OBLIGATION_UNVERIFIABLE" | "OBLIGATION_TERMS_BEFORE" | "CHECK_ACT_BEFORE" | null
  obligation: string | null
  successor: string | null
  successorTurns: string[]
  obligationTermsBefore: string[]
  checkActsBefore: string[]
  /** De onde veio a fala da ação seguinte: citada pelo especialista ou localizada pelo sistema na conversa. */
  successorSource?: "CITED" | "CONVERSATION"
}

export function prerequisiteSkipOf(input: { stepText: string; evidence: readonly Unit[]; operatorTurns: readonly Unit[]; contextTexts: readonly (string | null | undefined)[] }): PrerequisiteSkip {
  // Sem fala citada (a omissão proposta nem sempre traz o momento): o sistema procura, na conversa, a PRIMEIRA fala do operador que
  // realiza a ação seguinte — as mesmas provas valem (nada de X antes dela, nenhum ato de checagem antes).
  if (input.evidence.length === 0) return { ...prerequisiteSkipOf({ ...input, evidence: input.operatorTurns }), successorSource: "CONVERSATION" }
  return { ...prerequisiteSkipOfCited(input), successorSource: "CITED" }
}
function prerequisiteSkipOfCited(input: { stepText: string; evidence: readonly Unit[]; operatorTurns: readonly Unit[]; contextTexts: readonly (string | null | undefined)[] }): PrerequisiteSkip {
  const semantics = stepSemanticsOf(input.stepText)
  const obligation = primaryObligationOf(input.stepText)
  const base = { version: EVIDENCE_CONDUCT_VERSION, obligation, successor: null as string | null, successorTurns: [] as string[], obligationTermsBefore: [] as string[], checkActsBefore: [] as string[] }
  const fail = (failure: NonNullable<PrerequisiteSkip["failure"]>, extra: Partial<PrerequisiteSkip> = {}): PrerequisiteSkip => ({ ...base, ...extra, proven: false, failure })
  if (!semantics.primary || !obligation) return fail("NO_OBLIGATION")
  if (semantics.successors.length === 0) return fail("NO_SUCCESSOR")
  const context = new Set(input.contextTexts.flatMap((text) => (text ? [...terms(text)] : [])))
  const obligationTerms = obligationTermsOf(obligation)
  for (const successor of semantics.successors) {
    const successorTerms = new Set([...terms(successor)].filter((term) => !obligationTerms.has(term) && !context.has(term)))
    const successorTurns = input.evidence.filter((unit) => [...terms(unit.text)].some((term) => successorTerms.has(term))).map((unit) => unit.turnRef).slice(0, input.evidence === input.operatorTurns ? 1 : undefined)
    if (successorTurns.length === 0) continue
    const first = Math.min(...successorTurns.map(turnNumber))
    const ownObligation = [...obligationTerms].filter((term) => !successorTerms.has(term) && !context.has(term) && ![...terms(successor)].includes(term))
    if (ownObligation.length === 0) return fail("OBLIGATION_UNVERIFIABLE", { successor, successorTurns })
    const before = input.operatorTurns.filter((unit) => turnNumber(unit.turnRef) < first)
    const obligationTermsBefore = ownObligation.filter((term) => before.some((unit) => terms(unit.text).has(term)))
    if (obligationTermsBefore.length > 0) return fail("OBLIGATION_TERMS_BEFORE", { successor, successorTurns, obligationTermsBefore })
    const checkActsBefore = before.filter((unit) => isCheckAct(unit.text)).map((unit) => unit.turnRef)
    if (checkActsBefore.length > 0) return fail("CHECK_ACT_BEFORE", { successor, successorTurns, checkActsBefore })
    return { ...base, successor, successorTurns, proven: true, failure: null }
  }
  return fail("SUCCESSOR_NOT_OBSERVED", { successor: semantics.successors[0] ?? null })
}

/**
 * V1.7.4 — DEPENDÊNCIA DE PRÉ-REQUISITO (`PREREQUISITE_DEPENDENCY_V1`, domínio puro, sem LLM).
 *
 * Uma ação só é ponto forte quando o que a torna adequada foi cumprido. Na Golden Demo "Argumentário" (chamada 10) o operador
 * concluiu "a sua franquia acabou" SEM as validações que a regra exige e depois ofereceu o pacote adicional: a oferta, correta em
 * abstrato, foi publicada como ponto forte — mas ela se apoia na premissa que não foi validada, e o gabarito a conta como parte do
 * erro. A regra aqui é estrutural (mesma seção do mesmo documento, termos próprios em comum, ordem da conversa), nunca léxica por
 * etapa e nunca por caso:
 *
 *   PORTÃO  etapa NÃO cumprida com violação observada cuja regra condiciona algo a uma validação:
 *             "Não afirmar X sem realizar as validações"   → a parte dependente é X (a premissa afirmada sem validar);
 *             "Validar A antes de Y" / "Em caso positivo, Y" → a parte dependente é Y (o que só vale depois de A).
 *   DEPENDE etapa CUMPRIDA da MESMA seção com termo próprio da parte dependente (fora do título/abertura da seção) — e, no primeiro
 *           caso, com a fala do operador no momento da violação ou depois dela (o que veio antes não se apoiou na premissa).
 *
 * Etapa dependente não é ponto forte nem ponto de desenvolvimento: fica NOT_OBSERVABLE (`PREREQUISITE_NOT_MET`), sem item e sem
 * observação analítica. O acerto que não depende do pré-requisito continua ponto forte.
 */
export const PREREQUISITE_DEPENDENCY_VERSION = "PREREQUISITE_DEPENDENCY_V1" as const
const WITHOUT_VALIDATION_CLAUSE = /(?<!\p{L})sem\s+(?:antes\s+)?(?:(?:realizar|fazer|efetuar)\s+)?(?:as\s+|a\s+|os\s+|o\s+)?(?:valida\p{L}*|verifica\p{L}*|consulta\p{L}*|confer\p{L}*|checag\p{L}*|testes?|analis\p{L}*|diagnostic\p{L}*)/u
/** Verbos/palavras que abrem a regra e não caracterizam o assunto dela. */
const GATE_FILLER = new Set(["nao", "nunca", "jamais", "afirm", "infor", "diz", "dizer", "orien", "reali", "assoc", "relac", "neces", "desde", "caso", "posit", "negat", "manei", "forma"])
export type PrerequisiteGate = { version: typeof PREREQUISITE_DEPENDENCY_VERSION; kind: "ASSERTED_WITHOUT_VALIDATION" | "ACTION_AFTER_VALIDATION"; dependent: string; dependentTerms: string[] }

/** A regra de uma etapa não cumprida define um pré-requisito? Devolve a parte que depende dele. */
export function prerequisiteGateOf(stepText: string): PrerequisiteGate | null {
  const folded = fold(stepText)
  const without = WITHOUT_VALIDATION_CLAUSE.exec(folded)
  const make = (kind: PrerequisiteGate["kind"], dependent: string): PrerequisiteGate | null => {
    const dependentTerms = [...terms(dependent)].filter((term) => !GATE_FILLER.has(term))
    return dependentTerms.length > 0 ? { version: PREREQUISITE_DEPENDENCY_VERSION, kind, dependent: dependent.trim(), dependentTerms } : null
  }
  if (without && PROHIBITION_LEAD.test(folded.trim())) return make("ASSERTED_WITHOUT_VALIDATION", folded.slice(0, without.index))
  if (requiredConductOf(stepText).required !== "CONDITION_CHECK") return null
  const successors = stepSemanticsOf(stepText).successors
  return successors.length > 0 ? make("ACTION_AFTER_VALIDATION", successors.join(" ")) : null
}

export type PrerequisiteDependency = { version: typeof PREREQUISITE_DEPENDENCY_VERSION; gateRef: string; /** DECLARED = o especialista declarou `dependsOn` (contrato V5); os outros = inferência léxica (V4). */ kind: PrerequisiteGate["kind"] | "DECLARED"; sharedTerms: string[]; gateTurn: string | null
  /**
   * MONITORING V2 — o que se sabe do pré-requisito: NOT_MET = descumprido (a dependente cai para NOT_OBSERVABLE); UNVERIFIED = inconclusivo
   * (não verificado, ausente, inaplicável): a dependente CONTINUA com a sua evidência, mas não é conformidade — vai ao QA e fica fora da
   * analytics. Ausente = NOT_MET (histórico). Incerteza propaga incerteza, nunca falha.
   */
  state?: "NOT_MET" | "UNVERIFIED"; gateStatus?: string | null; gateReason?: string | null }
/**
 * A etapa CUMPRIDA depende do pré-requisito descumprido? `contextTexts` = título/abertura da seção e do documento (termos que só
 * dizem o assunto geral não ligam duas etapas). `gateTurns` = falas do operador que provam a violação.
 */
export function prerequisiteDependencyOf(input: { gateRef: string; gate: PrerequisiteGate; stepText: string; evidenceTurns: readonly string[]; gateTurns: readonly string[]; /** Falas do operador que provam a violação. */ gateEvidence?: readonly string[]; contextTexts: readonly (string | null | undefined)[] }): PrerequisiteDependency | null {
  const context = new Set(input.contextTexts.flatMap((text) => (text ? [...terms(text)] : [])))
  const step = terms(input.stepText)
  // Premissa afirmada sem validação: só o que o operador DE FATO afirmou ("a sua franquia acabou" → franquia) — o sintoma que a regra
  // também cita ("falta de conexão") é o que se investiga, não a conclusão sem validação.
  const asserted = input.gate.kind === "ASSERTED_WITHOUT_VALIDATION" && input.gateEvidence ? new Set(input.gateEvidence.flatMap((text) => [...terms(text)])) : null
  const sharedTerms = input.gate.dependentTerms.filter((term) => step.has(term) && !context.has(term) && (asserted === null || asserted.has(term)))
  if (sharedTerms.length === 0) return null
  const gateTurn = input.gateTurns.length > 0 ? input.gateTurns.reduce((first, turn) => (turnNumber(turn) < turnNumber(first) ? turn : first)) : null
  if (input.gate.kind === "ASSERTED_WITHOUT_VALIDATION") {
    // O acerto anterior à premissa sem validação não se apoiou nela.
    if (gateTurn === null || input.evidenceTurns.length === 0 || !input.evidenceTurns.every((turn) => turnNumber(turn) >= turnNumber(gateTurn))) return null
  }
  return { version: PREREQUISITE_DEPENDENCY_VERSION, gateRef: input.gateRef, kind: input.gate.kind, sharedTerms, gateTurn }
}
