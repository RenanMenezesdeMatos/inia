import { z } from "zod"
import { addDays, localToInstant } from "./freshness.js"

/**
 * DISPONIBILIDADE ESPERADA DOS DADOS (expected data availability) — "a partir de quando esta fonte
 * já DEVERIA conter o dia D?". Conceito distinto de tudo que já existe na Central:
 *  - Connection health: consigo chegar na fonte?                       (fonte)
 *  - Freshness: a última carga chegou dentro da cadência?              (feed)
 *  - Horizonte da escala: até que dia o calendário é conhecido?        (escala)
 *  - DISPONIBILIDADE: o dado referente a D chega em D+lagDays até HH:MM (fuso da organização). (aqui)
 * Um feed pode ter sincronizado hoje às 08:00 (FRESH) e o dado de ontem só ser esperado às 11:00 —
 * FRESH não significa "dia fechado". Sem política configurada a INIA NÃO assume D+1: o estado é
 * AVAILABILITY_UNKNOWN e nenhuma ausência é concluída automaticamente.
 */
export const availabilityPolicySchema = z.object({
  /** Dias de atraso esperados: 0 = mesmo dia, 1 = D-1, 2 = D-2. */
  lagDays: z.number().int().min(0).max(14),
  /** Horário local (HH:MM, fuso da organização) até o qual o dado de D deve estar carregado em D+lagDays. */
  availableByLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})
export type AvailabilityPolicy = z.infer<typeof availabilityPolicySchema>

/** Rótulo de UI: "D-1 até 11:00" (o usuário pensa em D-1/D-2; internamente é `lagDays`). */
export function describeAvailabilityPolicy(policy: AvailabilityPolicy | null): string {
  if (!policy) return "SLA de disponibilidade não configurado"
  return policy.lagDays === 0 ? `No mesmo dia até ${policy.availableByLocalTime}` : `D-${policy.lagDays} até ${policy.availableByLocalTime}`
}

/** Instante real (UTC) a partir do qual a fonte já deveria conter `workDate` — nunca UTC implícito. */
export function expectedAvailableAt(workDate: string, policy: AvailabilityPolicy, timeZone: string): Date {
  return localToInstant(addDays(workDate, policy.lagDays), policy.availableByLocalTime, timeZone)
}

/**
 * Estado de UMA fonte para UM dia:
 *  UNKNOWN — sem política: não dá para dizer se o dado já deveria ter chegado;
 *  WAITING — antes do prazo: o dado ainda pode chegar (não é atraso de ninguém);
 *  READY   — depois do prazo E a fonte teve a oportunidade de entregar D (carga bem-sucedida após o
 *            prazo, ou dado de negócio já cobrindo D);
 *  DELAYED — depois do prazo e SEM carga bem-sucedida após ele: fonte atrasada/falhando — problema de
 *            DADO, nunca ausência do colaborador.
 */
export type SourceAvailabilityState = "UNKNOWN" | "WAITING" | "READY" | "DELAYED"

export const SOURCE_AVAILABILITY_LABELS: Record<SourceAvailabilityState, string> = {
  UNKNOWN: "SLA não configurado",
  WAITING: "Dentro do prazo",
  READY: "Recebido",
  DELAYED: "Atrasado",
}

export type SourceAvailabilityInput = {
  policy: AvailabilityPolicy | null
  workDate: string
  now: Date
  timeZone: string
  lastSuccessAt: Date | null
  /** Data LOCAL (AAAA-MM-DD) do último dado de negócio carregado (maior periodEnd/eventTime), quando o feed a conhece. */
  lastDataLocalDate: string | null
}

export type SourceAvailability = { state: SourceAvailabilityState; expectedAt: Date | null }

export function resolveSourceAvailability(input: SourceAvailabilityInput): SourceAvailability {
  if (!input.policy) return { state: "UNKNOWN", expectedAt: null }
  const expectedAt = expectedAvailableAt(input.workDate, input.policy, input.timeZone)
  if (input.now.getTime() < expectedAt.getTime()) return { state: "WAITING", expectedAt }
  const deliveredByRun = input.lastSuccessAt !== null && input.lastSuccessAt.getTime() >= expectedAt.getTime()
  const deliveredByData = input.lastDataLocalDate !== null && input.lastDataLocalDate >= input.workDate
  return { state: deliveredByRun || deliveredByData ? "READY" : "DELAYED", expectedAt }
}

/** Combina fontes de um mesmo grupo: UNKNOWN > WAITING > DELAYED > READY (a mais conservadora decide). */
export function combineSourceAvailability(states: SourceAvailabilityState[]): SourceAvailabilityState {
  if (states.length === 0) return "UNKNOWN"
  if (states.includes("UNKNOWN")) return "UNKNOWN"
  if (states.includes("WAITING")) return "WAITING"
  if (states.includes("DELAYED")) return "DELAYED"
  return "READY"
}
