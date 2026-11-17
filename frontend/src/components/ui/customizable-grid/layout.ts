import type { ReactNode } from "react"

/**
 * GRADE PERSONALIZÁVEL — regras puras (padrão do app aprovado pelo responsável em 2026-11-12; ver "Padrões de UI" em
 * `docs/dev/memoria/visual-do-app.md`). Uma tela declara um CATÁLOGO de áreas e cards; a pessoa guarda uma DISPOSIÇÃO (ordem das áreas,
 * ordem dos cards dentro da área, largura em blocos numa grade de 12 colunas, altura dos gráficos e o que escondeu — migration 192).
 * Juntar os dois: o que está salvo vale na ordem salva; card ou área que deixou de existir no catálogo some; card ou área nova entra no
 * fim (da área ou da tela) com o tamanho padrão. Largura fora das permitidas pelo card volta ao padrão.
 */
export const CARD_WIDTHS = [3, 4, 6, 8, 9, 12] as const
export type CardWidth = (typeof CARD_WIDTHS)[number]
/**
 * Altura em BLOCOS (linhas de 72 px com 12 px entre elas), de 1 a 8 — a altura mínima do card; null = automática (a do conteúdo). Vale
 * para todos os cards (pedido do responsável em 2026-11-12: redimensionar também na vertical); o gráfico ocupa a altura escolhida.
 */
export const CARD_ROWS_MAX = 8
export const ROW_PX = 72
export const GAP_PX = 12
export const CARD_ROW_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export const WIDTH_LABELS: Record<CardWidth, string> = { 3: "1/4", 4: "1/3", 6: "Metade", 8: "2/3", 9: "3/4", 12: "Largura toda" }
export const rowsLabel = (rows: number | null) => (rows === null ? "Altura automática" : rows === 1 ? "1 bloco" : `${rows} blocos`)
/** Altura mínima, em px, de um card com `rows` blocos. */
export const rowsMinHeight = (rows: number) => rows * ROW_PX + (rows - 1) * GAP_PX
/**
 * Altura, em px, do gráfico dentro de um card de `rows` blocos: a altura do bloco menos o que o card mostra fora do gráfico (`reserve`:
 * título, resumo, botão da tabela); automática = 4 blocos.
 */
export const chartHeightPx = (rows: number | null, reserve = 76) => Math.max(120, rowsMinHeight(rows ?? 4) - reserve)
/** Blocos mais próximos de uma altura arrastada, em px (abaixo de meio bloco = automática). */
export function nearestRows(px: number): number | null {
  if (px < ROW_PX / 2) return null
  return Math.min(CARD_ROWS_MAX, Math.max(1, Math.round((px + GAP_PX) / (ROW_PX + GAP_PX))))
}
const validRows = (rows: unknown): rows is number => typeof rows === "number" && Number.isInteger(rows) && rows >= 1 && rows <= CARD_ROWS_MAX

export type GridCard = {
  id: string
  title: string
  defaultWidth: CardWidth
  /** Larguras que fazem sentido para este card (padrão: todas). */
  widths?: readonly CardWidth[]
  /** Altura padrão em blocos (null/ausente = automática); os gráficos começam com 4. */
  defaultRows?: number | null
  render: (context: { rows: number | null }) => ReactNode
}
export type GridSection = {
  id: string
  title: string
  description?: ReactNode
  /** Algo à direita do título (ex.: "Cronômetros ao vivo"). */
  aside?: ReactNode
  cards: GridCard[]
}

/**
 * Forma genérica da disposição, própria do kit (que não conhece zod nem as telas). O contrato com o servidor é o zod de
 * `schemas/view-layouts/view-layout.schema.ts` (`ViewLayoutPayload = z.infer<…>`), que confere em tempo de compilação ser o mesmo tipo.
 */
export type CardLayout = { id: string; hidden: boolean; w: CardWidth; h: number | null }
export type SectionLayout = { id: string; hidden: boolean; cards: CardLayout[] }
export type ViewLayout = { version: 1; sections: SectionLayout[] }

const widthsOf = (card: GridCard): readonly CardWidth[] => card.widths ?? CARD_WIDTHS
const cardDefault = (card: GridCard): CardLayout => ({ id: card.id, hidden: false, w: card.defaultWidth, h: card.defaultRows ?? null })

export function defaultLayout(catalog: readonly GridSection[]): ViewLayout {
  return { version: 1, sections: catalog.map((section) => ({ id: section.id, hidden: false, cards: section.cards.map(cardDefault) })) }
}

/** Junta a disposição salva com o catálogo atual (regras no topo do arquivo). Sem nada salvo, o padrão. */
export function mergeLayout(catalog: readonly GridSection[], saved: ViewLayout | null | undefined): ViewLayout {
  if (!saved) return defaultLayout(catalog)
  const sectionById = new Map(catalog.map((section) => [section.id, section]))
  const sections: SectionLayout[] = []
  for (const savedSection of saved.sections) {
    const section = sectionById.get(savedSection.id)
    if (!section || sections.some((item) => item.id === section.id)) continue
    const cardById = new Map(section.cards.map((card) => [card.id, card]))
    const cards: CardLayout[] = []
    for (const savedCard of savedSection.cards) {
      const card = cardById.get(savedCard.id)
      if (!card || cards.some((item) => item.id === card.id)) continue
      cards.push({ id: card.id, hidden: savedCard.hidden === true, w: widthsOf(card).includes(savedCard.w) ? savedCard.w : card.defaultWidth, h: savedCard.h === null ? null : validRows(savedCard.h) ? savedCard.h : (card.defaultRows ?? null) })
    }
    for (const card of section.cards) if (!cards.some((item) => item.id === card.id)) cards.push(cardDefault(card))
    sections.push({ id: section.id, hidden: savedSection.hidden === true, cards })
  }
  for (const section of catalog) if (!sections.some((item) => item.id === section.id)) sections.push({ id: section.id, hidden: false, cards: section.cards.map(cardDefault) })
  return { version: 1, sections }
}

export function moveSection(layout: ViewLayout, fromId: string, toId: string): ViewLayout {
  const from = layout.sections.findIndex((section) => section.id === fromId)
  const to = layout.sections.findIndex((section) => section.id === toId)
  if (from < 0 || to < 0 || from === to) return layout
  const sections = [...layout.sections]
  const [moved] = sections.splice(from, 1)
  sections.splice(to, 0, moved!)
  return { ...layout, sections }
}

const updateSection = (layout: ViewLayout, sectionId: string, change: (section: SectionLayout) => SectionLayout): ViewLayout => ({
  ...layout,
  sections: layout.sections.map((section) => (section.id === sectionId ? change(section) : section)),
})

export function moveCard(layout: ViewLayout, sectionId: string, fromId: string, toId: string): ViewLayout {
  return updateSection(layout, sectionId, (section) => {
    const from = section.cards.findIndex((card) => card.id === fromId)
    const to = section.cards.findIndex((card) => card.id === toId)
    if (from < 0 || to < 0 || from === to) return section
    const cards = [...section.cards]
    const [moved] = cards.splice(from, 1)
    cards.splice(to, 0, moved!)
    return { ...section, cards }
  })
}

export const updateCard = (layout: ViewLayout, sectionId: string, cardId: string, patch: Partial<Omit<CardLayout, "id">>): ViewLayout =>
  updateSection(layout, sectionId, (section) => ({ ...section, cards: section.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)) }))

export const setSectionHidden = (layout: ViewLayout, sectionId: string, hidden: boolean): ViewLayout => updateSection(layout, sectionId, (section) => ({ ...section, hidden }))

/** Largura permitida mais próxima de um número de colunas (arrastar a borda do card encaixa em blocos). */
export function nearestWidth(columns: number, allowed: readonly CardWidth[] = CARD_WIDTHS): CardWidth {
  return allowed.reduce((best, width) => (Math.abs(width - columns) < Math.abs(best - columns) ? width : best), allowed[0]!)
}

/** Classes da coluna: uma coluna no celular; a largura escolhida do desktop para cima (metade nas telas médias para os cards pequenos). */
export const WIDTH_CLASS: Record<CardWidth, string> = {
  3: "col-span-12 sm:col-span-6 xl:col-span-3",
  4: "col-span-12 sm:col-span-6 xl:col-span-4",
  6: "col-span-12 lg:col-span-6",
  8: "col-span-12 lg:col-span-8",
  9: "col-span-12 lg:col-span-9",
  12: "col-span-12",
}
