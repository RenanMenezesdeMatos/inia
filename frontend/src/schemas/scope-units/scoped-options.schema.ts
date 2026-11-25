import { z } from "zod"

/**
 * Opção de Grupo, Subgrupo ou pessoa das telas de acompanhamento (`…/unit-options`, `…/filter-options`), em lotes e só no alcance de
 * quem vê a tela. No Subgrupo e na pessoa, o Grupo (e o Subgrupo) distinguem nomes iguais.
 */
export const scopedOptionSchema = z.object({
  kind: z.enum(["TEAM", "SUBTEAM", "PERSON"]),
  id: z.string(),
  name: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  operatingUniverse: z.string().nullable(),
  matricula: z.string().nullable(),
  role: z.string().nullable(),
  jobTitle: z.string().nullable(),
})
export type ScopedOption = z.infer<typeof scopedOptionSchema>
export type ScopedOptionKind = ScopedOption["kind"]

export const scopedOptionPageSchema = z.object({ items: z.array(scopedOptionSchema), nextCursor: z.string().nullable() })
export type ScopedOptionPage = z.infer<typeof scopedOptionPageSchema>
