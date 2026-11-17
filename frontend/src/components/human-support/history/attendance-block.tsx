"use client"

import type { ReactNode } from "react"
import { Clock, Hourglass, ListOrdered, LogOut, MessageCircleOff, Star, ThumbsUp, Timer, UserRoundX, UserX, WifiOff } from "lucide-react"

import { SectionLabel, toneChip, type Tone } from "@/components/ui/surface"
import { cn } from "@/lib/utils"
import { END_CAUSE_LABELS } from "@/schemas/human-support/catalogs.schema"
import { durationText, type AttendanceIndicators, type Average, type OperationIndicators, type Ratio } from "@/schemas/human-support/monitoring.schema"

import { TermLabel, type Term } from "./term-hint"

/**
 * INDICADORES DE ATENDIMENTO (migration 191). Toda média mostra quantos atendimentos entram nela; toda taxa, numerador e denominador
 * ("sem dados" quando o denominador é zero — nunca 0%). A atribuição é DIRETA (D2): o acolhimento acontece na atribuição, então não há
 * tempo de acolhimento nem oferta expirada — o tempo até a primeira resposta do Anjo mostra a demora real.
 */
export const averageText = (average: Average) => (average.count === 0 ? "Sem dados" : durationText(average.averageSeconds))
export const averageDetail = (average: Average, noun = "atendimento") => `${average.count} ${average.count === 1 ? noun : `${noun}s`}`

export function ratioText(ratio: Ratio): string {
  if (ratio.status === "NO_DATA" || ratio.denominator === null || ratio.denominator === 0) return "Sem dados"
  const base = `${ratio.numerator ?? 0} de ${ratio.denominator}`
  if (ratio.status === "SMALL_SAMPLE" || ratio.value === null) return `${base} (amostra pequena)`
  return `${base} (${(Math.round(ratio.value * 1000) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`
}

function Metric({ icon: Icon, tone = "neutral", label, term, value, detail, testId }: { icon: typeof Timer; tone?: Tone; label: string; term?: Term; value: string; detail?: string | undefined; testId?: string }) {
  return (
    <div className="flex h-full items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs" data-testid={testId}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(tone))}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-xs text-muted-foreground">{term ? <TermLabel term={term}>{label}</TermLabel> : label}</span>
        <span className="block text-base font-semibold tabular-nums">{value}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  )
}

/**
 * `scope`: "anjo" (um Anjo) ou "all" (todos os Anjos do alcance — a visão geral); muda só os rótulos. `showReasons`: o ranking de
 * motivos (na visão geral os motivos vêm do cartão completo, com as ferramentas citadas, logo abaixo).
 */
/** Os cartões de atendimento, um por indicador (cada um vira um card na visão personalizável; o bloco os junta no detalhe do Anjo). */
export function attendanceMetricCards(indicators: AttendanceIndicators, scope: "anjo" | "all" = "anjo"): { id: string; title: string; render: () => ReactNode }[] {
  const { handling, noReply, pertinence, interruptedBySystem } = indicators
  const interrupted = interruptedBySystem.connection + interruptedBySystem.session + interruptedBySystem.roleRevoked + interruptedBySystem.unknown
  const waitLabel = scope === "all" ? "Espera dos operadores" : "Espera dos operadores que acolheu"
  return [
    { id: "acolhidos", title: "Atendimentos acolhidos", render: () => <Metric icon={ListOrdered} tone="info" label="Atendimentos acolhidos" value={String(indicators.acolhimentos)} detail="Acolhimento = atribuição direta ao Anjo" /> },
    {
      id: "abandonos-do-anjo",
      title: "Abandonos do Anjo",
      render: () => (
        <Metric
          icon={UserRoundX}
          tone={indicators.anjoAbandonment.total > 0 ? "danger" : "neutral"}
          label={scope === "all" ? "Abandonos dos Anjos" : "Abandonos do Anjo"}
          value={`${indicators.anjoAbandonment.total} · ${ratioText(indicators.anjoAbandonment.rate)}`}
          detail={`Parou de responder ${indicators.anjoAbandonment.noReply} · saiu e derrubou o operador ${indicators.anjoAbandonment.loggedOut} · queda de rede não conta`}
          testId="metric-anjo-abandonment"
        />
      ),
    },
    { id: "espera", title: waitLabel, render: () => <Metric icon={Hourglass} label={waitLabel} term="wait" value={averageText(indicators.operatorWait)} detail={`Da entrada na fila ao acolhimento · ${averageDetail(indicators.operatorWait, "pedido")}`} testId="metric-wait" /> },
    { id: "acolhimento", title: "Tempo médio de acolhimento", render: () => <Metric icon={Clock} label="Tempo médio de acolhimento" term="welcome" value={averageText(indicators.firstResponse)} detail={`Até a 1ª resposta ao operador · ${averageDetail(indicators.firstResponse)}`} testId="metric-welcome" /> },
    { id: "atendimento", title: "Tempo médio de atendimento", render: () => <Metric icon={Timer} label="Tempo médio de atendimento" term="handling" value={averageText(handling)} detail={`${averageDetail(handling)} · concluídos ${averageText(handling.normal)} (${handling.normal.count}) · outros motivos ${averageText(handling.other)} (${handling.other.count})`} testId="metric-handling" /> },
    {
      id: "falta-de-retorno",
      title: "Encerrados por falta de retorno",
      render: () => (
        <Metric
          icon={MessageCircleOff}
          tone={noReply.rate.numerator ? "warning" : "neutral"}
          label="Encerrados por falta de retorno"
          value={ratioText(noReply.rate)}
          detail={noReply.rate.numerator ? `Faltou retorno do Anjo: ${noReply.anjoSide} · do operador: ${noReply.operatorSide}` : "Sobre os encerrados (fora os transferidos)"}
          testId="metric-no-reply"
        />
      ),
    },
    { id: "operador-saiu", title: "Operador saiu depois de acolhido", render: () => <Metric icon={LogOut} label="Operador saiu depois de acolhido" value={String(indicators.abandonedAfterAcolhimento)} detail="Encerrado com a INIA fechada do operador" /> },
    {
      id: "interrompidos",
      title: "Interrompidos pelo sistema",
      render: () => (
        <Metric
          icon={WifiOff}
          tone={interrupted > 0 ? "danger" : "neutral"}
          label="Interrompidos pelo sistema"
          value={String(interrupted)}
          detail={`Rede ${interruptedBySystem.connection} · sessão encerrada ${interruptedBySystem.session} · papel retirado ${interruptedBySystem.roleRevoked}${interruptedBySystem.unknown ? ` · sem causa registrada ${interruptedBySystem.unknown}` : ""}`}
        />
      ),
    },
    { id: "estrelas", title: "Estrelas do operador", render: () => <Metric icon={Star} tone="warning" label="Estrelas do operador" value={indicators.stars.average === null ? "—" : `${indicators.stars.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 5`} detail={indicators.stars.average === null ? (indicators.stars.count === 0 ? "Sem notas" : `${indicators.stars.count} notas · a média aparece com 5 ou mais`) : `${indicators.stars.count} notas`} testId="metric-stars" /> },
    { id: "pertinencia", title: "Pertinência", render: () => <Metric icon={ThumbsUp} tone="success" label="Pertinência" value={ratioText(pertinence.rate)} detail={`Pertinente ${pertinence.pertinent} · Não pertinente ${pertinence.notPertinent} · Não avaliado ${pertinence.notEvaluated}`} testId="metric-pertinence" /> },
  ]
}

/** O bloco de atendimento de UM Anjo (detalhe e "Sua jornada"): os cartões, os outros motivos de encerramento e o ranking de motivos. */
export function AttendanceBlock({ indicators, scope = "anjo", showReasons = true }: { indicators: AttendanceIndicators; scope?: "anjo" | "all"; showReasons?: boolean }) {
  const otherCauses = Object.entries(indicators.handling.otherByCause)
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => `${END_CAUSE_LABELS[cause] ?? cause}: ${count}`)
    .join(" · ")
  return (
    <div className="space-y-4" data-testid="attendance-block">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {attendanceMetricCards(indicators, scope).map((card) => (
          <div key={card.id}>{card.render()}</div>
        ))}
      </div>
      {otherCauses ? <p className="text-xs text-muted-foreground">Encerrados por outros motivos: {otherCauses}.</p> : null}
      {showReasons ? <ReasonsRanking reasons={indicators.reasons} /> : null}
    </div>
  )
}

export function ReasonsRanking({ reasons }: { reasons: AttendanceIndicators["reasons"] }) {
  return (
    <section aria-label="Principais motivos de acionamento" className="space-y-2">
      <SectionLabel as="h3">Principais motivos de acionamento</SectionLabel>
      {reasons.total === 0 ? (
        <p className="text-sm text-muted-foreground">Sem atendimentos concluídos no período.</p>
      ) : (
        <ol className="space-y-1.5" data-testid="reasons-ranking">
          {reasons.items.map((item) => (
            <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
              <span className={cn("truncate", item.key === "NO_CLASSIFICATION" && "text-muted-foreground")}>{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {item.count} · {item.share === null ? "—" : `${(Math.round(item.share * 1000) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
              </span>
              <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round((item.share ?? 0) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">Sobre {reasons.total} atendimentos concluídos (interrompidos e transferidos não são classificados).</p>
    </section>
  )
}

/** Pedidos do período (sem atribuição individual): acolhidos, na fila agora e em atendimento. */
export function OperationRequestsCard({ operation }: { operation: OperationIndicators }) {
  return <Metric icon={ListOrdered} tone="info" label="Pedidos no período" value={String(operation.requests)} detail={`Acolhidos ${operation.acolhidos} · na fila agora ${operation.waiting} · em atendimento ${operation.inProgress}`} testId="metric-requests" />
}

/** Pedidos encerrados na fila sem Anjo logado (os abandonos têm a área própria). */
export function OperationNoAnjoCard({ operation }: { operation: OperationIndicators }) {
  return (
    <Metric
      icon={UserX}
      tone={operation.noAnjoLogged.count > 0 ? "danger" : "neutral"}
      label="Encerrados sem Anjo logado"
      value={String(operation.noAnjoLogged.count)}
      detail={`De ${operation.endedWithoutAcolhimento} encerrados na fila sem acolhimento${operation.noAnjoLogged.unrecorded ? ` · ${operation.noAnjoLogged.unrecorded} sem registro (antes da migration 191)` : ""}`}
      testId="metric-no-anjo"
    />
  )
}
