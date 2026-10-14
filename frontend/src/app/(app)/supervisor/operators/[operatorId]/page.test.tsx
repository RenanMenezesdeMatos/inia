/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ADMIN_CONTEXT, MANAGER_CONTEXT, SUPERVISOR_CONTEXT } from "@/components/analytics/testing/fixtures"
import type { AnalyticsContext } from "@/schemas/analytics/analytics.schema"
import type { SupervisorOperatorResult } from "@/services/supervisor"

import Page from "./page"

const fetchOperator = vi.fn<() => Promise<SupervisorOperatorResult>>()
const fetchContext = vi.fn<() => Promise<AnalyticsContext | null>>()

vi.mock("@/services/supervisor", () => ({ fetchSupervisorOperatorFromCookies: () => fetchOperator() }))
vi.mock("@/services/analytics/analytics-server", () => ({ fetchAnalyticsContextFromCookies: () => fetchContext() }))
vi.mock("@/services/auth/current-user-server", () => ({ getCurrentUserFromCookies: async () => null }))
// Só o estado indisponível interessa aqui: a ficha aberta tem teste próprio.
vi.mock("@/components/profile/employee-profile-page", () => ({ EmployeeProfilePage: () => null }))

afterEach(cleanup)

async function renderUnavailable(status: "forbidden" | "not_found" | "error", context: AnalyticsContext | null) {
  fetchOperator.mockResolvedValue({ status })
  fetchContext.mockResolvedValue(context)
  render(await Page({ params: Promise.resolve({ operatorId: "op-fora" }) }))
}

describe("Ficha do colaborador indisponível — saída e motivo", () => {
  it("quem não tem aba Equipe (Administrador geral fora da hierarquia) volta ao Organograma do próprio perfil, sem foco", async () => {
    await renderUnavailable("forbidden", ADMIN_CONTEXT)

    expect(screen.getByRole("link", { name: "Voltar para o organograma" })).toHaveAttribute("href", "/supervisor?tab=structure")
    expect(screen.queryByRole("link", { name: /Voltar para a equipe/ })).not.toBeInTheDocument()
    // Esse viewer não tem estrutura: o motivo fala do escopo do acesso.
    expect(screen.getByText("Você só pode abrir colaboradores ativos do seu escopo.")).toBeInTheDocument()
    expect(screen.queryByText(/sua estrutura/)).not.toBeInTheDocument()
  })

  it("no 404 o Administrador geral também sai pelo Organograma", async () => {
    await renderUnavailable("not_found", ADMIN_CONTEXT)

    expect(screen.getByText("Colaborador não encontrado")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Voltar para o organograma" })).toHaveAttribute("href", "/supervisor?tab=structure")
  })

  it.each([
    ["Supervisor", SUPERVISOR_CONTEXT],
    ["Gerente", MANAGER_CONTEXT],
  ])("%s continua voltando para a aba de pessoas, com o motivo de sempre", async (_role, context) => {
    await renderUnavailable("forbidden", context)

    expect(screen.getByRole("link", { name: "Voltar para a equipe" })).toHaveAttribute("href", "/supervisor?tab=people")
    expect(screen.getByText("Você só pode abrir pessoas que fazem parte da sua estrutura.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /organograma/i })).not.toBeInTheDocument()
  })

  it("sem contexto de analytics (falha ao carregar), mantém o destino de sempre", async () => {
    await renderUnavailable("error", null)

    expect(screen.getByText("Tente novamente em instantes.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Voltar para a equipe" })).toHaveAttribute("href", "/supervisor?tab=people")
  })
})
