/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ADMIN_CONTEXT, MANAGER_CONTEXT, SUPERVISOR_CONTEXT } from "@/components/analytics/testing/fixtures"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { AnalyticsContext } from "@/schemas/analytics/analytics.schema"
import type { SupervisorOperatorDetail } from "@/services/supervisor"

import { EmployeeProfilePage } from "./employee-profile-page"
import { profileTabsFor } from "./profile-tabs"

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/supervisor/operators/op-diego", useSearchParams: () => navigation.search, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
// Só o cabeçalho da ficha interessa aqui: as abas consultam a API e têm testes próprios.
vi.mock("@/components/analytics/indicators-view", () => ({ IndicatorsView: () => null }))
vi.mock("@/components/follow-up/structure-follow-up-feed", () => ({ StructureFollowUpFeed: () => null }))
vi.mock("@/components/structure/person-structure-view", () => ({ PersonStructureView: () => null }))
vi.mock("@/components/interventions/person-interventions", () => ({ PersonInterventions: () => null }))

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  navigation.search = new URLSearchParams()
})

const DIEGO: SupervisorOperatorDetail = {
  profile: { id: "op-diego", name: "Diego Costa", matricula: "EX-0003", role: "OPERATOR", avatarUrl: null, jobTitle: "Operador de Atendimento", bio: null, strengths: [], developmentFocus: [], hiredAt: null, teamId: "team-1", teamName: "Grupo Atendimento", presentation: null },
  plans: [],
  monitorings: [],
  escalation: null,
}

const renderFicha = (context: AnalyticsContext | null) => renderWithQuery(<EmployeeProfilePage detail={DIEGO} context={context} />)

describe("Ficha do colaborador — saída da ficha", () => {
  it("quem não tem aba Equipe (Administrador geral fora da hierarquia) volta ao Organograma do próprio perfil, já na pessoa visitada", () => {
    // O perfil próprio desse viewer não tem aba de pessoas: `tab=people` cairia em Acompanhamentos ("sem estrutura vinculada").
    const ownTabs = profileTabsFor(ADMIN_CONTEXT.capabilities).map((tab) => tab.value)
    expect(ownTabs).not.toContain("people")
    expect(ownTabs).toContain("structure")

    renderFicha(ADMIN_CONTEXT)

    expect(screen.getByRole("link", { name: "Voltar para o organograma" })).toHaveAttribute("href", "/supervisor?tab=structure&structurePersonId=op-diego")
    expect(screen.queryByRole("link", { name: /Voltar para a equipe/ })).not.toBeInTheDocument()
  })

  it.each([
    ["Supervisor", SUPERVISOR_CONTEXT],
    ["Gerente", MANAGER_CONTEXT],
  ])("%s continua voltando para a aba de pessoas, como antes", (_role, context) => {
    renderFicha(context)

    expect(screen.getByRole("link", { name: "Voltar para a equipe" })).toHaveAttribute("href", "/supervisor?tab=people")
    expect(screen.queryByRole("link", { name: /organograma/i })).not.toBeInTheDocument()
  })

  it("sem contexto de analytics (falha ao carregar), mantém o destino de sempre", () => {
    renderFicha(null)

    expect(screen.getByRole("link", { name: "Voltar para a equipe" })).toHaveAttribute("href", "/supervisor?tab=people")
  })
})

describe("Ficha do colaborador — Visão geral", () => {
  it("o subtítulo não repete o Grupo quando o cargo do cadastro já o traz (mesma linha do cabeçalho)", () => {
    navigation.search = new URLSearchParams("tab=people")
    const detail = { ...DIEGO, profile: { ...DIEGO.profile, jobTitle: "Operadora de Atendimento — B2C · Atendimento Geral", teamName: "B2C · Atendimento Geral" } }
    renderWithQuery(<EmployeeProfilePage detail={detail} context={SUPERVISOR_CONTEXT} />)

    expect(screen.getByText("Perfil do colaborador")).toBeInTheDocument()
    expect(screen.queryByText(/Atendimento Geral · B2C · Atendimento Geral/)).not.toBeInTheDocument()
    expect(screen.getAllByText("Operadora de Atendimento — B2C · Atendimento Geral").length).toBeGreaterThan(0)
  })

  it("cargo sem o Grupo continua mostrando os dois", () => {
    navigation.search = new URLSearchParams("tab=people")
    renderWithQuery(<EmployeeProfilePage detail={DIEGO} context={SUPERVISOR_CONTEXT} />)

    expect(screen.getAllByText("Operador de Atendimento · Grupo Atendimento").length).toBeGreaterThan(0)
  })
})
