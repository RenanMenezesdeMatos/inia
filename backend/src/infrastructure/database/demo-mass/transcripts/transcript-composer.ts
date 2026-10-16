import type { Domain } from "../indicator-catalog.js"
import type { Persona } from "../personas.js"
import type { Random } from "../random.js"
import {
  ANGRY_OPENERS, CALM_DOWN, CLOSING_ASK, CLOSING_GOODBYE, CLOSING_NO, CONFIRM_UNDERSTANDING, CONFIRM_YES, CUSTOMER_ACK,
  CUSTOMER_ACK_ANNOYED, CUSTOMER_GOODBYE, CUSTOMER_INTRO, DEEPENING_EXCHANGES, FILLER_EXCHANGES, GREETINGS, HOLD_ACK, HOLD_REQUEST, HOLD_RETURN,
  IDENTIFICATION, IDENTIFICATION_B2B, INAUDIBLE_NOTES, RECALL_ACK, RECALL_OPENING, SATISFIED_CLOSING, THREATS, UNSATISFIED_CLOSING, cl, op,
} from "./phrase-pools.js"
import { SCENARIO_BY_KEY, SCENARIO_WEIGHTS_BY_DOMAIN, type ScenarioSpec } from "./scenario-library.js"
import { LENGTH_TURN_RANGE, type CallContext, type CallPlan, type ComposedTranscript, type CustomerTone, type OperationalFailure, type Outcome, type ScenarioKey, type TranscriptLength, type Turn } from "./transcript-types.js"

/**
 * Compositor de transcrições: decide o ROTEIRO (cenário, duração, tom, desfecho, falhas,
 * inconclusividade, rechamada, pesquisa) e depois escreve as falas a partir da biblioteca de
 * cenários + pools de frases. Nada aqui é IA — é composição determinística por PRNG, com
 * variação suficiente pra 20 mil chamadas não parecerem carimbadas.
 */
const FAILURES: readonly OperationalFailure[] = [
  "SEM_CONFIRMACAO_ENTENDIMENTO", "EXPLICACAO_INCOMPLETA", "INFORMACAO_DIVERGENTE", "TRANSFERENCIA_PREMATURA",
  "SEM_ENCERRAMENTO", "SEM_ALTERNATIVA", "PROCEDIMENTO_INTERROMPIDO", "RETORNO_SEM_CONTEXTO",
]

/** Probabilidade de a chamada ter pelo menos uma falha operacional, coerente com a história de performance. */
export function failureProbability(persona: Persona, monthProgress: number): number {
  switch (persona) {
    case "ALTA_PERFORMANCE": return 0.08
    case "CRITICO": return 0.6
    case "EM_EVOLUCAO": return 0.6 - 0.45 * monthProgress
    case "EM_QUEDA": return 0.15 + 0.45 * monthProgress
    case "EFICIENTE_BAIXA_QUALIDADE": return 0.5
    case "QUALIDADE_BOA_TMA_RUIM": return 0.12
    default: return 0.3
  }
}

function pickWeighted<T extends string>(random: Random, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][]
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = random.next() * total
  for (const [key, weight] of entries) {
    cursor -= weight
    if (cursor <= 0) return key
  }
  return entries[entries.length - 1]![0]
}

export function pickLength(random: Random, persona: Persona): TranscriptLength {
  // Eficiente = chamadas mais curtas; TMA ruim = mais longas. Distribuição global ≈ 45/40/15.
  const shortBias = persona === "EFICIENTE_BAIXA_QUALIDADE" ? 0.15 : persona === "QUALIDADE_BOA_TMA_RUIM" ? -0.15 : 0
  const roll = random.next()
  if (roll < 0.45 + shortBias) return "CURTA"
  if (roll < 0.85 + shortBias / 2) return "MEDIA"
  return "LONGA"
}

export function buildCallPlan(random: Random, input: { domain: Domain; persona: Persona; monthProgress: number; scenarioKey?: ScenarioKey; length?: TranscriptLength }): CallPlan {
  const scenario = input.scenarioKey ?? pickWeighted(random, SCENARIO_WEIGHTS_BY_DOMAIN[input.domain])
  let length = input.length ?? pickLength(random, input.persona)
  const hasFailure = random.chance(failureProbability(input.persona, input.monthProgress))
  const failures: OperationalFailure[] = []
  if (hasFailure) {
    failures.push(random.pick(FAILURES))
    if (random.chance(0.25)) {
      const second = random.pick(FAILURES)
      if (!failures.includes(second)) failures.push(second)
    }
  }
  const outcome = pickOutcome(random, failures)
  // Transferência prematura = chamada curta por definição (o operador nem chegou a tratar).
  if (failures.includes("TRANSFERENCIA_PREMATURA")) length = "CURTA"
  const tone = pickTone(random, outcome, failures.length > 0)
  const isRecall = random.chance(scenario === "RECLAMACAO" ? 0.3 : 0.08)
  const inconclusive = random.chance(0.08) ? random.pick(["INICIO_SEM_AUDIO", "TRECHO_INAUDIVEL", "GRAVACAO_INTERROMPIDA"] as const) : null
  const surveyScore = random.chance(0.14) ? surveyFor(random, tone) : null
  const secondaryScenario = (length === "LONGA" && random.chance(0.85)) || (length === "MEDIA" && random.chance(0.15)) ? pickSecondary(random, input.domain, scenario) : null
  return {
    scenario, secondaryScenario, length, tone, outcome, failures, inconclusive, isRecall, surveyScore,
    holdSeconds: 0,
    plainFormat: random.chance(0.02),
  }
}

function pickSecondary(random: Random, domain: Domain, primary: ScenarioKey): ScenarioKey | null {
  const candidates: ScenarioKey[] =
    domain === "FATURAMENTO" ? ["CANCELAMENTO", "MUDANCA_PLANO", "SUPORTE_APP", "ALTERACAO_VENCIMENTO"]
    : domain === "RETENCAO" ? ["DUVIDA_FATURA", "SUPORTE_QUEDA_CONEXAO", "ALTERACAO_CADASTRAL"]
    : domain === "SUPORTE" ? ["DUVIDA_FATURA", "MUDANCA_PLANO", "INFORMACAO_GERAL"]
    : ["DUVIDA_FATURA", "SUPORTE_LENTIDAO", "MUDANCA_PLANO", "SEGUNDA_VIA"]
  const pick = random.pick(candidates)
  return pick === primary ? null : pick
}

function pickOutcome(random: Random, failures: OperationalFailure[]): Outcome {
  if (failures.includes("TRANSFERENCIA_PREMATURA")) return "TRANSFERIDO"
  if (failures.includes("RETORNO_SEM_CONTEXTO")) return "RETORNO_PROMETIDO"
  if (failures.includes("PROCEDIMENTO_INTERROMPIDO")) return random.pick(["PARCIAL", "NAO_RESOLVIDO"])
  const roll = random.next()
  if (failures.length > 0) {
    if (roll < 0.3) return "RESOLVIDO"
    if (roll < 0.55) return "PARCIAL"
    if (roll < 0.7) return "TRANSFERIDO"
    if (roll < 0.85) return "RETORNO_PROMETIDO"
    return "NAO_RESOLVIDO"
  }
  if (roll < 0.65) return "RESOLVIDO"
  if (roll < 0.84) return "PARCIAL"
  if (roll < 0.88) return "TRANSFERIDO"
  if (roll < 0.97) return "RETORNO_PROMETIDO"
  return "NAO_RESOLVIDO"
}

function pickTone(random: Random, outcome: Outcome, failed: boolean): CustomerTone {
  const roll = random.next()
  if (outcome === "NAO_RESOLVIDO") return roll < 0.75 ? "INSATISFEITO_FINAL" : "FRUSTRADO"
  if (outcome === "RESOLVIDO") {
    if (roll < 0.45) return "SATISFEITO"
    if (roll < 0.75) return "NEUTRO"
    if (roll < 0.92) return "IRRITADO_DEPOIS_SATISFEITO"
    return failed ? "FRUSTRADO" : "SATISFEITO"
  }
  if (roll < 0.4) return "NEUTRO"
  if (roll < 0.62) return "FRUSTRADO"
  if (roll < 0.85) return "IRRITADO_DEPOIS_SATISFEITO"
  if (roll < 0.93) return "SATISFEITO"
  return failed ? "INSATISFEITO_FINAL" : "NEUTRO"
}

function surveyFor(random: Random, tone: CustomerTone): number {
  switch (tone) {
    case "SATISFEITO": return random.pick([5, 5, 5, 4])
    case "NEUTRO": return random.pick([3, 4, 4, 5])
    case "FRUSTRADO": return random.pick([1, 2, 2, 3])
    case "IRRITADO_DEPOIS_SATISFEITO": return random.pick([3, 4, 5, 5])
    case "INSATISFEITO_FINAL": return random.pick([1, 1, 2])
  }
}

/** Só esperas longas viram flag `tempo_silencio` (a fonte real marca silêncio prolongado, não qualquer "um momento"). */
export const TEMPO_SILENCIO_FLAG_THRESHOLD = 180

type HoldTracker = { seconds: number }

function hold(ctx: CallContext, tracker: HoldTracker, long: boolean): Turn[] {
  const seconds = long ? ctx.random.int(40, 140) : ctx.random.int(8, 30)
  tracker.seconds += seconds
  const turns = [op(ctx.random.pick(HOLD_REQUEST)), cl(ctx.random.pick(HOLD_ACK)), op(ctx.random.pick(HOLD_RETURN)(ctx))]
  if (long && ctx.random.chance(0.5)) turns.splice(2, 0, cl("Alô? Ainda está aí?"), op("Estou sim, só mais um instante."))
  return turns
}

export function composeTranscript(ctx: CallContext, plan: CallPlan): ComposedTranscript {
  const random = ctx.random
  const scenario = SCENARIO_BY_KEY.get(plan.scenario)!
  const secondary = plan.secondaryScenario ? SCENARIO_BY_KEY.get(plan.secondaryScenario)! : null
  const range = LENGTH_TURN_RANGE[plan.length]
  const targetTurns = random.int(range.min, range.max)
  const tracker: HoldTracker = { seconds: 0 }
  const turns: Turn[] = []
  const has = (failure: OperationalFailure) => plan.failures.includes(failure)
  const angry = plan.tone === "FRUSTRADO" || plan.tone === "IRRITADO_DEPOIS_SATISFEITO" || plan.tone === "INSATISFEITO_FINAL"

  // 1. Abertura + identificação (ausente quando a gravação começou depois — inconclusivo).
  if (plan.inconclusive === "INICIO_SEM_AUDIO") {
    turns.push(op(`${random.pick(INAUDIBLE_NOTES)} ...então me confirma o que está acontecendo, por favor?`))
  } else {
    turns.push(op(random.pick(GREETINGS)(ctx)), cl(random.pick(CUSTOMER_INTRO)(ctx)))
    turns.push(...random.pick(ctx.segment === "B2B" ? IDENTIFICATION_B2B : IDENTIFICATION)(ctx))
  }

  // 2. Motivo (com rechamada e/ou irritação inicial quando for o caso).
  const opening = scenario.opening(ctx)
  if (angry) turns.push(cl(random.pick(ANGRY_OPENERS)))
  if (plan.isRecall) {
    turns.push(cl(random.pick(RECALL_OPENING)(ctx)))
    turns.push(op(random.pick(RECALL_ACK)(ctx)))
  }
  turns.push(...opening)
  if (angry) turns.push(op(random.pick(CALM_DOWN)(ctx)))

  // 3. Confirmação de entendimento (omitida = falha auditável).
  if (!has("SEM_CONFIRMACAO_ENTENDIMENTO")) {
    turns.push(op(random.pick(CONFIRM_UNDERSTANDING)(scenario.summary(ctx))), cl(random.pick(CONFIRM_YES)))
  }

  // 4. Tratativa: blocos de investigação do cenário, depois o 2º assunto (chamadas longas),
  //    depois aprofundamentos e trocas curtas — cada trecho usado no máximo uma vez por chamada.
  const closingBudget = plan.length === "CURTA" ? 5 : 8
  const bodyTarget = targetTurns - turns.length - closingBudget
  const investigationBlocks = (has("TRANSFERENCIA_PREMATURA") ? scenario.investigation.slice(0, 1) : scenario.investigation).map((block) => block(ctx)).filter((block) => block.length > 0)
  // Toda chamada tem tratativa de verdade: pelo menos 2 blocos (1 se transferida cedo), mesmo curta.
  const minimumBlocks = Math.min(investigationBlocks.length, has("TRANSFERENCIA_PREMATURA") ? 1 : 2)
  const body: Turn[] = []
  let blockIndex = 0
  while (blockIndex < investigationBlocks.length && (body.length < bodyTarget || blockIndex < minimumBlocks)) {
    body.push(...investigationBlocks[blockIndex]!)
    blockIndex += 1
    if (random.chance(0.35)) body.push(...hold(ctx, tracker, plan.length !== "CURTA" && random.chance(0.2)))
  }
  if (secondary && !has("TRANSFERENCIA_PREMATURA")) {
    body.push(cl(random.pick(["Aproveitando, tem outra coisa.", "Já que estou na linha, mais uma coisa.", "Ah, e outra coisa que eu queria ver."])))
    body.push(...secondary.opening(ctx))
    if (!has("SEM_CONFIRMACAO_ENTENDIMENTO")) body.push(op(random.pick(CONFIRM_UNDERSTANDING)(secondary.summary(ctx))), cl(random.pick(CONFIRM_YES)))
    for (const block of secondary.investigation.map((item) => item(ctx)).filter((item) => item.length > 0)) {
      body.push(...block)
      if (random.chance(0.3)) body.push(...hold(ctx, tracker, random.chance(0.25)))
    }
    body.push(...secondary.resolution[plan.outcome === "TRANSFERIDO" ? "PARCIAL" : plan.outcome](ctx))
  }
  const extras = random.shuffle([...DEEPENING_EXCHANGES, ...FILLER_EXCHANGES])
  let extraIndex = 0
  while (body.length < bodyTarget && extraIndex < extras.length && !has("TRANSFERENCIA_PREMATURA")) {
    if (angry && plan.tone !== "IRRITADO_DEPOIS_SATISFEITO" && random.chance(0.15)) {
      body.push(cl(random.pick(THREATS)), op(random.pick(CALM_DOWN)(ctx)))
      continue
    }
    body.push(...extras[extraIndex]!(ctx))
    extraIndex += 1
    if (random.chance(0.2)) body.push(...hold(ctx, tracker, random.chance(0.25)))
  }
  if (plan.inconclusive === "TRECHO_INAUDIVEL" && body.length > 4) {
    const at = random.int(2, body.length - 2)
    body.splice(at, 1, { speaker: body[at]!.speaker, text: `${random.pick(INAUDIBLE_NOTES)}` })
  }
  turns.push(...body)

  // Cliente que encerra insatisfeito sempre verbaliza isso na conversa (a flag `detrator` precisa de evidência literal).
  if (plan.tone === "INSATISFEITO_FINAL") turns.push(cl(random.pick(THREATS)), op(random.pick(CALM_DOWN)(ctx)))

  // 5. Divergência de processo (falha) e alternativa prevista (omitida = falha).
  if (has("INFORMACAO_DIVERGENTE")) turns.push(...scenario.divergent(ctx))
  if (has("PROCEDIMENTO_INTERROMPIDO")) {
    turns.push(op(random.pick(["Vou finalizar o registro aqui... na verdade, deixa pra lá, isso o sistema faz sozinho depois.", "Ia registrar a solicitação, mas o sistema travou. Vamos deixar assim por enquanto.", "Não vou conseguir concluir esse passo agora, mas não deve fazer diferença."])))
    turns.push(cl(random.pick(["Como assim, deixa pra lá?", "Tá... e aí?", "Mas isso não vai ficar pendente?"])))
  }

  // 6. Desfecho.
  const outcomeTurns = scenario.resolution[plan.outcome](ctx)
  if (has("EXPLICACAO_INCOMPLETA")) {
    turns.push(outcomeTurns[0]!)
    turns.push(cl(random.pick(["Tá, mas e o resto? Como fica o valor?", "Certo, mas você não me explicou o prazo.", "E o que eu faço agora exatamente?"])))
    turns.push(op(random.pick(["Isso já está tudo registrado no protocolo.", "Fica tranquilo, está tudo certo.", "Depois o senhor vê no aplicativo."])))
  } else {
    turns.push(...outcomeTurns)
  }
  if (plan.outcome === "RETORNO_PROMETIDO" && has("RETORNO_SEM_CONTEXTO")) {
    turns.push(cl(random.pick(["Retorno de quem? Sobre o quê exatamente?", "E quem vai ligar? Que horas?", "Mas retorno pra dizer o quê?"])))
    turns.push(op(random.pick(["Alguém entra em contato.", "A equipe responsável, no prazo deles.", "Vai ficar registrado, o senhor vai ser avisado."])))
  }
  if (!has("SEM_ALTERNATIVA") && plan.outcome !== "TRANSFERIDO" && random.chance(0.7)) turns.push(...scenario.alternative(ctx))

  // 7. Encerramento (omitido = falha; interrompido = inconclusivo).
  if (plan.inconclusive === "GRAVACAO_INTERROMPIDA") {
    turns.push(op(random.pick(["Então, só pra finalizar, o protocolo é...", "Perfeito. Vou passar o número do protocolo, anota aí:", "Certo. Então ficamos assim, e o protocolo"])))
    turns.push(cl(`${random.pick(INAUDIBLE_NOTES)}`))
  } else if (has("SEM_ENCERRAMENTO") || plan.outcome === "TRANSFERIDO") {
    if (plan.outcome === "TRANSFERIDO") turns.push(op(random.pick(["Transferindo agora, um momento.", "Vou transferir a ligação, aguarde na linha.", "Só um instante, transferindo."])))
    else turns.push(op(random.pick(["Tá bom então.", "É isso.", "Ok."])))
  } else {
    if (plan.tone === "INSATISFEITO_FINAL") {
      turns.push(op(random.pick(CLOSING_ASK)), cl(random.pick(UNSATISFIED_CLOSING)), op(random.pick(CLOSING_GOODBYE)(ctx)))
    } else if (plan.tone === "SATISFEITO" || plan.tone === "IRRITADO_DEPOIS_SATISFEITO") {
      turns.push(op(random.pick(CLOSING_ASK)), cl(random.pick(SATISFIED_CLOSING)(ctx)), op(random.pick(CLOSING_GOODBYE)(ctx)), cl(random.pick(CUSTOMER_GOODBYE)(ctx)))
    } else {
      turns.push(op(random.pick(CLOSING_ASK)), cl(plan.tone === "FRUSTRADO" ? random.pick(CUSTOMER_ACK_ANNOYED) : random.pick(CLOSING_NO)(ctx)), op(random.pick(CLOSING_GOODBYE)(ctx)), cl(random.pick(CUSTOMER_GOODBYE)(ctx)))
    }
  }

  if (random.chance(0.15)) turns.splice(random.int(3, Math.max(3, turns.length - 3)), 0, cl(random.pick(CUSTOMER_ACK)))

  const finalPlan: CallPlan = { ...plan, holdSeconds: tracker.seconds }
  const flags = deriveFlags(finalPlan, scenario, secondary)
  const durationSeconds = turns.length * random.int(5, 8) + tracker.seconds
  return { turns, content: renderContent(turns, finalPlan.plainFormat), reason: buildReason(random, scenario, secondary, finalPlan), motive: scenario.motive, plan: finalPlan, flags, durationSeconds }
}

function buildReason(random: Random, scenario: ScenarioSpec, secondary: ScenarioSpec | null, plan: CallPlan): string {
  const base = random.pick(scenario.reasons)
  if (secondary) return `${base} e ${random.pick(secondary.reasons).toLowerCase()}`
  if (plan.isRecall) return `${base} (rechamada)`
  return base
}

/** Flags que a transcrição SUSTENTA semanticamente — nunca uma flag sem o tema aparecer na conversa. */
export function deriveFlags(plan: CallPlan, scenario: ScenarioSpec, secondary: ScenarioSpec | null): Record<string, boolean | number> {
  const flags: Record<string, boolean | number> = {}
  for (const flag of [...scenario.impliedFlags, ...(secondary?.impliedFlags ?? [])]) flags[flag] = true
  if (plan.isRecall) flags.rechamada = true
  if (plan.outcome === "TRANSFERIDO") flags.transferencia = true
  if (plan.tone === "INSATISFEITO_FINAL") flags.detrator = true
  if (plan.surveyScore !== null) flags.nota_ura = plan.surveyScore
  if (plan.holdSeconds >= TEMPO_SILENCIO_FLAG_THRESHOLD) flags.tempo_silencio = plan.holdSeconds
  return flags
}

/** Uma fala por linha ("Operador: …"/"Cliente: …"); formato plain = texto corrido sem rótulos. */
export function renderContent(turns: Turn[], plain: boolean): string {
  if (plain) return turns.map((turn) => turn.text).join(" ")
  return turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")
}
