"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Clock3 } from "lucide-react"

import { FeedbackCard, FeedbackEntryHeader, FeedbackEntryWhen, type FeedbackEntryFamily, type FeedbackEntryOrigin } from "@/components/feedbacks/feedback-entry-header"
import { FeedbackNarrativeView } from "@/components/feedbacks/feedback-narrative-view"
import { PrvSupervisorDiagnosis } from "@/components/feedbacks/prv-supervisor-diagnosis"
import { SupportMaterialsSection } from "@/components/feedbacks/support-materials-section"
import { IniaFeedItem } from "@/components/operator/inia-feed"
import { RichContent } from "@/components/rich-content/rich-content"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDateTime, formatFeedTimestamp } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import type { FollowUpItem } from "@/schemas/analytics/analytics.schema"

/**
 * Um item do Acompanhamento da ESTRUTURA (liderança) com a MESMA apresentação do Acompanhamento do colaborador: linha
 * "INIA · publicação" com quando aconteceu à direita, cartão com o cabeçalho de tipo + motivo + título e o conteúdo lido no
 * próprio cartão — a narrativa aparece direto; o restante abre no lugar ("Ver feedback completo"), nunca em painel lateral.
 * Lê o MESMO objeto já carregado no feed (`FollowUpItem`), sem request nem tabela extra.
 *
 * O que muda para quem lidera: de quem é o item ("para Larissa Monteiro", fora da ficha da própria pessoa), o diagnóstico
 * técnico do fechamento (só para a liderança) e o ESTADO da ciência. Ler aqui NÃO marca leitura nem ciência: leitura é do sino
 * (`read_at`, no alerta) e ciência é a confirmação formal do PRÓPRIO colaborador no Acompanhamento dele.
 */
export type FollowUpEntryProps = {
  item: FollowUpItem
  /** Mostra de quem é o item na linha do autor — desligado na ficha do próprio colaborador. */
  showRecipient: boolean
  employeeHref?: (personId: string) => string
  /** Deep link do sino (`item=<id>`): rola até o item, destaca e abre o conteúdo. */
  highlighted?: boolean
}

const ALERT_FAMILY: Record<FollowUpItem["category"], FeedbackEntryFamily> = {
  MONITORING: "MONITORING",
  INDICATOR: "INDICATOR",
  WORKFLOW_OUTPUT: "WORKFLOW_OUTPUT",
  WORKFLOW_HUMAN_REVIEW: "HUMAN_REVIEW",
  WORKFLOW_ESCALATION: "ESCALATION",
  INTERVENTION: "INTERVENTION",
  OTHER: "OTHER",
}

/** Motivo vindo do backend (o mesmo do colaborador); sem ele, o tipo pela categoria do item. */
export function originOfFollowUp(item: FollowUpItem): FeedbackEntryOrigin {
  if (item.origin) return { family: item.origin.family, label: item.origin.label, iconKey: item.origin.iconKey }
  return { family: ALERT_FAMILY[item.category], label: null, iconKey: null }
}

export function FollowUpEntry({ item, showRecipient, employeeHref, highlighted = false }: FollowUpEntryProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(highlighted)
  const [wasHighlighted, setWasHighlighted] = useState(highlighted)
  if (highlighted !== wasHighlighted) {
    // Ajuste de estado durante o render (padrão do React para estado derivado): o deep link que chega depois também abre o item.
    setWasHighlighted(highlighted)
    if (highlighted) setOpen(true)
  }
  useEffect(() => {
    if (highlighted) rootRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  }, [highlighted])

  const view = item.feedback?.view ?? null
  const title = view?.heading?.title ?? item.title
  const subtitle = view?.heading?.subtitle ?? item.subtitle ?? null
  const urgent = item.severity === "HIGH" || item.severity === "CRITICAL"
  const recipient = showRecipient && item.operator ? <Recipient item={item} operator={item.operator} employeeHref={employeeHref} /> : undefined

  return (
    <div
      ref={rootRef}
      id={`follow-up-${item.id}`}
      className={cn("-mx-3 rounded-2xl px-3 transition-[background-color,box-shadow] duration-500 motion-reduce:transition-none", highlighted && "bg-primary/5 ring-1 ring-primary/30")}
      data-highlighted={highlighted || undefined}
    >
      <IniaFeedItem timestamp={formatFeedTimestamp(item.createdAt)} recipient={recipient} meta={subtitle ? <FeedbackEntryWhen text={subtitle} /> : undefined}>
        <FeedbackCard
          header={
            <FeedbackEntryHeader
              origin={originOfFollowUp(item)}
              title={title}
              badges={urgent ? <Badge variant="destructive">{item.severity === "CRITICAL" ? "Crítico" : "Alta prioridade"}</Badge> : undefined}
            />
          }
        >
          <div className="space-y-4 text-sm leading-6">
            {view ? (
              // Feedback por Flag V2: a narrativa JÁ é o resumo — aparece direto, como no Acompanhamento do colaborador.
              <>
                <FeedbackNarrativeView view={view} />
                {/* Indicator Diagnosis V1 — o diagnóstico técnico do fechamento, só para a liderança (o backend não o envia ao próprio colaborador). */}
                {item.feedback?.supervisorView ? <PrvSupervisorDiagnosis view={item.feedback.supervisorView} /> : null}
              </>
            ) : (
              <ExpandableContent item={item} open={open} onOpenChange={setOpen} />
            )}
            {/* Intervenção: uma atualização curta com o caminho para o caso — tarefas e decisões ficam lá (e em Pendências), nunca aqui. */}
            {item.kind === "ALERT" && item.category === "INTERVENTION" && item.caseId ? (
              <Link href={`/supervisor/cases/${encodeURIComponent(item.caseId)}`} className="inline-flex text-xs font-medium text-primary hover:underline">
                Abrir no caso de supervisão
              </Link>
            ) : null}
            {item.kind === "FEEDBACK" ? (
              <>
                <Separator />
                <div className="text-xs text-muted-foreground">
                  <AcknowledgementState acknowledgedAt={item.acknowledgedAt} />
                </div>
              </>
            ) : null}
          </div>
        </FeedbackCard>
      </IniaFeedItem>
    </div>
  )
}

/** "para Larissa Monteiro" (feedback do colaborador) ou "sobre Larissa Monteiro" (alerta endereçado à liderança). */
function Recipient({ item, operator, employeeHref }: { item: FollowUpItem; operator: NonNullable<FollowUpItem["operator"]>; employeeHref?: (personId: string) => string }) {
  const name = employeeHref ? (
    <Link href={employeeHref(operator.personId)} className="font-medium text-foreground hover:underline">
      {operator.name}
    </Link>
  ) : (
    <span className="font-medium text-foreground">{operator.name}</span>
  )
  return (
    <>
      {item.kind === "FEEDBACK" ? "para " : "sobre "}
      {name}
    </>
  )
}

/**
 * Feedback anterior ao view model e resultados de Workflow/escalonamentos: um resumo curto e o conteúdo integral no próprio
 * cartão (o mesmo "Ver feedback completo" do colaborador). Aberto, o resumo dá lugar ao conteúdo inteiro — nunca repetido.
 */
function ExpandableContent({ item, open, onOpenChange }: { item: FollowUpItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const isFeedback = item.kind === "FEEDBACK" && item.feedback !== null
  return (
    <div>
      {open ? null : (
        <div className={cn("text-muted-foreground", isFeedback ? "line-clamp-2" : "line-clamp-3")}>
          <RichContent text={item.summary} />
        </div>
      )}
      <Accordion type="single" collapsible value={open ? "content" : ""} onValueChange={(value) => onOpenChange(value === "content")}>
        <AccordionItem value="content" className="border-0">
          {/* O título do cartão é h3: o gatilho e as partes do feedback ficam abaixo dele na árvore de títulos. */}
          <AccordionTrigger headingLevel={4} className="justify-start gap-2 py-2 text-xs hover:no-underline">
            {isFeedback ? "Ver feedback completo" : "Ver análise completa"}
          </AccordionTrigger>
          <AccordionContent className="h-auto">
            <div className="space-y-6 pt-1">
              {isFeedback ? (
                <FeedbackSections feedback={item.feedback!} />
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

/** As quatro partes de um feedback publicável (evidência, comportamento, procedimento, recomendação) — cada uma integral, na
 * ordem em que o feedback é lido. */
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
          <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</h5>
          <div className="mt-2">
            {/* Evidência é citação literal da transcrição/dado — nunca passa por Markdown. */}
            {section.quote ? <blockquote className="border-l-2 border-primary/40 pl-3 text-sm leading-6 whitespace-pre-wrap break-words italic">{section.text}</blockquote> : <RichContent text={section.text} density="detail" />}
          </div>
        </section>
      ))}
      {/* Materiais resolvidos pelo backend para QUEM ESTÁ LENDO (o gestor): material fora do alcance dele aparece como
          indisponível, sem título — a referência não concede acesso. */}
      <SupportMaterialsSection materials={feedback.supportMaterials} />
    </>
  )
}

/** Ciência = confirmação formal do PRÓPRIO colaborador (no Acompanhamento dele) de que leu o feedback. Quem lidera só vê o
 * estado — no mesmo lugar e com o mesmo texto do controle do colaborador. */
function AcknowledgementState({ acknowledgedAt }: { acknowledgedAt: string | null }) {
  if (acknowledgedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300" data-testid="reading-confirmed">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        Ciência confirmada em {formatDateTime(acknowledgedAt)}
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300" tabIndex={0}>
          <Clock3 className="size-3.5 shrink-0" aria-hidden />
          Aguardando ciência do colaborador
        </span>
      </TooltipTrigger>
      <TooltipContent>O colaborador ainda não confirmou, no Acompanhamento dele, que leu este feedback.</TooltipContent>
    </Tooltip>
  )
}
