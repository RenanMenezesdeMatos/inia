import { z } from "zod"

/** Espelho de backend/src/modules/conversational-delivery (Workflow Outputs V1). */
export const avatarDeliveryStatusSchema = z.enum(["PENDING", "OFFERED", "ACCEPTED", "PLAYING", "DELIVERED", "SNOOZED", "FAILED", "INTERRUPTED"])
export type AvatarDeliveryStatus = z.infer<typeof avatarDeliveryStatusSchema>

export const avatarDeliveryEventSchema = z.enum(["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_COMPLETED", "PLAYBACK_FAILED", "PLAYBACK_INTERRUPTED", "SNOOZE"])
export type AvatarDeliveryEvent = z.infer<typeof avatarDeliveryEventSchema>
export type AvatarFailureReason = "SPEECH_UNAVAILABLE" | "SPEECH_ERROR" | "AUDIO_BLOCKED" | "NO_VOICE" | "UNKNOWN"

export const avatarDeliverySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** O que o avatar fala (texto puro). */
  speechText: z.string(),
  /** O recado por escrito (Markdown), sempre visível junto do convite. */
  displayText: z.string(),
  status: avatarDeliveryStatusSchema,
  createdAt: z.string(),
  offeredAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  playingAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  snoozedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  attemptCount: z.number(),
})
export type AvatarDelivery = z.infer<typeof avatarDeliverySchema>

export const iniaInboxSchema = z.object({
  avatarDeliveries: z.array(avatarDeliverySchema),
  unreadConversations: z.array(z.object({ id: z.string(), title: z.string(), startedAt: z.string() })),
})
export type IniaInbox = z.infer<typeof iniaInboxSchema>
