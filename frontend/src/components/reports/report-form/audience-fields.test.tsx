/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { AudiencePerson, ReportAudience, ReportOptions } from "@/schemas/reports/reports.schema"
import { searchAudiencePeople } from "@/services/reports/reports-service"
import { AudienceFields } from "./audience-fields"

vi.mock("@/services/reports/reports-service", () => ({ searchAudiencePeople: vi.fn() }))

const catalog: ReportOptions = {
  capabilities: { canCreateForSelf: true, canDistribute: true },
  timeZone: "America/Sao_Paulo",
  ownStructure: null,
  structures: [],
  indicators: [],
  audience: { scope: { organizationWide: true, teamIds: [], subteamIds: [] }, jobTitles: [], teams: [], subteams: [] },
}
const distribution: ReportAudience = { mode: "DISTRIBUTION", everyone: false, levels: [], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] }
const person = (personId: string, name: string): AudiencePerson => ({ personId, name, role: "OPERATOR", jobTitle: null })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeAll(() => installJsdomStubs())
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.mocked(searchAudiencePeople).mockReset()
})

describe("busca de pessoas específicas", () => {
  it("resposta atrasada de uma busca antiga não substitui a lista da busca atual", async () => {
    const first = deferred<AudiencePerson[]>()
    const second = deferred<AudiencePerson[]>()
    vi.mocked(searchAudiencePeople).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<AudienceFields audience={distribution} onChange={() => {}} catalog={catalog} canCreateForSelf />)
    const input = screen.getByRole("textbox", { name: "Buscar pessoa" })

    fireEvent.change(input, { target: { value: "an" } })
    act(() => vi.advanceTimersByTime(250))
    fireEvent.change(input, { target: { value: "bia" } })
    act(() => vi.advanceTimersByTime(250))
    expect(vi.mocked(searchAudiencePeople).mock.calls).toEqual([["an"], ["bia"]])

    // A busca "bia" responde primeiro; a de "an", depois.
    await act(async () => second.resolve([person("p2", "Bia Souza")]))
    await act(async () => first.resolve([person("p1", "Ana Lima")]))

    expect(screen.getByRole("button", { name: "Bia Souza" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Ana Lima" })).not.toBeInTheDocument()
  })
})
