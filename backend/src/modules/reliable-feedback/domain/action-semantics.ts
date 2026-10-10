import { stripListMarker } from "../../knowledge/domain/knowledge-list.js"
import { infinitiveOfConjugated, isInfinitive, KNOWN_ACTION_VERBS } from "./portuguese-verbs.js"

/**
 * V1.7.1i — SEMÂNTICA DE AÇÃO DA ETAPA (`ACTION_SEMANTICS_V1`, domínio puro, vocabulário FECHADO, sem LLM).
 *
 * A âncora estruturada exigia que palavras do TÍTULO da seção ("Serviços digitais não reconhecidos") aparecessem na conversa —
 * no smoke V1.7.1h, "já tirei a renovação" (etapa "Cancelar a recorrência") foi ao QA porque a chamada nunca disse "serviço".
 * A relação agora é de IDENTIDADE OPERACIONAL entre a etapa e a fala, nunca similaridade textual genérica:
 *
 *   FAMÍLIA DO VERBO  o infinitivo que abre a etapa pertence a uma família de ação; cada família lista as FORMAS que a
 *                     realizam na fala ("Cancelar" → cancelei, desativei, tirei, removi, suspendi…). Fora das famílias = sem
 *                     semântica (a etapa só ancora pelo próprio verbo).
 *   CLASSE DO OBJETO  termos do objeto da etapa pertencem a uma classe ("recorrência" ≈ renovação, assinatura, mensalidade);
 *                     a fala que cita OUTRA classe conhecida e nunca a da etapa é ação sobre outro objeto (OBJECT_MISMATCH).
 *
 * É só a classificação "fala → etapa canônica" — não autoriza causa nem fato novo; afirmações continuam presas à regra literal.
 *
 * V1.7.1k:
 *   IMPERATIVO        etapas de checklist no imperativo ("confirme", "informe", "explique") têm o mesmo verbo do infinitivo —
 *                     só entre verbos CONHECIDOS (famílias + lista fechada), nunca "qualquer palavra terminada em -e".
 *   AÇÃO × ESTADO     "desativei a renovação" é AÇÃO do operador; "a renovação foi/já foi/ficou desativada" é ESTADO descrito
 *                     (particípio da família depois de foi/foram/está/ficou…, com o objeto da etapa na mesma fala). Os dois
 *                     representam o mesmo estado operacional verificável, mas o estado SOZINHO nunca prova que foi o próprio
 *                     operador quem executou (`agency`).
 *   SOLUÇÃO APLICADA  etapa cujo objeto é "a solução aplicada" ("confirme a solução aplicada") se realiza quando a fala declara
 *                     uma ação concluída de uma família operacional ("registrei a contestação", "a renovação já foi tirada").
 */
export const ACTION_SEMANTICS_VERSION = "ACTION_SEMANTICS_V1" as const

export type ActionFamily = "CANCEL" | "REGISTER" | "INFORM" | "VERIFY" | "ASK" | "ACTIVATE" | "CONFIRM" | "TRANSFER"
export type ObjectClass = "RECURRENCE" | "PORTABILITY" | "PROTOCOL" | "DEADLINE" | "DISPUTE" | "ADJUSTED_BILL" | "BLOCK" | /** V1.7.1k */ "APPLIED_SOLUTION" | /** V1.7.1m */ "HOLDER" | /** V1.7.1m */ "PAYMENT"

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const wordsOf = (text: string) => fold(text).match(/\p{L}+/gu) ?? []

/** Infinitivos (dobrados) de cada família e os RADICAIS que realizam a ação na fala. */
const FAMILIES: Record<ActionFamily, { infinitives: string[]; stems: string[] }> = {
  CANCEL: { infinitives: ["cancelar", "desativar", "remover", "retirar", "suspender", "interromper", "excluir"], stems: ["cancel", "desativ", "remov", "retir", "suspend", "interromp", "exclu", "tirei", "tirou", "tiramos", "tirar", "tirando", "tirado"] },
  REGISTER: { infinitives: ["registrar", "abrir", "protocolar", "lancar", "formalizar"], stems: ["registr", "abri", "abert", "protocol", "lanc", "formaliz"] },
  INFORM: { infinitives: ["informar", "explicar", "orientar", "comunicar", "esclarecer", "recapitular", "resumir"], stems: ["inform", "explic", "orient", "comunic", "esclarec", "recapitul", "resum"] },
  // V1.7.1m — "identificar" e as formas de ter ENCONTRADO algo ("achei aqui", "encontrei") — formas exatas, nunca radical livre.
  VERIFY: { infinitives: ["verificar", "consultar", "conferir", "checar", "analisar", "localizar", "validar", "identificar", "comparar"], stems: ["verific", "consult", "confer", "chec", "analis", "localiz", "valid", "identific", "compar", "achei", "encontrei"] },
  ASK: { infinitives: ["perguntar", "questionar", "solicitar", "pedir"], stems: ["pergunt", "question", "solicit", "ped"] },
  ACTIVATE: { infinitives: ["ativar", "habilitar", "incluir", "aplicar"], stems: ["ativ", "habilit", "inclu", "aplic"] },
  CONFIRM: { infinitives: ["confirmar", "certificar"], stems: ["confirm", "certific"] },
  TRANSFER: { infinitives: ["transferir", "encaminhar", "direcionar"], stems: ["transfer", "encaminh", "direcion"] },
}
/** Termos (dobrados) de cada classe de objeto — o objeto da etapa e o objeto de que a fala trata. */
const OBJECTS: Record<ObjectClass, string[]> = {
  RECURRENCE: ["recorrencia", "renovacao", "assinatura", "mensalidade", "recorrente", "renovar"],
  PORTABILITY: ["portabilidade"],
  PROTOCOL: ["protocolo"],
  DEADLINE: ["prazo", "prazos"],
  DISPUTE: ["contestacao", "contestar", "contestei", "reclamacao"],
  ADJUSTED_BILL: ["ajustada", "ajuste", "reemitida", "corrigida"],
  BLOCK: ["bloqueio", "bloquear", "bloqueei"],
  APPLIED_SOLUTION: ["solucao", "resolucao"],
  // V1.7.1m — quem é o titular (validação de segurança) e o pagamento da conta (conferência).
  HOLDER: ["titular", "titularidade", "cpf", "nascimento"],
  PAYMENT: ["paga", "pago", "pagas", "pagos", "pagou", "pagaram", "paguei", "pagamento", "pagar"],
}

/** V1.7.1k — radicais de PARTICÍPIO (estado resultante) das famílias que mudam algo no sistema. */
const STATE_STEMS: Partial<Record<ActionFamily, string[]>> = {
  CANCEL: ["cancelad", "desativad", "removid", "retirad", "suspens", "interrompid", "excluid", "tirad"],
  REGISTER: ["registrad", "abert", "protocolad", "lancad", "formalizad"],
  ACTIVATE: ["ativad", "habilitad", "incluid", "aplicad"],
  TRANSFER: ["transferid", "encaminhad", "direcionad"],
}
const STATE_AUX = new Set(["foi", "foram", "esta", "estao", "ta", "ficou", "ficaram", "fica", "ficam", "sido", "estava"])
/** Famílias cuja ação concluída é "uma solução aplicada" (muda algo para o cliente). */
const SOLUTION_FAMILIES: readonly ActionFamily[] = ["CANCEL", "REGISTER", "ACTIVATE", "TRANSFER"]
const ALL_INFINITIVES = new Set([...Object.values(FAMILIES).flatMap((family) => family.infinitives), ...KNOWN_ACTION_VERBS])

/** V1.7.1k — verbo que abre a etapa, no INFINITIVO (dobrado): infinitivo ou imperativo de verbo conhecido; senão null. */
export function leadingVerbOf(stepText: string): string | null {
  const first = stripListMarker(stepText).trim().split(/\s+/)[0]
  if (!first) return null
  if (isInfinitive(first) || /^\p{L}{3,}(?:ar|er|ir)$/u.test(fold(first))) return fold(first)
  const infinitive = infinitiveOfConjugated(fold(first), ALL_INFINITIVES)
  return infinitive ? fold(infinitive) : null
}

/** Formas de ESTADO ("foi desativada", "já foi tirada", "ficou cancelado") de uma família numa fala. */
function stateFormsIn(family: ActionFamily, text: string): string[] {
  const stems = STATE_STEMS[family] ?? []
  const words = wordsOf(text)
  return words.filter((word, index) => stems.some((stem) => word.startsWith(stem)) && [words[index - 1], words[index - 2]].some((before) => before !== undefined && STATE_AUX.has(before)))
}

/** 1ª pessoa do pretérito ("registrei", "tirei", "abri") de uma família numa fala. */
function firstPersonPastIn(family: ActionFamily, text: string): string[] {
  const stems = FAMILIES[family].stems
  return wordsOf(text).filter((word) => (/ei$/u.test(word) || word === "abri" || /u[íi]$/u.test(word)) && stems.some((stem) => stem.length >= 3 && word.startsWith(stem.replace(/ei$/u, ""))))
}

/** A fala declara uma ação CONCLUÍDA que aplica solução (ação do operador ou estado resultante com objeto conhecido)? */
export function completedActionDeclared(texts: readonly string[]): boolean {
  return texts.some((text) => SOLUTION_FAMILIES.some((family) => firstPersonPastIn(family, text).length > 0 || (stateFormsIn(family, text).length > 0 && objectClassesOf(text).some((key) => key !== "APPLIED_SOLUTION"))))
}

/**
 * V1.7.1k — o ESTADO operacional ("serviço cancelado") aparece na fala, por AÇÃO do operador (1ª pessoa do pretérito da família)
 * OU por estado descrito com um dos `objectTerms` na mesma fala. `agency` separa quem executou (só a ação prova o operador).
 */
export function operationalStateIn(family: ActionFamily, objectTerms: readonly string[], texts: readonly string[]): { observed: boolean; agency: "OPERATOR_ACTION" | "STATE_ONLY" | null; forms: string[] } {
  let agency: "OPERATOR_ACTION" | "STATE_ONLY" | null = null
  const forms: string[] = []
  for (const text of texts) {
    const words = new Set(wordsOf(text))
    // A AÇÃO do operador vale como antes (a forma da família basta: "tirei o Clube de Jogos"); o ESTADO descrito só com o objeto
    // na mesma fala ("a renovação já foi tirada") — particípio solto ("foi ativado no dia 2") nunca é o estado da etapa.
    const actions = firstPersonPastIn(family, text)
    const states = objectTerms.some((term) => words.has(term)) ? stateFormsIn(family, text) : []
    forms.push(...actions, ...states)
    if (actions.length > 0) agency = "OPERATOR_ACTION"
    else if (states.length > 0 && agency === null) agency = "STATE_ONLY"
  }
  return { observed: agency !== null, agency, forms: [...new Set(forms)] }
}

export type StepAction = { version: typeof ACTION_SEMANTICS_VERSION; verb: string | null; family: ActionFamily | null; objectClasses: ObjectClass[] }

const objectClassesOf = (text: string): ObjectClass[] => {
  const words = new Set(wordsOf(text))
  return (Object.keys(OBJECTS) as ObjectClass[]).filter((key) => OBJECTS[key].some((term) => words.has(term)))
}

/** Ação canônica de uma linha de etapa ("1. Cancelar a recorrência, quando permitido;" → CANCEL × RECURRENCE). */
export function stepActionOf(stepText: string): StepAction {
  const body = stripListMarker(stepText).replace(/,\s*(?:quando|se|caso|desde\s+que)(?!\p{L}).*$/iu, "").trim()
  const [, ...rest] = body.split(/\s+/)
  const verb = leadingVerbOf(body)
  const family = verb ? ((Object.keys(FAMILIES) as ActionFamily[]).find((key) => FAMILIES[key].infinitives.includes(verb)) ?? null) : null
  return { version: ACTION_SEMANTICS_VERSION, verb, family, objectClasses: objectClassesOf(verb ? rest.join(" ") : body) }
}

const PARTICIPLE = /(?:ad|id)[oa]s?$/u
const PASSIVE_AUX = new Set(["foi", "foram", "esta", "estava", "estao", "estavam", "sido", "era", "eram", "fica", "ficou", "e"])

/** V1.7.1k — `stateForms`: estado descrito ("foi desativada") com o objeto da etapa; `agency`: ação do operador × só estado. */
export type ActionRelation = { verbForms: string[]; objectClasses: ObjectClass[]; mismatchedObjects: ObjectClass[]; related: boolean; objectMismatch: boolean; stateForms?: string[]; agency?: "OPERATOR_ACTION" | "STATE_ONLY" | null }

/**
 * Relação entre a ação da etapa e as falas VERIFICADAS do operador: forma da família do verbo OU objeto da mesma classe na fala.
 * OBJECT_MISMATCH: a etapa tem classe de objeto conhecida, a fala cita outra classe conhecida e nunca a da etapa.
 */
export function actionRelationOf(step: StepAction, operatorTexts: readonly string[]): ActionRelation {
  const stems = step.family ? FAMILIES[step.family].stems : step.verb ? [step.verb.replace(/(?:ar|er|ir)$/u, "")] : []
  // Particípio DESCRITIVO ("foi ativado no dia 2", "estava cancelada") descreve o estado, não é ação do operador.
  const performed = operatorTexts.flatMap((text) => { const words = wordsOf(text); return words.filter((word, index) => !(PARTICIPLE.test(word) && PASSIVE_AUX.has(words[index - 1] ?? ""))) })
  const verbForms = [...new Set(performed.filter((word) => stems.some((stem) => stem.length >= 3 && word.startsWith(stem))))]
  const spoken = objectClassesOf(operatorTexts.join(" "))
  // V1.7.1k — "a solução aplicada" se realiza quando a fala declara uma ação concluída (não por uma palavra "solução").
  if (step.objectClasses.includes("APPLIED_SOLUTION") && !spoken.includes("APPLIED_SOLUTION") && completedActionDeclared(operatorTexts)) spoken.push("APPLIED_SOLUTION")
  const objectClasses = spoken.filter((key) => step.objectClasses.includes(key))
  const mismatchedObjects = step.objectClasses.length > 0 && objectClasses.length === 0 ? spoken.filter((key) => !step.objectClasses.includes(key)) : []
  const objectMismatch = mismatchedObjects.length > 0
  // V1.7.1k — ESTADO descrito com o objeto da etapa na mesma fala (não prova quem executou).
  const stateForms = step.family ? [...new Set(operatorTexts.filter((text) => objectClassesOf(text).some((key) => step.objectClasses.includes(key))).flatMap((text) => stateFormsIn(step.family!, text)))] : []
  const agency = verbForms.length > 0 ? "OPERATOR_ACTION" as const : stateForms.length > 0 ? "STATE_ONLY" as const : null
  return { verbForms, objectClasses, mismatchedObjects, related: !objectMismatch && (verbForms.length > 0 || stateForms.length > 0 || objectClasses.length > 0), objectMismatch, stateForms, agency }
}

/**
 * V1.7.1o — ITEM A PERGUNTAR com SEMÂNTICA TIPADA (`ASKED_ITEM_SEMANTICS_V1`, vocabulário FECHADO, sem stemming livre).
 *
 * No smoke V1.7.1n o item "Se a conta já foi paga" (a lista pede que o cliente explique) não reconheceu a pergunta "Você já pagou
 * alguma dessas faturas?": a checagem só comparava palavras ("paga" × "pagou", "conta" × "faturas"). Aqui o item e a pergunta
 * convergem pela MESMA intenção operacional, com as classes de objeto que já existem (`OBJECTS`: PAYMENT = paga/pago/pagou/
 * pagamento/pagar…) + o ASSUNTO da conferência (BILL: conta/fatura/boleto; "cobrança" só junto de pagamento):
 *
 *   intenção do item    classes de objeto da linha do item (PAYMENT…) + assunto (BILL) quando o item nomeia um;
 *   pergunta            uma FRASE da fala do operador terminada em "?" (afirmação — "Eu já paguei a conta.", "A conta aparece
 *                       como paga no sistema." — nunca prova que o operador perguntou);
 *   ação + objeto       a pergunta traz a MESMA classe do item E o mesmo assunto — explícito ("essas faturas", "essa cobrança")
 *                       ou por anáfora ("alguma delas", "dessas") quando as falas imediatamente anteriores nomeiam o assunto.
 *                       Só o verbo não basta: "Você pagou o serviço com cartão?" não é a conferência da conta.
 * O matcher só PROVA que a fala evidencia a etapa já escolhida pelo checkpointRef — nunca escolhe etapa nem comportamento.
 */
export const ASKED_ITEM_SEMANTICS_VERSION = "ASKED_ITEM_SEMANTICS_V1" as const
export type AskedSubject = "BILL"
const SUBJECT_TERMS: Record<AskedSubject, string[]> = { BILL: ["conta", "contas", "fatura", "faturas", "boleto", "boletos"] }
/** "cobrança" é o assunto só quando a pergunta é sobre PAGAMENTO ("Você já pagou essa cobrança?"). */
const PAYMENT_SUBJECT_TERMS = ["cobranca", "cobrancas"]
const ANAPHORA = new Set(["dela", "delas", "dele", "deles", "dessa", "dessas", "desse", "desses", "essa", "essas", "esse", "esses", "ela", "elas", "ele", "eles"])
/** Classes que descrevem o ASSUNTO de uma pergunta (as demais — recorrência, portabilidade… — não servem de conferência aqui). */
const ASKABLE_CLASSES: readonly ObjectClass[] = ["PAYMENT", "PROTOCOL", "DEADLINE", "RECURRENCE", "PORTABILITY", "BLOCK", "ADJUSTED_BILL"]

export type AskedItemIntent = { classes: ObjectClass[]; subjects: AskedSubject[] }
const subjectsIn = (words: ReadonlySet<string>, classes: readonly ObjectClass[]): AskedSubject[] =>
  (Object.keys(SUBJECT_TERMS) as AskedSubject[]).filter((key) => SUBJECT_TERMS[key].some((term) => words.has(term)) || (key === "BILL" && classes.includes("PAYMENT") && PAYMENT_SUBJECT_TERMS.some((term) => words.has(term))))

/** Intenção tipada de um item a perguntar (null = o item não tem classe tipada: continua a comparação por palavras). */
export function askedItemIntentOf(itemText: string): AskedItemIntent | null {
  const classes = objectClassesOf(itemText).filter((key) => ASKABLE_CLASSES.includes(key))
  if (classes.length === 0) return null
  return { classes, subjects: subjectsIn(new Set(wordsOf(itemText)), classes) }
}

export type AskedItemMatch = { version: typeof ASKED_ITEM_SEMANTICS_VERSION; question: string; classes: ObjectClass[]; subject: AskedSubject | null; via: "EXPLICIT" | "ANAPHORA" | "NO_SUBJECT" }
/** A fala do operador PERGUNTA o item (frase interrogativa com a mesma classe e o mesmo assunto)? `preceding` = falas anteriores (mais recente por último). */
export function askedItemMatchOf(itemText: string, speech: string, preceding: readonly string[] = []): AskedItemMatch | null {
  const intent = askedItemIntentOf(itemText)
  if (!intent) return null
  const questions = speech.split(/(?<=[.!?…])\s+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.endsWith("?"))
  for (const question of questions) {
    const classes = objectClassesOf(question).filter((key) => intent.classes.includes(key))
    if (classes.length === 0) continue
    if (intent.subjects.length === 0) return { version: ASKED_ITEM_SEMANTICS_VERSION, question, classes, subject: null, via: "NO_SUBJECT" }
    const words = new Set(wordsOf(question))
    const explicit = subjectsIn(words, classes).find((subject) => intent.subjects.includes(subject))
    if (explicit) return { version: ASKED_ITEM_SEMANTICS_VERSION, question, classes, subject: explicit, via: "EXPLICIT" }
    // Anáfora ("alguma delas", "dessas") só com o assunto nomeado nas falas imediatamente anteriores.
    if ([...words].some((word) => ANAPHORA.has(word))) {
      const context = preceding.slice(-2).flatMap((text) => subjectsIn(new Set(wordsOf(text)), classes))
      const referred = context.find((subject) => intent.subjects.includes(subject))
      if (referred) return { version: ASKED_ITEM_SEMANTICS_VERSION, question, classes, subject: referred, via: "ANAPHORA" }
    }
  }
  return null
}

/** Família de ação de uma frase de abertura de lista ("Antes de encerrar, informar:" → INFORM). */
export function familyOfAction(action: string): ActionFamily | null {
  const verb = leadingVerbOf(action) ?? ""
  return (Object.keys(FAMILIES) as ActionFamily[]).find((key) => FAMILIES[key].infinitives.includes(verb)) ?? null
}

/**
 * V1.7.1l — AÇÃO CANÔNICA CONFIRM_UNDERSTANDING (vocabulário FECHADO, sem similaridade aberta, sem stemming genérico).
 *
 * "As informações ficaram claras?" (base) × "Ficou claro pra você…?" (fala) é o MESMO ato — perguntar ao cliente se entendeu —
 * e ia ao QA só por flexão (ficou/ficaram, claro/claras). O ato é reconhecido pela INTENÇÃO + OBJETO numa PERGUNTA do operador,
 * entre formulações controladas; formato interrogativo sozinho nunca basta ("Qual cobrança você não reconhece?", "Seu telefone
 * continua sendo…?" e "Posso te ajudar em mais alguma coisa?" não são confirmação de entendimento).
 */
export const UNDERSTANDING_CHECK_VERSION = "CONFIRM_UNDERSTANDING_V1" as const
const CLEAR = "(?:claro|clara|claros|claras)"
const UNDERSTANDING_FORMULATIONS: readonly RegExp[] = [
  new RegExp(`(?<!\\p{L})(?:ficou|ficaram|fica|ficam|esta|estao|ta|tao|foi|foram)\\s+(?:tudo\\s+|bem\\s+)?${CLEAR}(?!\\p{L})`, "u"),
  /(?<!\p{L})(?:ficou|restou|restaram|resta|restam|tem|ha|teria|existe|sobrou)\s+(?:mais\s+)?(?:alguma|algum)\s+duvidas?(?!\p{L})/u,
  /^\W*(?:e\s+)?(?:mais\s+)?(?:alguma|algum)\s+duvidas?(?!\p{L})/u,
  /(?<!\p{L})(?:conseguiu|consegui|deu\s+(?:pra|para))\s+(?:me\s+)?entender(?!\p{L})/u,
  /(?<!\p{L})(?:voce|vc)\s+entendeu(?!\p{L})/u,
  /(?<!\p{L})ficou\s+entendido(?!\p{L})/u,
]
/** Etapa que PEDE confirmar entendimento (item de checklist/regra): "confirme se o cliente tem mais alguma dúvida", "Confirmei se restaram dúvidas?". */
const UNDERSTANDING_STEP = /(?<!\p{L})(?:confirm\p{L}*|verific\p{L}*|pergunt\p{L}*|certific\p{L}*)\s+(?:o\s+|a\s+)?(?:entendimento|compreensao|(?:se\s+).*(?:duvidas?|entend\p{L}*|compreend\p{L}*|clar[oa]s?))(?!\p{L})/u

/** A fala é uma PERGUNTA do operador que confirma o entendimento do cliente (formulação controlada)? */
export function isUnderstandingCheckQuestion(text: string): boolean {
  if (!text.includes("?")) return false
  const folded = fold(text)
  return UNDERSTANDING_FORMULATIONS.some((pattern) => pattern.test(folded))
}

/** A etapa canônica é CONFIRM_UNDERSTANDING? A própria linha é uma formulação controlada, pede confirmar entendimento/dúvidas,
 * ou é item a perguntar de uma seção de confirmação de entendimento. */
export function isUnderstandingCheckStep(stepText: string, context: { understandingSection?: boolean; asksToAsk?: boolean } = {}): boolean {
  const body = fold(stripListMarker(stepText))
  if (UNDERSTANDING_FORMULATIONS.some((pattern) => pattern.test(body)) || UNDERSTANDING_STEP.test(body)) return true
  return Boolean(context.understandingSection && context.asksToAsk && /[“"«?]/.test(stepText))
}
