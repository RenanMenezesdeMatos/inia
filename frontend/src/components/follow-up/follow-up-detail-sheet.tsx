"use client"

import Link from "next/link"
import { CheckCircle2, Clock3 } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"
import { SupportMaterialsSection } from "@/components/feedbacks/support-materials-section"
import { FeedbackNarrativeView } from "@/components/feedbacks/feedback-narrative-view"
import { PrvSupervisorDiagnosis } from "@/components/feedbacks/prv-supervisor-diagnosis"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatDateTime } from "@/lib/format/date"
import type { FollowUpItem } from "@/schemas/analytics/analytics.schema"

/**
 * Detalhe INTEGRAL de um item do Acompanhamento da estrutura — a síntese consolidada de um
 * Orquestrador, um escalonamento com o conteúdo analisado, um feedback publicado. Lê o MESMO
 * objeto já carregado no feed (`FollowUpItem`: o alerta/feedback persistido, sem tabela paralela
 * nem request extra) e renderiza o Markdown inteiro pelo `RichContent` (títulos, listas, negrito,
 * tabelas, citações, links). Padrão de detalhe do produto: Sheet à direita com corpo rolável, o
 * mesmo do detalhe de Revisão humana.
 *
 * Abrir o detalhe NÃO marca leitura nem ciência: leitura é do sino (`read_at`, no alerta) e
 * ciência é confirmação formal do PRÓPRIO colaborador no Acompanhamento dele — o gestor só
 * enxerga o estado aqui.
 */
export type FollowUpDetailSheetProps = {
  item: FollowUpItem | null
  categoryLabel: (item: FollowUpItem) => string
  onOpenChange: (open: boolean) => void
  employeeHref?: (personId: string) => string
}

const SEVERITY_LABELS: Record<NonNullable<FollowUpItem["severity"]>, string> = { INFO: "Informativo", MEDIUM: "Média prioridade", HIGH: "Alta prioridade", CRITICAL: "Crítico" }

export function FollowUpDetailSheet({ item, categoryLabel, onOpenChange, employeeHref }: FollowUpDetailSheetProps) {
  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-2xl">
        {item ? <DetailBody item={item} categoryLabel={categoryLabel(item)} employeeHref={employeeHref} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({ item, categoryLabel, employeeHref }: { item: FollowUpItem; categoryLabel: string; employeeHref?: (personId: string) => string }) {
  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-0 bg-muted">{categoryLabel}</Badge>
          {item.severity && item.severity !== "INFO" ? <Badge variant={item.severity === "HIGH" || item.severity === "CRITICAL" ? "destructive" : "secondary"}>{SEVERITY_LABELS[item.severity]}</Badge> : null}
          {item.kind === "FEEDBACK" ? <AcknowledgementState acknowledgedAt={item.acknowledgedAt} /> : null}
        </div>
        <SheetTitle className="text-lg break-words">{item.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {item.subtitle ? <span>{item.subtitle}</span> : null}
          <span>{formatDateTime(item.createdAt)}</span>
          {item.operator ? (
            employeeHref ? (
              <Link href={employeeHref(item.operator.personId)} className="hover:underline">
                {item.operator.name}
              </Link>
            ) : (
              <span>{item.operator.name}</span>
            )
          ) : null}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4">
          {item.feedback?.view ? (
            // Feedback por Flag V2 — a mesma experiência do colaborador: narrativa + fundamentação sob demanda.
            <>
              <FeedbackNarrativeView view={item.feedback.view} />
              {/* Indicator Diagnosis V1 — o diagnóstico técnico do fechamento, só para a liderança (o backend não o envia ao próprio colaborador). */}
              {item.feedback.supervisorView ? <PrvSupervisorDiagnosis view={item.feedback.supervisorView} /> : null}
            </>
          ) : item.feedback ? (
            <FeedbackSections feedback={item.feedback} />
          ) : (
            <section aria-label="Conteúdo completo">
              <RichContent text={item.summary} density="detail" />
              {item.detail ? (
                <div className="mt-4 border-t pt-4">
                  <RichContent text={item.detail} density="detail" />
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </>
  )
}

/** As quatro partes de um feedback publicável (evidência, comportamento, procedimento,
 * recomendação) — cada uma integral, na ordem em que o feedback é lido. */
function FeedbackSections({ feedback }: { feedback: NonNullable<FollowUpItem["feedback"]> }) {
  const sections = [
    { title: "Evidência encontrada", text: feedback.evidenceFound, quote: true },
    { title: "Comportamento observado", text: feedback.observedBehavior },
    { title: "Procedimento relacionado", text: feedback.relatedProcedure },
    { title: "Recomendação", text: feedback.recommendation },
  ].filter((section) => section.text.trim().length > 0)
  return (
    <>
      {sections.map((section) => (
        <section key={section.title} aria-label={section.title}>
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</h3>
          <div className="mt-2">
            {/* Evidência é citação literal da transcrição/dado — nunca passa por Markdown. */}
            {section.quote ? <blockquote className="border-l-2 border-primary/40 pl-3 text-sm leading-6 whitespace-pre-wrap break-words italic">{section.text}</blockquote> : <RichContent text={section.text} density="detail" />}
          </div>
        </section>
      ))}
      {/* Materiais resolvidos pelo backend para QUEM ESTÁ LENDO (o gestor): material fora do
          alcance dele aparece como indisponível, sem título — a referência não concede acesso. */}
      <SupportMaterialsSection materials={feedback.supportMaterials} />
    </>
  )
}

function AcknowledgementState({ acknowledgedAt }: { acknowledgedAt: string | null }) {
  return acknowledgedAt ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="size-3.5" aria-hidden />
      Ciência em {formatDateTime(acknowledgedAt)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
      <Clock3 className="size-3.5" aria-hidden />
      Aguardando ciência do colaborador
    </span>
  )
}
