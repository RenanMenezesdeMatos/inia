"use client"

import { useState } from "react"
import { EllipsisVertical, Pencil, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { FeedbackCard, FeedbackEntryHeader } from "@/components/feedbacks/feedback-entry-header"
import { IniaFeedItem } from "@/components/operator/inia-feed"
import Link from "next/link"
import { publicationPath } from "@/components/publications/publications-route"
import { ModerationRetireDialog } from "@/components/publications/moderation/moderation-retire-dialog"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime, formatFeedTimestamp } from "@/lib/format/date"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import { useCommunicationQuery, useRetireCommunicationMutation } from "@/queries/communications/use-communications"
import type { Communication, ReceivedCommunication } from "@/schemas/communications/communication.schema"

/** Para quem foi e, para quem publicou, quantas pessoas receberam. */
export function communicationAudienceLabel(notice: Communication | ReceivedCommunication): string {
  const audience = notice.audience === "ORGANIZATION" ? "toda a empresa" : notice.audience === "SEGMENT" ? "um público específico" : notice.authoredByViewer ? "sua equipe" : "a equipe"
  if (!notice.authoredByViewer) return `Para ${audience}`
  const count = notice.recipientCount === null ? "" : ` · ${notice.recipientCount.toLocaleString("pt-BR")} ${notice.recipientCount === 1 ? "pessoa" : "pessoas"}`
  return `Publicado para ${audience}${count}`
}

/**
 * Comunicado da liderança no Acompanhamento — a MESMA peça no feed de quem lidera (publicados e recebidos) e no do colaborador
 * (recebidos). Só leitura: sem ciência nem "Ouvir com a INIA". O HTML já vem refeito pelo servidor e passa de novo pelo saneador da
 * tela antes de ir ao DOM. Quem publicou edita (versão anterior guardada no servidor) ou retira (exclusão lógica, que volta por
 * Consultar dados › Itens excluídos); quem recebeu vê "editado" quando o texto mudou depois da publicação.
 * No Acompanhamento do colaborador o comunicado chega da lista LEVE (`ReceivedCommunication`: trecho do texto, sem o conteúdo) e o
 * conteúdo inteiro é lido pelo id ao abrir — o servidor confere de novo se a pessoa o enxerga.
 */
export function CommunicationEntry({ notice }: { notice: Communication | ReceivedCommunication }) {
  const full = "contentHtml" in notice ? notice : null
  const author = notice.authoredByViewer ? "Comunicado seu" : `Comunicado de ${notice.author.name}`
  const edited = notice.editedAt ? <span className="text-muted-foreground/80" title={`Editado em ${formatDateTime(notice.editedAt)}`}> · editado</span> : null
  return (
    <div data-testid="communication-entry">
      <IniaFeedItem timestamp={formatFeedTimestamp(notice.publishedAt)} recipient={<>{author}{edited}</>} meta={<span className="truncate font-normal">{communicationAudienceLabel(notice)}</span>}>
        <FeedbackCard
          header={
            <FeedbackEntryHeader
              origin={{ family: "NOTICE", label: null, iconKey: null }}
              title={notice.title}
              badges={notice.tags.map((tag) => (
                <Badge variant="secondary" className="border-0" key={tag}>
                  {tag}
                </Badge>
              ))}
              action={full?.authoredByViewer ? <AuthorActions notice={full} /> : !notice.authoredByViewer ? <ModeratorActions notice={notice} /> : undefined}
            />
          }
        >
          {full ? <CommunicationBody html={full.contentHtml} /> : <CollapsedCommunication notice={notice as ReceivedCommunication} />}
        </FeedbackCard>
      </IniaFeedItem>
    </div>
  )
}

function CommunicationBody({ html }: { html: string }) {
  return <div className="inia-rich-content text-sm leading-6 text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />
}

/** Recebido (lista leve): o começo do texto e, ao abrir, o conteúdo inteiro lido pelo id. */
function CollapsedCommunication({ notice }: { notice: ReceivedCommunication }) {
  const [open, setOpen] = useState(false)
  const content = useCommunicationQuery(notice.id, open)
  const preview = notice.excerpt || (notice.hasImages ? "Comunicado com imagem." : "")
  return (
    <>
      {!open && preview ? <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{preview}{notice.excerpt && notice.hasImages ? <span className="text-muted-foreground/80"> · com imagem</span> : null}</p> : null}
      <Accordion type="single" collapsible value={open ? "content" : ""} onValueChange={(value) => setOpen(value === "content")}>
        <AccordionItem value="content" className="border-0">
          <AccordionTrigger className="justify-start gap-2 py-2 text-xs hover:no-underline">{open ? "Recolher comunicado" : "Ler comunicado completo"}</AccordionTrigger>
          <AccordionContent className="h-auto">
            {content.data ? (
              <CommunicationBody html={content.data.contentHtml} />
            ) : content.isError ? (
              <p role="alert" className="text-sm text-muted-foreground">
                Não foi possível abrir o comunicado.{" "}
                <button type="button" className="underline" onClick={() => void content.refetch()}>
                  Tentar novamente
                </button>
              </p>
            ) : (
              <div className="space-y-2" aria-busy="true" aria-label="Carregando o comunicado">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  )
}

function AuthorActions({ notice }: { notice: Communication }) {
  const [retiring, setRetiring] = useState(false)
  const retire = useRetireCommunicationMutation()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Ações do comunicado">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={publicationPath(notice.id)}>
              <Pencil />
              Editar
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setRetiring(true)}>
            <Trash2 />
            Retirar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={retiring} onOpenChange={setRetiring}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirar o comunicado?</AlertDialogTitle>
            <AlertDialogDescription>“{notice.title}” sai do Acompanhamento de todos que o receberam. O registro fica guardado e pode voltar por Consultar dados › Itens excluídos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retire.isPending}>Manter</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={retire.isPending}
              onClick={(event) => {
                event.preventDefault()
                retire.mutate(notice.id, {
                  onSuccess: () => {
                    toast.success("Comunicado retirado.")
                    setRetiring(false)
                  },
                  onError: (failure) => toast.error(failure instanceof Error && failure.message ? failure.message : "Não foi possível retirar o comunicado."),
                })
              }}
            >
              Retirar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Moderação (Administrador geral): retirar, com motivo, o comunicado de outra pessoa direto do Acompanhamento. Sem a permissão, nada aparece. */
function ModeratorActions({ notice }: { notice: Communication | ReceivedCommunication }) {
  const me = useCurrentUserQuery()
  const [retiring, setRetiring] = useState(false)
  if (!me.data?.access.capabilities.canModerateCommunications) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Moderação do comunicado">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setRetiring(true)}>
            <ShieldAlert />
            Retirar (moderação)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ModerationRetireDialog id={notice.id} title={notice.title} authorName={notice.author.name} open={retiring} onOpenChange={setRetiring} />
    </>
  )
}

