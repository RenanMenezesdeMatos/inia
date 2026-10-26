import { createHash } from "node:crypto"
import type { ProjectedInteraction, TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import {
  assessUnit,
  isDeterminate,
  pathCompletenessOf,
  requiredScriptLinesOf,
  verifyQuotes,
  verifyScriptAssessments,
  EVIDENCE_AVAILABILITY_NOW,
  type AssessedCriterion,
  type CriterionOrigin,
  type CriterionStatus,
  type EvidenceKind,
  type ExecutionClaim,
  type PathAssessment,
  type VerifiedCallAnalysis,
  type VerifiedQuote,
} from "./call-analysis.js"
import { decidePathConfirmation, type AssessedLine, type ClaimVerdict, type Confirmation, type ConfirmationDecision, type ConfirmationReason } from "./call-review.js"
import type { ModelObligation, ModelObligationAnalysis, EvidenceRole } from "./obligation-analysis.js"
import { decideObligationConfirmation, obligationClaimOf, OBLIGATION_REVIEW_VERSION, type CentralNeedReading, type ObligationClaim, type ObligationReview } from "./obligation-review.js"
import { CUSTOMER_SPEAKERS, isOptionalGuidance, OPERATOR_SPEAKERS, type ProcedureContext, type ProcedureLine, type ProcedureSection, type TranscriptStatus } from "./procedure.js"
import { catalogRecordOf, circularTurnsOf, effectOf, identifyRequests, isSuspendedByProduct, obligationScopeOf, PRODUCT_APPLICABILITY_VERSION, requestOfObligation, reviewedScopeOf, scopeRecordOf, type ClaimScopeReading, type ObligationProductReading, type ProductApplicabilityRecord, type ProductContext, type RuleEffectRecord, type RuleScope } from "./product-applicability.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "./versions.js"

/**
 * VERIFICAÇÃO DA ANÁLISE ORIENTADA AO CASO (`OBLIGATIONS_V1` → `VerifiedCallAnalysis`, domínio puro).
 *
 * A unidade é a OBRIGAÇÃO COMPLETA que a análise montou (as linhas da fonte são referência). O código não interpreta o sentido: aplica
 * as consequências LÓGICAS das leituras que o próprio modelo declarou e a integridade de sempre —
 *   - citação literal por turno/falante; omissão só com transcrição completa, oportunidade real e o operador falando depois;
 *   - cumprimento fora da conversa nunca vira cumprido/descumprido/parcial (fala = declaração/intenção);
 *   - o PAPEL que o modelo deu a cada trecho decide o que ele pode provar: acerto ou desvio por conduta exigem fala do operador
 *     marcada como CONDUTA; declaração, intenção, condição ou fala do cliente nunca sustentam a conduta (`DECLARATION_DOES_NOT_PROVE_
 *     CONDUCT`, `NO_CONDUCT_EVIDENCE`);
 *   - as PARTES e como se combinam (leitura do modelo): alternativas com uma parte feita nunca sustentam parcial/não cumprido;
 *     combinação indefinida não sustenta falha por parte; "cumprido" com parte não feita ou não verificável numa obrigação cumulativa
 *     se contradiz;
 *   - itens de argumentário aplicável sem nenhuma obrigação que os cubra viram lacuna de cobertura (lista do cadastro, nunca palavra);
 *   - o que a análise disse que NÃO avaliou fica registrado como não avaliado, com o motivo — nunca some.
 * Depois a REVISÃO (`obligation-review.ts`) confirma ou não cada conclusão determinada; o que só ela encontrou passa pela CONFIRMAÇÃO
 * FOCAL — sem ela, fica inconclusivo com o motivo.
 */
/** `actPlaceRequired`: o pedido foi o prompt V3 (pergunta onde acontece o ato exigido) — sem essa leitura nada é confirmado. */
export type ObligationReviewInput = { attempted: boolean; review: ObligationReview | null; error: string | null; sentClaims: readonly ObligationClaim[]; requested: { linesToAssess: string[] }; actPlaceRequired?: boolean }
export type ObligationConfirmationInput = { attempted: boolean; claims: Map<string, ClaimVerdict> | null; error: string | null; reason: "BUDGET" | "TECHNICAL" | "CONTRACT" | null; sentClaims: readonly ObligationClaim[]; actPlaceRequired?: boolean; /** Modo produto: leitura da abrangência de produto de cada achado conferido. */ scopeReadings?: Map<string, ClaimScopeReading> }
export type ObligationVerificationInput = {
  model: ModelObligationAnalysis
  context: ProcedureContext
  projection: TranscriptProjection
  transcriptStatus: TranscriptStatus
  interactionId: string
  subjectAnchoredDocumentIds: readonly string[]
  /** Ausente = passagem PRELIMINAR (só integridade e consequências — base dos alvos da revisão); nada é confirmado. */
  review?: ObligationReviewInput
  confirmation?: ObligationConfirmationInput
  /** `PRODUCT_APPLICABILITY_V1`: catálogo de produtos vigente na data da chamada (null/ausente = sem modo produto: nada muda). */
  products?: ProductContext | null
}

const STATUS_OF_FINDING: Record<ModelObligation["finding"], "MET" | "NOT_MET" | "PARTIAL" | "NOT_OBSERVABLE" | "NOT_APPLICABLE"> = { MET: "MET", NOT_MET: "NOT_MET", PARTIAL: "PARTIAL", NOT_VERIFIABLE: "NOT_OBSERVABLE", NOT_APPLICABLE: "NOT_APPLICABLE" }
const speakerOf = (speaker: string | null) => (speaker ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
const isOperator = (quote: Pick<VerifiedQuote, "speaker">) => OPERATOR_SPEAKERS.has(speakerOf(quote.speaker))
const isCustomer = (quote: Pick<VerifiedQuote, "speaker">) => CUSTOMER_SPEAKERS.has(speakerOf(quote.speaker))
const sha12 = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12)
const quoteKey = (quote: Pick<VerifiedQuote, "turn" | "quote">) => `${quote.turn}|${quote.quote}`
const byPosition = (context: ProcedureContext) => {
  const documentOrder = new Map(context.documents.map((document, index) => [document.handle, index]))
  return (a: ProcedureLine, b: ProcedureLine) => (documentOrder.get(a.documentHandle) ?? 0) - (documentOrder.get(b.documentHandle) ?? 0) || a.position - b.position
}
/**
 * Título LITERAL da obrigação (texto da fonte, nunca a ação escrita pelo modelo): a primeira linha; quando ela abre uma lista e a
 * obrigação inclui itens DESSA lista, a abertura com os itens incluídos, na ordem do documento (o corte de tamanho fica no brief).
 */
function titleOf(primary: ProcedureLine, ordered: readonly ProcedureLine[]): string {
  const clean = (text: string) => text.replace(/^\s*(?:[-*•+]\s*(?:\[[ xX]\]\s*)?|\(?\d{1,3}[.)]\s*)/u, "").replace(/[*_`]/g, "").trim()
  const first = clean(primary.text)
  const items = ordered.filter((line) => line.handle !== primary.handle && line.documentHandle === primary.documentHandle && line.leadIn !== null && clean(line.leadIn) === first)
  if (/:\s*$/.test(first) && items.length > 0) {
    const listed = items.map((line) => clean(line.text).replace(/[;.]+$/, "")).map((text) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`).join("; ")
    return `${first.replace(/[:\s]+$/, "")}: ${listed}`
  }
  // Abertura de lista sem nenhum item dela na obrigação ("O operador deverá explicar:") não diz o assunto: o título da seção diz.
  const heading = primary.heading ? primary.heading.replace(/^\s*\d+(?:\.\d+)*\.?\s+/u, "").replace(/[*_`#]/g, "").trim() : ""
  if (/:\s*$/.test(first) && heading) return heading
  return first.replace(/[;:.]+$/, "")
}

/**
 * LISTAS DA FONTE (estrutura do documento, nunca palavra): uma sequência contínua de itens numa seção e a linha que a abre (quando os
 * itens dizem que ela os abre). Usado para saber QUAIS itens de uma lista em jogo a análise deixou sem avaliação.
 */
type SourceList = { opening: ProcedureLine | null; items: ProcedureLine[] }
function sourceListsOf(context: ProcedureContext): Map<string, SourceList> {
  const out = new Map<string, SourceList>()
  for (const section of context.sections.values()) {
    const lines = section.lines
    for (let index = 0; index < lines.length; index++) {
      if (lines[index]!.kind !== "LIST_ITEM" || (index > 0 && lines[index - 1]!.kind === "LIST_ITEM")) continue
      const items: ProcedureLine[] = []
      for (let next = index; next < lines.length && lines[next]!.kind === "LIST_ITEM"; next++) items.push(lines[next]!)
      const previous = index > 0 ? lines[index - 1]! : null
      const opening = previous && previous.kind === "TEXT" && items[0]!.leadIn !== null && previous.text === items[0]!.leadIn ? previous : null
      const list: SourceList = { opening, items }
      if (opening) out.set(opening.handle, list)
      for (const item of items) out.set(item.handle, list)
    }
  }
  return out
}

/**
 * `LIST_COVERAGE_V2` — itens das listas da fonte que as obrigações da análise USAM e que nenhuma obrigação (nem o "não avaliado"
 * declarado) cobriu. Na C07 (V10) a obrigação "Antes de encerrar, informar:" levou 5 dos 10 itens e "Serviço cancelado, quando
 * aplicável" nunca foi lido por ninguém. A V1 desta regra criava um NÃO AVALIADO por item — no replay da C07 foram 58 (listas de
 * opções "A validação poderá incluir:", de gatilhos "Abrir análise quando:", de referência), inflando "sem avaliação" com itens que a
 * própria redação não torna obrigatórios. Decidir o que cada lista exige é SEMÂNTICO: os itens vão à revisão como CONTEXTO da
 * obrigação que usa a lista, com a pergunta "algum valia neste caso e faltou?"; o que ela apontar entra por `missed` (confirmação
 * focal, como todo achado só da revisão). Nenhum item vira desvio, acerto ou falta por estrutura; a cobertura registra quantos foram
 * mostrados e quantos a revisão apontou.
 */
export const LIST_COVERAGE_VERSION = "LIST_COVERAGE_V2" as const
/** Teto de itens mostrados à revisão como contexto. Acima dele, os itens são repartidos em rodízio entre as listas (toda lista em jogo
 * aparece; na ordem do documento dentro de cada uma) — na V10 a ordem por papel deixou a lista do encerramento por último e cortou
 * justamente "Serviço cancelado, quando aplicável". */
export const LIST_ITEMS_IN_PLAY_LIMIT = 60
/** `obligation` = o id da conclusão como a revisão a recebe (O-n, a posição da obrigação na análise). */
export type ListItemsInPlay = { obligation: string; action: string; opening: ProcedureLine | null; items: ProcedureLine[] }
/** Itens das listas usadas pelas obrigações que ninguém avaliou, agrupados pela obrigação (cada item uma vez, até o teto). */
export function listItemsInPlayOf(model: ModelObligationAnalysis, context: ProcedureContext, criteria: readonly AssessedCriterion[]): { groups: ListItemsInPlay[]; found: number } {
  const lists = sourceListsOf(context)
  const covered = new Set(criteria.flatMap((criterion) => [criterion.lineHandle, ...(criterion.sources ?? []).map((source) => source.handle)]))
  const declaredNotAssessed = new Set(model.notAssessed.flatMap((entry) => entry.sources))
  const seen = new Set<string>()
  const all: ListItemsInPlay[] = []
  model.obligations.forEach((obligation, index) => {
    for (const source of obligation.sources) {
      const list = lists.get(source)
      if (!list) continue
      const pending = list.items.filter((item) => !item.argument && !covered.has(item.handle) && !declaredNotAssessed.has(item.handle) && !seen.has(item.handle))
      if (pending.length === 0) continue
      for (const item of pending) seen.add(item.handle)
      all.push({ obligation: `O${index + 1}`, action: obligation.action, opening: list.opening, items: pending })
    }
  })
  const found = all.reduce((sum, group) => sum + group.items.length, 0)
  if (found <= LIST_ITEMS_IN_PLAY_LIMIT) return { groups: all, found }
  const taken = all.map(() => 0)
  for (let shown = 0, round = 0; shown < LIST_ITEMS_IN_PLAY_LIMIT; round++) {
    let progressed = false
    for (let index = 0; index < all.length && shown < LIST_ITEMS_IN_PLAY_LIMIT; index++) {
      if (taken[index]! > round || taken[index]! >= all[index]!.items.length) continue
      taken[index]! += 1
      shown += 1
      progressed = true
    }
    if (!progressed) break
  }
  return { groups: all.map((group, index) => ({ ...group, items: group.items.slice(0, taken[index]) })).filter((group) => group.items.length > 0), found }
}
/**
 * `SITUATION_SECTIONS_V1` — SEÇÕES ACIONADAS POR SITUAÇÃO. A análise diz (leitura semântica, `situations`) que a situação descrita no
 * título/abertura de uma seção aconteceu nesta conversa; o código só confere a fala (literal, por turno). As linhas dessa seção que
 * nenhuma obrigação cobriu e que a análise não declarou como não avaliadas vão à revisão como FOCO, com a fala da situação — ela aponta
 * em `missed` o que valia e faltou (confirmação focal, como todo achado só da revisão). Nada vira desvio por estrutura. Origem: Jeito
 * Vivo §19 na C07 ("Quando não houver solução imediata") lido pela análise e nunca ligado ao caso.
 */
export const SITUATION_SECTIONS_VERSION = "SITUATION_SECTIONS_V1" as const
/**
 * A seção como o modelo a escreveu → seções do CONTEXTO apresentado (identidade, nunca semelhança): os handles S-n que aparecem no texto
 * ("D1:S33", "S21 / S98 (…)", "D2 S104 - 10 Tempo de espera"); sem handle, o título da seção IGUAL ao apresentado, comparado sem a
 * numeração editorial e sem caixa ("34. Conta já paga", "10. Tempo de espera" × "10 Tempo de espera") — e só quando UM título bate
 * (dois documentos com o mesmo título = ambíguo, nada). Rodada real V14: o modelo escreveu as seções nesses formatos e nenhuma chegava.
 */
export function sectionsOfReference(reference: string, context: Pick<ProcedureContext, "sections">): ProcedureSection[] {
  const handles = [...reference.matchAll(/(?<![\p{L}\d])S\s*-?\s*0*(\d+)(?![\p{L}\d])/gu)].map((match) => `S${match[1]}`)
  const byHandle = [...new Set(handles)].flatMap((handle) => (context.sections.get(handle) ? [context.sections.get(handle)!] : []))
  if (byHandle.length > 0) return byHandle
  const bare = (text: string) => text.toLocaleLowerCase("pt-BR").replace(/^[\s\d.)–-]+/u, "").replace(/\s+/gu, " ").trim()
  const wanted = bare(reference.replace(/^\s*D\s*\d+\s*[·:/-]?\s*/iu, "").replace(/\s*\(.*\)\s*$/u, ""))
  if (wanted.length === 0) return []
  const matches = [...context.sections.values()].filter((section) => section.heading && bare(section.heading) === wanted)
  return matches.length === 1 ? matches : []
}
export const SITUATION_LINES_LIMIT = 30
export type SituationInPlay = { section: string; heading: string | null; document: string; evidence: VerifiedQuote[]; lines: ProcedureLine[] }
export function situationsInPlayOf(model: ModelObligationAnalysis, context: ProcedureContext, criteria: readonly AssessedCriterion[], interactions: ReadonlyMap<string, ProjectedInteraction>, projection: TranscriptProjection): { groups: SituationInPlay[]; declared: number; happened: number; found: number } {
  const covered = new Set(criteria.flatMap((criterion) => [criterion.lineHandle, ...(criterion.sources ?? []).map((source) => source.handle)]))
  const declaredNotAssessed = new Set(model.notAssessed.flatMap((entry) => entry.sources))
  const situations = model.situations ?? []
  const groups: SituationInPlay[] = []
  let shown = 0
  let found = 0
  let happened = 0
  const seen = new Set<string>()
  for (const situation of situations) {
    if (situation.happened !== "YES") continue
    const sections = sectionsOfReference(situation.section, context).filter((section) => !seen.has(section.handle))
    if (sections.length === 0) continue
    const evidence = verifyQuotes(situation.evidence.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote })), interactions, projection).verified
    // Sem fala verificada, a situação é só leitura: não traz linhas para a revisão.
    if (evidence.length === 0) continue
    for (const section of sections) {
      seen.add(section.handle)
      happened += 1
      const pending = section.lines.filter((line) => !line.argument && !covered.has(line.handle) && !declaredNotAssessed.has(line.handle))
      found += pending.length
      const room = Math.max(0, SITUATION_LINES_LIMIT - shown)
      if (pending.length === 0 || room === 0) continue
      const lines = pending.slice(0, room)
      shown += lines.length
      groups.push({ section: section.handle, heading: section.heading, document: section.documentHandle, evidence: evidence.slice(0, 2), lines })
    }
  }
  return { groups, declared: situations.length, happened, found }
}

/** Lacunas de cobertura que vão à revisão para receber disposição (itens de argumentário aplicável). */
export const reviewableGapsOf = (criteria: readonly AssessedCriterion[]) => criteria.filter((criterion) => criterion.origin === "COVERAGE_GAP" && /^L\d+$/.test(criterion.lineHandle))

const PATH_LABEL: Record<PathAssessment, string> = { CORRECT: "caminho indicado seguido", INCORRECT: "caminho inadequado para o cenário", PARTIALLY_CORRECT: "caminho indicado, com etapas materiais faltando ou fora de ordem", UNDETERMINED: "caminho não determinado", NO_PROCEDURE: "sem procedimento aplicável" }
const STATUS_LABEL: Partial<Record<CriterionStatus, string>> = { MET: "cumprida", NOT_MET: "não cumprida", PARTIAL: "cumprida em parte" }
const shortTitle = (criterion: AssessedCriterion) => {
  const title = (criterion.titleText ?? criterion.text.split("\n")[0] ?? "").replace(/[*_`]/g, "").trim()
  return title.length > 90 ? `${title.slice(0, 87).trimEnd()}…` : title
}
const turnNumber = (turn: string | null) => (turn ? Number(/\d+/.exec(turn)?.[0] ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER)

/**
 * `PATH_VIGENTE_V1` — o caminho seguido e a justificativa VIGENTES, montados pelo sistema a partir das conclusões FINAIS (o que foi
 * confirmado, o que é fora da conversa, o que não se sustentou). Usado quando a leitura da análise deixou de representar a evidência —
 * a leitura original fica em `analysisReading` (auditoria), nunca como diagnóstico.
 */
function vigentePathOf(criteria: readonly AssessedCriterion[], assessment: PathAssessment): { pathTaken: string; rationale: string } {
  const considered = criteria.filter((criterion) => criterion.onPath && !criterion.ruleConflict)
  const observed = considered.filter((criterion) => isDeterminate(criterion.status) && criterion.confirmation === "CONFIRMED")
  const declaredOutside = considered.filter((criterion) => criterion.observability === "OUTSIDE_CONVERSATION" && (criterion.executionClaim === "DECLARED" || criterion.executionClaim === "INTENDED"))
  const steps = [
    // Obrigação MISTA: a conclusão vale só para a parte da conversa — o título da obrigação inteira nunca leva "cumprida" sozinho.
    ...observed.map((criterion) => ({ at: Math.min(turnNumber(criterion.evidence[0]?.turn ?? null), turnNumber(criterion.opportunityTurn)), text: criterion.judgedPart ? `“${shortTitle(criterion)}” — ${STATUS_LABEL[criterion.status] ?? criterion.status} só na parte da conversa (${criterion.judgedPart})${criterion.operationalPart ? `; ${criterion.operationalPart.text}: execução em sistema, não verificável pela gravação` : ""}` : `“${shortTitle(criterion)}” — ${STATUS_LABEL[criterion.status] ?? criterion.status}` })),
    ...declaredOutside.map((criterion) => ({ at: turnNumber(criterion.evidence[0]?.turn ?? null), text: `“${shortTitle(criterion)}” — ${criterion.executionClaim === "INTENDED" ? "anunciada" : "declarada"} na conversa (execução em sistema, não verificável pela gravação)` })),
  ].sort((a, b) => a.at - b.at)
  const adverse = observed.filter((criterion) => criterion.status === "NOT_MET" || criterion.status === "PARTIAL")
  const material = adverse.filter((criterion) => criterion.materiality !== "LOW")
  const low = adverse.filter((criterion) => criterion.materiality === "LOW")
  const outside = considered.filter((criterion) => criterion.observability === "OUTSIDE_CONVERSATION" && !isDeterminate(criterion.status))
  const operationalParts = observed.flatMap((criterion) => (criterion.operationalPart ? [criterion.operationalPart.text] : []))
  const dropped = considered.filter((criterion) => criterion.origin === "ANALYSIS" && isDeterminate(criterion.declaredStatus as CriterionStatus) && !isDeterminate(criterion.status) && criterion.observability !== "OUTSIDE_CONVERSATION" && criterion.productApplicability?.effect !== "SUSPENDED" && criterion.productApplicability?.effect !== "OTHER_PRODUCT")
  const productPending = considered.filter((criterion) => criterion.productApplicability?.effect === "SUSPENDED" && isDeterminate(criterion.declaredStatus as CriterionStatus))
  const quoted = (list: readonly AssessedCriterion[]) => list.map((criterion) => `“${shortTitle(criterion)}”`).join("; ")
  const rationale = [
    `Avaliação vigente: ${PATH_LABEL[assessment]}.`,
    ...(material.length > 0 ? [`Desvio(s) confirmado(s) no caminho: ${material.map((criterion) => `“${shortTitle(criterion)}” (${STATUS_LABEL[criterion.status]})`).join("; ")}.`] : []),
    ...(low.length > 0 ? [`Desvio(s) de baixa materialidade (não sustentam desvio de caminho sozinhos): ${quoted(low)}.`] : []),
    ...(observed.length - adverse.length > 0 ? [`Etapa(s) cumprida(s) com evidência na conversa: ${observed.length - adverse.length}.`] : []),
    ...(outside.length > 0 || operationalParts.length > 0 ? [`Não verificável pela gravação (execução em sistema): ${[...(outside.length > 0 ? [quoted(outside)] : []), ...operationalParts.map((text) => `“${text}”`)].join("; ")}.`] : []),
    ...(dropped.length > 0 ? [`Conclusão(ões) da análise que não se sustentaram e ficaram fora do diagnóstico: ${quoted(dropped)}.`] : []),
    ...(productPending.length > 0 ? [`Sem avaliação por depender de um produto não estabelecido pela gravação: ${quoted(productPending)}.`] : []),
  ].join(" ")
  return { pathTaken: steps.length > 0 ? `Etapas verificadas na conversa, em ordem: ${steps.map((step) => step.text).join("; ")}.` : "Nenhuma etapa do caminho pôde ser verificada pela conversa.", rationale }
}

/**
 * `CONDUCT_OCCURRENCE_V1` — a MESMA conduta julgada por mais de uma regra (ex.: "antes de transferir: informar protocolo" e "antes de
 * encerrar: informe o número do protocolo", com o protocolo nunca dito). A revisão diz (`sameConductAs`) quais conclusões são a mesma
 * conduta; o código aceita só quando a estrutura confirma — as duas confirmadas, do mesmo lado (desvio × cumprimento) e no MESMO momento
 * (mesma oportunidade ou mesma fala verificada). Cada regra continua avaliada (cobertura por regra); a ocorrência é uma só.
 */
export const CONDUCT_OCCURRENCE_VERSION = "CONDUCT_OCCURRENCE_V1" as const
function occurrencesOf(criteria: AssessedCriterion[], linkOf: (criterion: AssessedCriterion) => string | null, context: { interactionId: string; reviewAvailable: boolean }): { accepted: number; rejected: { from: string; to: string; reason: string }[] } {
  const byHandle = new Map(criteria.map((criterion) => [criterion.lineHandle, criterion]))
  const parent = new Map<string, string>()
  const find = (handle: string): string => {
    const up = parent.get(handle) ?? handle
    if (up === handle) return handle
    const root = find(up)
    parent.set(handle, root)
    return root
  }
  const adverse = (criterion: AssessedCriterion) => criterion.status === "NOT_MET" || criterion.status === "PARTIAL"
  const momentsOf = (criterion: AssessedCriterion) => new Set([criterion.opportunityTurn, ...criterion.evidence.map((quote) => quote.turn)].filter((turn): turn is string => Boolean(turn)))
  const rejected: { from: string; to: string; reason: string }[] = []
  let accepted = 0
  for (const criterion of criteria) {
    const target = linkOf(criterion)
    if (!target || target === criterion.lineHandle) continue
    const other = byHandle.get(target)
    const reason = !other ? "UNKNOWN_CLAIM"
      : criterion.ruleConflict || other.ruleConflict ? "RULE_CONFLICT"
      : criterion.confirmation !== "CONFIRMED" || other.confirmation !== "CONFIRMED" ? "NOT_BOTH_CONFIRMED"
      : !((adverse(criterion) && adverse(other)) || (criterion.status === "MET" && other.status === "MET")) ? "DIFFERENT_OUTCOME"
      : ![...momentsOf(criterion)].some((turn) => momentsOf(other).has(turn)) ? "DIFFERENT_MOMENT"
      : null
    if (reason) {
      rejected.push({ from: criterion.lineHandle, to: target, reason })
      continue
    }
    parent.set(find(criterion.lineHandle), find(other!.lineHandle))
    accepted += 1
  }
  const groups = new Map<string, AssessedCriterion[]>()
  for (const handle of new Set([...parent.keys(), ...parent.values()])) {
    const member = byHandle.get(handle)
    if (member) groups.set(find(handle), [...(groups.get(find(handle)) ?? []), member])
  }
  // Chave = chamada + identidades das regras do grupo: a mesma dupla de regras em OUTRA chamada é outra ocorrência (nunca une chamadas).
  const keyOf = (members: readonly AssessedCriterion[]) => `OC-${sha12([context.interactionId, ...members.map((member) => member.identityKey ?? member.lineKey).sort()].join("|"))}`
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const key = keyOf(members)
    for (const member of members) member.occurrence = { key, members: members.map((entry) => entry.lineHandle), basis: "REVIEW_SAME_CONDUCT" }
  }
  // Sem revisão não há como saber se duas regras julgaram a mesma conduta: a ocorrência fica NÃO DETERMINÁVEL (null), nunca "única".
  if (context.reviewAvailable) for (const criterion of criteria) if (!criterion.occurrence) criterion.occurrence = { key: keyOf([criterion]), members: [criterion.lineHandle], basis: "SINGLE_RULE" }
  return { accepted, rejected }
}
/** Conta por OCORRÊNCIA (grupo da mesma conduta conta uma vez) e por REGRA. */
function occurrenceCountsOf(criteria: readonly AssessedCriterion[]) {
  const count = (predicate: (criterion: AssessedCriterion) => boolean) => {
    const list = criteria.filter((criterion) => !criterion.ruleConflict && predicate(criterion))
    return { rules: list.length, occurrences: new Set(list.map((criterion) => criterion.occurrence?.key ?? criterion.lineHandle)).size }
  }
  const adverse = count((criterion) => criterion.status === "NOT_MET" || criterion.status === "PARTIAL")
  const met = count((criterion) => criterion.status === "MET")
  return { adverseRules: adverse.rules, adverseOccurrences: adverse.occurrences, metRules: met.rules, metOccurrences: met.occurrences }
}

export function verifyObligationAnalysis(input: ObligationVerificationInput): VerifiedCallAnalysis {
  const { model, context, projection, transcriptStatus } = input
  const interactions = new Map<string, ProjectedInteraction>([["I1", { interactionRef: "I1", interactionId: input.interactionId, projection }]])
  const auditNotes: string[] = []
  const violations = [...model.contractViolations]
  let evidenceRejected = 0
  let downgraded = 0
  const ordering = byPosition(context)

  const procedureDocument = model.sources.primary ? context.documents.find((document) => document.handle === model.sources.primary && document.kind !== "ARGUMENT_SCRIPT") ?? null : null
  if (model.sources.primary && !procedureDocument) auditNotes.push("O procedimento indicado pela análise não estava entre os documentos apresentados.")
  const scripts = verifyScriptAssessments({ argumentScripts: model.argumentScripts.map((script) => ({ script: script.script, applicability: script.applies, situation: null, evidence: script.evidence, rationale: script.rationale })) }, context, interactions, projection)
  const scriptApplicability = new Map(scripts.map((script) => [script.scriptId, script.applicability]))
  const conditions = model.need.conditions.map((condition) => {
    const quotes = verifyQuotes(condition.evidence, interactions, projection)
    evidenceRejected += quotes.rejected.length
    return { text: condition.text, evidence: quotes.verified }
  })
  const conditionTurns = new Set(conditions.flatMap((condition) => condition.evidence.map((quote) => quote.turn)))
  const argumentOf = (line: ProcedureLine): NonNullable<AssessedCriterion["argument"]> | null => {
    if (!line.argument) return null
    const meta = context.documents.find((document) => document.handle === line.documentHandle)?.argument
    return { ...line.argument, trigger: meta?.trigger ?? null, notApplicableWhen: meta?.notApplicableWhen ?? null, scopeLabel: meta?.scopeLabel ?? "", scope: meta?.scope ?? { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null }, perspective: meta?.perspective ?? "RULE_IN_FORCE_AT_CALL" }
  }
  const identities = new Set<string>()
  const criteria: AssessedCriterion[] = []
  const duplicateReadings: { identity: string; handle: string; finding: ModelObligation["finding"]; rationale: string | null }[] = []
  // `REVIEW_DIVERGENCE_V1`: leitura da revisão (R-n) da MESMA obrigação (mesmo conjunto de linhas) com outra conclusão → R-n vira alvo da
  // confirmação focal e, depois, é FUNDIDA na obrigação da análise (uma identidade só): a leitura confirmada vale; a refutada, não; sem
  // decisão, a obrigação fica inconclusiva.
  const divergentOf = new Map<string, string>()
  // `PRODUCT_APPLICABILITY_V1`: o que a leitura (análise ou revisão) disse da solicitação e da abrangência de produto de cada obrigação.
  const productReadings = new Map<string, ObligationProductReading>()

  const obligationCriterion = (obligation: ModelObligation, handle: string, origin: CriterionOrigin): AssessedCriterion | null => {
    const known = obligation.sources.filter((source) => {
      if (context.lines.has(source)) return true
      violations.push(`${handle}:UNKNOWN_SOURCE:${source}`)
      return false
    })
    if (known.length === 0) {
      violations.push(`${handle}:NO_KNOWN_SOURCE`)
      return null
    }
    // `OPTIONAL_GUIDANCE_RECOGNITION_V1`: obrigação só de orientação "pode" — feita, é reconhecimento; não feita (ou em parte), nunca é
    // desvio, diga o que disser a leitura (da análise ou da revisão). Junto de outra fonte, a obrigação é da outra fonte.
    if (known.every((source) => isOptionalGuidance(context.lines.get(source)!)) && (obligation.finding === "NOT_MET" || obligation.finding === "PARTIAL")) {
      auditNotes.push(`[${handle}] é orientação opcional ("pode") do argumentário: não ter sido feita não conta como desvio.`)
      return null
    }
    const primary = context.lines.get(known[0]!)!
    const ordered = [...new Set(known)].map((source) => context.lines.get(source)!).sort(ordering)
    const multi = ordered.length > 1
    // Identidade pelo CONJUNTO de linhas (ordem do documento), nunca pela ordem em que o modelo as citou nem pela redação da ação.
    const lineKey = multi ? `${ordered[0]!.lineKey}#${sha12(ordered.map((line) => line.lineKey).join("|"))}` : primary.lineKey
    const identityKey = multi ? `${ordered[0]!.argument ? "AG" : "KC"}-${sha12(lineKey)}` : null
    const identity = identityKey ?? lineKey
    // A revisão apontou "de fora" uma obrigação que a análise JÁ tem (mesmas linhas): é uma SEGUNDA LEITURA dela. Mesma conclusão =
    // registrada na existente; conclusão diferente = divergência (decidida pela confirmação focal, nunca pela ordem de execução).
    let readingOf: AssessedCriterion | null = null
    if (identities.has(identity)) {
      readingOf = origin === "REVIEW_REPAIR" ? criteria.find((criterion) => criterion.origin === "ANALYSIS" && (criterion.identityKey ?? criterion.lineKey) === identity) ?? null : null
      if (!readingOf) {
        violations.push(`${handle}:DUPLICATE_OBLIGATION`)
        if (origin === "REVIEW_REPAIR") duplicateReadings.push({ identity, handle, finding: obligation.finding, rationale: obligation.rationale })
        return null
      }
    } else identities.add(identity)
    // Evidência: cada trecho conferido SOZINHO, para o papel declarado acompanhar a citação verificada.
    const verified: VerifiedQuote[] = []
    const evidenceRoles: (EvidenceRole | null)[] = []
    const rejectedEvidence: AssessedCriterion["rejectedEvidence"] = []
    for (const unit of obligation.evidence) {
      const result = verifyQuotes([unit], interactions, projection)
      rejectedEvidence.push(...result.rejected)
      evidenceRejected += result.rejected.length
      for (const quote of result.verified) {
        if (verified.some((other) => quoteKey(other) === quoteKey(quote))) continue
        verified.push(quote)
        evidenceRoles.push(unit.role)
      }
    }
    const roleOf = (quote: VerifiedQuote) => evidenceRoles[verified.indexOf(quote)] ?? null
    const operatorOnes = verified.filter(isOperator)
    const conduct = operatorOnes.filter((quote) => roleOf(quote) === "CONDUCT")
    const declared = operatorOnes.filter((quote) => roleOf(quote) === "DECLARATION")
    const intended = operatorOnes.filter((quote) => roleOf(quote) === "INTENTION")
    const declaredStatus = STATUS_OF_FINDING[obligation.finding]
    const adverse = declaredStatus === "NOT_MET" || declaredStatus === "PARTIAL"
    const evidenceKind: EvidenceKind = conduct.length > 0 ? "CONDUCT_OBSERVED"
      : declared.length > 0 || intended.length > 0 ? "DECLARED_ACTION"
      : declaredStatus === "MET" && verified.length === 0 ? "COMPLIANCE_BY_ABSENCE"
      : declaredStatus === "NOT_MET" && operatorOnes.length === 0 ? "OMISSION"
      : verified.some(isCustomer) && operatorOnes.length === 0 ? "CUSTOMER_CONTEXT"
      : "NONE"
    const tense = declared.length > 0 ? "COMPLETED" as const : intended.length > 0 ? "INTENDED" as const : null
    const applicability = obligation.finding === "NOT_APPLICABLE" || obligation.conditionHolds === "NO" ? "DOES_NOT_APPLY" as const : obligation.conditionHolds === "UNCERTAIN" ? "UNCERTAIN" as const : "APPLIES" as const
    // Consequências das leituras DO PRÓPRIO MODELO (papel do trecho, partes e combinação) — nenhuma palavra decide nada aqui.
    const items = obligation.items
    const done = items.filter((item) => item.status === "DONE").length
    const consequences: string[] = []
    if (adverse && conduct.length === 0 && (declared.length > 0 || intended.length > 0)) consequences.push("DECLARATION_DOES_NOT_PROVE_CONDUCT")
    if (declaredStatus === "MET" && evidenceKind !== "COMPLIANCE_BY_ABSENCE" && conduct.length === 0 && declared.length === 0 && intended.length === 0) consequences.push("NO_CONDUCT_EVIDENCE")
    if (adverse && done > 0 && obligation.itemsMode === "ANY") consequences.push("ALTERNATIVE_DONE")
    if (adverse && done > 0 && obligation.itemsMode === "UNCLEAR") consequences.push("ITEMS_COMBINATION_UNCLEAR")
    if (declaredStatus === "MET" && (obligation.itemsMode === "ALL" || obligation.itemsMode === "SEQUENCE") && items.some((item) => item.status === "NOT_DONE")) consequences.push("ITEMS_CONTRADICT_FINDING")
    if (declaredStatus === "MET" && (obligation.itemsMode === "ALL" || obligation.itemsMode === "SEQUENCE") && items.some((item) => item.status === "NOT_VERIFIABLE")) consequences.push("PART_NOT_VERIFIABLE")
    const unit = assessUnit({
      line: primary,
      unit: { status: declaredStatus, evidenceKind, declaredActionTense: tense, evidence: obligation.evidence.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote })), opportunityTurn: obligation.opportunityTurn, rationale: obligation.rationale, itemNature: obligation.where === "OUTSIDE_CONVERSATION" ? "INTERNAL_ACTION" : null, applicability, applicabilityEvidence: obligation.conditionEvidence, observability: obligation.where, lineRole: "ACTION" },
      scriptApplicability,
      interactions,
      projection,
      transcriptStatus,
      conditionTurns,
    })
    let status: CriterionStatus = unit.status
    const downgrades = [...unit.downgrades]
    if (consequences.length > 0 && isDeterminate(status)) {
      status = "NOT_OBSERVABLE"
      downgrades.push(...consequences)
    }
    if (readingOf) {
      if (status === readingOf.proposedStatus) {
        duplicateReadings.push({ identity, handle, finding: obligation.finding, rationale: obligation.rationale })
        return null
      }
      divergentOf.set(handle, readingOf.lineHandle)
    }
    const contests = readingOf ? { analysisHandle: readingOf.lineHandle, analysisStatus: readingOf.declaredStatus as CriterionStatus, analysisReading: readingOf.rationale } : null
    productReadings.set(handle, { request: obligation.request ?? null, productScope: obligation.productScope ?? null, commonAcrossSources: obligation.commonAcrossSources ?? null })
    if (status !== declaredStatus) downgraded += 1
    const guidance = obligation.guidance && (status === "NOT_MET" || status === "PARTIAL") ? { moment: obligation.guidance.moment, condition: obligation.condition, action: obligation.guidance.action, ruleLines: ordered.map((line) => ({ handle: line.handle, text: line.text, heading: line.heading })) } : null
    return {
      lineHandle: handle,
      lineKey,
      documentId: primary.documentId,
      documentHandle: primary.documentHandle,
      sectionHandle: primary.sectionHandle,
      heading: primary.heading,
      text: ordered.map((line) => line.text).join("\n"),
      leadIn: null,
      onPath: true,
      origin,
      declaredStatus,
      proposedStatus: status,
      status,
      confirmation: "NOT_A_CLAIM",
      confirmationReasons: [],
      review: null,
      evidenceKind: unit.evidenceKind,
      declaredActionTense: tense,
      evidence: verified,
      evidenceRoles,
      rejectedEvidence,
      opportunityTurn: unit.opportunityTurn,
      rationale: obligation.rationale,
      materiality: obligation.materiality,
      guidance,
      whyItMatters: null,
      ruleConflict: false,
      downgrades,
      itemNature: obligation.where === "OUTSIDE_CONVERSATION" ? "INTERNAL_ACTION" : null,
      scenarioRole: obligation.role,
      requiredAction: obligation.action,
      applicability: unit.applicability,
      condition: obligation.condition,
      applicabilityEvidence: unit.applicabilityEvidence,
      observability: unit.observability,
      evidenceNeeded: null,
      executionClaim: unit.executionClaim,
      lineRole: "ACTION",
      argument: argumentOf(primary),
      obligation: null,
      contract: "OBLIGATIONS_V1",
      obligationRef: obligation.id,
      sources: ordered.map((line) => ({ handle: line.handle, lineKey: line.lineKey, text: line.text, heading: line.heading })),
      items: items.map((item) => ({ text: item.text, line: item.line, status: item.status })),
      itemsMode: obligation.itemsMode,
      titleText: titleOf(primary, ordered),
      identityKey,
      ...(contests ? { contests } : {}),
    }
  }

  model.obligations.forEach((obligation, index) => {
    const criterion = obligationCriterion(obligation, `O${index + 1}`, "ANALYSIS")
    if (criterion) criteria.push(criterion)
  })
  const conflictLines = new Set(model.sourceConflicts.flatMap((conflict) => conflict.lines))
  for (const criterion of criteria) if ((criterion.sources ?? []).some((source) => conflictLines.has(source.handle))) criterion.ruleConflict = true

  // COBERTURA: itens avaliáveis do argumentário que se aplica sem obrigação que os cubra (lista estrutural do cadastro) e o que a
  // análise declarou não ter avaliado — os dois ficam como NÃO AVALIADOS, com o motivo, até alguém avaliá-los.
  const covered = new Set(criteria.flatMap((criterion) => (criterion.sources ?? []).map((source) => source.handle)))
  const declaredNotAssessed = new Set(model.notAssessed.flatMap((entry) => entry.sources))
  const scriptGaps = requiredScriptLinesOf(context, scriptApplicability).filter((line) => !covered.has(line.handle) && !declaredNotAssessed.has(line.handle))
  const review = input.review?.review ?? null
  // LISTAS EM JOGO (`LIST_COVERAGE_V2`): só contadas — os itens foram mostrados à revisão como contexto; o que ela apontou como
  // faltante vem em `missed` (com as linhas como fonte) e segue o caminho dos achados só da revisão.
  const inPlay = listItemsInPlayOf(model, context, criteria)
  const inPlayHandles = new Set(inPlay.groups.flatMap((group) => group.items.map((item) => item.handle)))
  const raisedFromLists = new Set((review?.missed ?? []).flatMap((missed) => missed.sources).filter((handle) => inPlayHandles.has(handle)))
  for (const group of inPlay.groups) {
    const owner = criteria.find((criterion) => criterion.origin === "ANALYSIS" && criterion.lineHandle === group.obligation)
    const open = group.items.filter((item) => !raisedFromLists.has(item.handle)).map((item) => item.text)
    if (owner && open.length > 0) owner.notAssessedInSameList = [...new Set([...(owner.notAssessedInSameList ?? []), ...open])].slice(0, 10)
  }
  // SITUAÇÕES EM JOGO (`SITUATION_SECTIONS_V1`): contadas; o que a revisão apontou vem em `missed`.
  const situationsInPlay = situationsInPlayOf(model, context, criteria, interactions, projection)
  const situationHandles = new Set(situationsInPlay.groups.flatMap((group) => group.lines.map((line) => line.handle)))
  const raisedFromSituations = new Set((review?.missed ?? []).flatMap((missed) => missed.sources).filter((handle) => situationHandles.has(handle)))
  const reviewedLines = new Map((review?.lines ?? []).filter((line) => (input.review?.requested.linesToAssess ?? []).includes(line.id)).map((line) => [line.id, line]))
  const lineCriterion = (line: ProcedureLine, assessed: AssessedLine | null): AssessedCriterion => {
    const base = { lineHandle: line.handle, lineKey: line.lineKey, documentId: line.documentId, documentHandle: line.documentHandle, sectionHandle: line.sectionHandle, heading: line.heading, text: line.text, leadIn: line.leadIn, onPath: true, argument: argumentOf(line), obligation: null, contract: "OBLIGATIONS_V1" as const }
    if (!assessed || assessed.status === "NOT_A_REQUIREMENT") return { ...base, origin: "COVERAGE_GAP", declaredStatus: "NOT_OBSERVABLE", proposedStatus: "NOT_ASSESSED", status: "NOT_ASSESSED", confirmation: "NOT_A_CLAIM", confirmationReasons: [], review: null, evidenceKind: "NONE", declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: assessed ? assessed.rationale : "Item do argumentário aplicável que a análise não avaliou.", materiality: "MEDIUM", guidance: null, whyItMatters: null, ruleConflict: false, downgrades: [assessed ? "NOT_A_REQUIREMENT_BY_REVIEW" : "NOT_ASSESSED_BY_ANALYSIS"] }
    const unit = assessUnit({ line, unit: { status: assessed.status, evidenceKind: assessed.evidenceKind, declaredActionTense: null, evidence: assessed.evidence.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote })), opportunityTurn: assessed.opportunityTurn, rationale: assessed.rationale, itemNature: null, applicability: assessed.applicability, applicabilityEvidence: [], observability: assessed.observability, lineRole: "ACTION" }, scriptApplicability, interactions, projection, transcriptStatus, conditionTurns })
    evidenceRejected += unit.rejected
    return { ...base, origin: "REVIEW_REPAIR", declaredStatus: assessed.status, proposedStatus: unit.status, status: unit.status, confirmation: "NOT_A_CLAIM", confirmationReasons: [], review: null, evidenceKind: unit.evidenceKind, declaredActionTense: null, evidence: unit.evidence, rejectedEvidence: unit.rejectedEvidence, opportunityTurn: unit.opportunityTurn, rationale: assessed.rationale, materiality: assessed.materiality ?? "LOW", guidance: null, whyItMatters: null, ruleConflict: false, downgrades: unit.downgrades, applicability: unit.applicability, observability: unit.observability, executionClaim: unit.executionClaim, lineRole: "ACTION" }
  }
  for (const line of scriptGaps) criteria.push(lineCriterion(line, reviewedLines.get(line.handle) ?? null))
  model.notAssessed.forEach((entry, index) => {
    const lines = entry.sources.map((source) => context.lines.get(source)).filter((line): line is ProcedureLine => Boolean(line)).sort(ordering)
    if (lines.length === 0) return
    const primary = lines[0]!
    const lineKey = `${primary.lineKey}#NA${sha12(lines.map((line) => line.lineKey).join("|"))}`
    criteria.push({ lineHandle: `N${index + 1}`, lineKey, documentId: primary.documentId, documentHandle: primary.documentHandle, sectionHandle: primary.sectionHandle, heading: primary.heading, text: lines.map((line) => line.text).join("\n"), leadIn: null, onPath: false, origin: "COVERAGE_GAP", declaredStatus: "NOT_OBSERVABLE", proposedStatus: "NOT_ASSESSED", status: "NOT_ASSESSED", confirmation: "NOT_A_CLAIM", confirmationReasons: [], review: null, evidenceKind: "NONE", declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: entry.reason, materiality: "LOW", guidance: null, whyItMatters: null, ruleConflict: false, downgrades: ["DECLARED_NOT_ASSESSED_BY_ANALYSIS"], requiredAction: entry.action, argument: argumentOf(primary), obligation: null, contract: "OBLIGATIONS_V1", sources: lines.map((line) => ({ handle: line.handle, lineKey: line.lineKey, text: line.text, heading: line.heading })), titleText: titleOf(primary, lines), identityKey: `${primary.argument ? "AG" : "KC"}-${sha12(lineKey)}` })
  })
  // Obrigações MATERIAIS que só a revisão apontou: mesma montagem e mesmas consequências; seguem para a confirmação focal.
  ;(review?.missed ?? []).forEach((missed, index) => {
    const criterion = obligationCriterion(missed, `R${index + 1}`, "REVIEW_REPAIR")
    if (criterion) criteria.push(criterion)
  })

  for (const reading of duplicateReadings) {
    const existing = criteria.find((criterion) => (criterion.identityKey ?? criterion.lineKey) === reading.identity)
    if (existing) existing.downgrades = [...existing.downgrades, `REVIEW_ALSO_LISTED_AS_MISSED:${reading.handle}:${reading.finding}`]
  }
  // PRODUTO (`PRODUCT_APPLICABILITY_V1`) — ANTES da decisão da revisão: uma regra só é cobrada ou reconhecida com a aplicabilidade
  // ESTABELECIDA para a solicitação. A abrangência vem do cadastro das fontes e da leitura do texto (a revisão só estreita); a
  // identificação, das evidências lidas pela análise e pela revisão (vale a leitura mais restrita). Regra suspensa ou de outro produto
  // não é conclusão a confirmar: não vai à revisão, não é decidida por ela e não conta como "não confirmada".
  let productRecord: ProductApplicabilityRecord | undefined
  if (input.products) {
    const products = input.products
    const scopeViolations: string[] = []
    const scoped = criteria.map((criterion) => {
      const sources = (criterion.sources ?? []).map((source) => source.handle)
      const handles = sources.length > 0 ? sources : /^L\d+$/.test(criterion.lineHandle) ? [criterion.lineHandle] : []
      if (handles.length === 0) return null
      const reading = productReadings.get(criterion.lineHandle) ?? {}
      const result = obligationScopeOf(products, context, handles, reading)
      for (const violation of result.violations) scopeViolations.push(`${criterion.lineHandle}:${violation}`)
      return { scope: result.scope, request: reading.request ?? null }
    })
    const circularTurns = circularTurnsOf(criteria, (index) => scoped[index] !== null && scoped[index]!.scope !== null)
    const identifications = identifyRequests({ context: products, requests: model.requests ?? [], review: input.review ? { readings: input.review.review?.requests ?? [] } : null, interactions, projection, circularTurns })
    const effects: RuleEffectRecord[] = []
    const counts = { independent: 0, established: 0, otherProduct: 0, suspended: 0 }
    criteria.forEach((criterion, index) => {
      const entry = scoped[index]
      if (!entry) return
      const scopeReading = criterion.origin === "REVIEW_REPAIR" ? input.confirmation?.scopeReadings?.get(criterion.lineHandle) ?? null : criterion.origin === "ANALYSIS" ? input.review?.review?.scopeReadings?.get(criterion.lineHandle) ?? null : null
      const scope: RuleScope = reviewedScopeOf(products, entry.scope, scopeReading)
      const identification = requestOfObligation(identifications, entry.request)
      const { effect, reason } = effectOf(scope, identification)
      criterion.productApplicability = { version: PRODUCT_APPLICABILITY_VERSION, request: identification?.ref ?? entry.request, scope: scopeRecordOf(scope), effect, reason }
      counts[effect === "INDEPENDENT" ? "independent" : effect === "ESTABLISHED" ? "established" : effect === "OTHER_PRODUCT" ? "otherProduct" : "suspended"] += 1
      if (effect !== "INDEPENDENT") effects.push({ lineHandle: criterion.lineHandle, ruleKey: criterion.identityKey ?? criterion.lineKey, title: (criterion.titleText ?? criterion.text.split("\n")[0] ?? "").slice(0, 160), request: criterion.productApplicability.request, scope: criterion.productApplicability.scope, effect, reason, statusBefore: criterion.proposedStatus, statusAfter: criterion.proposedStatus })
    })
    productRecord = { version: PRODUCT_APPLICABILITY_VERSION, catalog: catalogRecordOf(products), requests: identifications, effects, counts, violations: scopeViolations }
  }
  const blockedByProduct = (criterion: AssessedCriterion) => criterion.productApplicability?.effect === "SUSPENDED" || criterion.productApplicability?.effect === "OTHER_PRODUCT"

  // CONFIRMAÇÃO das conclusões da análise (revisão) e dos achados só da revisão (confirmação focal) — decisão por código.
  const reviewInput = input.review ?? null
  const sentByHandle = new Map((reviewInput?.sentClaims ?? []).map((claim) => [claim.id, claim]))
  const confirmationInput = input.confirmation ?? null
  const confirmationSent = new Map((confirmationInput?.sentClaims ?? []).map((claim) => [claim.id, claim]))
  const discoveries = new Set(obligationDiscoveriesOf(criteria).map((criterion) => criterion.lineHandle))
  const discoverySummary = { found: discoveries.size, pending: 0, confirmed: 0, refuted: 0, unconfirmed: 0, notRun: 0, notPrioritized: 0 }
  let confirmedCount = 0
  let unconfirmedCount = 0
  let refutedCount = 0
  for (const criterion of criteria) {
    if (!isDeterminate(criterion.proposedStatus) || criterion.ruleConflict || blockedByProduct(criterion)) continue
    const fromReview = criterion.origin === "REVIEW_REPAIR"
    const claim = fromReview ? confirmationSent.get(criterion.lineHandle) : sentByHandle.get(criterion.lineHandle)
    const verdict = fromReview ? confirmationInput?.claims?.get(criterion.lineHandle) ?? null : review?.claims.get(criterion.lineHandle) ?? null
    const conditionEvidence = verdict ? verifyQuotes(verdict.conditionEvidence, interactions, projection).verified : []
    const counterEvidence = verdict ? verifyQuotes(verdict.counterEvidence, interactions, projection).verified : []
    const requireActPlace = Boolean(fromReview ? confirmationInput?.actPlaceRequired : reviewInput?.actPlaceRequired)
    const decide = (sent: ObligationClaim | undefined, available: boolean): ConfirmationDecision => decideObligationConfirmation({ claim: sent ?? obligationClaimOf(criterion), verdict, reviewAvailable: available, verifiedConditionEvidence: conditionEvidence, verifiedCounterEvidence: counterEvidence, evidenceKind: criterion.evidenceKind, requireActPlace })
    let decision: ConfirmationDecision
    if (!reviewInput) decision = { confirmation: "UNCONFIRMED", reasons: ["REVIEW_UNAVAILABLE"] }
    else if (!fromReview) decision = decide(claim, Boolean(review))
    else if (!discoveries.has(criterion.lineHandle)) {
      decision = { confirmation: "UNCONFIRMED", reasons: ["REVIEW_DISCOVERY_NOT_PRIORITIZED"] }
      discoverySummary.notPrioritized += 1
    } else if (confirmationInput?.claims && claim) {
      decision = decide(claim, true)
      if (decision.confirmation === "CONFIRMED") discoverySummary.confirmed += 1
      else if (decision.confirmation === "REFUTED") discoverySummary.refuted += 1
      else discoverySummary.unconfirmed += 1
    } else if (confirmationInput?.attempted) {
      decision = { confirmation: "UNCONFIRMED", reasons: ["CONFIRMATION_NOT_RUN"] }
      discoverySummary.notRun += 1
    } else {
      decision = { confirmation: "UNCONFIRMED", reasons: ["PENDING_CONFIRMATION"] }
      discoverySummary.pending += 1
    }
    criterion.confirmation = decision.confirmation
    criterion.confirmationReasons = decision.reasons
    criterion.review = verdict ? { verdict: verdict.verdict, issues: verdict.issues, listReading: verdict.listReading, conditionEvidence, counterEvidence, note: verdict.note, focus: claim?.focus ?? [], evidenceReading: verdict.evidenceReading ?? null, outsideDependency: verdict.outsideDependency ?? null, ...(verdict.actPlace ? { actPlace: verdict.actPlace, judgedPart: verdict.judgedPart ?? null, outsidePart: verdict.outsidePart ?? null } : {}) } : null
    // `OBLIGATION_SPEECH_EXECUTION_V1`: a revisora leu na FONTE que o ato exigido é feito fora da conversa, e a análise o tinha posto na
    // conversa — a conclusão não se confirma pela fala (relato do resultado comprova a comunicação, não a execução). Fica registrado.
    // A leitura do ATO EXIGIDO é da fonte, não do veredito: lido fora da conversa, a consequência vale mesmo com veredito incerto
    // (rodada real V12: "Verificar…" lido OUTSIDE + UNCERTAIN ficava na memória como "na conversa", com o relato como conduta).
    const readOutside = verdict?.actPlace === "OUTSIDE_CONVERSATION"
    if (readOutside && criterion.observability !== "OUTSIDE_CONVERSATION") criterion.downgrades = [...criterion.downgrades, "ACT_PLACE_READ_OUTSIDE_BY_REVIEW"]
    if (readOutside || decision.reasons.includes("EXECUTION_OUTSIDE_CONVERSATION") || decision.reasons.includes("DECLARATION_IS_NOT_EXECUTION")) {
      criterion.observability = "OUTSIDE_CONVERSATION"
      criterion.executionClaim = criterion.declaredActionTense === "INTENDED" ? "INTENDED" : criterion.evidence.some(isOperator) && (criterion.proposedStatus === "MET" || criterion.proposedStatus === "PARTIAL" || criterion.evidenceKind === "DECLARED_ACTION") ? "DECLARED" : "NONE"
      if (criterion.executionClaim !== "NONE") criterion.evidenceKind = "DECLARED_ACTION"
      criterion.opportunityTurn = null
    }
    if (decision.confirmation === "CONFIRMED") {
      // Obrigação MISTA: a conclusão confirmada vale só para a parte da conversa; a parte operacional fica registrada como tal, com o
      // que a fala mostra sobre ela (declarada/anunciada pelo papel que a análise deu às falas do operador — nunca executada).
      if (verdict?.actPlace === "MIXED" && verdict.judgedPart) {
        const roles = criterion.evidence.map((quote, index) => (isOperator(quote) ? criterion.evidenceRoles?.[index] ?? null : null))
        criterion.judgedPart = verdict.judgedPart
        criterion.operationalPart = verdict.outsidePart ? { text: verdict.outsidePart, executionClaim: roles.includes("DECLARATION") ? "DECLARED" : roles.includes("INTENTION") ? "INTENDED" : "NONE" } : null
      }
      confirmedCount += 1
      continue
    }
    if (decision.confirmation === "REFUTED") refutedCount += 1
    else unconfirmedCount += 1
    criterion.status = "NOT_OBSERVABLE"
    criterion.guidance = null
    criterion.downgrades = [...criterion.downgrades, `${decision.confirmation}:${decision.reasons.join("+")}`]
  }
  // DIVERGÊNCIAS (`REVIEW_DIVERGENCE_V1`): a leitura da revisão (R-n) da MESMA obrigação já passou pela confirmação focal (quando era
  // conferível). Confirmada → substitui a da análise; refutada → fica a da análise; sem decisão → a obrigação fica inconclusiva. A R-n é
  // fundida na obrigação da análise (uma identidade, uma linha na memória).
  const divergenceSummary = { found: divergentOf.size, reviewReadingConfirmed: 0, reviewReadingRefuted: 0, unresolved: 0 }
  for (const [reviewHandle, analysisHandle] of divergentOf) {
    const reading = criteria.find((criterion) => criterion.lineHandle === reviewHandle)
    const target = criteria.find((criterion) => criterion.lineHandle === analysisHandle)
    if (!reading || !target) continue
    // Passagem intermediária (revisão lida, confirmação ainda não pedida): a leitura conferível fica como alvo da confirmação focal.
    if (!confirmationInput && discoveries.has(reviewHandle)) continue
    delete reading.contests
    const outcome = reading.confirmation === "CONFIRMED" ? "REVIEW_READING_CONFIRMED" as const : reading.confirmation === "REFUTED" ? "REVIEW_READING_REFUTED" as const : "UNRESOLVED" as const
    const record = { reviewHandle, analysisStatus: target.status, reviewStatus: reading.proposedStatus, reviewRationale: reading.rationale, outcome, reasons: reading.confirmationReasons.length > 0 ? [...reading.confirmationReasons] : reading.downgrades.slice(-1) }
    if (outcome === "REVIEW_READING_CONFIRMED") {
      divergenceSummary.reviewReadingConfirmed += 1
      Object.assign(target, {
        status: reading.status, proposedStatus: reading.proposedStatus, confirmation: reading.confirmation, confirmationReasons: reading.confirmationReasons, review: reading.review,
        evidenceKind: reading.evidenceKind, declaredActionTense: reading.declaredActionTense, evidence: reading.evidence, evidenceRoles: reading.evidenceRoles, rejectedEvidence: reading.rejectedEvidence,
        opportunityTurn: reading.opportunityTurn, rationale: reading.rationale, materiality: reading.materiality, guidance: reading.guidance, items: reading.items, itemsMode: reading.itemsMode,
        applicability: reading.applicability, applicabilityEvidence: reading.applicabilityEvidence, observability: reading.observability, executionClaim: reading.executionClaim, requiredAction: reading.requiredAction, condition: reading.condition, scenarioRole: reading.scenarioRole ?? target.scenarioRole,
        judgedPart: reading.judgedPart ?? null, operationalPart: reading.operationalPart ?? null,
      })
    } else if (outcome === "REVIEW_READING_REFUTED") divergenceSummary.reviewReadingRefuted += 1
    else {
      divergenceSummary.unresolved += 1
      if (isDeterminate(target.status)) {
        if (target.confirmation === "CONFIRMED") {
          confirmedCount -= 1
          unconfirmedCount += 1
        }
        Object.assign(target, { status: "NOT_OBSERVABLE" as CriterionStatus, confirmation: "UNCONFIRMED" as Confirmation, guidance: null })
      }
      target.confirmationReasons = [...target.confirmationReasons.filter((reason) => reason !== "DIVERGENT_READINGS_UNRESOLVED"), "DIVERGENT_READINGS_UNRESOLVED" as ConfirmationReason]
    }
    target.divergence = record
    target.downgrades = [...target.downgrades, `DIVERGENCE:${outcome}:${reviewHandle}`]
    criteria.splice(criteria.indexOf(reading), 1)
  }

  // POLÍTICA DE EVIDÊNCIA ÚNICA (defesa final): execução fora da conversa nunca fica cumprida, descumprida, parcial nem confirmada.
  for (const criterion of criteria) {
    if (criterion.observability !== "OUTSIDE_CONVERSATION") continue
    const wasDeterminate = isDeterminate(criterion.status)
    if (!wasDeterminate && criterion.confirmation !== "CONFIRMED") continue
    if (criterion.confirmation === "CONFIRMED") {
      confirmedCount -= 1
      unconfirmedCount += 1
    }
    const operatorSpoke = criterion.evidence.some(isOperator)
    const claim: ExecutionClaim = criterion.executionClaim && criterion.executionClaim !== "NONE" ? criterion.executionClaim : criterion.declaredActionTense === "INTENDED" && operatorSpoke ? "INTENDED" : operatorSpoke && (criterion.evidenceKind === "DECLARED_ACTION" || criterion.proposedStatus === "MET" || criterion.proposedStatus === "PARTIAL") ? "DECLARED" : criterion.executionClaim ?? "NONE"
    Object.assign(criterion, {
      status: "NOT_OBSERVABLE" as CriterionStatus,
      confirmation: (criterion.confirmation === "CONFIRMED" || wasDeterminate ? "UNCONFIRMED" : criterion.confirmation) as Confirmation,
      confirmationReasons: [...criterion.confirmationReasons, "EXECUTION_OUTSIDE_CONVERSATION" as ConfirmationReason],
      executionClaim: claim,
      evidenceKind: claim === "NONE" ? (criterion.evidenceKind === "CUSTOMER_CONTEXT" ? "CUSTOMER_CONTEXT" : "NONE") : "DECLARED_ACTION",
      opportunityTurn: null,
      guidance: null,
      whyItMatters: null,
      downgrades: criterion.downgrades.includes("EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT") ? criterion.downgrades : [...criterion.downgrades, "EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"],
    })
  }

  // PRODUTO — consequências (regras marcadas antes da decisão da revisão): suspensa = nem falha, nem acerto, nunca orientação; de outro
  // produto = não se aplica. Vale também para a leitura que a revisão apontou de fora e para itens de argumentário sem avaliação.
  let suspendedFindings = 0
  if (productRecord) {
    for (const criterion of criteria) {
      const applicability = criterion.productApplicability
      if (!applicability || (applicability.effect !== "SUSPENDED" && applicability.effect !== "OTHER_PRODUCT")) continue
      const proposed = isDeterminate(criterion.proposedStatus)
      if (applicability.effect === "SUSPENDED" && (proposed || isDeterminate(criterion.status) || criterion.status === "NOT_ASSESSED")) {
        if (proposed && !criterion.ruleConflict) suspendedFindings += 1
        Object.assign(criterion, {
          status: "NOT_OBSERVABLE" as CriterionStatus,
          confirmation: (proposed ? "UNCONFIRMED" : criterion.confirmation) as Confirmation,
          confirmationReasons: [...criterion.confirmationReasons, "PRODUCT_APPLICABILITY_NOT_ESTABLISHED" as ConfirmationReason],
          applicability: "UNCERTAIN" as const,
          guidance: null,
          whyItMatters: null,
          judgedPart: null,
          operationalPart: null,
          downgrades: [...criterion.downgrades, `PRODUCT_SUSPENDED:${applicability.reason ?? "UNSPECIFIED"}`],
        })
      } else if (applicability.effect === "OTHER_PRODUCT" && criterion.status !== "NOT_APPLICABLE") {
        Object.assign(criterion, {
          status: "NOT_APPLICABLE" as CriterionStatus,
          confirmation: "NOT_A_CLAIM" as Confirmation,
          confirmationReasons: [...criterion.confirmationReasons, "PRODUCT_OUT_OF_RULE_SCOPE" as ConfirmationReason],
          applicability: "DOES_NOT_APPLY" as const,
          guidance: null,
          whyItMatters: null,
          judgedPart: null,
          operationalPart: null,
          downgrades: [...criterion.downgrades, `PRODUCT_OTHER:${applicability.reason ?? "UNSPECIFIED"}`],
        })
      }
    }
    for (const effect of productRecord.effects) effect.statusAfter = criteria.find((criterion) => criterion.lineHandle === effect.lineHandle)?.status ?? effect.statusAfter
    if (suspendedFindings > 0) auditNotes.push(`${suspendedFindings} conclusão(ões) dependem de um produto que a gravação não estabeleceu para a solicitação: ficam sem avaliação (nem falha, nem acerto).`)
  }

  // OCORRÊNCIAS (`CONDUCT_OCCURRENCE_V1`): regras diferentes que julgam a MESMA conduta, no mesmo momento, viram uma ocorrência.
  const linkOf = (criterion: AssessedCriterion) => (criterion.origin === "REVIEW_REPAIR" ? confirmationInput?.claims?.get(criterion.lineHandle)?.sameConductAs : review?.claims.get(criterion.lineHandle)?.sameConductAs) ?? null
  const occurrenceLinks = occurrencesOf(criteria, linkOf, { interactionId: input.interactionId, reviewAvailable: Boolean(review) })
  for (const link of occurrenceLinks.rejected) auditNotes.push(`A revisão indicou que ${link.from} e ${link.to} julgam a mesma conduta, mas a ligação não foi aceita (${link.reason}): ficam como ocorrências separadas.`)

  // NECESSIDADE CENTRAL (`CENTRAL_NEED_V1`): a resposta da revisão cruzada com as conclusões FINAIS das obrigações das mesmas linhas.
  const centralNeed = centralNeedOf(review?.need ?? null, criteria, context, interactions, projection)
  if (centralNeed && (centralNeed.resolution === "GAP_UNCONFIRMED" || centralNeed.resolution === "NOT_DETERMINABLE")) auditNotes.push(centralNeed.resolution === "NOT_DETERMINABLE" ? "A revisão não conseguiu determinar se a necessidade central do cliente foi tratada na conversa: fica em aberto (nem acerto, nem falha)." : "A revisão apontou que a necessidade central do cliente não foi tratada por completo, mas nenhuma obrigação dessas linhas ficou confirmada: fica em aberto (nem acerto, nem falha).")

  // CAMINHO: avaliação da análise → sustentação estrutural → confirmação → completude (CORRECT só com todas as etapas verificadas).
  const pathEvidence: VerifiedQuote[] = []
  const analysisCriteria = criteria.filter((criterion) => criterion.origin === "ANALYSIS")
  let proposedPath: PathAssessment = procedureDocument ? model.conduct.assessment : "NO_PROCEDURE"
  const onPathProposed = (statuses: CriterionStatus[]) => analysisCriteria.some((criterion) => !criterion.ruleConflict && statuses.includes(criterion.proposedStatus))
  if ((proposedPath === "INCORRECT" || proposedPath === "PARTIALLY_CORRECT") && !onPathProposed(["NOT_MET", "PARTIAL"])) {
    proposedPath = "UNDETERMINED"
    auditNotes.push("A análise indicou desvio de caminho, mas nenhuma obrigação proposta como descumprida o sustenta.")
  } else if (proposedPath === "CORRECT" && !onPathProposed(["MET"])) proposedPath = "UNDETERMINED"
  const pathConfirmation: Confirmation = proposedPath === "UNDETERMINED" || proposedPath === "NO_PROCEDURE" ? "NOT_A_CLAIM" : decidePathConfirmation(review?.path ?? null, Boolean(reviewInput && review)).confirmation
  let pathAssessment: PathAssessment = pathConfirmation === "CONFIRMED" || pathConfirmation === "NOT_A_CLAIM" ? proposedPath : "UNDETERMINED"
  const finalOnPath = (statuses: CriterionStatus[], materialOnly = false) => criteria.some((criterion) => criterion.onPath && !criterion.ruleConflict && statuses.includes(criterion.status) && (!materialOnly || criterion.materiality !== "LOW"))
  // Desvio de caminho exige etapa MATERIAL descumprida no conjunto FINAL (definição do próprio contrato): um item de baixa materialidade
  // sozinho não sustenta "caminho inadequado" nem "etapas materiais faltando" (C07 V10: só a marca na saudação sustentava o parcial).
  if ((pathAssessment === "INCORRECT" || pathAssessment === "PARTIALLY_CORRECT") && !finalOnPath(["NOT_MET", "PARTIAL"], true)) {
    if (finalOnPath(["NOT_MET", "PARTIAL"])) auditNotes.push("O único desvio confirmado no caminho é de baixa materialidade: não sustenta, sozinho, um desvio de caminho.")
    pathAssessment = "UNDETERMINED"
  } else if (pathAssessment === "CORRECT" && !finalOnPath(["MET"])) pathAssessment = "UNDETERMINED"
  const pathCompleteness = pathCompletenessOf(criteria)
  if (pathAssessment === "CORRECT" && pathCompleteness.status === "LIMITED") {
    pathAssessment = "UNDETERMINED"
    auditNotes.push("O caminho observável é compatível com o indicado, mas há obrigações que a conversa não permitiu verificar — não se afirma que todas foram seguidas.")
  }

  // CAMINHO VIGENTE (`PATH_VIGENTE_V1`): a leitura da análise só continua sendo o diagnóstico se nenhuma conclusão em que ela se apoia
  // mudou e a avaliação final é a mesma; senão o texto vigente sai das conclusões FINAIS e a leitura original fica na auditoria.
  // Leitura MISTA confirmada também muda o ALCANCE da conclusão (só a parte da conversa) sem mudar o status: a leitura da análise que
  // tratava a obrigação inteira ("abriu análise e encerrou") deixa de representar a evidência.
  const analysisChanged = analysisCriteria.some((criterion) => isDeterminate(criterion.declaredStatus as CriterionStatus) && (criterion.status !== criterion.declaredStatus || criterion.confirmation !== "CONFIRMED" || Boolean(criterion.judgedPart))) || criteria.some((criterion) => criterion.origin === "REVIEW_REPAIR" && isDeterminate(criterion.status))
  const vigente = !analysisChanged && pathAssessment === model.conduct.assessment ? null : vigentePathOf(criteria, pathAssessment)

  const anchored = new Set(input.subjectAnchoredDocumentIds)
  const procedureSelection: VerifiedCallAnalysis["checks"]["procedureSelection"] = !procedureDocument ? "NO_PROCEDURE" : anchored.size === 0 ? "NO_SUBJECT_ANCHOR" : anchored.has(procedureDocument.documentId) ? "CONSISTENT_WITH_SUBJECT" : model.sources.rationale ? "DIFFERENT_FROM_SUBJECT_EXPLAINED" : "DIFFERENT_FROM_SUBJECT_UNEXPLAINED"
  if (reviewInput && !review) auditNotes.push("As conclusões da análise não puderam ser revisadas nesta execução: ficam registradas como hipóteses não confirmadas.")
  if (unconfirmedCount + refutedCount > 0 && review) auditNotes.push(`${unconfirmedCount + refutedCount} conclusão(ões) não foram confirmadas e ficam fora do diagnóstico.`)
  if (discoverySummary.found > 0) auditNotes.push(`${discoverySummary.found} achado(s) encontrado(s) só pela revisão: ${discoverySummary.confirmed} confirmado(s) na confirmação focal, ${discoverySummary.refuted} refutado(s), ${discoverySummary.unconfirmed} incerto(s), ${discoverySummary.notRun + discoverySummary.pending} sem confirmação (inconclusivo).`)
  const missing = criteria.filter((criterion) => criterion.status === "NOT_ASSESSED").map((criterion) => criterion.lineHandle)
  if (missing.length > 0) auditNotes.push(`${missing.length} obrigação(ões)/item(ns) aplicáveis sem avaliação — a análise é parcial.`)

  const findings = criteria.filter((criterion) => isDeterminate(criterion.status) && !criterion.ruleConflict)
  const proposedFindings = criteria.filter((criterion) => isDeterminate(criterion.proposedStatus) && !criterion.ruleConflict)
  const outcomeReasons: string[] = []
  let outcome: VerifiedCallAnalysis["outcome"]
  if (transcriptStatus === "UNAVAILABLE") {
    outcome = "INSUFFICIENT_EVIDENCE"
    outcomeReasons.push("TRANSCRIPT_UNAVAILABLE")
  } else if (!procedureDocument && !scripts.some((script) => script.applicability === "APPLIES")) {
    outcome = "INSUFFICIENT_EVIDENCE"
    outcomeReasons.push("NO_APPLICABLE_PROCEDURE")
  } else if (findings.length === 0) {
    outcome = "INSUFFICIENT_EVIDENCE"
    // Nada útil sustentado porque o que havia dependia de um produto não estabelecido: abstenção com o motivo rastreável.
    const onlyProductDependent = suspendedFindings > 0 && proposedFindings.every((criterion) => criterion.productApplicability?.effect === "SUSPENDED" || criterion.productApplicability?.effect === "OTHER_PRODUCT")
    outcomeReasons.push(proposedFindings.length === 0 ? "NO_VERIFIED_FINDING" : reviewInput && !review ? "REVIEW_UNAVAILABLE" : onlyProductDependent ? "PRODUCT_NOT_ESTABLISHED" : "NO_CONFIRMED_FINDING")
    if (suspendedFindings > 0 && !onlyProductDependent) outcomeReasons.push("PRODUCT_DEPENDENT_POINTS_SUSPENDED")
  } else {
    if (suspendedFindings > 0) outcomeReasons.push("PRODUCT_DEPENDENT_POINTS_SUSPENDED")
    if (missing.length > 0) outcomeReasons.push("COVERAGE_PARTIAL")
    if (procedureSelection === "DIFFERENT_FROM_SUBJECT_UNEXPLAINED") outcomeReasons.push("PROCEDURE_SELECTION_UNEXPLAINED")
    if (transcriptStatus === "INCOMPLETE") outcomeReasons.push("TRANSCRIPT_INCOMPLETE")
    if (unconfirmedCount + refutedCount > 0) outcomeReasons.push("SOME_CONCLUSIONS_UNCONFIRMED")
    outcome = outcomeReasons.length > 0 ? "PARTIAL" : "USABLE"
  }
  const count = (predicate: (criterion: AssessedCriterion) => boolean) => criteria.filter(predicate).length
  return {
    logicVersion: CALL_ANALYSIS_LOGIC_VERSION,
    transcriptStatus,
    scenario: {
      customerNeed: model.need.summary,
      conditions,
      procedureHandle: procedureDocument?.handle ?? null,
      procedureDocumentId: procedureDocument?.documentId ?? null,
      procedureTitle: procedureDocument?.title ?? null,
      procedureVersion: procedureDocument?.version ?? null,
      rulePerspective: procedureDocument?.perspective ?? null,
      procedureRationale: model.sources.rationale,
      pathSections: [...new Map(analysisCriteria.map((criterion) => [criterion.sectionHandle, { handle: criterion.sectionHandle, heading: criterion.heading }])).values()],
      correctPath: "",
      pathTaken: vigente?.pathTaken ?? model.conduct.pathTaken,
      declaredPathAssessment: model.conduct.assessment,
      proposedPathAssessment: proposedPath,
      pathAssessment,
      pathConfirmation,
      pathCompleteness,
      pathRationale: vigente?.rationale ?? model.conduct.rationale,
      pathEvidence,
      pathRationaleSource: vigente ? "FINAL_EVIDENCE" : "ANALYSIS",
      analysisReading: { assessment: model.conduct.assessment, pathTaken: model.conduct.pathTaken, rationale: model.conduct.rationale },
      ...(centralNeed ? { centralNeed } : {}),
    },
    criteria,
    notRequirements: [],
    sectionDispositions: [],
    coverage: { requiredLines: criteria.map((criterion) => criterion.lineHandle), closingSections: [], missing, repairAttempted: Boolean(reviewInput?.attempted), status: missing.length === 0 ? "COMPLETE" : "PARTIAL", byStatus: { assessed: count((criterion) => isDeterminate(criterion.status)), notApplicable: count((criterion) => criterion.status === "NOT_APPLICABLE"), notVerifiable: count((criterion) => criterion.status === "NOT_OBSERVABLE"), notAssessed: missing.length }, occurrences: occurrenceCountsOf(criteria), listItems: { found: inPlay.found, shownToReview: reviewInput?.attempted ? inPlayHandles.size : 0, raisedByReview: raisedFromLists.size }, situations: { declared: situationsInPlay.declared, happened: situationsInPlay.happened, linesFound: situationsInPlay.found, shownToReview: reviewInput?.attempted ? situationHandles.size : 0, raisedByReview: raisedFromSituations.size } },
    sourceConflicts: model.sourceConflicts,
    limitations: [...new Set(model.limitations)],
    argumentScripts: scripts,
    duplicates: [],
    composites: [],
    evidenceAvailability: { transcript: transcriptStatus, ...EVIDENCE_AVAILABILITY_NOW },
    coverageLimits: {
      outsideConversation: count((criterion) => criterion.observability === "OUTSIDE_CONVERSATION" && criterion.status === "NOT_OBSERVABLE"),
      applicabilityUncertain: count((criterion) => criterion.applicability === "UNCERTAIN" && criterion.status === "NOT_OBSERVABLE"),
      declaredExecutions: count((criterion) => criterion.executionClaim === "DECLARED"),
      intendedExecutions: count((criterion) => criterion.executionClaim === "INTENDED"),
      ...(productRecord ? { productNotEstablished: count((criterion) => isSuspendedByProduct(criterion)) } : {}),
    },
    ...(productRecord ? { productApplicability: productRecord } : {}),
    auditNotes: [...new Set(auditNotes)],
    checks: {
      procedureSelection,
      evidenceRejected,
      downgraded,
      contractViolations: violations,
      review: { version: OBLIGATION_REVIEW_VERSION, attempted: Boolean(reviewInput?.attempted), available: Boolean(review), error: reviewInput?.error ?? null, claims: confirmedCount + unconfirmedCount + refutedCount, confirmed: confirmedCount, unconfirmed: unconfirmedCount, refuted: refutedCount, linesAssessed: criteria.filter((criterion) => criterion.origin === "REVIEW_REPAIR").length, path: pathConfirmation, violations: review?.violations ?? [], coverage: { requested: input.review?.requested.linesToAssess.length ?? 0, answered: reviewedLines.size, unanswered: (input.review?.requested.linesToAssess.length ?? 0) - reviewedLines.size, withheld: 0 }, occurrenceLinks: { accepted: occurrenceLinks.accepted, rejected: occurrenceLinks.rejected.length }, discoveries: { ...discoverySummary, duplicatesOfAnalysis: duplicateReadings.length, divergences: divergenceSummary, confirmation: confirmationInput ? { attempted: confirmationInput.attempted, available: Boolean(confirmationInput.claims), reason: confirmationInput.reason, error: confirmationInput.error } : null } },
    },
    outcome,
    outcomeReasons,
  }
}

/**
 * `CENTRAL_NEED_V1` — a pergunta relevante do caso, respondida: o que a revisão leu sobre a necessidade central (falas verificadas) ×
 * as conclusões FINAIS das obrigações que usam as mesmas linhas. Uma falta só é "confirmada" quando uma obrigação dessas linhas ficou
 * confirmada como não cumprida/parcial; a leitura da revisão sozinha nunca vira falha nem acerto.
 */
function centralNeedOf(need: CentralNeedReading | null, criteria: readonly AssessedCriterion[], context: ProcedureContext, interactions: Map<string, ProjectedInteraction>, projection: TranscriptProjection): NonNullable<VerifiedCallAnalysis["scenario"]["centralNeed"]> | null {
  if (!need) return null
  const sources = [...new Set(need.sources.filter((handle) => context.lines.has(handle)))]
  const wanted = new Set(sources)
  const linked = criteria.filter((criterion) => !criterion.ruleConflict && [criterion.lineHandle, ...(criterion.sources ?? []).map((source) => source.handle)].some((handle) => wanted.has(handle)))
  const confirmed = (criterion: AssessedCriterion) => criterion.confirmation === "CONFIRMED" && isDeterminate(criterion.status)
  const gapConfirmed = linked.some((criterion) => confirmed(criterion) && (criterion.status === "NOT_MET" || criterion.status === "PARTIAL"))
  const metConfirmed = linked.some((criterion) => confirmed(criterion) && criterion.status === "MET")
  const refuted = linked.some((criterion) => criterion.confirmation === "REFUTED" || criterion.divergence?.outcome === "REVIEW_READING_REFUTED")
  const resolution = need.status === "NOT_DETERMINABLE" ? "NOT_DETERMINABLE" as const
    : gapConfirmed ? "GAP_CONFIRMED" as const
    : need.status === "ADDRESSED" ? (metConfirmed ? "ADDRESSED_CONFIRMED" as const : "ADDRESSED_REVIEW_ONLY" as const)
    : refuted ? "GAP_REFUTED" as const
    : "GAP_UNCONFIRMED" as const
  const sourceLines = sources.map((handle) => context.lines.get(handle)!).map((line) => ({ handle: line.handle, lineKey: line.lineKey, documentId: line.documentId, text: line.text, heading: line.heading }))
  return { status: need.status, requiredGuidance: need.requiredGuidance, sources, sourceLines, heard: verifyQuotes(need.heard, interactions, projection).verified, unknown: need.unknown, note: need.note, linkedCriteria: linked.map((criterion) => criterion.lineHandle), resolution }
}

/**
 * Achados só da revisão que vão à confirmação focal: desvio determinado, íntegro, aplicável, na conversa (mesma regra das linhas). Uma
 * leitura que CONTESTA a da análise na mesma obrigação (`REVIEW_DIVERGENCE_V1`) vai também quando diz "cumprido" — sem confirmação ela
 * não substituiria nada, e a obrigação ficaria com a leitura da análise só por ordem de execução.
 */
export function obligationDiscoveriesOf(criteria: readonly AssessedCriterion[]): AssessedCriterion[] {
  // `PRODUCT_APPLICABILITY_V1`: achado que depende de produto não estabelecido (ou de outro produto) não vai à confirmação focal.
  return criteria.filter((criterion) => criterion.origin === "REVIEW_REPAIR" && !criterion.ruleConflict && criterion.productApplicability?.effect !== "SUSPENDED" && criterion.productApplicability?.effect !== "OTHER_PRODUCT" && (criterion.proposedStatus === "NOT_MET" || criterion.proposedStatus === "PARTIAL" || (criterion.contests !== undefined && criterion.proposedStatus === "MET")) && criterion.applicability === "APPLIES" && criterion.observability !== "OUTSIDE_CONVERSATION")
}
