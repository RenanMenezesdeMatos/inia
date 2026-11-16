"use client"

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core"
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Eye, EyeOff, GripVertical, LayoutGrid, MoveDiagonal2, Plus, RotateCcw, Ruler, X } from "lucide-react"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SectionLabel } from "@/components/ui/surface"
import { cn } from "@/lib/utils"

import {
  CARD_ROW_OPTIONS,
  CARD_WIDTHS,
  mergeLayout,
  moveCard,
  moveSection,
  nearestRows,
  nearestWidth,
  rowsLabel,
  rowsMinHeight,
  setSectionHidden,
  updateCard,
  WIDTH_CLASS,
  WIDTH_LABELS,
  type CardLayout,
  type CardWidth,
  type GridCard,
  type GridSection,
  type ViewLayout,
} from "./layout"

/**
 * VISÃO PERSONALIZÁVEL — o padrão do app para áreas e cards que a pessoa reposiciona, redimensiona e esconde (aprovado pelo
 * responsável em 2026-11-12; @dnd-kit). A tela passa o catálogo e a disposição salva; "Personalizar" abre o modo de edição:
 *  - áreas: arrastar pela alça (mouse ou teclado: espaço para pegar, setas para mover, espaço para soltar) e esconder/mostrar;
 *  - cards: arrastar dentro da área, redimensionar em blocos pelo canto — largura (1/4, 1/3, 1/2, 2/3, 3/4 ou a largura toda) e altura
 *    (1 a 8 blocos ou automática) juntas — ou pelo menu "Tamanho", esconder (×) e "Adicionar card" com os escondidos. O conteúdo do
 *    card ocupa o bloco inteiro (estica na largura e na altura);
 *  - Concluir (salva pela função da tela), Cancelar (descarta) e Restaurar padrão (com confirmação).
 * No celular tudo vira uma coluna, na ordem escolhida. Os dados e os filtros não mudam: só a visão.
 */
type Props = {
  catalog: readonly GridSection[]
  saved: ViewLayout | null | undefined
  onSave: (layout: ViewLayout) => Promise<unknown>
  onReset: () => Promise<unknown>
  /** Nome da visão para leitor de tela e mensagens ("Indicadores"). */
  label: string
  className?: string
}

const ANNOUNCE_PICK = "Pegou. Use as setas para mover e espaço para soltar; Esc cancela."
const announcements = (nameOf: (id: string) => string): Announcements => ({
  onDragStart: ({ active }) => `${nameOf(String(active.id))}. ${ANNOUNCE_PICK}`,
  onDragOver: ({ active, over }) => (over ? `${nameOf(String(active.id))} sobre ${nameOf(String(over.id))}.` : undefined),
  onDragEnd: ({ active, over }) => (over ? `${nameOf(String(active.id))} solto no lugar de ${nameOf(String(over.id))}.` : `${nameOf(String(active.id))} solto.`),
  onDragCancel: ({ active }) => `Movimento de ${nameOf(String(active.id))} cancelado.`,
})
const screenReaderInstructions = { draggable: "Para mover, pressione espaço, use as setas e pressione espaço de novo para soltar. Esc cancela." }

export function CustomizableView({ catalog, saved, onSave, onReset, label, className }: Props) {
  const current = mergeLayout(catalog, saved)
  const [draft, setDraft] = useState<ViewLayout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = draft !== null
  const layout = draft ?? current
  const sectionById = new Map(catalog.map((section) => [section.id, section]))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const sectionName = (id: string) => `Área ${sectionById.get(id)?.title ?? id}`

  const finish = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setDraft(null)
    } catch {
      setError("Não foi possível salvar a sua visão. Tente novamente.")
    } finally {
      setBusy(false)
    }
  }
  const onSectionDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) setDraft((value) => moveSection(value ?? current, String(active.id), String(over.id)))
  }
  const visibleSections = layout.sections.filter((section) => !section.hidden && sectionById.has(section.id))
  const hiddenSections = layout.sections.filter((section) => section.hidden && sectionById.has(section.id))

  return (
    <div className={cn("space-y-6", className)} data-editing={editing ? "true" : undefined}>
      <div className={cn("flex flex-wrap items-center justify-end gap-2", editing && "sticky top-2 z-20 justify-between rounded-2xl border border-primary/40 bg-card px-3 py-2 shadow-sm")}>
        {editing ? (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              Arraste áreas e cards, ajuste o tamanho e esconda o que não usa. A visão é só sua.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" disabled={busy}>
                    <RotateCcw aria-hidden />
                    Restaurar padrão
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Restaurar a visão padrão de {label}?</AlertDialogTitle>
                    <AlertDialogDescription>A ordem, os tamanhos e os cards escondidos voltam ao padrão. Os dados não mudam.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Manter a minha</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void finish(onReset)}>Restaurar padrão</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void finish(() => onSave(layout))}>
                {busy ? "Salvando…" : "Concluir"}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="w-full text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft(current)} aria-label={`Personalizar a visão de ${label}`}>
            <LayoutGrid aria-hidden />
            Personalizar
          </Button>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd} accessibility={{ announcements: announcements(sectionName), screenReaderInstructions }}>
        <SortableContext items={visibleSections.map((section) => section.id)} strategy={verticalListSortingStrategy} disabled={!editing}>
          <div className="space-y-8">
            {visibleSections.map((section) => (
              <SortableSection
                key={section.id}
                definition={sectionById.get(section.id)!}
                layout={section}
                editing={editing}
                onHide={() => setDraft((value) => setSectionHidden(value ?? current, section.id, true))}
                onCardsChange={(change) => setDraft((value) => change(value ?? current))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editing && hiddenSections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border px-3 py-2" aria-label="Áreas escondidas">
          <span className="text-sm text-muted-foreground">Áreas escondidas:</span>
          {hiddenSections.map((section) => (
            <Button key={section.id} type="button" variant="outline" size="sm" onClick={() => setDraft((value) => setSectionHidden(value ?? current, section.id, false))}>
              <Eye aria-hidden />
              Mostrar {sectionById.get(section.id)!.title}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SortableSection({
  definition,
  layout,
  editing,
  onHide,
  onCardsChange,
}: {
  definition: GridSection
  layout: { id: string; cards: CardLayout[] }
  editing: boolean
  onHide: () => void
  onCardsChange: (change: (layout: ViewLayout) => ViewLayout) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: definition.id, disabled: !editing })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const cardById = new Map(definition.cards.map((card) => [card.id, card]))
  const visible = layout.cards.filter((card) => !card.hidden && cardById.has(card.id))
  const hidden = layout.cards.filter((card) => card.hidden && cardById.has(card.id))
  const cardName = (id: string) => `Card ${cardById.get(id)?.title ?? id}`
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onCardsChange((value) => moveCard(value, definition.id, String(active.id), String(over.id)))
  }
  const titleId = `section-${definition.id}-title`

  return (
    <section ref={setNodeRef} style={style} aria-labelledby={titleId} className={cn("space-y-3", editing ? "rounded-2xl border border-dashed border-primary/40 p-3" : "border-t border-border pt-6 first:border-t-0 first:pt-0", isDragging && "relative z-10 opacity-80 shadow-lg")} data-section={definition.id}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {editing ? (
            <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Mover a área ${definition.title}`} className="mt-0.5 cursor-grab rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing">
              <GripVertical className="size-4" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 space-y-0.5">
            <SectionLabel id={titleId}>{definition.title}</SectionLabel>
            {definition.description ? <div className="text-sm text-muted-foreground">{definition.description}</div> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {definition.aside}
          {editing ? (
            <>
              {hidden.length > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      <Plus aria-hidden />
                      Adicionar card
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-1">
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">Cards escondidos nesta área</p>
                    {hidden.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => onCardsChange((value) => updateCard(value, definition.id, card.id, { hidden: false }))}
                      >
                        <Plus className="size-4 text-muted-foreground" aria-hidden />
                        {cardById.get(card.id)!.title}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={onHide}>
                <EyeOff aria-hidden />
                Esconder área
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{editing ? "Todos os cards desta área estão escondidos. Use “Adicionar card”." : "Nenhum card nesta área."}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements: announcements(cardName), screenReaderInstructions }}>
          <SortableContext items={visible.map((card) => card.id)} strategy={rectSortingStrategy} disabled={!editing}>
            <div className="grid grid-cols-12 gap-3" data-grid>
              {visible.map((card) => (
                <SortableCard key={card.id} definition={cardById.get(card.id)!} layout={card} editing={editing} onChange={(patch) => onCardsChange((value) => updateCard(value, definition.id, card.id, patch))} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}

function SortableCard({ definition, layout, editing, onChange }: { definition: GridCard; layout: CardLayout; editing: boolean; onChange: (patch: Partial<Omit<CardLayout, "id">>) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: definition.id, disabled: !editing })
  const [preview, setPreview] = useState<{ w: CardWidth; h: number | null } | null>(null)
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const width = preview?.w ?? layout.w
  const rows = preview ? preview.h : layout.h
  const widths = definition.widths ?? CARD_WIDTHS
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition }

  // Arrastar o canto: largura encaixa na permitida mais próxima (grade de 12 colunas) e altura em blocos; soltar grava os dois.
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const grid = nodeRef.current?.parentElement
    const card = nodeRef.current
    const content = contentRef.current
    if (!grid || !card || !content) return
    event.preventDefault()
    const columnWidth = grid.getBoundingClientRect().width / 12
    const left = card.getBoundingClientRect().left
    const top = content.getBoundingClientRect().top
    let latest = { w: layout.w, h: layout.h }
    const move = (moveEvent: PointerEvent) => {
      latest = { w: nearestWidth((moveEvent.clientX - left) / columnWidth, widths), h: nearestRows(moveEvent.clientY - top) }
      setPreview(latest)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      setPreview(null)
      if (latest.w !== layout.w || latest.h !== layout.h) onChange(latest)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        nodeRef.current = node
      }}
      style={style}
      className={cn(WIDTH_CLASS[width], "relative flex min-w-0 flex-col", editing && "rounded-2xl ring-2 ring-dashed ring-primary/30 ring-offset-2 ring-offset-background", isDragging && "z-10 opacity-80")}
      data-card={definition.id}
      data-width={width}
      data-rows={rows ?? "auto"}
    >
      {editing ? (
        // Em edição, uma barra própria acima do conteúdo: o nome do card e os controles nunca cobrem os números.
        <div className="mb-1.5 flex items-center gap-1 rounded-full border border-border bg-card px-1 py-0.5 shadow-sm">
          <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Mover o card ${definition.title}`} className="cursor-grab rounded-full p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing">
            <GripVertical className="size-3.5" aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{definition.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {WIDTH_LABELS[width]} · {rowsLabel(rows).replace("Altura automática", "automática")}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Tamanho do card ${definition.title}`} className="rounded-full p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
                <Ruler className="size-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-44 overflow-y-auto">
              <DropdownMenuLabel>Largura</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={String(layout.w)} onValueChange={(value) => onChange({ w: Number(value) as CardWidth })}>
                {widths.map((option) => (
                  <DropdownMenuRadioItem key={option} value={String(option)}>
                    {WIDTH_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Altura</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={layout.h === null ? "auto" : String(layout.h)} onValueChange={(value) => onChange({ h: value === "auto" ? null : Number(value) })}>
                <DropdownMenuRadioItem value="auto">Automática</DropdownMenuRadioItem>
                {CARD_ROW_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option} value={String(option)}>
                    {rowsLabel(option)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" aria-label={`Esconder o card ${definition.title}`} onClick={() => onChange({ hidden: true })} className="rounded-full p-1 text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      {/* O conteúdo estica para ocupar o bloco inteiro: a altura da linha da grade (o card mais alto) e a altura mínima escolhida. */}
      <div
        ref={contentRef}
        className={cn("flex min-h-0 flex-1 flex-col [&>*]:flex-1", editing && "pointer-events-none select-none opacity-90")}
        style={rows === null ? undefined : { minHeight: rowsMinHeight(rows) }}
        aria-hidden={editing ? true : undefined}
        inert={editing ? true : undefined}
      >
        {definition.render({ rows })}
      </div>
      {editing ? (
        <>
          <button
            type="button"
            onPointerDown={startResize}
            aria-label={`Redimensionar o card ${definition.title} (${WIDTH_LABELS[width]}, ${rowsLabel(rows).toLowerCase()}); pelo teclado, use o menu Tamanho`}
            title="Arraste para mudar a largura e a altura"
            tabIndex={-1}
            className="absolute right-0 bottom-0 z-10 flex size-6 translate-x-1/3 translate-y-1/3 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-primary/40 bg-card text-primary shadow-sm"
          >
            <MoveDiagonal2 className="size-3.5" aria-hidden />
          </button>
          {preview !== null ? (
            <span className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary-foreground">
              {WIDTH_LABELS[preview.w]} · {rowsLabel(preview.h).toLowerCase()}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
