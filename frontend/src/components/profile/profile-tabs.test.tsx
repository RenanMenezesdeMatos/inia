/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { describe, expect, it } from "vitest"

import { MANAGER_CONTEXT, OPERATOR_CONTEXT, SUPERVISOR_CONTEXT } from "@/components/analytics/testing/fixtures"

import { profileTabsFor } from "./profile-tabs"

describe("abas do perfil por capabilities (nunca por role no frontend)", () => {
  it("Operador: Acompanhamento, Indicadores e Organograma, sem aba de pessoas", () => {
    expect(profileTabsFor(OPERATOR_CONTEXT.capabilities).map((tab) => tab.label)).toEqual(["Acompanhamento", "Indicadores", "Organograma"])
  })

  it("Supervisor: 'Equipe' e 'Pendências'; Gerente+: 'Estrutura' e 'Pendências'", () => {
    expect(profileTabsFor(SUPERVISOR_CONTEXT.capabilities).map((tab) => tab.label)).toEqual(["Acompanhamento", "Indicadores", "Equipe", "Pendências", "Organograma"])
    expect(profileTabsFor(MANAGER_CONTEXT.capabilities).map((tab) => tab.label)).toEqual(["Acompanhamento", "Indicadores", "Estrutura", "Pendências", "Organograma"])
  })

  it("Pendências carrega o badge com a contagem real de revisões aguardando decisão (nunca número fake)", () => {
    expect(profileTabsFor(SUPERVISOR_CONTEXT.capabilities).find((tab) => tab.value === "pending")?.badge).toBeUndefined()
    expect(profileTabsFor(SUPERVISOR_CONTEXT.capabilities, 3).find((tab) => tab.value === "pending")?.badge).toBe(3)
  })
})
