/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { newMessageTitle } from "@/lib/attention/attention-alert"
import type { AnjoAttendanceView, AnjoView } from "@/schemas/human-support/state.schema"
import type { AnjoWorkspaceState } from "./use-anjo-workspace-state"
import { resetAcknowledgementsForTests } from "./receipt-acks"

import { AnjoWorkspaceProvider, NEW_ATTENDANCE_TITLE, useAnjoWorkspace, type AnjoWorkspaceContextValue } from "./anjo-workspace-provider"

/** Conexão do Anjo no app inteiro: só depois de abrir a área nesta aba do navegador; avisos em qualquer tela. */
const hook = vi.hoisted(() => ({ value: null as unknown as AnjoWorkspaceState, options: null as null | { enabled?: boolean; onNewAttendance?: (ids: string[]) => void } }))
const service = vi.hoisted(() => ({ fetchHumanSupportState: vi.fn(), acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })) }))
vi.mock("@/services/human-support/human-support-service", () => service)
vi.mock("./use-anjo-workspace-state", () => ({
  useAnjoWorkspaceState: (options: { enabled?: boolean; onNewAttendance?: (ids: string[]) => void }) => {
    hook.options = options
    return hook.value
  },
}))

const attendance = (overrides: Partial<AnjoAttendanceView> = {}): AnjoAttendanceView => ({
  id: "att-1", requestId: "req-1", protocol: "AP-1", operatorName: "Bruno", operatorAvatarUrl: null, teamName: null, subteamName: null, startedAt: new Date().toISOString(), firstAnjoMessageAt: null, lastSeq: 1,
  operatorAbsentSince: null, sharedContext: { question: null, answer: null, dislike: null, note: null }, peerReceipts: { deliveredSeq: 0, readSeq: 0 }, peerTypingMs: null, unreadCount: 0, ...overrides,
})
const anjoView = (attendances: AnjoAttendanceView[]): AnjoView => ({
  serverTime: new Date().toISOString(), presence: { status: "AVAILABLE", pauseReason: null, connected: true, since: new Date().toISOString(), scheduled: null }, capacity: { max: 2, used: attendances.length }, attendances, pendingClassifications: [],
})
const setState = (anjo: AnjoView | null) => {
  hook.value = { anjo, blocked: false, reconnecting: false, sessionEnded: false, refresh: vi.fn(), applyAnjo: vi.fn(), clockOffsetMs: 0 }
}

const probe = { current: null as unknown as AnjoWorkspaceContextValue }
function Probe() {
  const value = useAnjoWorkspace()
  useEffect(() => {
    probe.current = value
  })
  return <span data-testid="unread">{value.attention.unread}</span>
}

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

beforeEach(() => {
  tones.length = 0
  window.sessionStorage.clear()
  vi.stubGlobal("AudioContext", FakeAudioContext)
  document.title = "INIA"
  setState(anjoView([attendance()]))
  service.fetchHumanSupportState.mockReset()
  service.fetchHumanSupportState.mockResolvedValue({ version: "1", operator: null, anjo: { ...anjoView([]), presence: { status: "OFFLINE", pauseReason: null, connected: false, since: new Date().toISOString(), scheduled: null } } })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("AnjoWorkspaceProvider", () => {
  it("sem o papel Anjo: nada liga e nada é exposto", () => {
    render(<AnjoWorkspaceProvider available={false}><Probe /></AnjoWorkspaceProvider>)
    expect(hook.options?.enabled).toBe(false)
    expect(probe.current.available).toBe(false)
  })

  it("a conexão só começa depois de abrir a área nesta aba do navegador, e continua depois de recarregar", () => {
    const { unmount } = render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    expect(hook.options?.enabled).toBe(false)
    act(() => probe.current.arm())
    expect(hook.options?.enabled).toBe(true)
    unmount()
    render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    expect(hook.options?.enabled).toBe(true)
  })

  it("ao entrar, só LÊ o estado (sem conectar) para a aba: Indisponível fica desligado; em serviço, a conexão liga sozinha", async () => {
    render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    await waitFor(() => expect(probe.current.presence?.status).toBe("OFFLINE"))
    expect(service.fetchHumanSupportState).toHaveBeenCalledWith({ wait: 0, workspace: "anjo-status" })
    expect(hook.options?.enabled).toBe(false)
    cleanup()

    service.fetchHumanSupportState.mockResolvedValue({ version: "1", operator: null, anjo: { ...anjoView([]), presence: { status: "PAUSED", pauseReason: "LUNCH", connected: false, since: new Date().toISOString(), scheduled: null } } })
    render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    await waitFor(() => expect(hook.options?.enabled).toBe(true))
    // Conectado aqui, o estado passa a vir da conexão.
    expect(probe.current.presence?.status).toBe("AVAILABLE")
  })

  it("entregue do lado do Anjo: a conexão confirma as mensagens que chegaram, em qualquer tela, sem a área aberta", async () => {
    window.sessionStorage.setItem("inia:anjo-workspace-armed", "1")
    resetAcknowledgementsForTests()
    setState(anjoView([attendance({ requestId: "req-9", lastSeq: 4 })]))
    render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    await waitFor(() => expect(service.acknowledgeSupportMessages).toHaveBeenCalledWith("req-9", { deliveredSeq: 4 }))
  })

  it("atendimento novo em qualquer tela: som, título piscando até a aba ter foco e a chegada para a área selecionar", () => {
    window.sessionStorage.setItem("inia:anjo-workspace-armed", "1")
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    fireEvent.pointerDown(document.body)
    act(() => hook.options?.onNewAttendance?.(["att-2"]))
    expect(tones.length).toBeGreaterThan(0)
    expect(document.title).toBe(NEW_ATTENDANCE_TITLE)
    expect(probe.current.arrival?.attendanceId).toBe("att-2")
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(document.title).toBe("INIA")
  })

  it("mensagem nova do operador (contagem do servidor): som em toda mensagem, também com o atendimento na tela; fora da vista, o título com o nome", () => {
    window.sessionStorage.setItem("inia:anjo-workspace-armed", "1")
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true)
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const { rerender } = render(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    fireEvent.pointerDown(document.body)

    // Com a página vista: toca, sem piscar o título.
    setState(anjoView([attendance({ unreadCount: 1 })]))
    rerender(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    expect(tones.length).toBeGreaterThan(0)
    const afterFirst = tones.length

    // De novo: toca outra vez; a contagem aparece para o indicador.
    setState(anjoView([attendance({ unreadCount: 2 })]))
    rerender(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    expect(tones.length).toBeGreaterThan(afterFirst)
    expect(screen.getByTestId("unread")).toHaveTextContent("2")
    expect(document.title).toBe("INIA")

    // Janela sem foco: o título também pisca com o nome do operador.
    focus.mockReturnValue(false)
    setState(anjoView([attendance({ unreadCount: 3 })]))
    rerender(<AnjoWorkspaceProvider available><Probe /></AnjoWorkspaceProvider>)
    expect(document.title).toBe(newMessageTitle("Bruno"))
  })
})
