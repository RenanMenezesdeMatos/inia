import { z } from "zod"

/** Espelho de backend/src/modules/people/domain/my-journey.ts + application/my-journey.ts ("Minha jornada"). */
export const journeyDayKindSchema = z.enum(["WORK", "DAY_OFF", "EXCEPTION", "EMPLOYMENT_STATUS", "HOLIDAY", "NO_SCHEDULE", "BEFORE_HIRE"])
export type JourneyDayKind = z.infer<typeof journeyDayKindSchema>

export const journeyBlockKindSchema = z.enum(["SHIFT", "LOGGED_IN", "BREAK", "OTHER", "NON_WORKING"])
export type JourneyBlockKind = z.infer<typeof journeyBlockKindSchema>

export const journeyShiftSchema = z.object({ start: z.string(), end: z.string(), crossesMidnight: z.boolean(), source: z.enum(["SCHEDULE_DAY", "ACTIVITIES", "WORK_SHIFT"]) })
export type JourneyShift = z.infer<typeof journeyShiftSchema>

export const journeyActivitySchema = z.object({ type: z.enum(["LOGGED_IN", "BREAK", "OTHER"]), typeLabel: z.string(), name: z.string(), start: z.string(), end: z.string(), crossesMidnight: z.boolean() })
export type JourneyActivity = z.infer<typeof journeyActivitySchema>

export const journeyBlockSchema = z.object({
  kind: journeyBlockKindSchema,
  label: z.string(),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
  continuesFromPreviousDay: z.boolean(),
  continuesNextDay: z.boolean(),
})
export type JourneyBlock = z.infer<typeof journeyBlockSchema>

export const journeyDaySchema = z.object({
  date: z.string(),
  kind: journeyDayKindSchema,
  label: z.string(),
  shift: journeyShiftSchema.nullable(),
  exceptions: z.array(z.object({ id: z.string(), code: z.string(), label: z.string(), originLabel: z.string() })),
  activities: z.array(journeyActivitySchema),
  blocks: z.array(journeyBlockSchema),
})
export type JourneyDay = z.infer<typeof journeyDaySchema>

export const myJourneyViewSchema = z.object({
  today: z.string(),
  timeZone: z.string(),
  generatedAt: z.string(),
  week: z.object({ from: z.string(), to: z.string(), previous: z.string(), next: z.string(), containsToday: z.boolean() }),
  pauses: z.object({ available: z.boolean(), message: z.string() }),
  days: z.array(journeyDaySchema),
})
export type MyJourneyView = z.infer<typeof myJourneyViewSchema>
