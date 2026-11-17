"use client"

import { Eye } from "lucide-react"

import { PersistedCustomizableView } from "@/components/view-layouts/persisted-customizable-view"

import { useAbandonmentSection } from "../history/abandonment-block"
import { useOperationNowSection } from "./anjos-now-section"
import { civilToday } from "./period-picker"
import { ResponseTimesControl } from "./response-times-control"

/**
 * MONITORIA ONLINE (aba do Painel dos Anjos; pedido do responsável em 2026-11-12): só o que está acontecendo AGORA — a "Operação agora"
 * (cada Anjo e há quanto tempo está no estado, a fila com quem aguarda e há quanto tempo) e os abandonos de HOJE, relidos a cada 5 s.
 * Não depende do período: o histórico fica em Indicadores e em "Jornada e atendimentos". Só a coordenação (Coordenador de Anjos e
 * Administrador geral) chega aqui. Visão personalizável (padrão do app): a pessoa reposiciona áreas e cards, ajusta o tamanho em blocos e
 * esconde o que não usa; fica salvo para ela (`anjos.monitoria-online`). "Tempos de resposta" (migration 193) ajusta quanto o operador e
 * o Anjo podem ficar sem responder.
 */
export function OnlineMonitoringTab({ scope }: { scope: { teamId?: string | null; subteamId?: string | null } }) {
  const today = civilToday()
  const operationNow = useOperationNowSection(scope)
  const abandonment = useAbandonmentSection({
    id: "abandonos-hoje",
    live: true,
    filter: { from: today, to: today, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null },
    title: "Abandonos de hoje",
    description: "Desde a meia-noite, ao vivo. Na espera: o operador desistiu antes de um Anjo assumir. No atendimento: alguém saiu ou parou de responder — encerramento normal e queda de rede não contam.",
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />
          Abrir esta aba fica registrado (quem viu a presença e as pausas de cada Anjo).
        </p>
        <ResponseTimesControl />
      </div>
      <PersistedCustomizableView viewKey="anjos.monitoria-online" label="Monitoria Online" catalog={[operationNow, abandonment]} />
    </div>
  )
}
