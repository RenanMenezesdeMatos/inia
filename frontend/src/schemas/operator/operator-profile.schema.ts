//src\schemas\operator\operator-profile.schema.ts

import { z } from "zod"

export const operatorProfileSchema = z.object({
  name: z.string(),
  role: z.string(),
  avatarUrl: z.string().nullable(),
  periodLabel: z.string(),
  assistantName: z.string(),
  assistantImage: z.string(),
  /** Nome de exibição e de tratamento resolvidos pelo backend (preferência da pessoa × cadastro). `name` segue cadastral. */
  displayName: z.string().optional(),
  addressName: z.string().nullable().optional(),
})

export type OperatorProfile = z.infer<typeof operatorProfileSchema>