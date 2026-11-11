"use client"

import { Fragment, useState } from "react"
import { ChevronDown, ChevronRight, Eye, HeartHandshake } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"
import { useAnjoPresenceTimelineQuery, useAnjosActivityQuery } from "@/queries/human-support/use-human-support-admin"
import { PAUSE_REASON_LABELS, PAUSE_REASONS, PRESENCE_STATUS_LABELS } from "@/schemas/human-support/catalogs.schema"
import { durationText, type AnjoActivity } from "@/schemas/human-support/monitoring.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { SectionLabel } from "@/components/ui/surface"

import { AnjosNowSection } from "./anjos-now-section"
import { PanelError } from "./panel-error"
import { periodText } from "./funnel-tab"

/** Por que a presença mudou (catálogo `PRESENCE_EVENT_CAUSES` do servidor). */
const PRESENCE_CAUSE_LABELS: Record<string, string> = {
  ANJO: "pelo Anjo",
  ANJO_SCHEDULED: "programado pelo Anjo, ao terminar o último atendimento",
  LEASE_EXPIRED: "área do Anjo fechada (sem sinal)",
  ROLE_REVOKED: "papel Anjo retirado",
  CONNECTION_LOST: "conexão perdida",
  CONNECTION_RESTORED: "conexão retomada",
}

const hoursText = (hours: number) => `${hours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`

/**
 * Aba Anjos: primeiro a SITUAÇÃO AGORA (não depende do período), depois a atividade NO PERÍODO.
 * Atividade no período, por Anjo no alcance de quem lê (D11): horas disponível, em pausa por motivo e sem conexão; atendimentos; tempo até a
 * primeira resposta (p50/p90) e atendimentos sem resposta; média das estrelas só com 5 notas ou mais. "Ver presença" abre a linha do
 * tempo do Anjo no período. Abrir a aba e a presença grava o registro de leitura no servidor.
 */
export function AnjosActivityTab({ filter }: { filter: PanelFilter }) {
  const query = useAnjosActivityQuery(filter)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Eye className="size-3.5" aria-hidden />
        Abrir esta aba e a presença de um Anjo fica registrado (quem viu a presença e as pausas de cada Anjo).
      </p>
      <AnjosNowSection filter={{ teamId: filter.teamId ?? null, subteamId: filter.subteamId ?? null }} />
      <section aria-labelledby="anjos-period-title" className="space-y-3">
        <div className="space-y-0.5">
          <SectionLabel id="anjos-period-title">No período</SectionLabel>
          <p className="text-sm text-muted-foreground">O que cada Anjo fez de {periodText(filter)}: horas em cada estado, atendimentos, tempo até a primeira resposta e estrelas.</p>
        </div>
      {query.isPending ? (
        <Skeleton className="h-48 w-full rounded-xl" aria-label="Carregando os Anjos" />
      ) : query.isError ? (
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <AnalyticsEmptyState icon={HeartHandshake} title="Nenhum Anjo no seu alcance" description="Aparecem aqui os Anjos cujo escopo o seu papel cobre." />
      ) : (
        <div className={TABLE_FRAME}>
          <Table aria-label="Atividade dos Anjos">
            <TableHeader>
              <TableRow>
                <TableHead>Anjo</TableHead>
                <TableHead className="text-right">Horas disponível</TableHead>
                <TableHead>Horas em pausa</TableHead>
                <TableHead className="text-right">Horas sem conexão</TableHead>
                <TableHead className="text-right">Atendimentos</TableHead>
                <TableHead className="text-right" title="Metade dos atendimentos teve a primeira resposta do Anjo em até esse tempo.">1ª resposta (mediana)</TableHead>
                <TableHead className="text-right" title="90% dos atendimentos tiveram a primeira resposta em até esse tempo.">1ª resposta (90% até)</TableHead>
                <TableHead className="text-right">Encerrados sem resposta</TableHead>
                <TableHead className="text-right" title="Média das notas; aparece com 5 notas ou mais.">Estrelas (média)</TableHead>
                <TableHead><span className="sr-only">Presença</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((anjo) => (
                <Fragment key={anjo.personId}>
                  <ActivityRow anjo={anjo} open={openId === anjo.personId} onToggle={() => setOpenId(openId === anjo.personId ? null : anjo.personId)} />
                  {openId === anjo.personId ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={10} className="whitespace-normal">
                        <PresenceTimeline personId={anjo.personId} name={anjo.name} period={{ from: filter.from, to: filter.to }} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      </section>
    </div>
  )
}

function ActivityRow({ anjo, open, onToggle }: { anjo: AnjoActivity; open: boolean; onToggle: () => void }) {
  const pauses = PAUSE_REASONS.map((reason) => ({ reason, hours: anjo.hoursPaused[reason] ?? 0 })).filter((entry) => entry.hours > 0)
  const pausedTotal = pauses.reduce((sum, entry) => sum + entry.hours, 0)
  return (
    <TableRow data-testid={`anjo-activity-${anjo.personId}`}>
      <TableCell className="font-medium">{anjo.name}</TableCell>
      <TableCell className="text-right tabular-nums">{hoursText(anjo.hoursAvailable)}</TableCell>
      <TableCell className="whitespace-normal">
        {pauses.length === 0 ? (
          <span className="tabular-nums">{hoursText(0)}</span>
        ) : (
          <span className="block min-w-36 tabular-nums">
            {hoursText(pausedTotal)}
            <span className="block text-xs text-muted-foreground">{pauses.map((entry) => `${PAUSE_REASON_LABELS[entry.reason]} ${hoursText(entry.hours)}`).join(" · ")}</span>
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{hoursText(anjo.hoursDisconnected)}</TableCell>
      <TableCell className="text-right tabular-nums">{anjo.attendances.toLocaleString("pt-BR")}</TableCell>
      <TableCell className="text-right tabular-nums">{durationText(anjo.firstResponse.p50Seconds)}</TableCell>
      <TableCell className="text-right tabular-nums">{durationText(anjo.firstResponse.p90Seconds)}</TableCell>
      <TableCell className="text-right tabular-nums">{anjo.firstResponse.withoutResponse.toLocaleString("pt-BR")}</TableCell>
      <TableCell className="text-right tabular-nums" title={anjo.averageStars === null ? "A média aparece com 5 notas ou mais." : undefined}>
        {anjo.averageStars === null ? "—" : anjo.averageStars.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
      </TableCell>
      <TableCell>
        <Button type="button" variant="ghost" size="xs" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown data-icon="inline-start" aria-hidden /> : <ChevronRight data-icon="inline-start" aria-hidden />}
          {open ? "Fechar presença" : "Ver presença"}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function PresenceTimeline({ personId, name, period }: { personId: string; name: string; period: { from: string; to: string } }) {
  const query = useAnjoPresenceTimelineQuery(personId, period)
  if (query.isPending) return <Skeleton className="h-16 w-full" aria-label={`Carregando a presença de ${name}`} />
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.events.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma mudança de presença de {name} no período.</p>
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
