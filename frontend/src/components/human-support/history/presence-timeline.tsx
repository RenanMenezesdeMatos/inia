"use client"

import { History } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/format/date"
import { useAnjoPresenceTimelineQuery } from "@/queries/human-support/use-human-support-admin"
import { PAUSE_REASON_LABELS, PRESENCE_STATUS_LABELS } from "@/schemas/human-support/catalogs.schema"

import { PanelError } from "../monitoring/panel-error"

/**
 * LINHA DO TEMPO DA PRESENÇA de um Anjo no período (cada troca de estado e de conexão, com a causa) — veio da antiga tabela "No período"
 * da aba Anjos para o detalhe do Anjo em "Jornada e atendimentos" (histórico fica no histórico; a Monitoria Online é só o agora).
 * Abrir grava o registro de quem viu a presença (no servidor).
 */
/** Por que a presença mudou (catálogo `PRESENCE_EVENT_CAUSES` do servidor). */
export const PRESENCE_CAUSE_LABELS: Record<string, string> = {
  ANJO: "pelo Anjo",
  ANJO_SCHEDULED: "programado pelo Anjo, ao terminar o último atendimento",
  LEASE_EXPIRED: "área do Anjo fechada (sem sinal)",
  ROLE_REVOKED: "papel Anjo retirado",
  CONNECTION_LOST: "conexão perdida",
  CONNECTION_RESTORED: "conexão retomada",
  SESSION_ENDED: "sessão encerrada",
  // Migration 195: o Anjo ficou sem responder ninguém.
  UNRESPONSIVE: "pelo sistema: ficou sem responder ninguém",
  UNRESPONSIVE_TIMEOUT: "pelo sistema: não voltou da pausa Desconexão",
}

export function PresenceTimeline({ personId, name, period }: { personId: string; name: string; period: { from: string; to: string } }) {
  const query = useAnjoPresenceTimelineQuery(personId, period)
  if (query.isPending) return <Skeleton className="h-16 w-full" aria-label={`Carregando a presença de ${name}`} />
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.events.length === 0) return <p className="text-sm text-muted-foreground"><History className="mr-1 inline size-4" aria-hidden />Nenhuma mudança de presença de {name} no período.</p>
  return (
    <ol className="space-y-1 text-sm" aria-label={`Presença de ${name}`}>
      {query.data.events.map((event, index) => (
        <li key={`${event.occurredAt}:${index}`} className="flex flex-wrap gap-x-2">
          <span className="text-muted-foreground tabular-nums">{formatDateTime(event.occurredAt)}</span>
          <span>
            {event.fromStatus ? `${PRESENCE_STATUS_LABELS[event.fromStatus]} → ` : ""}
            <span className="font-medium">{PRESENCE_STATUS_LABELS[event.toStatus]}</span>
            {event.pauseReason ? ` (${PAUSE_REASON_LABELS[event.pauseReason]})` : ""}
          </span>
          <span className="text-muted-foreground">· {PRESENCE_CAUSE_LABELS[event.cause] ?? event.cause}</span>
        </li>
      ))}
    </ol>
  )
}
