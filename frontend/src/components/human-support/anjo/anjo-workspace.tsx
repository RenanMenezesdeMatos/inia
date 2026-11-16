"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ChartNoAxesColumn, ClipboardCheck, HeartHandshake, History, Inbox, MessagesSquare, RefreshCw, Timer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAnjoWorkspace } from "@/queries/human-support/anjo-workspace-provider"
import { describeElapsed } from "@/lib/format/date"
import type { AnjoView } from "@/schemas/human-support/state.schema"
import { cn } from "@/lib/utils"
import { loginWithReturn } from "@/lib/auth/safe-return"

import { IconBadge, StatusChip, SURFACE_CARD, PageHeader, SectionLabel, toneSurface } from "@/components/ui/surface"

import { MyAnjoHistory } from "../history/my-anjo-history"
import { AttendanceHistory } from "./attendance-history"
import { AttendancePane } from "./attendance-pane"
import { ClassificationForm } from "./classification-form"
import { PresenceControl } from "./presence-control"
import { useClock, useElapsed } from "./use-clock"

/**
 * ÁREA DO ANJO — a aba "Apoio" do próprio perfil (`?tab=apoio`; `/apoio` leva até ela). A conexão do Anjo e os avisos de som e título
 * vivem no shell (`AnjoWorkspaceProvider`): abrir esta área liga a conexão nesta aba do navegador, e ela continua nas outras abas do
 * perfil e nas outras telas do app — só uma aba do navegador por vez (as outras mostram o aviso). Leitura na ordem: (1) o estado do
 * Anjo e as vagas, sempre visíveis; depois duas abas internas —
 *  - "Atendimento": os atendimentos em andamento (um por aba) e as classificações pendentes;
 *  - "Seus atendimentos": o histórico dos próprios atendimentos (D5).
 * As duas ficam montadas (só a inativa é escondida): trocar de aba não encerra nada, não perde mensagens nem o texto digitado e não
 * reinicia contadores (todos contam do servidor). As mensagens novas por atendimento vêm do servidor (`unreadCount`): fora da vista,
 * a contagem sobe; com o atendimento na tela, zera assim que a leitura é confirmada. Atendimento novo seleciona a aba dele. A aba
 * interna fica na URL (`?apoio=historico`) para sobreviver a uma atualização da página. `embedded` = dentro do perfil (sem o título
 * e as margens de página); `visible` = a aba do perfil está na tela (fora dela nada conta como lido).
 */
/**
 * Abas da área: atendimento, os atendimentos já feitos e a própria jornada (migration 191). "Operação agora" (os outros Anjos e a fila)
 * é só da coordenação — Coordenador de Anjos e Administrador geral, no painel —, nunca da área do Anjo.
 */
type WorkspaceTab = "atendimento" | "historico" | "jornada"
const TAB_PARAM = "apoio"
const WORKSPACE_TABS: readonly WorkspaceTab[] = ["atendimento", "historico", "jornada"]
const asTab = (value: string | null): WorkspaceTab => (WORKSPACE_TABS.includes(value as WorkspaceTab) ? (value as WorkspaceTab) : "atendimento")

function initialTab(): WorkspaceTab {
  if (typeof window === "undefined") return "atendimento"
  return asTab(new URLSearchParams(window.location.search).get(TAB_PARAM))
}

export function AnjoWorkspace({ embedded = false, visible = true }: { embedded?: boolean; visible?: boolean }) {
  // Escolha da pessoa (com o instante) × chegada de atendimento novo (do provedor): vale a mais recente, sem efeito que copie estado.
  const [picked, setPicked] = useState<{ attendanceId: string | null; at: number }>({ attendanceId: null, at: 0 })
  const select = useCallback((attendanceId: string) => setPicked({ attendanceId, at: Date.now() }), [])
  const [tab, setTab] = useState<WorkspaceTab>(initialTab)
  const classifyFocusRef = useRef<string | null>(null)
  const { anjo, blocked, reconnecting, sessionEnded, refresh, applyAnjo, clockOffsetMs, arm, setAreaVisible, arrival, attention, primeAudio } = useAnjoWorkspace()
  const now = useClock() + clockOffsetMs

  // Abrir a área liga a conexão do Anjo nesta aba do navegador (e ela segue nas outras telas).
  useEffect(() => {
    arm()
  }, [arm])
  useEffect(() => {
    setAreaVisible(visible)
    return () => setAreaVisible(false)
  }, [visible, setAreaVisible])
  // Atendimento novo: a aba dele fica selecionada (o som e o título vêm do provedor, em qualquer tela).
  const selectedId = arrival && arrival.nonce > picked.at ? arrival.attendanceId : picked.attendanceId

  const attendances = anjo?.attendances ?? []
  const activeId = attendances.some((attendance) => attendance.id === selectedId) ? selectedId! : (attendances[0]?.id ?? null)
  const onScreen = visible && tab === "atendimento"
  const viewingId = onScreen ? activeId : null
  // Mensagens novas por atendimento (do servidor); o que está na tela conta como visto na hora, sem esperar a confirmação voltar.
  const unreadById: Record<string, number> = Object.fromEntries(attendances.map((attendance) => [attendance.id, attendance.id === viewingId ? 0 : attendance.unreadCount]))

  const changeTab = (value: string) => {
    const next = asTab(value)
    setTab(next)
    try {
      const url = new URL(window.location.href)
      if (next !== "atendimento") url.searchParams.set(TAB_PARAM, next)
      else url.searchParams.delete(TAB_PARAM)
      window.history.replaceState(window.history.state, "", url)
    } catch {
      // Sem histórico do navegador (testes): a aba muda do mesmo jeito.
    }
  }

  // Depois de encerrar, o foco vai para a classificação pendente que o servidor devolveu (leitor de tela e teclado chegam nela).
  const focusClassificationOf = useCallback((attendanceId: string) => {
    classifyFocusRef.current = attendanceId
  }, [])
  useEffect(() => {
    const target = classifyFocusRef.current
    if (!target || !anjo?.pendingClassifications.some((pending) => pending.attendanceId === target)) return
    classifyFocusRef.current = null
    document.getElementById(classifyHeadingId(target))?.focus()
  }, [anjo])

  if (sessionEnded) {
    // 401 na chamada de estado: tentar de novo não adianta. Sem a área aberta a conexão do Anjo cai; depois da carência o servidor o
    // deixa Indisponível e devolve os atendimentos à fila (regra da distribuição).
    return (
      <div className={embedded ? "space-y-6" : "mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:py-8"}>
        {embedded ? null : <WorkspaceTitle />}
        <div role="alert" className={cn(toneSurface("warning"), "p-5")}>
          <p className="font-medium">Sua sessão terminou</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre novamente para continuar os atendimentos. Se você voltar em até 3 minutos, eles continuam com você; depois disso voltam para a fila e você fica indisponível.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4 rounded-full">
            <a href={loginWithReturn(typeof window === "undefined" ? "/apoio" : `${window.location.pathname}${window.location.search}`)}>Entrar novamente</a>
          </Button>
        </div>
      </div>
    )
  }

  if (blocked) {
    return (
      <div className={embedded ? "space-y-6" : "mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:py-8"}>
        {embedded ? null : <WorkspaceTitle />}
        <div role="alert" className={cn(toneSurface("warning"), "p-5")}>
          <p className="font-medium">A área do Anjo está aberta em outra aba</p>
          <p className="mt-1 text-sm text-muted-foreground">Continue os atendimentos na outra aba. Para usar esta, feche a outra e recarregue esta página.</p>
          <Button type="button" variant="outline" size="sm" className="mt-4 rounded-full" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden />
            Recarregar esta página
          </Button>
        </div>
      </div>
    )
  }

  const unreadTotal = Object.values(unreadById).reduce((total, count) => total + count, 0)
  const awaitingResponse = attention.awaitingResponse

  return (
    <div className={embedded ? "space-y-6" : "mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:py-8"}>
      <header className="flex flex-col gap-5">
        {embedded ? (
          reconnecting ? (
            <StatusChip tone="warning" icon={RefreshCw} role="status" className="self-start">
              Reconectando…
            </StatusChip>
          ) : null
        ) : (
          <WorkspaceTitle
            aside={
              reconnecting ? (
                <StatusChip tone="warning" icon={RefreshCw} role="status">
                  Reconectando…
                </StatusChip>
              ) : null
            }
          />
        )}
        {anjo ? (
          <div className={cn(SURFACE_CARD, "p-4 sm:p-5")}>
            <PresenceControl
              presence={anjo.presence}
              activeAttendances={anjo.attendances.length}
              onApplyAnjo={applyAnjo}
              onPrimeAudio={primeAudio}
              clockOffsetMs={clockOffsetMs}
              aside={
                <div className="flex items-center gap-3 border-t border-border pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
                  <IconBadge icon={Inbox} tone="neutral" size="sm" />
                  <p className="leading-tight">
                    <span className="block text-xs text-muted-foreground">Atendimentos agora</span>
                    <span className="text-lg font-semibold tabular-nums">
                      {anjo.capacity.used} de {anjo.capacity.max}
                    </span>
                  </p>
                </div>
              }
            />
          </div>
        ) : null}
      </header>

      {!anjo ? (
        <p className="text-sm text-muted-foreground" role="status">
          {reconnecting ? "Não foi possível abrir a área do Anjo. Tentando de novo…" : "Carregando a área do Anjo…"}
        </p>
      ) : (
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList aria-label="Área do Anjo" className="max-w-full overflow-x-auto">
            <TabsTrigger value="atendimento">
              <MessagesSquare className="size-4" aria-hidden />
              Atendimento
              <AttentionCount count={anjo.attendances.length} unread={unreadTotal} awaiting={awaitingResponse} />
            </TabsTrigger>
            <TabsTrigger value="historico">
              <History className="size-4" aria-hidden />
              Seus atendimentos
            </TabsTrigger>
            <TabsTrigger value="jornada">
              <ChartNoAxesColumn className="size-4" aria-hidden />
              Sua jornada
            </TabsTrigger>
          </TabsList>

          {/* As duas abas ficam montadas: a inativa só é escondida (nada recomeça ao voltar). */}
          <TabsContent value="atendimento" forceMount className="mt-5 flex flex-col gap-8 data-[state=inactive]:hidden">
            <AttendancesSection
              anjo={anjo}
              activeId={activeId}
              onSelect={select}
              now={now}
              clockOffsetMs={clockOffsetMs}
              workspaceActive={onScreen}
              unreadById={unreadById}
              onApplyAnjo={applyAnjo}
              onRefresh={refresh}
              onClosed={focusClassificationOf}
            />
            {anjo.pendingClassifications.length > 0 ? (
              <section aria-labelledby="anjo-pending-title" className="flex flex-col gap-3">
                <div className="space-y-1">
                  <SectionLabel id="anjo-pending-title">Classificações pendentes</SectionLabel>
                  <p className="text-sm text-muted-foreground">Registre por que o operador precisou de você e como o atendimento terminou. A pendência não impede novos atendimentos.</p>
                </div>
                <ul className="flex flex-col gap-4">
                  {anjo.pendingClassifications.map((pending) => (
                    <li key={pending.attendanceId} className={cn(SURFACE_CARD, "p-4 sm:p-5")}>
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <IconBadge icon={ClipboardCheck} tone="warning" size="sm" />
                        <h3 id={classifyHeadingId(pending.attendanceId)} tabIndex={-1} className="font-mono text-sm font-semibold outline-none">
                          {pending.protocol}
                        </h3>
                        <FinalDuration startedAt={pending.startedAt} endedAt={pending.endedAt} />
                      </div>
                      <ClassificationForm pending={pending} onDone={refresh} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </TabsContent>

          <TabsContent value="historico" forceMount className="mt-5 data-[state=inactive]:hidden">
            <AttendanceHistory reloadKey={[...anjo.attendances.map((attendance) => attendance.id), "|", ...anjo.pendingClassifications.map((pending) => pending.attendanceId)].join(",")} />
          </TabsContent>
          <TabsContent value="jornada" className="mt-5">
            <MyAnjoHistory />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

const classifyHeadingId = (attendanceId: string) => `classificar-${attendanceId}`

function WorkspaceTitle({ aside }: { aside?: ReactNode }) {
  return <PageHeader icon={HeartHandshake} title="Área do Anjo" description="Atenda os pedidos de apoio dos operadores. Nada desta conversa passa pela INIA." aside={aside} />
}

/**
 * Contagem da aba "Atendimento": quantos estão em andamento; em destaque (cor primária) quando algo pede atenção — mensagem nova do
 * operador ainda não vista ou atendimento sem a primeira resposta —, com o motivo para leitor de tela.
 */
function AttentionCount({ count, unread, awaiting }: { count: number; unread: number; awaiting: boolean }) {
  if (count === 0) return null
  const attention = unread > 0 || awaiting
  const notes = [unread > 0 ? (unread === 1 ? "1 mensagem nova" : `${unread} mensagens novas`) : null, awaiting ? "atendimento sem resposta" : null].filter(Boolean)
  return (
    <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-semibold tabular-nums", attention ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} data-attention={attention || undefined}>
      <span aria-hidden>{count}</span>
      <span className="sr-only">
        {count === 1 ? "1 em andamento" : `${count} em andamento`}
        {notes.length > 0 ? `, ${notes.join(", ")}` : ""}
      </span>
    </span>
  )
}

/** Duração final de um atendimento encerrado (congelada: início e fim reais do servidor). */
function FinalDuration({ startedAt, endedAt }: { startedAt: string; endedAt: string }) {
  const elapsed = useElapsed(startedAt, 0, endedAt)
  if (elapsed === null) return null
  return (
    <StatusChip tone="neutral" icon={Timer}>
      <span className="sr-only">Tempo de atendimento: </span>
      <span aria-hidden>Durou </span>
      {describeElapsed(elapsed)}
    </StatusChip>
  )
}

type AttendancesSectionProps = {
  anjo: AnjoView
  activeId: string | null
  onSelect: (attendanceId: string) => void
  now: number
  clockOffsetMs: number
  /** A aba "Atendimento" é a que está na tela. */
  workspaceActive: boolean
  unreadById: Record<string, number>
  onApplyAnjo: (anjo: AnjoView) => void
  onRefresh: () => void
  onClosed: (attendanceId: string) => void
}

function AttendancesSection({ anjo, activeId, onSelect, now, clockOffsetMs, workspaceActive, unreadById, onApplyAnjo, onRefresh, onClosed }: AttendancesSectionProps) {
  const { attendances } = anjo
  return (
    <section aria-labelledby="anjo-attendances-title" className="flex flex-col gap-3">
      <SectionLabel id="anjo-attendances-title">Atendimentos em andamento</SectionLabel>
      {attendances.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-5 text-sm text-muted-foreground">
          <IconBadge icon={Inbox} tone="neutral" size="sm" />
          <p>
            {anjo.presence.status === "OFFLINE"
              ? "Você está indisponível. Clique em “Ficar disponível” para receber atendimentos."
              : anjo.presence.status === "PAUSED"
                ? "Você está em pausa e não recebe novos atendimentos."
                : "Nenhum atendimento agora. Quando um pedido chegar, ele abre aqui com um aviso sonoro."}
          </p>
        </div>
      ) : (
        <Tabs value={activeId ?? ""} onValueChange={onSelect}>
          <TabsList aria-label="Atendimentos em andamento" className="max-w-full overflow-x-auto">
            {attendances.map((attendance) => {
              const unread = unreadById[attendance.id] ?? 0
              return (
                <TabsTrigger key={attendance.id} value={attendance.id}>
                  {attendance.firstAnjoMessageAt === null ? (
                    <>
                      <span className="size-2 rounded-full bg-amber-500" aria-hidden />
                      <span className="sr-only">Sem resposta:</span>
                    </>
                  ) : null}
                  <span className="truncate">{attendance.operatorName}</span>
                  <span className="font-mono text-xs font-normal text-muted-foreground">{attendance.protocol}</span>
                  {unread > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold tabular-nums text-primary-foreground">
                      <span aria-hidden>{unread}</span>
                      <span className="sr-only">{unread === 1 ? "1 mensagem nova" : `${unread} mensagens novas`}</span>
                    </span>
                  ) : null}
                </TabsTrigger>
              )
            })}
          </TabsList>
          {attendances.map((attendance) => (
            // Todas as abas ficam montadas (só escondidas): a conversa de cada uma continua sendo lida e o texto digitado não se perde.
            <TabsContent key={attendance.id} value={attendance.id} forceMount className={cn(SURFACE_CARD, "mt-3 p-4 data-[state=inactive]:hidden sm:p-5")}>
              <AttendancePane
                attendance={attendance}
                now={now}
                clockOffsetMs={clockOffsetMs}
                active={workspaceActive && attendance.id === activeId}
                onApplyAnjo={onApplyAnjo}
                onRefresh={onRefresh}
                onClosed={onClosed}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  )
}
