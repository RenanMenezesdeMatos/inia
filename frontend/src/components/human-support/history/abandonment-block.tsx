"use client"

import { Ban, DoorOpen, Hourglass, LogOut, MessageCircleOff, UserRoundX, WifiOff } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { SURFACE_CARD, toneChip, type Tone } from "@/components/ui/surface"
import type { GridSection } from "@/components/ui/customizable-grid/layout"
import { cn } from "@/lib/utils"
import { useSupportAbandonmentQuery } from "@/queries/human-support/use-human-support-admin"
import type { Abandonment } from "@/schemas/human-support/monitoring.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { PanelError } from "../monitoring/panel-error"
import { ratioText } from "./attendance-block"

/**
 * ABANDONOS (pedido do responsável em 2026-11-12) — o MESMO bloco na Monitoria Online (`live`: o dia de hoje, relido a cada 5 s) e em
 * Indicadores (o período). Na espera: o operador fechou a INIA ou cancelou antes de um Anjo assumir (expirado à parte: quem encerra é
 * o sistema). No atendimento: pelo operador (saiu da INIA, parou de responder) e pelo Anjo (caiu por rede ou sessão, parou de
 * responder). Encerramento normal e transferência nunca contam. Cada taxa com numerador e denominador.
 */
function Group({ icon: Icon, tone, title, rate, total, base, children, testId }: { icon: typeof Ban; tone: Tone; title: string; rate: string; total: number; base: string; children: React.ReactNode; testId: string }) {
  return (
    <article className={cn(SURFACE_CARD, "h-full space-y-3 p-4")} aria-label={title} data-testid={testId}>
      <header className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(total > 0 ? tone : "neutral"))}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 leading-tight">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-2xl font-semibold tabular-nums">{total}</p>
          <p className="text-xs text-muted-foreground">
            {rate} · {base}
          </p>
        </div>
      </header>
      <ul className="divide-y divide-border rounded-xl border border-border text-sm">{children}</ul>
    </article>
  )
}

function Line({ icon: Icon, label, value, muted = false }: { icon: typeof Ban; label: string; value: number; muted?: boolean }) {
  return (
    <li className={cn("flex items-center gap-2 px-3 py-2", muted && "text-muted-foreground")}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </li>
  )
}

function WaitingGroup({ data }: { data: Abandonment }) {
  const { waiting } = data
  return (
    <Group icon={DoorOpen} tone="warning" title="Abandonos na espera" total={waiting.abandoned} rate={ratioText(waiting.rate)} base="dos pedidos que entraram na fila" testId="abandon-waiting">
      <Line icon={LogOut} label="Fechou a INIA antes de ser atendido" value={waiting.closedInia} />
      <Line icon={Ban} label="Cancelou o pedido" value={waiting.cancelled} />
      <Line icon={Hourglass} label="Expirou na fila (o sistema encerrou; não conta como abandono)" value={waiting.expired} muted />
    </Group>
  )
}

function AttendanceGroup({ data }: { data: Abandonment }) {
  const { attendance } = data
  const drops = attendance.byAnjo.connection + attendance.byAnjo.session + attendance.byAnjo.roleRevoked + attendance.byAnjo.unknownDrop
  return (
    <Group icon={UserRoundX} tone="danger" title="Abandonos no atendimento" total={attendance.abandoned} rate={ratioText(attendance.rate)} base="dos atendimentos encerrados (encerramento normal não conta)" testId="abandon-attendance">
      <Line icon={LogOut} label="Operador saiu da INIA no meio" value={attendance.byOperator.leftInia} />
      <Line icon={MessageCircleOff} label="Operador parou de responder (15 min)" value={attendance.byOperator.noReply} />
      <Line icon={WifiOff} label={`Anjo caiu — rede ${attendance.byAnjo.connection} · sessão ${attendance.byAnjo.session}${attendance.byAnjo.roleRevoked ? ` · papel retirado ${attendance.byAnjo.roleRevoked}` : ""}${attendance.byAnjo.unknownDrop ? ` · sem causa ${attendance.byAnjo.unknownDrop}` : ""}`} value={drops} />
      <Line icon={MessageCircleOff} label="Anjo parou de responder (15 min)" value={attendance.byAnjo.noReply} />
    </Group>
  )
}

/**
 * ÁREA DE ABANDONOS do catálogo (grade personalizável): dois cards — na espera e no atendimento —, a mesma leitura. `live` = Monitoria
 * Online (o dia de hoje, relido a cada 5 s); sem ele, o período de Indicadores.
 */
export function useAbandonmentSection({ id, title, description, filter, live = false }: { id: string; title: string; description: string; filter: PanelFilter; live?: boolean }): GridSection {
  const query = useSupportAbandonmentQuery(filter, live)
  const state = (render: (data: Abandonment) => React.ReactNode) =>
    query.isPending ? <Skeleton className="h-40 w-full rounded-2xl" aria-label="Carregando os abandonos" /> : query.isError ? <PanelError error={query.error} onRetry={() => void query.refetch()} /> : render(query.data)
  return {
    id,
    title,
    description,
    cards: [
      { id: "espera", title: "Abandonos na espera", defaultWidth: 6, widths: [4, 6, 8, 12], render: () => state((data) => <WaitingGroup data={data} />) },
      { id: "atendimento", title: "Abandonos no atendimento", defaultWidth: 6, widths: [4, 6, 8, 12], render: () => state((data) => <AttendanceGroup data={data} />) },
    ],
  }
}
