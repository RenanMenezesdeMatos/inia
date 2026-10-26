import { z } from "zod"

/**
 * CHAMADA BOA × RUIM NO SINAL (`channel_flags.call_outcome`, migration 156). A INIA não supõe nada sobre um sinal: o que é um valor
 * bom ou ruim é cadastro (um sinal novo amanhã é só configuração). Numérico: uma condição para o bom e outra para o ruim — o meio
 * fica de fora, e as duas nunca se sobrepõem. Sim/não: qual valor é o ruim; o oposto, quando enviado, é o bom. Chamada SEM o sinal
 * nunca é boa nem ruim (dado ausente não é resultado). Usado para comparar chamadas na base de boas práticas.
 */
export const SIGNAL_OPERATORS = ["GTE", "GT", "LTE", "LT", "EQ"] as const
export type SignalOperator = (typeof SIGNAL_OPERATORS)[number]
export const signalConditionSchema = z.object({ operator: z.enum(SIGNAL_OPERATORS), value: z.number().finite() })
export type SignalCondition = z.infer<typeof signalConditionSchema>

type Interval = { min: number; minOpen: boolean; max: number; maxOpen: boolean }
function intervalOf(condition: SignalCondition): Interval {
  switch (condition.operator) {
    case "GTE": return { min: condition.value, minOpen: false, max: Infinity, maxOpen: true }
    case "GT": return { min: condition.value, minOpen: true, max: Infinity, maxOpen: true }
    case "LTE": return { min: -Infinity, minOpen: true, max: condition.value, maxOpen: false }
    case "LT": return { min: -Infinity, minOpen: true, max: condition.value, maxOpen: true }
    case "EQ": return { min: condition.value, minOpen: false, max: condition.value, maxOpen: false }
  }
}
/** As faixas de bom e ruim têm algum valor em comum (cadastro ambíguo). */
export function conditionsOverlap(a: SignalCondition, b: SignalCondition): boolean {
  const x = intervalOf(a)
  const y = intervalOf(b)
  const low = Math.max(x.min, y.min)
  const high = Math.min(x.max, y.max)
  if (low < high) return true
  if (low > high) return false
  const lowOpen = (x.min === low && x.minOpen) || (y.min === low && y.minOpen)
  const highOpen = (x.max === high && x.maxOpen) || (y.max === high && y.maxOpen)
  return !lowOpen && !highOpen
}

export const callOutcomeSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("NUMERIC"), good: signalConditionSchema, bad: signalConditionSchema }),
    z.object({ kind: z.literal("BOOLEAN"), badValue: z.boolean() }),
  ])
  .refine((outcome) => outcome.kind !== "NUMERIC" || !conditionsOverlap(outcome.good, outcome.bad), { message: "As faixas de chamada boa e ruim não podem ter valores em comum." })
export type CallOutcome = z.infer<typeof callOutcomeSchema>

/** Valor do sinal numa chamada (como chegou em `interaction_flags`); ausente = sem o sinal. */
export type SignalValue = { boolean: boolean | null; numeric: number | null }
export type CallOutcomeGroup = "GOOD" | "BAD"

function satisfies(condition: SignalCondition, value: number): boolean {
  switch (condition.operator) {
    case "GTE": return value >= condition.value
    case "GT": return value > condition.value
    case "LTE": return value <= condition.value
    case "LT": return value < condition.value
    case "EQ": return value === condition.value
  }
}

/** Boa, ruim ou fora (nulo): sem o sinal, valor no meio ou de outro tipo. */
export function callOutcomeOf(outcome: CallOutcome, value: SignalValue | null | undefined): CallOutcomeGroup | null {
  if (!value) return null
  if (outcome.kind === "BOOLEAN") return value.boolean === null ? null : value.boolean === outcome.badValue ? "BAD" : "GOOD"
  if (value.numeric === null) return null
  if (satisfies(outcome.good, value.numeric)) return "GOOD"
  if (satisfies(outcome.bad, value.numeric)) return "BAD"
  return null
}

const OPERATOR_TEXT: Record<SignalOperator, string> = { GTE: "≥", GT: ">", LTE: "≤", LT: "<", EQ: "=" }
const numberText = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
export const conditionText = (condition: SignalCondition) => `${OPERATOR_TEXT[condition.operator]} ${numberText(condition.value)}`

/** Rótulos para a tela, a análise e o feedback: "Nota da URA ≥ 4" / "Rechamada = não". */
export function callOutcomeLabelsOf(signalName: string, outcome: CallOutcome): { good: string; bad: string } {
  if (outcome.kind === "BOOLEAN") return { good: `${signalName} = ${outcome.badValue ? "não" : "sim"}`, bad: `${signalName} = ${outcome.badValue ? "sim" : "não"}` }
  return { good: `${signalName} ${conditionText(outcome.good)}`, bad: `${signalName} ${conditionText(outcome.bad)}` }
}
