import { z } from "zod"

export const prohibitedTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  requiredBehavior: z.string(),
  active: z.boolean(),
})
export type ProhibitedTopic = z.infer<typeof prohibitedTopicSchema>

export const glossaryTermSchema = z.object({
  id: z.string(),
  term: z.string(),
  definition: z.string(),
  feedbackApplication: z.string(),
  active: z.boolean(),
})
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>
