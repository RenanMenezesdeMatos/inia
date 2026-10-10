/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { readAvOffsetMs, resetAvOffsetForTests, setAvOffsetMs } from "@/lib/avatar/audio/av-sync"
import { AvSyncSection, describeAvOffset } from "./av-sync-section"

beforeAll(installJsdomStubs)

describe("Sincronia da boca da INIA (Acessibilidade)", () => {
  afterEach(() => {
    cleanup()
    resetAvOffsetForTests()
  })

  it("mostra o ajuste deste aparelho e muda pelo teclado em passos de 10 ms", () => {
    render(<AvSyncSection />)
    expect(screen.getByText("0 ms (padrão)")).toBeTruthy()
    const slider = screen.getByRole("slider", { name: "Sincronia da boca da INIA" })
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    expect(readAvOffsetMs()).toBe(-10)
    expect(screen.getByText("-10 ms · boca mais tarde")).toBeTruthy()
    expect(window.localStorage.getItem("inia.avatar.avOffsetMs")).toBe("-10")
    act(() => setAvOffsetMs(40))
    expect(screen.getByText("+40 ms · boca mais cedo")).toBeTruthy()
  })

  it("texto do valor", () => {
    expect(describeAvOffset(0)).toBe("0 ms (padrão)")
    expect(describeAvOffset(-120)).toBe("-120 ms · boca mais tarde")
    expect(describeAvOffset(30)).toBe("+30 ms · boca mais cedo")
  })
})
