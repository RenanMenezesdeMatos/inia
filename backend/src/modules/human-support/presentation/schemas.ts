import { z } from "zod"
import { HUMAN_SUPPORT_LIMITS, PAUSE_REASONS_V1 } from "../domain/catalogs.js"
import { SCOPE_STATES } from "../domain/enablement.js"

/** Corpos e consultas do Apoio com Anjo (design_draft.md, Apêndice C), sempre `.strict()`: campo a mais é recusado. */
const id = z.string().uuid()
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max)

export const stateQuerySchema = z.object({ since: z.string().regex(/^\d{1,18}$/).optional(), wait: int(0, HUMAN_SUPPORT_LIMITS.longPollMaxSeconds).default(0), workspace: z.enum(["anjo", "none"]).default("none") }).strict()
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
  z.object({ status: z.literal("PAUSED"), pauseReason: z.enum(PAUSE_REASONS_V1) }).strict(),
  z.object({ status: z.literal("OFFLINE") }).strict(),
])
export const listQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: int(1, 50).optional() }).strict()
export const settingsSchema = z.object({ enabled: z.boolean(), defaultCapacity: z.number().int().min(HUMAN_SUPPORT_LIMITS.capacityMin).max(HUMAN_SUPPORT_LIMITS.capacityMax), version: z.number().int().min(0) }).strict()
export const scopeParamsSchema = z.object({ scopeType: z.enum(["group", "subgroup"]), id }).strict()
export const scopeStateSchema = z.object({ state: z.enum(SCOPE_STATES) }).strict()
export const anjosQuerySchema = z.object({ teamId: id.optional(), subteamId: id.optional() }).strict()
export const capacitySchema = z.object({ maxConcurrent: z.number().int().min(HUMAN_SUPPORT_LIMITS.capacityMin).max(HUMAN_SUPPORT_LIMITS.capacityMax).nullable() }).strict()
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const panelQuerySchema = z.object({ from: civilDate, to: civilDate, teamId: id.optional(), subteamId: id.optional() }).strict()
export const panelListQuerySchema = panelQuerySchema.extend({ search: z.string().trim().max(100).optional(), status: z.enum(["WAITING", "IN_PROGRESS", "CLOSED", "CANCELLED", "EXPIRED", "ABANDONED"]).optional(), origin: z.enum(["BUTTON", "DISLIKE", "SIGNAL"]).optional(), cursor: z.string().max(200).optional(), limit: int(1, 50).optional() }).strict()
export const attemptsQuerySchema = panelQuerySchema.extend({ cursor: z.string().max(200).optional(), limit: int(1, 50).optional() }).strict()
export const anjosNowQuerySchema = z.object({ teamId: id.optional(), subteamId: id.optional() }).strict()
export const timelineQuerySchema = z.object({ from: civilDate, to: civilDate }).strict()
export const idParamSchema = id
