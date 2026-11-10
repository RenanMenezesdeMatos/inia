import type { ComponentProps, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * SUPERFÍCIES E SINALIZAÇÃO DO APP (só apresentação, sem regra): cartão sobre a superfície da página, aviso tingido pelo estado,
 * rótulo curto de seção em caixa alta, selo de estado com ícone e texto (a cor nunca é a única informação), ícone num círculo
 * tingido e o cabeçalho de página. Nasceu no Apoio com Anjo (referência: área logada da Vivo — cartões com borda e raio grande,
 * rótulos de seção, selos tingidos, botões em pílula) e vale para o app inteiro. Cores pelos tokens do tema (primária, muted,
 * border) e verde/âmbar para "pronto"/"aguardando", com par claro/escuro.
 */
export type Tone = "success" | "warning" | "info" | "neutral" | "danger"

const TONES: Record<Tone, { chip: string; badge: string; surface: string }> = {
  success: {
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-700/15 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/25",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    surface: "border-emerald-700/15 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-500/10",
  },
  warning: {
    chip: "bg-amber-50 text-amber-900 ring-amber-700/20 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/25",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    surface: "border-amber-700/20 bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-500/10",
  },
  info: {
    chip: "bg-primary/8 text-primary ring-primary/20",
    badge: "bg-primary/10 text-primary",
    surface: "border-primary/20 bg-primary/5",
  },
  neutral: {
    chip: "bg-muted text-muted-foreground ring-border",
    badge: "bg-muted text-muted-foreground",
    surface: "border-border bg-muted/60",
  },
  danger: {
    chip: "bg-destructive/10 text-destructive ring-destructive/20",
    badge: "bg-destructive/10 text-destructive",
    surface: "border-destructive/25 bg-destructive/5",
  },
}

/** Cartão sobre a superfície da página: fundo do cartão, borda e raio grande. */
export const SURFACE_CARD = "rounded-2xl border border-border bg-card shadow-xs"

/** Cores de selo de um tom (fundo, texto e contorno), para quem monta o próprio selo. */
export const toneChip = (tone: Tone) => TONES[tone].chip

/** Superfície tingida de um aviso ou estado (borda e fundo do tom). */
export const toneSurface = (tone: Tone) => cn("rounded-2xl border", TONES[tone].surface)

/** Rótulo curto de seção, em caixa alta (ex.: "ATENDIMENTOS EM ANDAMENTO"). É o título da seção para leitores de tela. */
export function SectionLabel({ children, className, as: Tag = "h2", ...props }: ComponentProps<"h2"> & { as?: "h2" | "h3" | "p" }) {
  return (
    <Tag className={cn("text-xs font-semibold tracking-wider text-muted-foreground uppercase", className)} {...props}>
      {children}
    </Tag>
  )
}

/** Selo de estado: texto e ícone sobre o tom. */
export function StatusChip({ tone, icon: Icon, children, className, ...props }: ComponentProps<"span"> & { tone: Tone; icon?: LucideIcon }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", TONES[tone].chip, className)} {...props}>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  )
}

/** Ícone num círculo tingido (cabeçalhos, listas e avisos). Decorativo: o texto ao lado diz o que é. */
export function IconBadge({ tone = "info", icon: Icon, size = "md", className }: { tone?: Tone; icon: LucideIcon; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-full", size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10", TONES[tone].badge, className)}>
      <Icon className={size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5"} />
    </span>
  )
}

/** Cabeçalho de página: ícone, título e descrição; `aside` à direita (estado, ações). */
export function PageHeader({ icon, title, description, aside }: { icon: LucideIcon; title: ReactNode; description: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <IconBadge icon={icon} size="lg" />
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{description}</p>
        </div>
      </div>
      {aside}
    </div>
  )
}
