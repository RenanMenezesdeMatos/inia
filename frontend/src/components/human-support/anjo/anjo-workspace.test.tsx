/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { ApiError } from "@/lib/api/api-client"
import type { AnjoAttendanceView, AnjoView } from "@/schemas/human-support/state.schema"
import type { AnjoWorkspaceState } from "@/queries/human-support/use-anjo-workspace-state"

import { NEW_ATTENDANCE_TITLE, newMessageTitle } from "./attendance-alert"
import { AnjoWorkspace } from "./anjo-workspace"

/** Área do Anjo (Apoio com Anjo, Parte B — design_draft.md seções 6, 11 e 14). */
const hook = vi.hoisted(() => ({
  value: null as unknown as AnjoWorkspaceState,
  options: null as null | { onNewAttendance?: (ids: string[]) => void },
}))
vi.mock("@/queries/human-support/use-anjo-workspace-state", () => ({
  useAnjoWorkspaceState: (options: { onNewAttendance?: (ids: string[]) => void }) => {
    hook.options = options
    return hook.value
  },
}))
const service = vi.hoisted(() => ({
  signalSupportTyping: vi.fn(async () => undefined), acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })),
  changeAnjoPresence: vi.fn(),
  cancelScheduledAnjoPresence: vi.fn(),
  closeSupportRequestAsAnjo: vi.fn(),
  fetchSupportMessages: vi.fn(),
  sendSupportMessage: vi.fn(),
  classifySupportAttendance: vi.fn(),
  fetchAnjoAttendanceHistory: vi.fn(),
}))
vi.mock("@/services/human-support/human-support-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // A aba escolhida fica na URL: cada teste começa sem ela.
  window.history.replaceState(null, "", "/")
})

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function attendance(overrides: Partial<AnjoAttendanceView> = {}): AnjoAttendanceView {
  return {
    id: "att-1",
    requestId: "req-1",
    protocol: "AP-7K2QX9",
    operatorName: "Bruno",
    teamName: "Grupo X",
    subteamName: "X1",
    startedAt: minutesAgo(2),
    firstAnjoMessageAt: null,
    lastSeq: 2,
    operatorAbsentSince: null,
    sharedContext: { question: "Como faço o estorno?", answer: "**Não encontrei** essa informação.", dislike: null, note: "Cliente na linha" },
    peerReceipts: { deliveredSeq: 0, readSeq: 0 },
    peerTypingMs: null,
    ...overrides,
  }
}

function anjoView(overrides: Partial<AnjoView> = {}): AnjoView {
  return {
    serverTime: new Date().toISOString(),
    presence: { status: "AVAILABLE", pauseReason: null, connected: true, since: minutesAgo(30), scheduled: null },
    capacity: { max: 2, used: 1 },
    attendances: [attendance()],
    pendingClassifications: [],
    ...overrides,
  }
}

function setHook(overrides: Partial<AnjoWorkspaceState> = {}) {
  hook.value = { anjo: anjoView(), blocked: false, reconnecting: false, sessionEnded: false, refresh: vi.fn(), applyAnjo: vi.fn(), clockOffsetMs: 0, ...overrides }
  return hook.value
}

beforeEach(() => {
  // Tela grande: o contexto do atendimento começa aberto, à esquerda da conversa.
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }))
  for (const mock of Object.values(service)) mock.mockReset()
  service.fetchSupportMessages.mockResolvedValue({ messages: [], hasMore: false })
  service.fetchAnjoAttendanceHistory.mockResolvedValue({ items: [], nextCursor: null })
  setHook()
})

describe("AnjoWorkspace", () => {
  it("outra aba já está com a área aberta: só o aviso, sem estado nem atendimentos", () => {
    setHook({ anjo: null, blocked: true })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("alert")).toHaveTextContent("A área do Anjo está aberta em outra aba")
    expect(screen.queryByRole("button", { name: "Ficar disponível" })).not.toBeInTheDocument()
    expect(service.fetchAnjoAttendanceHistory).not.toHaveBeenCalled()
  })

  it("mostra o estado, as vagas \"1 de 2\", o atendimento em aba e \"Reconectando…\" quando a chamada falha", async () => {
    setHook({ reconnecting: true })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("status", { name: "Seu estado: Disponível" })).toBeInTheDocument()
    expect(screen.getByText("1 de 2")).toBeInTheDocument()
    expect(screen.getByText("Reconectando…")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Bruno/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("region", { name: "O que o operador compartilhou" })).toHaveTextContent("Como faço o estorno?")
    // A resposta da INIA passa pelo RichContent (Markdown); o que a pessoa escreveu continua texto puro.
    expect(screen.getByText("Não encontrei").tagName).toBe("STRONG")
    await waitFor(() => expect(service.fetchSupportMessages).toHaveBeenCalledWith("req-1"))
    expect(await screen.findByText("Você ainda não fez nenhum atendimento.")).toBeInTheDocument()
  })

  it("sessão terminada (401): pede para entrar de novo, com o retorno para a área, em vez de \"Tentando de novo\" para sempre", () => {
    setHook({ anjo: null, sessionEnded: true })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("alert")).toHaveTextContent("Sua sessão terminou")
    expect(screen.getByRole("link", { name: "Entrar novamente" }).getAttribute("href")).toMatch(/^\/auth\/login/)
    expect(screen.queryByText(/Tentando de novo/)).not.toBeInTheDocument()
  })

  it("recusa ao mudar o estado aparece com o texto do servidor; sucesso aplica a área devolvida", async () => {
    const state = setHook({ anjo: anjoView({ presence: { status: "OFFLINE", pauseReason: null, connected: true, since: minutesAgo(5), scheduled: null }, attendances: [], capacity: { max: 2, used: 0 } }) })
    service.changeAnjoPresence.mockRejectedValueOnce(new ApiError("O apoio com Anjo não está ligado em nenhum escopo que você atende.", 409, "HUMAN_SUPPORT_NO_ENABLED_SCOPE"))
    render(<AnjoWorkspace />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ficar disponível" }))
    })
    expect(service.changeAnjoPresence).toHaveBeenCalledWith({ status: "AVAILABLE" })
    expect(await screen.findByRole("alert")).toHaveTextContent("O apoio com Anjo não está ligado em nenhum escopo que você atende.")
    expect(state.applyAnjo).not.toHaveBeenCalled()

    const available = anjoView({ attendances: [], capacity: { max: 2, used: 0 } })
    service.changeAnjoPresence.mockResolvedValueOnce(available)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ficar disponível" }))
    })
    expect(state.applyAnjo).toHaveBeenCalledWith(available)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("pausa com motivo grava o motivo escolhido (sem atendimento, entra na hora)", async () => {
    const state = setHook({ anjo: anjoView({ attendances: [], capacity: { max: 2, used: 0 } }) })
    const paused = anjoView({ presence: { status: "PAUSED", pauseReason: "LUNCH", connected: true, since: minutesAgo(0), scheduled: null } })
    service.changeAnjoPresence.mockResolvedValue(paused)
    render(<AnjoWorkspace />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Pausa" }), { key: "Enter" })
    const lunch = await screen.findByRole("menuitemradio", { name: "Lanche" })
    await act(async () => {
      fireEvent.click(lunch)
    })
    expect(service.changeAnjoPresence).toHaveBeenCalledWith({ status: "PAUSED", pauseReason: "LUNCH" })
    expect(state.applyAnjo).toHaveBeenCalledWith(paused)
  })

  it("atendimento novo: abre a aba dele, pisca o título até a aba ter foco e toca o som", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const oscillators: string[] = []
    class FakeAudioContext {
      state = "running"
      currentTime = 0
      destination = {}
      resume = vi.fn(async () => undefined)
      close = vi.fn(async () => undefined)
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
      }
      createOscillator() {
        oscillators.push("tone")
        return { type: "sine", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext)
    document.title = "INIA"
    const { rerender } = render(<AnjoWorkspace />)
    // O gesto da pessoa prepara o som.
    fireEvent.pointerDown(document.body)

    setHook({ anjo: anjoView({ capacity: { max: 2, used: 2 }, attendances: [attendance(), attendance({ id: "att-2", requestId: "req-2", protocol: "AP-NEW222", operatorName: "Carla" })] }) })
    act(() => hook.options?.onNewAttendance?.(["att-2"]))
    rerender(<AnjoWorkspace />)

    expect(screen.getByRole("tab", { name: /Carla/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("article", { name: "Atendimento AP-NEW222" })).toBeVisible()
    expect(document.title).toBe(NEW_ATTENDANCE_TITLE)
    expect(oscillators.length).toBeGreaterThan(0)
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(document.title).toBe("INIA")
    vi.unstubAllGlobals()
  })

  it("encerrar pede confirmação e aplica a área devolvida pelo servidor", async () => {
    const state = setHook()
    const after = anjoView({ attendances: [], capacity: { max: 2, used: 0 }, pendingClassifications: [{ attendanceId: "att-1", protocol: "AP-7K2QX9", operatorName: "Bruno", startedAt: minutesAgo(2), endedAt: minutesAgo(0), endCause: "ANJO_CLOSED" }] })
    service.closeSupportRequestAsAnjo.mockResolvedValue(after)
    render(<AnjoWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Encerrar atendimento" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(service.closeSupportRequestAsAnjo).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Encerrar" }))
    })
    expect(service.closeSupportRequestAsAnjo).toHaveBeenCalledWith("req-1", undefined)
    expect(state.applyAnjo).toHaveBeenCalledWith(after)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("depois de encerrar, o foco vai para a classificação pendente do atendimento", async () => {
    const after = anjoView({ attendances: [], capacity: { max: 2, used: 0 }, pendingClassifications: [{ attendanceId: "att-1", protocol: "AP-7K2QX9", operatorName: "Bruno", startedAt: minutesAgo(2), endedAt: minutesAgo(0), endCause: "ANJO_CLOSED" }] })
    const state = setHook()
    state.applyAnjo = vi.fn((next: AnjoView) => setHook({ anjo: next, applyAnjo: state.applyAnjo }))
    service.closeSupportRequestAsAnjo.mockResolvedValue(after)
    const { rerender } = render(<AnjoWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Encerrar atendimento" }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Encerrar" }))
    })
    rerender(<AnjoWorkspace />)
    await waitFor(() => expect(screen.getByRole("heading", { name: "AP-7K2QX9" })).toHaveFocus())
  })

  it("classificação pendente aparece com o formulário e o aviso de que é definitiva", () => {
    setHook({ anjo: anjoView({ attendances: [], pendingClassifications: [{ attendanceId: "att-9", protocol: "AP-OLD999", operatorName: "Dora", startedAt: "2026-11-10T13:00:00.000Z", endedAt: "2026-11-10T13:12:04.000Z", endCause: "INACTIVITY" }] }) })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("form", { name: "Classificar o atendimento AP-OLD999" })).toBeInTheDocument()
    expect(screen.getByText("A classificação é definitiva: depois de enviada, não pode ser alterada.")).toBeInTheDocument()
    expect(screen.getByText(/Falta de mensagens/)).toBeInTheDocument()
    // Duração final congelada: fim − início reais do atendimento.
    expect(screen.getByText("12 min 4 s")).toBeInTheDocument()
  })

  it("cronômetro ao vivo de há quanto tempo o Anjo está no estado, contado pelo relógio do servidor", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-10T15:00:00.000Z") })
    try {
      setHook({ anjo: anjoView({ presence: { status: "PAUSED", pauseReason: "LUNCH", connected: true, since: "2026-11-10T14:48:30.000Z", scheduled: null } }) })
      render(<AnjoWorkspace />)
      const timer = screen.getByTestId("presence-timer")
      expect(timer).toHaveTextContent("11:30")
      expect(timer).toHaveAttribute("aria-label", "Neste estado há 11 min 30 s")
      act(() => void vi.advanceTimersByTime(5_000))
      expect(timer).toHaveTextContent("11:35")
      cleanup()
      // A tela está 1 min atrasada em relação ao servidor: o cronômetro conta pelo servidor.
      setHook({ clockOffsetMs: 60_000, anjo: anjoView({ presence: { status: "AVAILABLE", pauseReason: null, connected: true, since: "2026-11-10T13:00:00.000Z", scheduled: null } }) })
      render(<AnjoWorkspace />)
      expect(screen.getByTestId("presence-timer")).toHaveTextContent("2:01:05")
    } finally {
      vi.useRealTimers()
    }
  })

  it("indisponível: estado com ícone e texto, sem cronômetro nem \"desde\"; só \"Ficar disponível\" para mudar", () => {
    setHook({ anjo: anjoView({ presence: { status: "OFFLINE", pauseReason: null, connected: true, since: minutesAgo(5), scheduled: null }, attendances: [], capacity: { max: 2, used: 0 } }) })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("status", { name: "Seu estado: Indisponível" })).toHaveTextContent("Indisponível")
    expect(screen.queryByTestId("presence-timer")).not.toBeInTheDocument()
    expect(screen.queryByRole("timer")).not.toBeInTheDocument()
    expect(screen.queryByText(/^desde /)).not.toBeInTheDocument()
    const actions = screen.getByRole("group", { name: "Mudar estado" })
    expect(within(actions).getAllByRole("button").map((button) => button.textContent)).toEqual(["Ficar disponível"])
  })

  it("disponível: \"Ficar indisponível\" em vermelho, com ícone de parada, separado do estado atual", async () => {
    const state = setHook({ anjo: anjoView({ attendances: [], capacity: { max: 2, used: 0 } }) })
    const offline = anjoView({ presence: { status: "OFFLINE", pauseReason: null, connected: true, since: minutesAgo(0), scheduled: null }, attendances: [] })
    service.changeAnjoPresence.mockResolvedValue(offline)
    render(<AnjoWorkspace />)
    const actions = screen.getByRole("group", { name: "Mudar estado" })
    const stop = within(actions).getByRole("button", { name: "Ficar indisponível" })
    expect(stop).toHaveAttribute("data-variant", "destructive")
    expect(stop.querySelector("svg.lucide-circle-stop")).not.toBeNull()
    expect(within(actions).queryByRole("status")).not.toBeInTheDocument()
    expect(screen.getByTestId("presence-timer")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(stop)
    })
    expect(service.changeAnjoPresence).toHaveBeenCalledWith({ status: "OFFLINE" })
    expect(state.applyAnjo).toHaveBeenCalledWith(offline)
  })

  it("com atendimento: os botões programam; a faixa mostra o estado atual e o programado, com alterar e cancelar", async () => {
    const state = setHook()
    const scheduled = anjoView({ presence: { status: "AVAILABLE", pauseReason: null, connected: true, since: minutesAgo(30), scheduled: { status: "PAUSED", pauseReason: "LUNCH", requestedAt: minutesAgo(0) } } })
    service.changeAnjoPresence.mockResolvedValue(scheduled)
    const { rerender } = render(<AnjoWorkspace />)
    const actions = screen.getByRole("group", { name: "Mudar estado" })
    expect(within(actions).getByRole("button", { name: "Programar indisponível" })).toBeInTheDocument()
    expect(screen.getByText(/ficam programadas/)).toBeInTheDocument()
    fireEvent.keyDown(within(actions).getByRole("button", { name: "Programar pausa" }), { key: "Enter" })
    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitemradio", { name: "Lanche" }))
    })
    expect(service.changeAnjoPresence).toHaveBeenCalledWith({ status: "PAUSED", pauseReason: "LUNCH" })
    expect(state.applyAnjo).toHaveBeenCalledWith(scheduled)

    // A tela com a programação: o estado atual (e o cronômetro) continuam; a faixa diz o que entra e quando.
    const after = setHook({ anjo: scheduled })
    rerender(<AnjoWorkspace />)
    expect(screen.getByRole("status", { name: "Seu estado: Disponível" })).toBeInTheDocument()
    expect(screen.getByTestId("presence-timer")).toBeInTheDocument()
    const band = screen.getByTestId("presence-scheduled")
    expect(band).toHaveTextContent("Programado: Em pausa · Lanche")
    expect(band).toHaveTextContent("Entra quando terminar o atendimento em andamento.")
    expect(band).toHaveTextContent("Você não recebe novos atendimentos.")

    // Alterar: o menu marca a pausa programada; outro motivo troca a programação.
    fireEvent.keyDown(screen.getByRole("button", { name: "Alterar pausa programada" }), { key: "Enter" })
    expect(await screen.findByRole("menuitemradio", { name: /Lanche/ })).toHaveAttribute("aria-checked", "true")
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Reunião" }))
    })
    expect(service.changeAnjoPresence).toHaveBeenLastCalledWith({ status: "PAUSED", pauseReason: "MEETING" })

    // Cancelar a programação.
    const cleared = anjoView()
    service.cancelScheduledAnjoPresence.mockResolvedValueOnce(cleared)
    await act(async () => {
      fireEvent.click(within(band).getByRole("button", { name: "Cancelar programação" }))
    })
    expect(service.cancelScheduledAnjoPresence).toHaveBeenCalledTimes(1)
    expect(after.applyAnjo).toHaveBeenLastCalledWith(cleared)
  })

  it("indisponível programado com dois atendimentos: sem o botão de novo, e a faixa conta os atendimentos", () => {
    setHook({
      anjo: anjoView({
        presence: { status: "PAUSED", pauseReason: "MEETING", connected: true, since: minutesAgo(3), scheduled: { status: "OFFLINE", pauseReason: null, requestedAt: minutesAgo(1) } },
        capacity: { max: 2, used: 2 },
        attendances: [attendance(), attendance({ id: "att-2", requestId: "req-2", protocol: "AP-NEW222", operatorName: "Carla" })],
      }),
    })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("status", { name: "Seu estado: Em pausa · Reunião" })).toBeInTheDocument()
    expect(screen.getByTestId("presence-scheduled")).toHaveTextContent("Programado: Indisponível")
    expect(screen.getByTestId("presence-scheduled")).toHaveTextContent("último dos 2 atendimentos")
    const actions = screen.getByRole("group", { name: "Mudar estado" })
    expect(within(actions).queryByRole("button", { name: /indisponível/i })).not.toBeInTheDocument()
    expect(within(actions).getByRole("button", { name: "Voltar" })).toBeInTheDocument()
  })

  it("em pausa: a pausa atual aparece no estado e vem marcada no menu, cada motivo com ícone próprio; escolher a mesma não grava", async () => {
    setHook({ anjo: anjoView({ presence: { status: "PAUSED", pauseReason: "MEETING", connected: true, since: minutesAgo(3), scheduled: null } }) })
    render(<AnjoWorkspace />)
    expect(screen.getByRole("status", { name: "Seu estado: Em pausa · Reunião" })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("button", { name: "Trocar pausa" }), { key: "Enter" })
    const items = await screen.findAllByRole("menuitemradio")
    expect(items.map((item) => item.textContent)).toEqual(["Lanche", "Pessoal", "Atividade de processo", "Reunião(pausa atual)"])
    expect(screen.getByRole("menuitemradio", { name: /Reunião/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("menuitemradio", { name: "Lanche" })).toHaveAttribute("aria-checked", "false")
    const icons = items.map((item) => item.querySelector("svg")?.getAttribute("class"))
    expect(new Set(icons).size).toBe(4)
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Reunião/ }))
    })
    expect(service.changeAnjoPresence).not.toHaveBeenCalled()
  })

  it("abas: \"Seus atendimentos\" fica numa aba própria; trocar de aba não perde o texto digitado nem desmonta o atendimento", async () => {
    render(<AnjoWorkspace />)
    expect(screen.getByRole("tab", { name: /Atendimento/ })).toHaveAttribute("aria-selected", "true")
    // A aba inativa fica montada e só é escondida (CSS por `data-state`; o jsdom não aplica o Tailwind).
    const history = screen.getByRole("tabpanel", { hidden: true, name: /Seus atendimentos/ })
    expect(history).toHaveAttribute("data-state", "inactive")
    const field = screen.getByLabelText("Mensagem para o operador")
    fireEvent.change(field, { target: { value: "Rascunho que não pode sumir" } })

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Seus atendimentos/ }), { button: 0 })
    expect(screen.getByRole("tab", { name: /Seus atendimentos/ })).toHaveAttribute("aria-selected", "true")
    expect(history).toHaveAttribute("data-state", "active")
    expect(await within(history).findByText("Você ainda não fez nenhum atendimento.")).toBeInTheDocument()
    expect(screen.getByRole("article", { hidden: true, name: "Atendimento AP-7K2QX9" }).closest("[role=tabpanel][data-slot=tabs-content][data-state]")!.parentElement!.closest("[role=tabpanel]")).toHaveAttribute("data-state", "inactive")
    expect(window.location.search).toBe("?tab=historico")

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Atendimento/ }), { button: 0 })
    expect(screen.getByLabelText("Mensagem para o operador")).toHaveValue("Rascunho que não pode sumir")
    expect(window.location.search).toBe("")
  })

  it("mensagem nova do operador com o Anjo em outra aba: a aba \"Atendimento\" e a do atendimento sinalizam", async () => {
    const operatorMessage = (seq: number) => ({ id: `m-${seq}`, seq, authorKind: "OPERATOR" as const, authorName: "Bruno", body: `oi ${seq}`, systemCode: null, occurredAt: minutesAgo(0) })
    service.fetchSupportMessages.mockResolvedValueOnce({ messages: [operatorMessage(1), operatorMessage(2)], hasMore: false })
    const { rerender } = render(<AnjoWorkspace />)
    await screen.findByText("oi 2")
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Seus atendimentos/ }), { button: 0 })

    service.fetchSupportMessages.mockResolvedValueOnce({ messages: [operatorMessage(3)], hasMore: false })
    setHook({ anjo: anjoView({ attendances: [attendance({ lastSeq: 3 })] }) })
    rerender(<AnjoWorkspace />)
    await waitFor(() => expect(screen.getByRole("tab", { name: /Atendimento/ })).toHaveTextContent("1 mensagem nova"))
    expect(screen.getByRole("tab", { name: /Bruno/, hidden: true })).toHaveTextContent("1 mensagem nova")
  })

  it("mensagem nova do operador com a página fora da vista: o título pisca com o nome do operador e toca o som; ao voltar, para", async () => {
    const tones: string[] = []
    class FakeAudioContext {
      state = "running"
      currentTime = 0
      destination = {}
      resume = vi.fn(async () => undefined)
      close = vi.fn(async () => undefined)
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
      }
      createOscillator() {
        tones.push("tone")
        return { type: "sine", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext)
    const operatorMessage = (seq: number) => ({ id: `m-${seq}`, seq, authorKind: "OPERATOR" as const, authorName: "Bruno", body: `oi ${seq}`, systemCode: null, occurredAt: minutesAgo(0) })
    service.fetchSupportMessages.mockResolvedValueOnce({ messages: [operatorMessage(1), operatorMessage(2)], hasMore: false })
    document.title = "INIA"
    const { rerender } = render(<AnjoWorkspace />)
    await screen.findByText("oi 2")
    fireEvent.pointerDown(document.body)
    expect(tones).toHaveLength(0)

    // O Anjo foi para outro sistema: a janela perdeu o foco.
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false)
    service.fetchSupportMessages.mockResolvedValueOnce({ messages: [operatorMessage(3)], hasMore: false })
    setHook({ anjo: anjoView({ attendances: [attendance({ lastSeq: 3 })] }) })
    rerender(<AnjoWorkspace />)
    await waitFor(() => expect(document.title).toBe(newMessageTitle("Bruno")))
    expect(tones.length).toBeGreaterThan(0)

    focus.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(document.title).toBe("INIA")
    vi.unstubAllGlobals()
  })

  it("tempo de atendimento: desde o início real do atendimento, pelo relógio do servidor, um por atendimento", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-10T15:00:00.000Z") })
    try {
      setHook({
        clockOffsetMs: 30_000,
        anjo: anjoView({
          capacity: { max: 2, used: 2 },
          attendances: [attendance({ startedAt: "2026-11-10T14:52:00.000Z" }), attendance({ id: "att-2", requestId: "req-2", protocol: "AP-NEW222", operatorName: "Carla", startedAt: "2026-11-10T14:59:00.000Z" })],
        }),
      })
      render(<AnjoWorkspace />)
      const timers = screen.getAllByTestId("attendance-timer")
      expect(timers.map((timer) => timer.textContent)).toEqual(["08:30", "01:30"])
      expect(timers[0]).toHaveAttribute("aria-label", "Tempo de atendimento: 8 min 30 s")
      act(() => void vi.advanceTimersByTime(2_000))
      expect(timers[0]).toHaveTextContent("08:32")
    } finally {
      vi.useRealTimers()
    }
  })
})
