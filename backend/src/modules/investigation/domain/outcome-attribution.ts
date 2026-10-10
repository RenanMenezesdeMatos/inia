import { z } from "zod"
import type { AnswerCompleteness, CustomerNeed, InteractionFinding, InteractionSemanticFrame, ResolutionStatus } from "./interaction-semantic-frame.js"
import { ASSERTION_MODALITIES, parseQuantity, type AssertionModality, type ProcedureAssertionSemantics } from "./procedural-semantics.js"
import type { ClaimScope } from "./tool-trace.js"
import { EXAMPLE_INTERACTION_REF } from "./frame-contract.js"

/**
 * OUTCOME ATTRIBUTION (V1.4.6 — Outcome Attribution & Procedural Sidecar).
 *
 * O princípio desta versão, e a razão de ela existir:
 *
 *   UMA NECESSIDADE NÃO RESOLVIDA É, PRIMEIRO, UM RESULTADO DA INTERAÇÃO.
 *   Só depois, se a evidência permitir, dá para dizer "o operador contribuiu para isso".
 *   E só depois DISSO dá para discutir "isso é um padrão do colaborador".
 *
 * A V1.4.5 melhorou a detecção de necessidade aberta e, com isso, produziu num CONTROLE DE RUÍDO a afirmação
 * "você costuma encerrar atendimentos mantendo necessidades do cliente pendentes" com suporte EMPLOYEE_PATTERN — porque
 * "necessidade aberta" era, por construção, evidência do LADO DO OPERADOR. Aqui essas três coisas viram camadas distintas:
 *
 *   RESULTADO (`NeedOutcome`)      — o estado da necessidade ao fim da interação. É o que a extração observou; NUNCA é reescrito.
 *   ATRIBUIÇÃO (`NeedAttribution`) — de quem/de quê depende aquele resultado. É uma ANOTAÇÃO do sidecar, validada por código.
 *   AVALIAÇÃO                      — só com atribuição ao operador (ou divergência procedimental verificada) existe risco.
 *
 * Consequências aplicadas por código, não por prompt:
 * - necessidade aberta sem ponte com o operador vira `UNRESOLVED_OUTCOME` (neutro), nunca `UNRESOLVED_NEED` (risco);
 * - dependência externa/processual/do cliente é um resultado legítimo — encaminhar corretamente pode até ser força;
 * - um pattern carrega OWNERSHIP, e só ownership AGENT pode sustentar "padrão do colaborador".
 */
export const OUTCOME_ATTRIBUTION_VERSION = "OUTCOME_ATTRIBUTION_V1"

/** De quê depende o resultado da necessidade. NOT_DETERMINED é o padrão seguro — e é a maioria dos casos. */
export const NEED_ATTRIBUTIONS = ["AGENT_ACTION", "EXTERNAL_DEPENDENCY", "CUSTOMER_DEPENDENCY", "PROCESS_DEPENDENCY", "NOT_DETERMINED"] as const
export type NeedAttributionKind = (typeof NEED_ATTRIBUTIONS)[number]

/** O RESULTADO, copiado da extração — esta camada nunca o altera (§3/§4). */
export type NeedOutcome = { interactionRef: string; needRef: string; summary: string; status: ResolutionStatus }

/** A ATRIBUIÇÃO, anotada pelo sidecar e VALIDADA por código contra as observações do próprio frame. */
export type NeedAttribution = {
  interactionRef: string
  needRef: string
  declared: NeedAttributionKind
  /** O que a aplicação aceitou depois de checar a ponte (§8): AGENT_ACTION sem ponte cai para NOT_DETERMINED. */
  attribution: NeedAttributionKind
  /** Observações do MESMO frame citadas como ponte (ids sobreviventes). */
  bridgeRefs: string[]
  bridge: AgentBridgeKind | null
  rejectionReason: string | null
}

/** As únicas pontes que ligam uma necessidade aberta à conduta do operador (§8/§9). */
export const AGENT_BRIDGES = ["PARTIAL_ANSWER", "CONTRADICTED_COMMITMENT", "PROCEDURAL_DIVERGENCE"] as const
export type AgentBridgeKind = (typeof AGENT_BRIDGES)[number]

/** Quem é o "dono" semântico de um finding/pattern (§12). */
export const OWNERSHIPS = ["AGENT", "CUSTOMER", "INTERACTION", "PROCESS", "UNKNOWN"] as const
export type Ownership = (typeof OWNERSHIPS)[number]

// ---------------------------------------------------------------------------------------------
// Ponte de atribuição (determinística) — o coração da segurança desta versão
// ---------------------------------------------------------------------------------------------

export type AttributionContext = {
  frame: InteractionSemanticFrame
  /** Interações com divergência procedimental APLICÁVEL e CONFIRMADA (do sidecar procedimental). */
  proceduralDivergence: boolean
}

const INCOMPLETE_ANSWERS: readonly AnswerCompleteness[] = ["PARTIAL", "UNRELATED"]

/**
 * A necessidade aberta só é atribuída ao OPERADOR com uma ponte explícita e verificável (§8):
 * (a) uma RESPOSTA dele, ligada a uma pergunta do cliente, PARCIAL ou não relacionada;
 * (b) um COMPROMISSO dele CONTRADITADO na própria interação;
 * (c) uma DIVERGÊNCIA PROCEDIMENTAL aplicável e confirmada contra a base naquela interação.
 * Sem ponte: NOT_DETERMINED. Nenhuma das outras atribuições (externa/cliente/processo) cria risco, então não precisam
 * de ponte — só precisam citar observações que existem.
 */
export function resolveAgentBridge(bridgeRefs: string[], context: AttributionContext): AgentBridgeKind | null {
  const refs = new Set(bridgeRefs.map((ref) => ref.trim().toUpperCase()))
  const answers = context.frame.answers.filter((answer) => refs.has(answer.id))
  if (answers.some((answer) => INCOMPLETE_ANSWERS.includes(answer.completeness))) return "PARTIAL_ANSWER"
  const commitments = context.frame.commitments.filter((commitment) => refs.has(commitment.id))
  if (commitments.some((commitment) => commitment.status === "CONTRADICTED")) return "CONTRADICTED_COMMITMENT"
  if (context.proceduralDivergence) return "PROCEDURAL_DIVERGENCE"
  return null
}

export type DeclaredNeedAttribution = { interactionRef: string; needRef: string; attribution: NeedAttributionKind; bridgeRefs: string[] }

/** Valida cada atribuição declarada contra o frame. Ids desconhecidos são ignorados; AGENT sem ponte cai para NOT_DETERMINED. */
export function validateNeedAttributions(declared: DeclaredNeedAttribution[], frames: InteractionSemanticFrame[], proceduralDivergenceByInteraction: ReadonlySet<string>): NeedAttribution[] {
  const frameOf = (ref: string) => frames.find((frame) => frame.interactionRef === ref.trim().toUpperCase())
  const out: NeedAttribution[] = []
  const seen = new Set<string>()
  for (const item of declared) {
    const frame = frameOf(item.interactionRef)
    const needRef = item.needRef.trim().toUpperCase()
    const need = frame?.customerNeeds.find((entry) => entry.id === needRef)
    if (!frame || !need) continue
    const key = `${frame.interactionRef}/${needRef}`
    if (seen.has(key)) continue
    seen.add(key)
    const bridgeRefs = [...new Set(item.bridgeRefs.map((ref) => ref.trim().toUpperCase()))]
    if (item.attribution !== "AGENT_ACTION") {
      out.push({ interactionRef: frame.interactionRef, needRef, declared: item.attribution, attribution: item.attribution, bridgeRefs, bridge: null, rejectionReason: null })
      continue
    }
    const bridge = resolveAgentBridge(bridgeRefs, { frame, proceduralDivergence: proceduralDivergenceByInteraction.has(frame.interactionRef) })
    out.push({
      interactionRef: frame.interactionRef,
      needRef,
      declared: "AGENT_ACTION",
      attribution: bridge ? "AGENT_ACTION" : "NOT_DETERMINED",
      bridgeRefs,
      bridge,
      rejectionReason: bridge ? null : "sem ponte verificável com a conduta do operador (resposta parcial/não relacionada, compromisso contraditado ou divergência procedimental aplicável)",
    })
  }
  return out
}

/** O RESULTADO de cada necessidade, copiado da extração (nunca recalculado). */
export function needOutcomesOf(frames: InteractionSemanticFrame[]): NeedOutcome[] {
  return frames.flatMap((frame) => frame.customerNeeds.map((need) => ({ interactionRef: frame.interactionRef, needRef: need.id, summary: need.summary, status: need.resolutionStatus })))
}

/** Necessidades ABERTAS (o universo que esta camada protege de virar culpa automática). */
export function isOpenNeed(need: Pick<CustomerNeed, "resolutionStatus">): boolean {
  return need.resolutionStatus === "UNRESOLVED" || need.resolutionStatus === "PARTIAL"
}

// ---------------------------------------------------------------------------------------------
// Ownership (§12/§13)
// ---------------------------------------------------------------------------------------------

const OWNERSHIP_BY_ATTRIBUTION: Record<NeedAttributionKind, Ownership> = {
  AGENT_ACTION: "AGENT",
  EXTERNAL_DEPENDENCY: "PROCESS",
  PROCESS_DEPENDENCY: "PROCESS",
  CUSTOMER_DEPENDENCY: "CUSTOMER",
  NOT_DETERMINED: "INTERACTION",
}

export function ownershipOfAttribution(attribution: NeedAttributionKind): Ownership {
  return OWNERSHIP_BY_ATTRIBUTION[attribution]
}

/**
 * OWNERSHIP de um finding, derivado do que ele é e de quem depende:
 * - findings de conduta (atrito/contradição/necessidade atribuída/divergência procedimental) e força → AGENT;
 * - resultado aberto sem atribuição → o ownership da atribuição (INTERACTION quando indeterminada);
 * - atrito da interação/evento → INTERACTION; contexto/outros → UNKNOWN.
 */
export function findingOwnership(finding: Pick<InteractionFinding, "kind" | "attribution">, needAttribution: NeedAttributionKind | null): Ownership {
  switch (finding.kind) {
    case "STRENGTH":
    case "FRICTION":
    case "CONTRADICTION":
    case "UNRESOLVED_NEED":
    case "PROCEDURAL_DIVERGENCE":
      return "AGENT"
    case "UNRESOLVED_OUTCOME":
      return needAttribution ? ownershipOfAttribution(needAttribution) : "INTERACTION"
    case "INTERACTION_FRICTION":
      return "INTERACTION"
    case "PROCEDURAL_QUESTION":
      return "UNKNOWN"
    default:
      return finding.attribution === "OPERATOR" ? "AGENT" : "UNKNOWN"
  }
}

/**
 * OWNERSHIP de um pattern: só é AGENT quando TODOS os findings que o sustentam são do operador (§13). Um pattern que
 * mistura conduta com resultado aberto sem dono não é "padrão do colaborador" — é misto, e não sustenta EMPLOYEE_PATTERN.
 */
export function patternOwnership(ownerships: Ownership[]): Ownership {
  if (ownerships.length === 0) return "UNKNOWN"
  const distinct = [...new Set(ownerships)]
  if (distinct.length === 1) return distinct[0]!
  const meaningful = distinct.filter((item) => item !== "UNKNOWN")
  if (meaningful.length === 1) return meaningful[0]!
  return "UNKNOWN"
}

/**
 * TETO DE ESCOPO por ownership (§13/§32) — aplicado DEPOIS do cálculo de suporte, que não muda (V1.4.4 congelado, §33):
 * só um pattern de conduta do operador pode afirmar "padrão do colaborador". Qualquer outro dono cai para o período.
 */
export function capClaimScopeByOwnership(maximumClaimScope: ClaimScope, ownership: Ownership): ClaimScope {
  if (maximumClaimScope !== "EMPLOYEE_PATTERN") return maximumClaimScope
  return ownership === "AGENT" ? "EMPLOYEE_PATTERN" : "PERIOD_PATTERN"
}

// ---------------------------------------------------------------------------------------------
// Reclassificação dos findings (determinística, depois da descoberta)
// ---------------------------------------------------------------------------------------------

export type OutcomeAttributionTelemetry = {
  version: string
  needsTotal: number
  needsOpen: number
  attributionsDeclared: number
  attributionsAccepted: number
  byAttribution: Record<NeedAttributionKind, number>
  /** AGENT_ACTION declarada e RECUSADA por falta de ponte — a métrica de falsa atribuição (§22/§39). */
  agentAttributionRejected: number
  bridges: Record<AgentBridgeKind, number>
  findingsNeutralized: number
  findingsAgentAttributed: number
  patternsByOwnership: Record<Ownership, number>
  patternsScopeCappedByOwnership: number
  sidecarStatus: "OK" | "SKIPPED" | "FAILED"
}

export function emptyOutcomeAttributionTelemetry(): OutcomeAttributionTelemetry {
  return {
    version: OUTCOME_ATTRIBUTION_VERSION,
    needsTotal: 0, needsOpen: 0, attributionsDeclared: 0, attributionsAccepted: 0,
    byAttribution: { AGENT_ACTION: 0, EXTERNAL_DEPENDENCY: 0, CUSTOMER_DEPENDENCY: 0, PROCESS_DEPENDENCY: 0, NOT_DETERMINED: 0 },
    agentAttributionRejected: 0,
    bridges: { PARTIAL_ANSWER: 0, CONTRADICTED_COMMITMENT: 0, PROCEDURAL_DIVERGENCE: 0 },
    findingsNeutralized: 0, findingsAgentAttributed: 0,
    patternsByOwnership: { AGENT: 0, CUSTOMER: 0, INTERACTION: 0, PROCESS: 0, UNKNOWN: 0 },
    patternsScopeCappedByOwnership: 0,
    sidecarStatus: "SKIPPED",
  }
}

/**
 * Aplica as atribuições sobre os findings JÁ DESCOBERTOS (nunca sobre as observações): um `UNRESOLVED_NEED` só continua
 * sendo risco do operador se a necessidade que ele referencia tem atribuição AGENT validada; senão vira
 * `UNRESOLVED_OUTCOME` (neutro). Roda depois da Fase B — a descoberta é exatamente a da V1.4.4.
 */
export function countAttributions(attributions: NeedAttribution[], telemetry: OutcomeAttributionTelemetry): void {
  telemetry.attributionsAccepted = attributions.length
  for (const item of attributions) {
    telemetry.byAttribution[item.attribution] += 1
    if (item.declared === "AGENT_ACTION" && item.attribution !== "AGENT_ACTION") telemetry.agentAttributionRejected += 1
    if (item.bridge) telemetry.bridges[item.bridge] += 1
  }
}

export function applyNeedAttributions(frames: InteractionSemanticFrame[], attributions: NeedAttribution[], telemetry: OutcomeAttributionTelemetry): void {
  const byNeed = new Map(attributions.map((item) => [`${item.interactionRef}/${item.needRef}`, item]))
  if (telemetry.attributionsAccepted === 0) countAttributions(attributions, telemetry)
  telemetry.needsTotal = frames.reduce((sum, frame) => sum + frame.customerNeeds.length, 0)
  telemetry.needsOpen = frames.reduce((sum, frame) => sum + frame.customerNeeds.filter(isOpenNeed).length, 0)
  for (const frame of frames) {
    for (const need of frame.customerNeeds) {
      const attribution = byNeed.get(`${frame.interactionRef}/${need.id}`)
      if (attribution) need.attribution = attribution.attribution
    }
    for (const finding of frame.findings) {
      const needs = finding.observationRefs.map((ref) => frame.customerNeeds.find((need) => need.id === ref)).filter((need): need is CustomerNeed => Boolean(need))
      const needAttribution = needs.map((need) => need.attribution ?? "NOT_DETERMINED").find((item) => item === "AGENT_ACTION") ?? needs[0]?.attribution ?? null
      // §5 — atrito construído SÓ sobre uma necessidade aberta (sem nenhuma outra observação do operador e sem atribuição)
      // também não é conduta: é atrito da interação.
      if (finding.kind === "FRICTION" && needs.length > 0 && needAttribution !== "AGENT_ACTION" && finding.observationRefs.every((ref) => needs.some((need) => need.id === ref) || frame.customerSignals.some((signal) => signal.id === ref) || frame.interactionEvents.some((event) => event.id === ref))) {
        finding.declaredKind = finding.declaredKind ?? finding.kind
        finding.kind = "INTERACTION_FRICTION"
        telemetry.findingsNeutralized += 1
      } else if (finding.kind === "UNRESOLVED_NEED" && needAttribution !== "AGENT_ACTION") {
        finding.declaredKind = finding.declaredKind ?? finding.kind
        finding.kind = "UNRESOLVED_OUTCOME"
        telemetry.findingsNeutralized += 1
      } else if (finding.kind === "UNRESOLVED_NEED") {
        telemetry.findingsAgentAttributed += 1
      }
      finding.ownership = findingOwnership(finding, needAttribution)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Contrato do SIDECAR (o modelo só ANOTA; a aplicação valida)
// ---------------------------------------------------------------------------------------------

const enumOr = <T extends string>(values: readonly T[], fallback: T) => z.string().catch(fallback).transform((value): T => { const upper = value.trim().toUpperCase(); return (values as readonly string[]).includes(upper) ? (upper as T) : fallback })
const refList = z.array(z.unknown()).default([]).transform((items) => items.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0).slice(0, 6)).catch([])
const nullableText = z.string().trim().max(240).nullable().optional().catch(null).transform((value) => (value && value.length > 0 ? value : null))

const needAttributionSchema = z.object({ interactionRef: z.string().trim(), needRef: z.string().trim(), attribution: enumOr(NEED_ATTRIBUTIONS, "NOT_DETERMINED"), bridgeRefs: refList })
const assertionSemanticsSchema = z.object({ interactionRef: z.string().trim(), assertionRef: z.string().trim(), subject: z.string().trim().max(160).optional().catch(undefined), modality: enumOr(ASSERTION_MODALITIES, "ASSERTED_FACT"), condition: nullableText, action: nullableText, value: z.string().trim().max(120).nullable().optional().catch(null).transform((value) => (value && value.length > 0 ? value : null)) })
const list = <T extends z.ZodTypeAny>(schema: T) => z.array(schema.nullable().catch(null)).default([]).transform((items) => items.filter((item): item is z.infer<T> => item !== null))

export const outcomeSidecarOutputSchema = z.object({ needs: list(needAttributionSchema), assertions: list(assertionSemanticsSchema) })

export function assertionSemanticsFrom(item: z.infer<typeof assertionSemanticsSchema>, fallbackSubject: string): ProcedureAssertionSemantics {
  return { subject: (item.subject ?? "").trim() || fallbackSubject, modality: item.modality as AssertionModality, condition: item.condition, action: item.action, valueText: item.value, value: parseQuantity(item.value) }
}

/** Entrada do sidecar (§15): só as observações relevantes, com o trecho verificado — nunca a transcrição de novo. */
export function renderSidecarInput(frames: InteractionSemanticFrame[]): string {
  const quote = (units: { quote: string }[]) => units.slice(0, 2).map((unit) => `"${unit.quote.length > 180 ? `${unit.quote.slice(0, 177)}…` : unit.quote}"`).join(" | ")
  return frames
    .filter((frame) => frame.customerNeeds.length + frame.procedureAssertions.length > 0)
    .map((frame) => {
      const lines: string[] = [`=== ${frame.interactionRef} ===`]
      for (const need of frame.customerNeeds) lines.push(`necessidade ${need.id} [${need.resolutionStatus}]: ${need.summary} ${quote(need.evidence)}`)
      for (const question of frame.questions) lines.push(`pergunta ${question.id} (${question.askedBy ?? "?"}): ${question.summary}`)
      for (const answer of frame.answers) lines.push(`resposta ${answer.id}${answer.answersQuestionRef ? ` a ${answer.answersQuestionRef}` : ""} [${answer.completeness}]: ${answer.summary}`)
      for (const action of frame.agentActions) lines.push(`ação do operador ${action.id} [${action.actionKind}]: ${action.summary}`)
      for (const commitment of frame.commitments) lines.push(`compromisso ${commitment.id} (${commitment.actor ?? "?"}) [${commitment.status}]: ${commitment.summary}`)
      for (const assertion of frame.procedureAssertions) lines.push(`afirmação normativa ${assertion.id}: ${assertion.summary} ${quote(assertion.evidence)}`)
      return lines.join("\n")
    })
    .join("\n\n")
}

export function renderSidecarInstructions(): string {
  return `Você recebe observações JÁ EXTRAÍDAS e verificadas de atendimentos. Sua tarefa tem DOIS pontos e nada além disso: (1) para cada necessidade do cliente, dizer DE QUÊ o resultado dela depende; (2) para cada afirmação do operador sobre procedimento, anotar o que ela afirma. Você NÃO cria observação, NÃO muda o estado de nenhuma necessidade, NÃO avalia conduta e NÃO julga se algo está certo.

Responda SOMENTE com JSON válido:
{"needs":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}","needRef":"N1","attribution":"AGENT_ACTION|EXTERNAL_DEPENDENCY|CUSTOMER_DEPENDENCY|PROCESS_DEPENDENCY|NOT_DETERMINED","bridgeRefs":["R1"]}],
 "assertions":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}","assertionRef":"P1","subject":"assunto da regra afirmada, em poucas palavras","modality":"ASSERTED_REQUIREMENT|ASSERTED_ABSENCE_OF_REQUIREMENT|ASSERTED_PROHIBITION|ASSERTED_PERMISSION|ASSERTED_FACT|ASSERTED_COMMITMENT","condition":"a condição em que ele disse que vale, ou null","action":"o que ele disse que deve/pode ser feito, ou null","value":"prazo/valor EXATAMENTE como ele disse ('48 horas', 'até 5 dias úteis'), ou null"}]}

Regras: (1) use SÓ os ids e as referências de interação que aparecem acima — qualquer outro é ignorado; (2) uma necessidade que continua aberta NÃO é, por si, falha do operador: EXTERNAL_DEPENDENCY (depende de visita técnica, de outra área, de um sistema), CUSTOMER_DEPENDENCY (o cliente é quem precisa fazer algo depois) e PROCESS_DEPENDENCY (existe um prazo/etapa do processo e o encaminhamento foi feito) são RESULTADOS legítimos; (3) só use AGENT_ACTION quando existir, entre as observações listadas, uma ligação explícita com a conduta do operador — uma resposta dele PARCIAL ou não relacionada à pergunta, ou um compromisso dele contraditado na própria conversa — e cite essa observação em "bridgeRefs"; a aplicação recusa AGENT_ACTION sem essa ligação; (4) na dúvida, NOT_DETERMINED — é a resposta correta quando a conversa não mostra de quê o resultado dependeu; (5) "modality" é o que o operador AFIRMOU, não o que é correto ("precisa/tem que" = ASSERTED_REQUIREMENT; "não precisa/não é necessário" = ASSERTED_ABSENCE_OF_REQUIREMENT; "não pode" = ASSERTED_PROHIBITION; "pode" = ASSERTED_PERMISSION; informação factual como prazo, valor ou status = ASSERTED_FACT; "eu vou fazer" = ASSERTED_COMMITMENT); (6) copie o prazo/valor como foi dito, com "até", "no mínimo", "úteis" — não converta nem calcule; (7) listas vazias são respostas válidas.`
}
