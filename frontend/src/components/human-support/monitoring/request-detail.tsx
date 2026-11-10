"use client"

import type { ReactNode } from "react"
import { ChevronLeft, ExternalLink, Eye, Star } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime, formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useSupportRequestDetailQuery } from "@/queries/human-support/use-human-support-admin"
import { CLASSIFICATION_OUTCOME_LABELS, CLASSIFICATION_REASON_LABELS, CLASSIFICATION_TOOL_REASONS, END_CAUSE_LABELS, EVALUATION_RESOLVED_LABELS, REQUEST_ORIGIN_LABELS, REQUEST_STATUS_LABELS } from "@/schemas/human-support/catalogs.schema"
import { durationText, type RequestDetail as RequestDetailView } from "@/schemas/human-support/monitoring.schema"
import type { MessageView, SharedContext } from "@/schemas/human-support/state.schema"

import { PanelError } from "./panel-error"

const seconds = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000)
const placeText = (team: string | null, subteam: string | null) => [team, subteam].filter(Boolean).join(" › ") || "Sem Grupo"

/**
 * Detalhe de um pedido no painel do apoio: o que o operador compartilhou, a conversa inteira (operador à direita, Anjo à esquerda,
 * sistema ao centro — o texto já vem do servidor como o leitor deve ver), os atendimentos com a primeira resposta, a classificação do
 * Anjo e a avaliação vigente do operador. Abrir grava o registro de leitura (LGPD) no servidor.
 */
export function RequestDetail({ requestId, onBack }: { requestId: string; onBack?: () => void }) {
  const query = useSupportRequestDetailQuery(requestId)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {onBack ? (
        <div className="border-b px-3 py-2 lg:hidden">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft data-icon="inline-start" aria-hidden />
            Voltar para os pedidos
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {query.isPending ? (
          <div className="space-y-3" aria-label="Carregando o pedido">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : query.isError ? (
          query.error instanceof ApiError && query.error.status === 404 ? (
            <p role="alert" className="text-sm text-muted-foreground">Este pedido não existe ou está fora do seu alcance.</p>
          ) : (
            <PanelError error={query.error} onRetry={() => void query.refetch()} />
          )
        ) : (
          <RequestDetailBody detail={query.data} />
        )}
      </div>
    </div>
  )
}

function RequestDetailBody({ detail }: { detail: RequestDetailView }) {
  return (
    <article className="space-y-5" aria-label={`Pedido ${detail.protocol}`}>
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tabular-nums">{detail.protocol}</h2>
          <Badge variant="secondary">{REQUEST_STATUS_LABELS[detail.status]}</Badge>
          {detail.endCause ? <span className="text-sm text-muted-foreground">{END_CAUSE_LABELS[detail.endCause] ?? detail.endCause}</span> : null}
        </div>
        <p className="text-sm">
          <span className="font-medium">{detail.operatorName}</span>
          <span className="text-muted-foreground"> · {placeText(detail.teamName, detail.subteamName)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {REQUEST_ORIGIN_LABELS[detail.origin]} · aberto em {formatDateTime(detail.createdAt)}
          {detail.endedAt ? ` · terminou em ${formatDateTime(detail.endedAt)}` : ""}
        </p>
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />
          Abrir este pedido fica registrado (quem viu os dados do operador e dos Anjos).
        </p>
      </header>

      <SharedContextCard context={detail.sharedContext} />

      <Section title="Conversa">
        <Conversation messages={detail.messages} />
      </Section>

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
    </article>
  )
}

/** O que o operador compartilhou ao pedir ajuda. A resposta da INIA é texto de IA (RichContent); o resto é texto da pessoa, puro. */
function SharedContextCard({ context }: { context: SharedContext }) {
  const empty = !context.question && !context.answer && !context.dislike && !context.note
  return (
    <section className="space-y-2 rounded-xl border bg-muted/30 p-3" aria-label="O que o operador compartilhou">
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

function Conversation({ messages }: { messages: MessageView[] }) {
  if (messages.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma mensagem.</p>
  return (
    <ol className="space-y-2" aria-label="Mensagens do apoio">
      {messages.map((message) => {
        if (message.authorKind === "SYSTEM") {
          return (
            <li key={message.id} data-author="SYSTEM" className="flex justify-center">
              <p className="max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
                {message.body} <span className="tabular-nums">· {formatShortDateTime(message.occurredAt)}</span>
              </p>
            </li>
          )
        }
        const operator = message.authorKind === "OPERATOR"
        return (
          <li key={message.id} data-author={message.authorKind} className={cn("flex", operator ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] space-y-0.5 rounded-2xl px-3 py-2 text-sm", operator ? "rounded-br-sm bg-primary/10" : "rounded-bl-sm border bg-card")}>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{message.authorName ?? (operator ? "Operador" : "Anjo")}</span>
                {operator ? null : <Badge variant="outline" className="ml-1.5 h-4 px-1.5 text-[10px]">Anjo</Badge>}
                <span className="ml-1.5 tabular-nums">{formatShortDateTime(message.occurredAt)}</span>
              </p>
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
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
