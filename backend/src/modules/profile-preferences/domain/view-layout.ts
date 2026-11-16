import { z } from "zod"

/**
 * DISPOSIÇÃO PERSONALIZADA DE UMA TELA (migration 192; padrão aprovado pelo responsável em 2026-11-12 — vale para qualquer tela com
 * áreas e cards reposicionáveis). A pessoa guarda, por visão, a ordem das áreas, a ordem dos cards dentro de cada área, a largura em
 * blocos de uma grade de 12 colunas, a altura em blocos (linhas) e o que escondeu. O servidor guarda só esta forma, validada e com limites;
 * a tela junta com o catálogo atual dela (card que deixou de existir é ignorado; card novo entra no fim da área, com o tamanho padrão).
 *
 * Visões conhecidas: só as listadas aqui (uma tela nova entra nesta lista). Nada além da própria pessoa lê ou grava a disposição.
 */
export const VIEW_LAYOUT_KEYS = ["anjos.indicadores", "anjos.monitoria-online", "anjos.jornada"] as const
export type ViewLayoutKey = (typeof VIEW_LAYOUT_KEYS)[number]
export const VIEW_LAYOUT_VERSION = 1 as const
/** Larguras em blocos (colunas de 12): 1/4, 1/3, 1/2, 2/3, 3/4 e a largura toda. */
export const CARD_WIDTHS = [3, 4, 6, 8, 9, 12] as const
/** Altura em blocos (linhas da grade), de 1 a 8; null = automática (a do conteúdo). */
export const CARD_ROWS_MAX = 8

const itemId = z.string().regex(/^[a-z][a-z0-9-]{0,59}$/, "Identificador inválido.")
const cardSchema = z.object({ id: itemId, hidden: z.boolean().default(false), w: z.union(CARD_WIDTHS.map((width) => z.literal(width)) as [z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<6>, z.ZodLiteral<8>, z.ZodLiteral<9>, z.ZodLiteral<12>]), h: z.number().int().min(1).max(CARD_ROWS_MAX).nullable().default(null) }).strict()
const sectionSchema = z.object({ id: itemId, hidden: z.boolean().default(false), cards: z.array(cardSchema).max(60) }).strict()

export const viewLayoutSchema = z
  .object({ version: z.literal(VIEW_LAYOUT_VERSION), sections: z.array(sectionSchema).max(30) })
  .strict()
  .superRefine((layout, context) => {
    const sections = new Set<string>()
    layout.sections.forEach((section, index) => {
      if (sections.has(section.id)) context.addIssue({ code: "custom", path: ["sections", index, "id"], message: "Área repetida." })
      sections.add(section.id)
      const cards = new Set<string>()
      section.cards.forEach((card, cardIndex) => {
        if (cards.has(card.id)) context.addIssue({ code: "custom", path: ["sections", index, "cards", cardIndex, "id"], message: "Card repetido na área." })
        cards.add(card.id)
      })
    })
  })
export type ViewLayout = z.infer<typeof viewLayoutSchema>
export const viewLayoutKeySchema = z.enum(VIEW_LAYOUT_KEYS)
