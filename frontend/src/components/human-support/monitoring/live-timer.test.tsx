/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LiveTimer } from "./live-timer"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("LiveTimer", () => {
  it("corre a cada segundo sozinho, sem nova consulta, e passa a h:mm:ss depois de 1 hora; usa o relógio do servidor", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-12T13:00:00.000Z"))
    render(<LiveTimer since="2026-11-12T12:59:55.000Z" testId="timer" />)
    expect(screen.getByTestId("timer")).toHaveTextContent("00:05")
    act(() => void vi.advanceTimersByTime(3_000))
    expect(screen.getByTestId("timer")).toHaveTextContent("00:08")
    cleanup()
    // Relógio do servidor 1 min adiantado em relação ao da tela.
    render(<LiveTimer since="2026-11-12T11:35:00.000Z" offsetMs={60_000} testId="timer" />)
    expect(screen.getByTestId("timer")).toHaveTextContent("1:26:03")
    expect(screen.getByTestId("timer")).toHaveAccessibleName("1 h 26 min")
  })

  it("sem início, um traço — nunca um tempo inventado", () => {
    render(<LiveTimer since={null} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
