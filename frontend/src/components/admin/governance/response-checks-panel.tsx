"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { Button } from "@/components/ui/button"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatShortDateTime } from "@/lib/format/date"
import { useResponseCheckSummaryQuery, useResponseChecksQuery } from "@/queries/admin/use-governance-queries"
import { RESPONSE_CHECK_SURFACE_LABELS, type ResponseCheckEvent, type ResponseCheckSummary } from "@/schemas/admin/governance.schema"

const DEFAULT_PAGE_SIZE = 20

type CheckMode = ResponseCheckSummary["mode"]
/** O que a conferência faz em cada grupo, no modo em vigor. Só ENFORCE previne; AUDIT e OFF nunca aparecem como prevenção. */
const COVERAGE: { key: keyof ResponseCheckSummary["modes"]; label: string; text: Record<CheckMode, string> }[] = [
  {
    key: "conversation",
    label: "Chat, voz, agentes e orquestradores",
    text: {
      ENFORCE: "conferidos antes da entrega. O que o modelo de voz diz por conta própria só é conferido depois de falado, e a fala não volta atrás.",
      AUDIT: "modo de auditoria: nada é impedido antes da entrega. A resposta é entregue e conferida depois.",
      OFF: "conferência desligada: nada é conferido nem registrado.",
    },
  },
  {
    key: "content",
    label: "Reports, intervenções e boas práticas",
    text: {
      ENFORCE: "conferidos antes de ficarem disponíveis. Só o texto da IA é conferido; tabelas e fatos, não.",
      AUDIT: "modo de auditoria: nada é impedido antes da entrega. O que for detectado fica registrado.",
      OFF: "conferência desligada: nada é conferido nem registrado.",
    },
  },
  {
    key: "feedback",
    label: "Mensagens de feedback",
    text: {
      ENFORCE: "conferidas antes de serem publicadas. Citações de chamadas não contam sozinhas como violação.",
      AUDIT: "modo de auditoria: nada é impedido antes da entrega. A mensagem é publicada, e o que for detectado fica registrado.",
      OFF: "conferência desligada: nada é conferido nem registrado.",
    },
  },
]
const NOT_COVERED = "Sem cobertura: a análise interna do motor de feedback, o Diagnóstico da liderança e a apresentação falada em \"Ouvir com a INIA\"."

/** O que aconteceu, em palavras de quem audita: prevenção e detecção nunca se confundem. */
function situationOf(event: Pick<ResponseCheckEvent, "outcome" | "action">): { label: string; variant: "destructive" | "secondary" | "outline" } {
  if (event.outcome === "CHECK_FAILED") return event.action === "BLOCKED" ? { label: "Conferência falhou: não entregue", variant: "secondary" } : { label: "Conferência falhou: já tinha sido entregue", variant: "outline" }
  return event.action === "BLOCKED" ? { label: "Bloqueada antes da entrega", variant: "destructive" } : { label: "Detectada depois da entrega", variant: "destructive" }
}

function Summary() {
  const summary = useResponseCheckSummaryQuery()
  if (summary.isError) return <p className="text-sm text-muted-foreground">{summary.error.message}</p>
  if (!summary.data) return null
  const items = [
    { label: "Conferidas", value: summary.data.checked },
    { label: "Bloqueadas antes da entrega", value: summary.data.blocked },
    { label: "Detectadas depois da entrega", value: summary.data.detected },
    { label: "Conferência falhou", value: summary.data.failed },
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={`Últimos ${summary.data.days} dias`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Registro da conferência das respostas (PEN-017). As regras são as de "Assuntos proibidos" e os limites de cada agente: nada se cadastra aqui. O texto
 * guardado é o que a pessoa não recebeu, ou, na voz, o que ela já tinha ouvido; só quem administra a organização inteira lê.
 */
export function ResponseChecksPanel() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [open, setOpen] = useState<string | null>(null)
  const list = useResponseChecksQuery({ page, pageSize })
  const modes = useResponseCheckSummaryQuery().data?.modes
  const total = list.data?.total ?? 0
  return (
    <div className="space-y-4">
      {modes ? (
        <div className="max-w-3xl space-y-1 text-sm text-muted-foreground" data-testid="response-check-coverage">
          {COVERAGE.map((group) => (
            <p key={group.key}><span className="font-medium text-foreground">{group.label}:</span> {group.text[modes[group.key]]}</p>
          ))}
          <p>{NOT_COVERED}</p>
        </div>
      ) : null}
      <Summary />
      {list.isError ? <p className="text-sm text-muted-foreground">{list.error.message}</p> : null}
      {list.data && list.data.items.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma resposta bloqueada, detectada ou sem conferência.</p> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>O que aconteceu</TableHead>
                <TableHead>Regra e motivo</TableHead>
                <TableHead>
                  <span className="sr-only">Texto</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((event) => {
                const situation = situationOf(event)
                return (
                  <TableRow key={event.id} data-testid="response-check-row">
                    <TableCell className="whitespace-nowrap text-sm">{formatShortDateTime(event.createdAt, { withYear: true })}</TableCell>
                    <TableCell className="text-sm">
                      {RESPONSE_CHECK_SURFACE_LABELS[event.surface] ?? event.surface}
                      {event.agentName ? <p className="text-xs text-muted-foreground">{event.agentName}</p> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={situation.variant}>{situation.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-96 whitespace-normal text-sm">
                      {event.rules.map((rule) => rule.name).join(", ")}
                      {event.reason ? <p className="text-xs text-muted-foreground">{event.reason}</p> : null}
                      {event.sourceRef && !event.flaggedContent ? <p className="text-xs text-muted-foreground">O conteúdo fica na origem, com quem já pode lê-la.</p> : null}
                      {open === event.id ? <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{event.flaggedContent}</p> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.flaggedContent ? (
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === event.id ? null : event.id)}>
                          {open === event.id ? "Ocultar texto" : "Ver texto"}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {total > 0 ? (
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={total}
          isFetching={list.isFetching}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          itemLabel={["conferência", "conferências"]}
        />
      ) : null}
    </div>
  )
}
