"use client"

import type { ReactNode } from "react"
import { CalendarClock, CalendarRange, Check, FileText, OctagonX, Package, RefreshCw, CircleCheck } from "lucide-react"
import { toast } from "sonner"

import { FeedbackCard, FeedbackEntryHeader } from "@/components/feedbacks/feedback-entry-header"
import { IniaFeedItem } from "@/components/operator/inia-feed"
import { Button } from "@/components/ui/button"
import { StatusChip } from "@/components/ui/surface"
import { ApiError } from "@/lib/api/api-client"
import { formatCivilDate, formatCivilDayMonth, formatCivilWeekday, formatDate, formatDateTime, formatFeedTimestamp } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useMarkMyAlignmentReadMutation } from "@/queries/operational-alignments/use-my-alignments"
import type { MyAlignment, StructureAlignment } from "@/schemas/operational-alignments/my-alignment.schema"

/**
 * Frase da faixa "não está mais vigente". Encerrado à mão → o dia do encerramento. Versão SUBSTITUÍDA (deixou de valer antes da data
 * final cadastrada, sem encerramento: a nova versão não alcança mais esta pessoa) → o dia real em que deixou de valer, nunca a data
 * final original, que pode ser futura. Nos demais casos a vigência terminou na data final.
 */
export function endedSentence(alignment: Pick<MyAlignment, "endedEarly" | "noLongerValidSince" | "endsOn">): string {
  const since = alignment.noLongerValidSince
  if (alignment.endedEarly && since) return `Encerrado antes do prazo em ${formatCivilDate(since)}.`
  if (since && since.slice(0, 10) <= alignment.endsOn.slice(0, 10)) return `Não vale mais desde ${formatCivilDate(since)}: foi substituído por uma nova versão.`
  return `A vigência terminou em ${formatCivilDate(alignment.endsOn)}.`
}

/**
 * Alinhamento operacional no Acompanhamento do operador (`MY_OPERATIONAL_ALIGNMENTS_V1`, desenho aprovado em 18/11/2026):
 * um cartão por alinhamento, sempre na versão que importa agora. A VIGÊNCIA aparece sempre; antes de valer, a faixa âmbar
 * "Alinhamento válido a partir de…" (some no primeiro dia); quando deixa de valer, o cartão fica em vermelho com o símbolo de PARE e a
 * faixa "Este alinhamento não está mais vigente". "Li o alinhamento" é a leitura simples (sem senha — não é a ciência dos feedbacks), por
 * versão. Orientação, trecho e justificativa são texto puro do cadastro (nunca Markdown nem HTML).
 */
/** Fase 2: no Acompanhamento de quem lidera o mesmo cartão recebe o alinhamento da estrutura e mostra "N de M leram", sem o botão de leitura. */
export function MyAlignmentEntry({ alignment, highlighted = false }: { alignment: MyAlignment | StructureAlignment; highlighted?: boolean }) {
  const ended = alignment.state === "ENDED"
  const definedBy = alignment.definedBy ? `Definido por ${alignment.definedBy.name}${alignment.definedBy.jobTitle ? ` (${alignment.definedBy.jobTitle})` : ""}` : "Alinhamento operacional"
  return (
    <div data-testid="alignment-entry" data-state={alignment.state} data-highlighted={highlighted || undefined}>
      {/* Para quem fica só no "Para …" da linha de cima: o nome real de Grupo/Subgrupo é longo e repetido no topo do cartão poluía. */}
      <IniaFeedItem timestamp={formatFeedTimestamp(alignment.publishedAt)} recipient={definedBy} meta={<span className="truncate font-normal">Para {alignment.audienceLabel}</span>}>
        <FeedbackCard
          className={cn(ended && "bg-red-50/50 ring-red-200 dark:bg-red-950/20 dark:ring-red-900/60")}
          header={<FeedbackEntryHeader origin={{ family: ended ? "ALIGNMENT_ENDED" : "ALIGNMENT", label: null, iconKey: null }} title={alignment.title} />}
        >
          <div className="space-y-4">
            {alignment.state === "UPCOMING" ? (
              <Banner tone="upcoming" icon={CalendarClock} title={`Alinhamento válido a partir de ${formatCivilWeekday(alignment.startsOn).toLowerCase()}`}>
                Até lá, siga o procedimento de hoje.
              </Banner>
            ) : null}
            {ended ? (
              <Banner tone="ended" icon={OctagonX} title="Este alinhamento não está mais vigente">
                {endedSentence(alignment)}
              </Banner>
            ) : null}

            <div className="flex flex-wrap gap-2" data-testid="alignment-chips">
              {alignment.state === "IN_FORCE" ? <StatusChip tone="success" icon={CircleCheck}>Em vigor · até {formatCivilDayMonth(alignment.endsOn)}</StatusChip> : null}
              {alignment.state === "UPCOMING" ? <StatusChip tone="warning" icon={CalendarClock}>Começa em {formatCivilDayMonth(alignment.startsOn)}</StatusChip> : null}
              {ended ? <StatusChip tone="danger" icon={OctagonX}>Não vale mais</StatusChip> : null}
              <StatusChip tone={ended ? "neutral" : "info"} icon={CalendarRange} data-testid="alignment-period">
                Vigência {formatCivilDate(alignment.startsOn)} a {formatCivilDate(alignment.endsOn)}
              </StatusChip>
              {alignment.version > 1 && !ended ? <StatusChip tone="info" icon={RefreshCw}>Atualizado em {formatDate(alignment.publishedAt)}</StatusChip> : null}
              {alignment.productName ? <StatusChip tone="neutral" icon={Package}>Só para {alignment.productName}</StatusChip> : null}
            </div>

            {alignment.changeReason && !ended ? <Section label="O que mudou nesta versão">{alignment.changeReason}</Section> : null}
            <Section label="O que fazer" muted={ended}>{alignment.guidance}</Section>
            {alignment.affectedTopic ? <Section label="O que muda no procedimento" muted={ended}>{alignment.affectedTopic}</Section> : null}
            {alignment.processes.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{alignment.processes.length > 1 ? "Processos" : "Processo"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {alignment.processes.map((process) => (
                    <span key={process} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-border">
                      <FileText className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{process}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <Section label="Por quê" muted>{alignment.justification}</Section>

            {"reach" in alignment ? <TeamReadSummary alignment={alignment} /> : <ReadControl alignment={alignment} />}
          </div>
        </FeedbackCard>
      </IniaFeedItem>
    </div>
  )
}

function Banner({ tone, icon: Icon, title, children }: { tone: "upcoming" | "ended"; icon: typeof OctagonX; title: string; children: ReactNode }) {
  return (
    <div
      role={tone === "ended" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset",
        tone === "upcoming" ? "bg-amber-50 text-amber-900 ring-amber-700/20 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/25" : "bg-red-50 text-red-900 ring-red-700/20 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-400/30",
      )}
      data-testid={tone === "ended" ? "alignment-ended-banner" : "alignment-upcoming-banner"}
    >
      <Icon className={cn("mt-0.5 size-6 shrink-0", tone === "upcoming" ? "text-amber-600 dark:text-amber-300" : "text-red-600 dark:text-red-300")} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className={cn("text-xs", tone === "upcoming" ? "text-amber-800 dark:text-amber-200" : "text-red-800 dark:text-red-200")}>{children}</p>
      </div>
    </div>
  )
}

function Section({ label, children, muted = false }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-sm leading-6 whitespace-pre-line", muted ? "text-muted-foreground" : "text-foreground")}>{children}</p>
    </div>
  )
}

/** Quem lidera: quantas pessoas da estrutura o alinhamento alcança e quantas marcaram "Li o alinhamento" na versão mostrada. */
function TeamReadSummary({ alignment }: { alignment: StructureAlignment }) {
  const { people, read } = alignment.reach
  const percent = people > 0 ? Math.round((read / people) * 100) : 0
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-3" data-testid="alignment-team-reads">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">
          {read} de {people} {people === 1 ? "pessoa da equipe leu" : "pessoas da equipe leram"} {alignment.version > 1 ? "esta versão" : "o alinhamento"}
        </span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Leitura do alinhamento pela equipe" aria-valuemin={0} aria-valuemax={people} aria-valuenow={read}>
        <div className={cn("h-full rounded-full", alignment.state === "ENDED" ? "bg-muted-foreground/40" : "bg-primary")} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** Leitura simples por versão: botão enquanto não leu (e o alinhamento ainda vale ou vai valer); depois, quando leu. */
function ReadControl({ alignment }: { alignment: MyAlignment }) {
  const mark = useMarkMyAlignmentReadMutation()
  if (alignment.readAt) {
    return (
      <p className="flex items-center gap-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground" data-testid="alignment-read">
        <Check className="size-3.5 text-emerald-600" aria-hidden />
        Você leu em {formatDateTime(alignment.readAt)}
      </p>
    )
  }
  if (alignment.state === "ENDED") return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
      <span className="text-xs text-muted-foreground">{alignment.version > 1 ? "Este alinhamento mudou. Leia a nova versão." : "Registre que você leu este alinhamento."}</span>
      <Button
        type="button"
        size="sm"
        disabled={mark.isPending}
        onClick={() =>
          mark.mutate(
            { alignmentId: alignment.alignmentId, versionId: alignment.versionId },
            // 404 = o alinhamento acabou de ser encerrado, substituído ou excluído: a lista é recarregada pelo hook e o botão some.
            { onError: (error) => toast.error(error instanceof ApiError && error.status === 404 ? "Este alinhamento mudou ou não está mais disponível. A lista foi atualizada." : "Não foi possível registrar a leitura. Tente de novo.") },
          )
        }
      >
        <Check aria-hidden />
        {alignment.version > 1 ? "Li a nova versão" : "Li o alinhamento"}
      </Button>
    </div>
  )
}
