import { z } from "zod"
import { ANJO_PAUSE_REASONS, ANJO_UNRESPONSIVE_LIMITS, HUMAN_SUPPORT_LIMITS, RESPONSE_TIMES_LIMITS } from "../domain/catalogs.js"
import { SCOPE_STATES } from "../domain/enablement.js"

/** Corpos e consultas do Apoio com Anjo (design_draft.md, Apêndice C), sempre `.strict()`: campo a mais é recusado. */
const id = z.string().uuid()
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max)

export const stateQuerySchema = z.object({ since: z.string().regex(/^\d{1,18}$/).optional(), wait: int(0, HUMAN_SUPPORT_LIMITS.longPollMaxSeconds).default(0), workspace: z.enum(["anjo", "anjo-status", "none"]).default("none") }).strict()
export const sourceSchema = z.object({ interactionId: id.optional(), ratingId: id.optional() }).strict()
export const createRequestSchema = z.object({ clientRequestId: id, interactionId: id.optional(), ratingId: id.optional(), note: z.string().max(HUMAN_SUPPORT_LIMITS.noteMaxChars * 2).transform((value) => value.trim()).pipe(z.string().max(HUMAN_SUPPORT_LIMITS.noteMaxChars)).optional() }).strict()
export const messagesQuerySchema = z.object({ after: int(0, 1_000_000).optional(), before: int(1, 1_000_000).optional(), limit: int(1, HUMAN_SUPPORT_LIMITS.messagesPageMax).optional() }).strict()
export const sendMessageSchema = z.object({ clientMessageId: id, body: z.string().max(HUMAN_SUPPORT_LIMITS.messageMaxChars * 2).transform((value) => value.trim()).pipe(z.string().min(1).max(HUMAN_SUPPORT_LIMITS.messageMaxChars)) }).strict()
export const typingSchema = z.object({ typing: z.boolean() }).strict()
export const receiptsSchema = z
  .object({ deliveredSeq: z.number().int().min(0).max(1_000_000).optional(), readSeq: z.number().int().min(0).max(1_000_000).optional() })
  .strict()
  .refine((value) => value.deliveredSeq !== undefined || value.readSeq !== undefined, { message: "Informe deliveredSeq ou readSeq." })
export const closeSchema = z.object({ cause: z.literal("OPERATOR_ABSENT").optional() }).strict()
export const presenceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("AVAILABLE") }).strict(),
  z.object({ status: z.literal("PAUSED"), pauseReason: z.enum(ANJO_PAUSE_REASONS) }).strict(),
  z.object({ status: z.literal("OFFLINE") }).strict(),
])
export const listQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: int(1, 50).optional() }).strict()
export const settingsSchema = z.object({ enabled: z.boolean(), defaultCapacity: z.number().int().min(HUMAN_SUPPORT_LIMITS.capacityMin).max(HUMAN_SUPPORT_LIMITS.capacityMax), version: z.number().int().min(0) }).strict()
/** Tempos de resposta (migration 193); a regra entre eles (encerramento depois da volta à fila) fica em `responseTimesProblem`. */
export const responseTimesSchema = z
  .object({
    operatorRequeueMinutes: z.number().int().min(RESPONSE_TIMES_LIMITS.requeueMin).max(RESPONSE_TIMES_LIMITS.requeueMax),
    operatorCloseMinutes: z.number().int().min(RESPONSE_TIMES_LIMITS.requeueMin + 1).max(RESPONSE_TIMES_LIMITS.closeMax),
    anjoRequeueMinutes: z.number().int().min(RESPONSE_TIMES_LIMITS.requeueMin).max(RESPONSE_TIMES_LIMITS.requeueMax),
    /** Anjo sem responder ninguém (migration 195): pausa "Desconexão" e, depois dela, Indisponível. */
    anjoUnresponsive: z.object({ pauseAfterMinutes: z.number().int().min(1).max(ANJO_UNRESPONSIVE_LIMITS.pauseAfterMax), offlineAfterMinutes: z.number().int().min(1).max(ANJO_UNRESPONSIVE_LIMITS.offlineAfterMax) }).strict(),
    version: z.number().int().min(0),
  })
  .strict()
const timesShape = {
  operatorRequeueMinutes: z.number().int().min(RESPONSE_TIMES_LIMITS.requeueMin).max(RESPONSE_TIMES_LIMITS.requeueMax),
  operatorCloseMinutes: z.number().int().min(RESPONSE_TIMES_LIMITS.requeueMin + 1).max(RESPONSE_TIMES_LIMITS.closeMax),
  anjoRequeueMinutes: z.number().int().min(RESPONSE_TIMES_LIMITS.requeueMin).max(RESPONSE_TIMES_LIMITS.requeueMax),
}
/** Tempos de um Grupo (migration 194): `times = null` = voltar ao padrão da organização. */
export const groupResponseTimesSchema = z.object({ times: z.object(timesShape).strict().nullable(), version: z.number().int().min(0) }).strict()
export const scopeParamsSchema = z.object({ scopeType: z.enum(["group", "subgroup"]), id }).strict()
export const scopeStateSchema = z.object({ state: z.enum(SCOPE_STATES) }).strict()
export const anjosQuerySchema = z.object({ teamId: id.optional(), subteamId: id.optional() }).strict()
export const capacitySchema = z.object({ maxConcurrent: z.number().int().min(HUMAN_SUPPORT_LIMITS.capacityMin).max(HUMAN_SUPPORT_LIMITS.capacityMax).nullable() }).strict()
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const panelQuerySchema = z.object({ from: civilDate, to: civilDate, teamId: id.optional(), subteamId: id.optional() }).strict()
export const panelListQuerySchema = panelQuerySchema.extend({ search: z.string().trim().max(100).optional(), status: z.enum(["WAITING", "IN_PROGRESS", "AWAITING_OPERATOR", "CLOSED", "CANCELLED", "EXPIRED", "ABANDONED"]).optional(), origin: z.enum(["BUTTON", "DISLIKE", "SIGNAL"]).optional(), cursor: z.string().max(200).optional(), limit: int(1, 50).optional() }).strict()
export const attemptsQuerySchema = panelQuerySchema.extend({ cursor: z.string().max(200).optional(), limit: int(1, 50).optional() }).strict()
export const anjosNowQuerySchema = z.object({ teamId: id.optional(), subteamId: id.optional() }).strict()
export const timelineQuerySchema = z.object({ from: civilDate, to: civilDate }).strict()
/** Acionamentos do período (aba Indicadores): o filtro opcional de produtivo × não produtivo × não avaliado. */
export const demandQuerySchema = panelQuerySchema.extend({ productivity: z.enum(["PRODUCTIVE", "NOT_PRODUCTIVE", "NOT_EVALUATED"]).optional() }).strict()
/** Histórico da operação do Anjo (migration 191): período, Grupo/Subgrupo e um Anjo (coordenação); o próprio Anjo só o período. */
export const historyQuerySchema = panelQuerySchema.extend({ anjoPersonId: id.optional() }).strict()
export const idParamSchema = id
/** Transferência pela coordenação (migration 190): para um Anjo (`toAnjoPersonId`) ou de volta à frente da fila (`null`), com motivo. */
export const transferSchema = z
  .object({
    toAnjoPersonId: id.nullable(),
    reason: z.string().max(HUMAN_SUPPORT_LIMITS.transferReasonMax * 2).transform((value) => value.trim()).pipe(z.string().min(HUMAN_SUPPORT_LIMITS.transferReasonMin).max(HUMAN_SUPPORT_LIMITS.transferReasonMax)),
  })
  .strict()
