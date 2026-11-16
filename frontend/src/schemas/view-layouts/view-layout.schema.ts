import { z } from "zod"

import { CARD_ROWS_MAX, CARD_WIDTHS } from "@/components/ui/customizable-grid/layout"

/** Disposição personalizada de uma tela (contrato do servidor, migration 192). */
export const VIEW_LAYOUT_KEYS = ["anjos.indicadores", "anjos.monitoria-online", "anjos.jornada"] as const
export type ViewLayoutKey = (typeof VIEW_LAYOUT_KEYS)[number]

const cardSchema = z.object({ id: z.string(), hidden: z.boolean(), w: z.union(CARD_WIDTHS.map((width) => z.literal(width)) as [z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<6>, z.ZodLiteral<8>, z.ZodLiteral<9>, z.ZodLiteral<12>]), h: z.number().int().min(1).max(CARD_ROWS_MAX).nullable() })
export const viewLayoutSchema = z.object({ version: z.literal(1), sections: z.array(z.object({ id: z.string(), hidden: z.boolean(), cards: z.array(cardSchema) })) })
export const savedViewLayoutSchema = z.object({ layout: viewLayoutSchema.nullable(), updatedAt: z.string().nullable() })
export type SavedViewLayout = z.infer<typeof savedViewLayoutSchema>
