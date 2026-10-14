import type { ReactNode } from "react"
import { CalendarDays, ChartLine, ClipboardCheck, Headset, ListChecks, Megaphone, MessageSquareText, Send, Sun, TriangleAlert } from "lucide-react"

import { DisplayIcon } from "@/lib/display-icons"
import { cn } from "@/lib/utils"

/**
 * Tipo + MOTIVO de um item do Acompanhamento, o que o colaborador precisa entender de relance:
 *   Monitoria · Rechamada / Monitoria · Nota da URA / Monitoria · Rotina / Monitoria · Avulsa / Indicador (TMA, Reincidência…).
 * A FAMÍLIA dá a cor (monitoria = azul, indicador = verde-água); o MOTIVO dá o ícone (configurado por flag/indicador na
 * Administração, senão o padrão pelo comportamento — vem pronto do backend). O ícone nunca diz o tom do conteúdo.
 *
 * O Acompanhamento da estrutura (liderança) usa o MESMO cabeçalho; as famílias depois de "Leitura do dia" são os itens que só
 * a liderança recebe (resultado de Workflow, revisão, escalonamento, comunicado) — o colaborador nunca as vê.
 */
export type FeedbackEntryFamily = "MONITORING" | "INDICATOR" | "DAILY_READING" | "WORKFLOW_OUTPUT" | "HUMAN_REVIEW" | "ESCALATION" | "INTERVENTION" | "NOTICE" | "OTHER"
export type FeedbackEntryOrigin = { family: FeedbackEntryFamily; label: string | null; iconKey: string | null }

const FAMILY: Record<FeedbackEntryFamily, { label: string; fallback: typeof Headset; tile: string; eyebrow: string }> = {
  MONITORING: { label: "Monitoria", fallback: Headset, tile: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", eyebrow: "text-sky-700 dark:text-sky-300" },
  INDICATOR: { label: "Indicador", fallback: ChartLine, tile: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300", eyebrow: "text-teal-700 dark:text-teal-300" },
  DAILY_READING: { label: "Leitura do dia", fallback: Sun, tile: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", eyebrow: "text-amber-700 dark:text-amber-300" },
  WORKFLOW_OUTPUT: { label: "Resultado de workflow", fallback: Send, tile: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", eyebrow: "text-violet-700 dark:text-violet-300" },
  HUMAN_REVIEW: { label: "Revisão pendente", fallback: ClipboardCheck, tile: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", eyebrow: "text-rose-700 dark:text-rose-300" },
  ESCALATION: { label: "Escalonamento", fallback: TriangleAlert, tile: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300", eyebrow: "text-orange-700 dark:text-orange-300" },
  INTERVENTION: { label: "Intervenção", fallback: ListChecks, tile: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300", eyebrow: "text-lime-800 dark:text-lime-300" },
  NOTICE: { label: "Comunicado", fallback: Megaphone, tile: "bg-primary/10 text-primary dark:text-chart-4", eyebrow: "text-primary dark:text-chart-4" },
  OTHER: { label: "Acompanhamento", fallback: MessageSquareText, tile: "bg-muted text-muted-foreground", eyebrow: "text-muted-foreground" },
}

/** "Monitoria · Rechamada" — o texto do tipo + motivo (também é o que o leitor de tela lê antes do título). */
export const originLabelOf = (origin: FeedbackEntryOrigin) => (origin.label ? `${FAMILY[origin.family].label} · ${origin.label}` : FAMILY[origin.family].label)

/**
 * O topo do cartão tem DUAS linhas (motivo + título), alinhadas ao centro do quadrado do ícone. Quando aconteceu (data do
 * atendimento / período do indicador) é metadado e fica FORA do cartão, à direita da linha "INIA · publicação"
 * (`FeedbackEntryWhen` no `meta` do `IniaFeedItem`).
 */
export type FeedbackEntryHeaderProps = {
  origin: FeedbackEntryOrigin
  /** O assunto do atendimento (monitoria) ou o indicador. */
  title: string
  /** Selos ao lado do motivo (ex.: "Ponto positivo" de um feedback de atendimento). */
  badges?: ReactNode
  /** Ação do item no canto direito (ex.: Ouvir com a INIA). */
  action?: ReactNode
}

export function FeedbackEntryHeader({ origin, title, badges, action }: FeedbackEntryHeaderProps) {
  const family = FAMILY[origin.family]
  return (
    <header className="flex min-w-0 items-center gap-3.5" data-slot="feedback-entry-header" data-family={origin.family}>
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", family.tile)} aria-hidden data-slot="feedback-origin-icon">
        <DisplayIcon iconKey={origin.iconKey} fallback={family.fallback} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("text-[11px] leading-4 font-semibold tracking-wider uppercase", family.eyebrow)} data-slot="feedback-origin">
            {originLabelOf(origin)}
          </p>
          {badges}
        </div>
        <h3 className="mt-0.5 min-w-0 font-heading text-[17px] leading-snug font-semibold break-words text-primary dark:text-chart-4">{title}</h3>
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </header>
  )
}

/** Quando aconteceu (data do atendimento / período do indicador), discreto, à direita da linha do autor do item. */
export function FeedbackEntryWhen({ text }: { text: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-normal" data-slot="feedback-entry-when">
      <CalendarDays className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  )
}

/**
 * O cartão de um feedback: o topo (tipo, motivo, título, data, ação) separado do conteúdo por uma linha — a identidade do
 * feedback fica num lugar só, e o texto começa logo abaixo.
 */
export function FeedbackCard({ header, children, usageEntity }: { header: ReactNode; children: ReactNode; usageEntity?: { type: "PUBLISHED_FEEDBACK" | "INTERACTION_FEEDBACK_DELIVERY"; id: string } }) {
  // Monitoria de usabilidade: o cartão visto (≥ 50% por 1 s) é a EXPOSIÇÃO do feedback; o corpo é o conteúdo cuja leitura (rolagem) é medida.
  const usage = usageEntity ? { "data-usage-expose": "feedback.card", "data-usage-entity-type": usageEntity.type, "data-usage-entity-id": usageEntity.id } : {}
  return (
    <article className="min-w-0 overflow-hidden rounded-2xl bg-muted/35 ring-1 ring-border/60" data-slot="feedback-card" {...usage}>
      <div className="px-4 pt-4 pb-3.5 sm:px-5">{header}</div>
      <div className="border-t border-border/60 px-4 py-4 sm:px-5" data-usage-scroll={usageEntity ? "feedback.content" : undefined}>
        {children}
      </div>
    </article>
  )
}
