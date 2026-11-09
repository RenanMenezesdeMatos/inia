"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatShortDateTime } from "@/lib/format/date"
import { useResponseCheckSummaryQuery, useResponseChecksQuery } from "@/queries/admin/use-governance-queries"
import { RESPONSE_CHECK_SURFACE_LABELS, type ResponseCheckEvent, type ResponseCheckSummary } from "@/schemas/admin/governance.schema"

const PAGE_SIZE = 20

/** O que a conferência faz no modo em vigor. Só ENFORCE previne; AUDIT e OFF nunca aparecem como prevenção. */
const MODE_NOTICE: Record<ResponseCheckSummary["mode"], string> = {
  ENFORCE: "Antes de entregar, a INIA confere se a resposta viola os assuntos proibidos ou os limites do agente. Na voz, o que vem do servidor é conferido antes de ser falado; o que o modelo de voz diz por conta própria só é conferido depois de falado, e a fala não volta atrás.",
  AUDIT: "Modo de auditoria: nada é impedido antes da entrega. A resposta é entregue e conferida depois, e o que for detectado sai da conversa e fica registrado.",
  OFF: "A conferência está desligada: nenhuma resposta é conferida nem registrada.",
}
const NOT_COVERED = "Esta conferência não cobre o motor de feedback, os reports, as intervenções, o treino nem as boas práticas."

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
  const [open, setOpen] = useState<string | null>(null)
  const list = useResponseChecksQuery({ page, pageSize: PAGE_SIZE })
  const mode = useResponseCheckSummaryQuery().data?.mode
  const total = list.data?.total ?? 0
  return (
    <div className="space-y-4">
      {mode ? <p className="max-w-3xl text-sm text-muted-foreground">{MODE_NOTICE[mode]} {NOT_COVERED}</p> : null}
      <Summary />
      {list.isError ? <p className="text-sm text-muted-foreground">{list.error.message}</p> : null}
      {list.data && list.data.items.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma resposta bloqueada, detectada ou sem conferência.</p> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
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
      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      ) : null}
    </div>
  )
}
