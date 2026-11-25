/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { scopedOptionsServiceFrom } from "@/components/admin/shared/testing/scoped-options-fake"
import type { ReportAudience, ReportOptions } from "@/schemas/reports/reports.schema"

const UNITS = vi.hoisted(() => [{ id: "t-a", name: "Atendimento", subteams: [{ id: "s-a", name: "Tarde" }] }, { id: "t-r", name: "Retenção", subteams: [{ id: "s-r", name: "Tarde" }] }])
const PEOPLE = vi.hoisted(() => [{ id: "p-ana", name: "Ana Lima", teamId: "t-a" }, { id: "p-salva", name: "Salva Antiga", teamId: "t-r" }])
vi.mock("@/services/scope-units/scoped-options-service", () => scopedOptionsServiceFrom(UNITS, PEOPLE))

import { AudienceFields } from "./audience-fields"

const catalog: ReportOptions = {
  capabilities: { canCreateForSelf: true, canDistribute: true },
  timeZone: "America/Sao_Paulo",
  ownStructure: null,
  indicators: [],
  audience: { scope: { organizationWide: true, teamIds: [], subteamIds: [] }, jobTitles: [] },
}
const saved: ReportAudience = { mode: "DISTRIBUTION", everyone: false, levels: [], jobTitles: [], teamIds: [], subteamIds: [], personIds: ["p-salva"] }

function Form({ onAudience }: { onAudience: (audience: ReportAudience) => void }) {
  const [audience, setAudience] = useState<ReportAudience>(saved)
  return <AudienceFields audience={audience} onChange={(next) => { setAudience(next); onAudience(next) }} catalog={catalog} canCreateForSelf />
}

beforeAll(() => installJsdomStubs())
afterEach(cleanup)

describe("Público do report — Grupos, Subgrupos e pessoas", () => {
  it("a pessoa já salva aparece pelo nome e continua ao buscar e escolher outra", async () => {
    const onAudience = vi.fn()
    renderWithQuery(<Form onAudience={onAudience} />)
    expect(await screen.findByText("Salva Antiga")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Pessoas:/ }))
    fireEvent.change(await screen.findByRole("combobox", { name: /Buscar pessoa/ }), { target: { value: "ana" } })
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    fireEvent.click(screen.getByRole("option", { name: "Ana Lima" }))
    expect(onAudience).toHaveBeenLastCalledWith(expect.objectContaining({ personIds: ["p-salva", "p-ana"] }))
    const chosen = screen.getByRole("list", { name: "Pessoas escolhidos", hidden: true })
    expect(await within(chosen).findByText("Ana Lima")).toBeInTheDocument()
    expect(within(chosen).getByText("Salva Antiga")).toBeInTheDocument()
  })

  it("Subgrupos de nome igual: o Grupo de origem distingue na lista e no selo", async () => {
    const onAudience = vi.fn()
    renderWithQuery(<Form onAudience={onAudience} />)
    fireEvent.click(screen.getByRole("button", { name: /^Subgrupos:/ }))
    fireEvent.click(await screen.findByRole("option", { name: "Retenção › Tarde" }))
    expect(screen.getByRole("option", { name: "Atendimento › Tarde" })).toHaveAttribute("aria-selected", "false")
    expect(onAudience).toHaveBeenLastCalledWith(expect.objectContaining({ subteamIds: ["s-r"] }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: /Buscar/ }), { key: "Escape" })
    fireEvent.click(await screen.findByRole("button", { name: "Remover Retenção › Tarde" }))
    expect(onAudience).toHaveBeenLastCalledWith(expect.objectContaining({ subteamIds: [] }))
  })
})
