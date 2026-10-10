"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Card genérico das listagens administrativas, com a mesma estrutura, espaçamento e hierarquia
// do card de Bases de conhecimento (knowledge-page.tsx → KnowledgeCard): ícone à esquerda,
// linha de metadados + título, menu de ações à direita, resumo no meio e rodapé com etiquetas
// e status. Cada módulo só troca o conteúdo dos slots.

export function EntityCardIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary", className)}>
      <Icon className="size-4.5" />
    </span>
  )
}

// Etiqueta discreta do rodapé (mesmo desenho das ScopeTags da base de conhecimento).
export function EntityCardTag({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground", className)}>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}

export function EntityCard({
  icon,
  kicker,
  title,
  href,
  onOpen,
  actions,
  description,
  descriptionFallback = "Sem descrição disponível.",
  tags,
  footerStart,
  footerEnd,
  children,
  muted = false,
  className,
}: {
  icon: ReactNode
  // Linha pequena acima do título (tipo · formato, canal, etc.). Separadores com <span aria-hidden>·</span>.
  kicker: ReactNode
  title: string
  // Link "esticado": o card inteiro abre o registro, sem envolver tudo num <a>.
  href?: string
  onOpen?: () => void
  actions?: ReactNode
  description?: string | null
  descriptionFallback?: string
  tags?: ReactNode
  footerStart?: ReactNode
  footerEnd?: ReactNode
  // Conteúdo extra entre o resumo e o rodapé (ex.: lista de eventos expandida).
  children?: ReactNode
  muted?: boolean
  className?: string
}) {
  const stretched = "after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 focus-within:border-primary/40",
        muted && "opacity-60",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">{kicker}</div>
          <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">
            {href ? (
              <Link href={href} className={stretched}>
                {title}
              </Link>
            ) : onOpen ? (
              <button type="button" onClick={onOpen} className={cn("text-left", stretched)}>
                {title}
              </button>
            ) : (
              title
            )}
          </h3>
        </div>
        {actions ? <div className="relative z-10 -mr-1.5 -mt-1 flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>

      {description ? (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : (
        <p className="mt-3 text-sm italic text-muted-foreground/70">{descriptionFallback}</p>
      )}

      {children ? <div className="relative z-10 mt-3">{children}</div> : null}

      <div className="mt-auto space-y-2 pt-4">
        {tags ? <div className="flex flex-wrap items-center gap-1.5">{tags}</div> : null}
        {footerStart || footerEnd ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{footerStart}</div>
            {/* Controles (switch, botões) ficam acima do link esticado para continuarem clicáveis. */}
            <div className="relative z-10 flex items-center gap-2">{footerEnd}</div>
          </div>
        ) : null}
      </div>
    </article>
  )
}
