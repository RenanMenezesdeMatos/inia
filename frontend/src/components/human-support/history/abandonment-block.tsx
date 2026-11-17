"use client"

import { Ban, DoorOpen, Hourglass, LogOut, MessageCircleOff, UserMinus, UserRoundX, WifiOff } from "lucide-react"

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
 * o sistema). No atendimento, um card para cada lado, cada um com número e taxa próprios (pedido do responsável em 2026-11-16): do
 * Anjo (parou de responder; saiu e derrubou o operador — queda de rede à parte, sem contar) e do operador (saiu da INIA, parou de responder). Encerramento normal e transferência nunca contam.
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

function OperatorGroup({ data }: { data: Abandonment }) {
  const { byOperator } = data.attendance
  return (
    <Group icon={UserMinus} tone="warning" title="Abandonos do operador no atendimento" total={byOperator.total} rate={ratioText(byOperator.rate)} base="dos atendimentos encerrados" testId="abandon-operator">
      <Line icon={LogOut} label="Saiu da INIA no meio" value={byOperator.leftInia} />
      <Line icon={MessageCircleOff} label="Parou de responder (Anjo liberado)" value={byOperator.noReply} />
    </Group>
  )
}

/**
 * O número que diz se o Anjo abandona (pedidos do responsável em 2026-11-16): parou de responder + saiu (deslogou) e derrubou o
 * operador, com taxa própria. Queda de rede e papel retirado pela coordenação não são culpa dele: aparecem à parte, sem contar.
 */
function AnjoGroup({ data }: { data: Abandonment }) {
  const { byAnjo } = data.attendance
  const notCounted = byAnjo.connection + byAnjo.roleRevoked + byAnjo.unknownDrop
  return (
    <Group icon={UserRoundX} tone="danger" title="Abandonos do Anjo" total={byAnjo.total} rate={ratioText(byAnjo.rate)} base="dos atendimentos encerrados" testId="abandon-anjo">
      <Line icon={MessageCircleOff} label="Parou de responder (perdeu o atendimento)" value={byAnjo.noReply} />
      <Line icon={LogOut} label="Saiu (deslogou) e derrubou o operador" value={byAnjo.session} />
      <Line icon={WifiOff} label={`Queda de rede${byAnjo.roleRevoked ? ` · papel retirado ${byAnjo.roleRevoked}` : ""}${byAnjo.unknownDrop ? ` · sem causa ${byAnjo.unknownDrop}` : ""} (não conta como abandono)`} value={notCounted} muted />
    </Group>
  )
}

/**
 * ÁREA DE ABANDONOS do catálogo (grade personalizável): três cards — na espera, do Anjo e do operador no atendimento —, a mesma leitura. `live` = Monitoria
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
      { id: "espera", title: "Abandonos na espera", defaultWidth: 4, widths: [4, 6, 8, 12], render: () => state((data) => <WaitingGroup data={data} />) },
      { id: "anjo", title: "Abandonos do Anjo", defaultWidth: 4, widths: [4, 6, 8, 12], render: () => state((data) => <AnjoGroup data={data} />) },
      { id: "operador", title: "Abandonos do operador no atendimento", defaultWidth: 4, widths: [4, 6, 8, 12], render: () => state((data) => <OperatorGroup data={data} />) },
    ],
  }
}
