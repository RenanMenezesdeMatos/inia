"use client"

import { useId, useState, type ComponentType, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type FeedbackSupportTile = {
  key: string
  icon: ComponentType<{ className?: string }>
  title: string
  /** Uma linha curta no próprio card ("2 pontos para ajustar", "3 documentos"). */
  summary: string
  /** Frase que abre o conteúdo aberto (o que o bloco traz). */
  hint: string
  usageElement?: string
  content: ReactNode
}

/**
 * Blocos de apoio do feedback como CARDS lado a lado ("Entenda este feedback", "Oportunidades inspiradas em boas práticas",
 * "Materiais utilizados"): cada card mostra o título e uma linha curta; o escolhido abre embaixo, na largura toda, e só um fica aberto
 * por vez (clicar de novo fecha). No celular os cards viram linhas empilhadas. Fechados por padrão — o texto é o feedback.
 */
export function FeedbackSupportTiles({ tiles }: { tiles: FeedbackSupportTile[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const baseId = useId()
  const panelId = `${baseId}-panel`
  const open = tiles.find((tile) => tile.key === openKey) ?? null
  if (tiles.length === 0) return null
  return (
    <div className="min-w-0 space-y-2">
      <div className="grid gap-2 sm:auto-cols-fr sm:grid-flow-col">
        {tiles.map((tile) => {
          const Icon = tile.icon
          const selected = tile.key === openKey
          return (
            <h4 key={tile.key} className="m-0 min-w-0">
              <button
                type="button"
                aria-expanded={selected}
                aria-controls={panelId}
                data-slot="feedback-tile"
                data-usage-element={tile.usageElement}
                onClick={() => setOpenKey(selected ? null : tile.key)}
                className={cn(
                  "flex h-full w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "sm:min-h-28 sm:flex-col sm:items-start sm:gap-2 sm:p-4",
                  selected && "border-primary/60 bg-primary/5 ring-1 ring-primary/30",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                  <Icon className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:w-full">
                  <span id={`${baseId}-${tile.key}-title`} className="text-sm font-semibold leading-snug break-words" data-slot="feedback-tile-title">{tile.title}</span>
                  <span className="text-xs leading-4 text-muted-foreground sm:mt-auto">{tile.summary}</span>
                </span>
              </button>
            </h4>
          )
        })}
      </div>
      <section id={panelId} aria-labelledby={open ? `${baseId}-${open.key}-title` : undefined} hidden={!open} className="min-w-0 rounded-xl border bg-card px-2.5 py-3 sm:px-4" data-slot="feedback-tile-panel">
        {open ? (
          <div className="space-y-3">
            <p className="text-xs leading-5 text-muted-foreground">{open.hint}</p>
            {open.content}
          </div>
        ) : null}
      </section>
    </div>
  )
}
