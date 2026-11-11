"use client"

import type { ReactNode } from "react"
import { ArrowLeft, ExternalLink, HeartHandshake, Lock, Star } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/api-client"
import { dateSeparatorLabel, dayKey, formatShortDateTime, messageTime } from "@/lib/format/date"
import { useSupportRequestDetailQuery } from "@/queries/human-support/use-human-support-admin"
import { CLASSIFICATION_OUTCOME_LABELS, CLASSIFICATION_REASON_LABELS, CLASSIFICATION_TOOL_REASONS, END_CAUSE_LABELS, EVALUATION_RESOLVED_LABELS } from "@/schemas/human-support/catalogs.schema"
import { durationText, type RequestDetail as RequestDetailView } from "@/schemas/human-support/monitoring.schema"
import type { MessageView, SharedContext } from "@/schemas/human-support/state.schema"

import { PanelError } from "./panel-error"
import { messagesLabel, OperatorAvatar, RequestStatusLabel, requestOriginOf } from "./request-presentation"

const seconds = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000)
const placeText = (team: string | null, subteam: string | null) => [team, subteam].filter(Boolean).join(" › ") || "Sem Grupo"

/**
 * Leitura de UM pedido no painel do apoio, no formato da conversa em "Conversas com a INIA": o cabeçalho com a origem, o estado e
 * quem pediu; no corpo, o que o operador compartilhou, a conversa (operador à direita, Anjo à esquerda, sistema ao centro — o texto já
 * vem do servidor como o leitor deve ver) e, no fim, os atendimentos, a classificação do Anjo e a avaliação vigente. Somente leitura.
 * Abrir grava o registro de leitura (LGPD) no servidor; na fila ou em atendimento, a leitura se atualiza sozinha.
 */
export function RequestDetail({ requestId, onBack }: { requestId: string; onBack?: () => void }) {
  const query = useSupportRequestDetailQuery(requestId)
  if (query.isPending) {
    return (
      <div className="space-y-4 p-4" aria-label="Carregando o pedido">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-14 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
      </div>
    )
  }
  if (!query.data) {
    const denied = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404)
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
        {denied ? (
          <>
            <Lock className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="font-medium">Pedido indisponível</p>
            <p className="max-w-sm text-sm text-muted-foreground">Este pedido não existe ou está fora do seu alcance.</p>
          </>
        ) : (
          <PanelError error={query.error} onRetry={() => void query.refetch()} />
        )}
        {onBack ? <Button variant="ghost" size="sm" className="lg:hidden" onClick={onBack}><ArrowLeft />Voltar à lista</Button> : null}
      </div>
    )
  }
  return <RequestThread detail={query.data} onBack={onBack} />
}

function RequestThread({ detail, onBack }: { detail: RequestDetailView; onBack: (() => void) | undefined }) {
  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={`Pedido ${detail.protocol}`}>
      <ThreadHeader detail={detail} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-5">
        <div className="mx-auto max-w-3xl space-y-5">
          <SharedContextCard context={detail.sharedContext} />
          <Conversation messages={detail.messages} operator={{ name: detail.operatorName, avatarUrl: detail.operatorAvatarUrl }} />
          <OutcomeCard detail={detail} />
        </div>
      </div>
      <p className="flex items-center justify-center gap-1.5 border-t px-4 py-2 text-center text-[11px] text-muted-foreground">
        <Lock className="size-3 shrink-0" aria-hidden />
        Somente leitura — abrir este pedido fica registrado (quem viu os dados).
      </p>
    </article>
  )
}

/** Cabeçalho: de onde veio o pedido e o protocolo, o estado (e por que terminou), quem pediu (Grupo › Subgrupo), quando e quantas mensagens. */
function ThreadHeader({ detail, onBack }: { detail: RequestDetailView; onBack: (() => void) | undefined }) {
  const origin = requestOriginOf(detail.origin)
  return (
    <header className="space-y-3 border-b px-5 py-4">
      <div className="flex items-start gap-3">
        {onBack ? <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={onBack} aria-label="Voltar à lista"><ArrowLeft /></Button> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"><origin.icon className="size-3.5" aria-hidden />{origin.label}</p>
            <span className="inline-flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <RequestStatusLabel status={detail.status} />
              {detail.endCause ? <span>· {END_CAUSE_LABELS[detail.endCause] ?? detail.endCause}</span> : null}
            </span>
          </div>
          <h2 className="text-lg leading-snug font-semibold tabular-nums">Pedido {detail.protocol}</h2>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <OperatorAvatar name={detail.operatorName} avatarUrl={detail.operatorAvatarUrl} className="size-6 text-[10px]" />
          <span className="min-w-0 truncate"><span className="font-medium text-foreground">{detail.operatorName}</span> · {placeText(detail.teamName, detail.subteamName)}</span>
        </span>
        <span>Aberto em {formatShortDateTime(detail.createdAt)}</span>
        {detail.endedAt ? <span>Terminou em {formatShortDateTime(detail.endedAt)}</span> : null}
        <span className="tabular-nums">{messagesLabel(detail.messageCount)}</span>
      </div>
    </header>
  )
}

/** O que o operador compartilhou ao pedir ajuda. A resposta da INIA é texto de IA (RichContent); o resto é texto da pessoa, puro. */
function SharedContextCard({ context }: { context: SharedContext }) {
  const empty = !context.question && !context.answer && !context.dislike && !context.note
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4 shadow-xs" aria-label="O que o operador compartilhou">
      <h3 className="text-sm font-semibold">O que o operador compartilhou</h3>
      {empty ? <p className="text-sm text-muted-foreground">Pedido aberto pelo botão, sem pergunta nem nota.</p> : null}
      <dl className="space-y-2 text-sm">
        {context.question ? <Field label="Pergunta à INIA"><span className="whitespace-pre-wrap">{context.question}</span></Field> : null}
        {context.answer ? (
          <Field label="Resposta da INIA">
            <RichContent text={context.answer} />
          </Field>
        ) : null}
        {context.dislike ? (
          <Field label="Descurtida">
            <span>{context.dislike.reasonLabel}</span>
            {context.dislike.comment ? <span className="mt-0.5 block whitespace-pre-wrap text-muted-foreground">{context.dislike.comment}</span> : null}
          </Field>
        ) : null}
        {context.note ? <Field label="Nota do operador"><span className="whitespace-pre-wrap">{context.note}</span></Field> : null}
      </dl>
    </section>
  )
}

/** A conversa como num aplicativo de mensagens: separadores de data, operador à direita com a foto, Anjo à esquerda, sistema ao centro. */
function Conversation({ messages, operator }: { messages: MessageView[]; operator: { name: string; avatarUrl: string | null } }) {
  if (messages.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma mensagem.</p>
  return (
    <ol className="space-y-5" aria-label="Mensagens do apoio">
      {messages.map((message, index) => {
        const separator = index === 0 || dayKey(messages[index - 1]!.occurredAt) !== dayKey(message.occurredAt)
        const operatorMessage = message.authorKind === "OPERATOR"
        return (
          <li key={message.id} data-author={message.authorKind} className="space-y-5">
            {separator ? (
              <div className="flex justify-center" role="separator" aria-label={dateSeparatorLabel(message.occurredAt)}>
                <span className="rounded-full bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs">{dateSeparatorLabel(message.occurredAt)}</span>
              </div>
            ) : null}
            {message.authorKind === "SYSTEM" ? (
              <div className="flex justify-center">
                <p className="max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
                  {message.body} <span className="tabular-nums">· {messageTime(message.occurredAt)}</span>
                </p>
              </div>
            ) : (
              <Message align={operatorMessage ? "end" : "start"}>
                <MessageAvatar>
                  {operatorMessage ? (
                    <OperatorAvatar name={operator.name} avatarUrl={operator.avatarUrl} className="size-8" />
                  ) : (
                    <Avatar className="size-8"><AvatarFallback className="bg-primary text-primary-foreground"><HeartHandshake className="size-4" aria-hidden /></AvatarFallback></Avatar>
                  )}
                </MessageAvatar>
                <MessageContent className="max-w-[85%]">
                  <MessageHeader className="px-1">
                    {message.authorName ?? (operatorMessage ? operator.name : "Anjo")}
                    {operatorMessage ? null : <span className="ml-1.5 font-normal text-muted-foreground">· Anjo</span>}
                  </MessageHeader>
                  <Bubble variant={operatorMessage ? "default" : "muted"} className="max-w-full">
                    <BubbleContent className="px-4 py-3"><span className="whitespace-pre-wrap break-words">{message.body}</span></BubbleContent>
                  </Bubble>
                  <MessageFooter className="px-1"><time dateTime={message.occurredAt}>{messageTime(message.occurredAt)}</time></MessageFooter>
                </MessageContent>
              </Message>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Como terminou: cada atendimento com a primeira resposta, a classificação do Anjo e a avaliação vigente do operador. */
function OutcomeCard({ detail }: { detail: RequestDetailView }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-xs" aria-label="Como foi o atendimento">
      <Section title="Atendimentos">
        {detail.attendances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum Anjo recebeu este pedido.</p>
        ) : (
          <ul className="space-y-2">
            {detail.attendances.map((attendance) => (
              <li key={attendance.id} className="rounded-lg border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">{attendance.anjoName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatShortDateTime(attendance.startedAt)}
                    {attendance.endedAt ? ` – ${formatShortDateTime(attendance.endedAt)}` : " · em andamento"}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Primeira resposta: {attendance.firstAnjoMessageAt ? durationText(seconds(attendance.startedAt, attendance.firstAnjoMessageAt)) : "sem resposta do Anjo"}
                  {attendance.endCause ? ` · ${END_CAUSE_LABELS[attendance.endCause] ?? attendance.endCause}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Classificação do Anjo">
        {detail.classification ? (
          <dl className="space-y-1.5 text-sm">
            <Field label="Motivo do encaminhamento">{CLASSIFICATION_REASON_LABELS[detail.classification.reason]}</Field>
            {/* Impedimento operacional (V2): o título é a ferramenta ou o sistema afetado e a descrição, os detalhes. Os rótulos da V1 não mudam. */}
            {detail.classification.referenceTitle ? <Field label={CLASSIFICATION_TOOL_REASONS.includes(detail.classification.reason) ? "Ferramenta ou sistema afetado" : "Onde estava a informação"}>{detail.classification.referenceTitle}</Field> : null}
            {detail.classification.otherDescription ? (
              <Field label={CLASSIFICATION_TOOL_REASONS.includes(detail.classification.reason) ? "Detalhes" : "Descrição"}>
                <span className="whitespace-pre-wrap">{detail.classification.otherDescription}</span>
              </Field>
            ) : null}
            {detail.classification.referenceUrl ? (
              <Field label="Endereço informado">
                <span className="block break-all font-mono text-xs">{detail.classification.referenceUrl}</span>
                <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ExternalLink className="size-3" aria-hidden />
                  Endereço externo digitado pelo Anjo: confira antes de abrir em outra aba.
                </span>
              </Field>
            ) : null}
            <Field label="Resultado">{CLASSIFICATION_OUTCOME_LABELS[detail.classification.outcome]}</Field>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Ainda sem classificação.</p>
        )}
      </Section>

      <Section title="Avaliação do operador">
        {detail.resolved === null && detail.stars === null ? (
          <p className="text-sm text-muted-foreground">O operador não avaliou o atendimento.</p>
        ) : (
          <dl className="space-y-1.5 text-sm">
            <Field label="Sua dúvida foi resolvida?">{detail.resolved ? EVALUATION_RESOLVED_LABELS[detail.resolved] : "Sem resposta"}</Field>
            <Field label="Estrelas">
              {detail.stars === null ? (
                "Sem nota"
              ) : (
                <span className="inline-flex items-center gap-1" aria-label={`${detail.stars} de 5 estrelas`}>
                  <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                  {detail.stars} de 5
                </span>
              )}
            </Field>
          </dl>
        )}
      </Section>
    </section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
