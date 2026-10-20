/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastMock = vi.hoisted(() => ({ warning: vi.fn(), dismiss: vi.fn() }))
const reportMock = vi.hoisted(() => vi.fn(async () => "ok" as "ok" | "ended"))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@/services/auth/auth-service", () => ({ reportSessionActivity: reportMock }))

import { signalUserActivity } from "@/lib/auth/idle-session"
import { SessionIdleGuard } from "./session-idle-guard"

const MINUTE = 60_000

describe("SessionIdleGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"))
    toastMock.warning.mockClear()
    toastMock.dismiss.mockClear()
    reportMock.mockClear()
    reportMock.mockResolvedValue("ok")
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("parada: avisa nos 2 minutos finais e encerra no limite", () => {
    const onExpired = vi.fn()
    render(<SessionIdleGuard timeoutMinutes={30} onExpired={onExpired} />)
    act(() => void vi.advanceTimersByTime(27 * MINUTE))
    expect(toastMock.warning).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1 * MINUTE + 10_000))
    expect(toastMock.warning).toHaveBeenCalled()
    expect(String(toastMock.warning.mock.calls.at(-1)![0])).toContain("encerrada por inatividade")
    expect(onExpired).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(2 * MINUTE))
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it("interação renova a contagem e avisa o servidor no máximo uma vez por minuto", () => {
    const onExpired = vi.fn()
    render(<SessionIdleGuard timeoutMinutes={30} onExpired={onExpired} />)
    act(() => void vi.advanceTimersByTime(25 * MINUTE))
    act(() => {
      window.dispatchEvent(new Event("pointerdown"))
      window.dispatchEvent(new Event("keydown"))
    })
    expect(reportMock).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(29 * MINUTE))
    expect(onExpired).not.toHaveBeenCalled()
    act(() => signalUserActivity())
    expect(reportMock).toHaveBeenCalledTimes(2)
    act(() => void vi.advanceTimersByTime(29 * MINUTE))
    expect(onExpired).not.toHaveBeenCalled()
  })

  it("servidor já encerrou a sessão: a tela também encerra", async () => {
    reportMock.mockResolvedValue("ended")
    const onExpired = vi.fn()
    render(<SessionIdleGuard timeoutMinutes={30} onExpired={onExpired} />)
    act(() => void vi.advanceTimersByTime(2 * MINUTE))
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"))
      await Promise.resolve()
    })
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it("limite 0: nada é medido", () => {
    const onExpired = vi.fn()
    render(<SessionIdleGuard timeoutMinutes={0} onExpired={onExpired} />)
    act(() => void vi.advanceTimersByTime(600 * MINUTE))
    expect(onExpired).not.toHaveBeenCalled()
    expect(toastMock.warning).not.toHaveBeenCalled()
  })
})
