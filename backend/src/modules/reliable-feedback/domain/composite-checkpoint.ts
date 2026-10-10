import { familyOfAction, type ActionFamily } from "./action-semantics.js"
import { ruleActionOf } from "./behavior-presentation.js"
import { isConditionalStep, terms } from "./verified-omission.js"
import { cancellationEvidenceOf, reliableAbsenceOf, resolutionOutcomeStateOf, subItemBlocksAbsence, subItemKindOf, subItemMatches, subItemPreconditionOf, type SubItemKind } from "./subitem-semantics.js"

/**
 * V1.7.1i — ETAPA COMPOSTA (`COMPOSITE_CHECKPOINT_V1`, domínio puro, sem LLM).
 *
 * No smoke V1.7.1h a recapitulação ("Antes de encerrar, informar: conta analisada; lançamento contestado; valor; … prazo; canal
 * de retorno; protocolo") cobriu cerca de 4 dos 10 itens, o especialista marcou a etapa inteira como cumprida e ela saiu como
 * ponto forte. Um subconjunto observado NÃO prova cumprimento integral.
 *
 *   COMPOSTA        a regra citada é UMA frase de abertura + uma lista de ≥ 2 itens que o OPERADOR executa: dizer ao cliente
 *                   (família INFORM: informar/explicar/orientar/recapitular…) ou conferir (família VERIFY: verificar/consultar…).
 *                   "Permitir que o cliente explique: …" não é composta (os itens são do cliente, não todos obrigatórios).
 *   ITEM            OBSERVED         o conteúdo do item na fala verificada que a etapa citou — V1.7.1j: pelo DETECTOR do tipo do
 *                                    item (`subitem-semantics.ts`: dinheiro, prazo, protocolo, canal…) ou todas as palavras dele;
 *                   OBSERVED_ELSEWHERE dito na chamada, fora da etapa (nunca ausente, nunca "feito na etapa");
 *                   VERIFIED_ABSENT  só em INFORM: transcrição completa, a etapa aconteceu (oportunidade) e NENHUM termo próprio
 *                                    do item aparece em fala nenhuma do operador na chamada — dizer é observável na fala;
 *                                    em VERIFY (conferência no sistema) ausência na fala nunca prova ausência;
 *                   CONDITIONAL      "quando aplicável", "se houver"… — condição que a conversa não mostra;
 *                   NOT_VERIFIABLE   item que nomeia CATEGORIA ("Ação realizada") — a fala não prova nem nega;
 *                   UNKNOWN          o resto (termo dito em outro momento, só parte dos termos) — nunca acusação.
 *   COMPLETUDE      COMPLETE (todo item verificável e não condicional observado) · PARTIAL (≥ 1 observado e ≥ 1 verificadamente ausente) ·
 *                   UNKNOWN (nem completo nem ausência provada).
 *
 * Efeito (process-assessment): cumprida + PARTIAL ⇒ NÃO cumprida (motivo COMPOSITE_PARTIAL, nunca ponto forte); cumprida +
 * UNKNOWN ⇒ continua cumprida, mas só com QA (COMPOSITE_COMPLETENESS_UNVERIFIED) e fora do histórico de "cumpriu".
 */
export const COMPOSITE_CHECKPOINT_VERSION = "COMPOSITE_CHECKPOINT_V1" as const

/** V1.7.1j: OBSERVED_ELSEWHERE = o conteúdo do item apareceu na chamada, mas FORA da etapa (ex.: o valor dito no começo, não na
 * recapitulação) — não conta como feito na etapa e nunca vira "ausente". */
/** NOT_APPLICABLE (SUBITEM_APPLICABILITY_V1): o item dependia de um resultado que a própria conversa mostra que ainda não existia
 * (análise pendente) — não é cobrado, não conta para a completude e nunca vira "não informou". */
export type SubItemStatus = "OBSERVED" | "OBSERVED_ELSEWHERE" | "VERIFIED_ABSENT" | "CONDITIONAL" | "NOT_VERIFIABLE" | "NOT_APPLICABLE" | "UNKNOWN"
export type CompositeCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN"
/** `conditional` (V1.7.1j): item condicional ("quando aplicável") — observado continua OBSERVED, sem perder a natureza condicional. */
/** `agency` (V1.7.1k): para itens de AÇÃO (serviço cancelado), se a fala mostra a ação do operador ou só o estado descrito. */
export type CompositeSubItem = { text: string; status: SubItemStatus; kind?: SubItemKind; conditional?: boolean; agency?: "OPERATOR_ACTION" | "STATE_ONLY" | null; terms: string[]; observedTurns: string[]
  /** SUBITEM_APPLICABILITY_V1 — só em tipo com pré-condição e não observado: o estado do resultado e a fala que o mostra. */
  applicability?: { status: "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN"; reason: "RESOLUTION_OUTCOME_CONCLUDED" | "RESOLUTION_OUTCOME_PENDING" | "RESOLUTION_OUTCOME_NOT_EVIDENCED"; evidence: string | null } }
export type CheckpointCompleteness = {
  version: typeof COMPOSITE_CHECKPOINT_VERSION
  family: Extract<ActionFamily, "INFORM" | "VERIFY">
  status: CompositeCompleteness
  items: CompositeSubItem[]
  counts: Record<SubItemStatus, number>
}

/** Termos que nomeiam CATEGORIA, não conteúdo ("Ação realizada", "Demais informações"): o item não é verificável pela fala. */
const GENERIC_ITEM_TERMS = new Set(["acao", "reali", "infor", "dados", "detal", "situa", "demai", "outro", "outra", "aplic", "quand", "houve"])

/** A regra citada é composta? Devolve a família e os itens (literais, na ordem do documento). */
export function compositeListOf(quote: string | null | undefined): { family: "INFORM" | "VERIFY"; items: string[] } | null {
  const action = ruleActionOf(quote)
  if (!action || action.items.length < 2 || action.interrogativeItems) return null
  const family = familyOfAction(action.action)
  return family === "INFORM" || family === "VERIFY" ? { family, items: action.items } : null
}

export function assessCompleteness(input: {
  quote: string | null | undefined
  /** Falas VERIFICADAS do operador que a etapa citou (onde o item precisa aparecer para contar como observado). */
  evidence: readonly { turnRef: string; text: string }[]
  /** Todas as falas do operador na chamada (contraprova da ausência). */
  operatorConversation: readonly string[]
  windowComplete: boolean
}): CheckpointCompleteness | null {
  const list = compositeListOf(input.quote)
  if (!list || input.evidence.length === 0) return null
  // V1.7.1j — cada item tem um TIPO com detector positivo (dinheiro, prazo, protocolo, canal…); ausência só com detector confiável.
  const items: CompositeSubItem[] = list.items.map((text) => {
    const conditional = isConditionalStep(text)
    const kind = subItemKindOf(text)
    const own = [...terms(text.replace(/,\s*(?:quando|se|caso|desde\s+que)(?!\p{L}).*$/iu, ""))].filter((term) => !GENERIC_ITEM_TERMS.has(term))
    // Presença: tipo com detector CONFIÁVEL → só o detector ("Conta ajustada" nunca por "conta de agosto"); tipo sem detector
    // confiável ou sem tipo → detector OU TODAS as palavras do item na mesma fala ("Nome do serviço" nunca por "meu nome é…").
    const wordsForPresence = own.length > 0 ? own : [...terms(text)]
    const hits = (said: string) => { const found = terms(said); return wordsForPresence.filter((term) => found.has(term)).length }
    const allWords = (said: string) => wordsForPresence.length > 0 && hits(said) === wordsForPresence.length
    const matches = (said: string) => subItemMatches(kind, said) === true || (!reliableAbsenceOf(kind) && allWords(said))
    const observedTurns = input.evidence.filter((unit) => matches(unit.text)).map((unit) => unit.turnRef)
    // V1.7.1k — condição e observabilidade são dimensões diferentes: item condicional com evidência positiva fica OBSERVADO
    // (conditional = true), inclusive quando dito fora da etapa; só o condicional SEM evidência fica CONDITIONAL.
    const agency = kind === "CANCELED_SERVICE" ? (() => { const texts = observedTurns.length > 0 ? input.evidence.filter((unit) => observedTurns.includes(unit.turnRef)).map((unit) => unit.text) : input.operatorConversation.filter(matches); return texts.map(cancellationEvidenceOf).find((entry) => entry.agency === "OPERATOR_ACTION")?.agency ?? (texts.length > 0 ? "STATE_ONLY" as const : null) })() : undefined
    const base: Omit<CompositeSubItem, "status" | "observedTurns"> = { text, kind, conditional, terms: own, ...(agency !== undefined ? { agency } : {}) }
    if (observedTurns.length > 0) return { ...base, status: "OBSERVED", observedTurns }
    if (kind === "LEXICAL" && own.length === 0 && !conditional) return { ...base, status: "NOT_VERIFIABLE", observedTurns: [] }
    if (input.operatorConversation.some(matches)) return { ...base, status: "OBSERVED_ELSEWHERE", observedTurns: [] }
    if (conditional) return { ...base, status: "CONDITIONAL", observedTurns: [] }
    // SUBITEM_APPLICABILITY_V1 — item que só existe depois de um RESULTADO (conta ajustada, valor a pagar): antes de afirmar que
    // faltou, a condição precisa estar satisfeita. Resultado pendente na própria conversa → NÃO APLICÁVEL; sem evidência nenhuma do
    // resultado → DESCONHECIDO (nunca lacuna); resultado concluído → avaliado como sempre.
    if (subItemPreconditionOf(kind) === "RESOLUTION_OUTCOME") {
      const outcome = resolutionOutcomeStateOf(input.operatorConversation)
      if (outcome.state === "PENDING") return { ...base, status: "NOT_APPLICABLE", observedTurns: [], applicability: { status: "NOT_APPLICABLE", reason: "RESOLUTION_OUTCOME_PENDING", evidence: outcome.evidence } }
      if (outcome.state === "UNKNOWN") return { ...base, status: "UNKNOWN", observedTurns: [], applicability: { status: "UNKNOWN", reason: "RESOLUTION_OUTCOME_NOT_EVIDENCED", evidence: null } }
      Object.assign(base, { applicability: { status: "APPLICABLE", reason: "RESOLUTION_OUTCOME_CONCLUDED", evidence: outcome.evidence } })
    }
    // Ausência: só em lista de DIZER (INFORM), transcrição completa e detector CONFIÁVEL do tipo sem nenhum achado em fala nenhuma
    // do operador (o detector — não palavras genéricas como "conta" — decide).
    // V1.7.1l — fala AMBÍGUA do tipo (canal + retorno sem relação reconhecida) impede afirmar a ausência.
    const absent = list.family === "INFORM" && input.windowComplete && reliableAbsenceOf(kind) && !input.operatorConversation.some((said) => subItemBlocksAbsence(kind, said))
    return { ...base, status: absent ? "VERIFIED_ABSENT" : "UNKNOWN", observedTurns: [] }
  })
  const counts: Record<SubItemStatus, number> = { OBSERVED: 0, OBSERVED_ELSEWHERE: 0, VERIFIED_ABSENT: 0, CONDITIONAL: 0, NOT_VERIFIABLE: 0, NOT_APPLICABLE: 0, UNKNOWN: 0 }
  for (const item of items) counts[item.status] += 1
  // Só o que podia ser cobrado conta para a completude (não verificável e não aplicável ficam de fora).
  const required = items.filter((item) => !item.conditional && item.status !== "NOT_VERIFIABLE" && item.status !== "NOT_APPLICABLE")
  const status: CompositeCompleteness = required.length > 0 && required.every((item) => item.status === "OBSERVED")
    ? "COMPLETE"
    : counts.OBSERVED > 0 && counts.VERIFIED_ABSENT > 0 ? "PARTIAL" : "UNKNOWN"
  return { version: COMPOSITE_CHECKPOINT_VERSION, family: list.family, status, items, counts }
}

/**
 * MONITORING V2 — completude DECLARADA (contrato V5): a lista vem da BASE (`compositeListOf`, estrutural); o que foi coberto vem do
 * especialista (`items[].covered`), e cada "coberto" só vale com uma fala LITERAL já verificada (`verifiedTurnsOf`). Nenhum detector
 * por tipo de item. Ausência (`covered: false`) só vale numa lista de DIZER (INFORM) com a transcrição completa — a mesma fronteira
 * de sempre; o resto é desconhecido (nunca lacuna). Item declarado que não está na lista da base é ignorado (o modelo não cria item).
 */
export function declaredCompletenessOf(input: {
  quote: string | null | undefined
  declared: readonly { text: string; covered: boolean | null; evidence: readonly string[] }[] | null | undefined
  /** Confere uma fala declarada contra a transcrição (turno + falante OPERADOR); devolve o turno ou null. */
  verifiedTurnsOf: (quote: string) => string | null
  windowComplete: boolean
}): CheckpointCompleteness | null {
  const list = compositeListOf(input.quote)
  if (!list) return null
  const norm = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const items: CompositeSubItem[] = list.items.map((text) => {
    const conditional = isConditionalStep(text)
    const declared = (input.declared ?? []).find((entry) => { const a = norm(entry.text); const b = norm(text); return a.length > 0 && (a === b || a.includes(b) || b.includes(a)) }) ?? null
    const base = { text, conditional, terms: [] as string[] }
    if (declared?.covered === true) {
      const observedTurns = declared.evidence.flatMap((quote) => { const turn = input.verifiedTurnsOf(quote); return turn ? [turn] : [] })
      return observedTurns.length > 0 ? { ...base, status: "OBSERVED" as const, observedTurns } : { ...base, status: "UNKNOWN" as const, observedTurns: [] }
    }
    if (conditional) return { ...base, status: "CONDITIONAL" as const, observedTurns: [] }
    if (declared?.covered === false && list.family === "INFORM" && input.windowComplete) return { ...base, status: "VERIFIED_ABSENT" as const, observedTurns: [] }
    return { ...base, status: "UNKNOWN" as const, observedTurns: [] }
  })
  const counts: Record<SubItemStatus, number> = { OBSERVED: 0, OBSERVED_ELSEWHERE: 0, VERIFIED_ABSENT: 0, CONDITIONAL: 0, NOT_VERIFIABLE: 0, NOT_APPLICABLE: 0, UNKNOWN: 0 }
  for (const item of items) counts[item.status] += 1
  const required = items.filter((item) => !item.conditional)
  const status: CompositeCompleteness = required.length > 0 && required.every((item) => item.status === "OBSERVED") ? "COMPLETE" : counts.OBSERVED > 0 && counts.VERIFIED_ABSENT > 0 ? "PARTIAL" : "UNKNOWN"
  return { version: COMPOSITE_CHECKPOINT_VERSION, family: list.family, status, items, counts }
}
