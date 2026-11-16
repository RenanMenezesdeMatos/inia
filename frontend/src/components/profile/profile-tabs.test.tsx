/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { describe, expect, it } from "vitest"

import { MANAGER_CONTEXT, OPERATOR_CONTEXT, SUPERVISOR_CONTEXT } from "@/components/analytics/testing/fixtures"

import { profileTabsFor, type AnjoTabSignal } from "./profile-tabs"

describe("abas do perfil por capabilities (nunca por role no frontend)", () => {
  it("Anjo: \"Apoio\" é a última aba; número de mensagens novas, ou um ponto com atendimento sem resposta", () => {
    expect(profileTabsFor(OPERATOR_CONTEXT.capabilities, 0, { unread: 0, awaitingResponse: false }).map((tab) => tab.label)).toEqual(["Acompanhamento", "Indicadores", "Organograma", "Apoio"])
    expect(profileTabsFor(SUPERVISOR_CONTEXT.capabilities, 0, { unread: 0, awaitingResponse: false }).at(-1)?.label).toBe("Apoio")
    const withUnread = profileTabsFor(OPERATOR_CONTEXT.capabilities, 0, { unread: 3, awaitingResponse: true }).find((tab) => tab.value === "apoio")!
    expect(withUnread).toMatchObject({ badge: 3, badgeTone: "attention" })
    expect(withUnread.badgeLabel?.(3)).toBe("mensagens novas")
    expect(withUnread.dot).toBeUndefined()
    expect(profileTabsFor(OPERATOR_CONTEXT.capabilities, 0, { unread: 0, awaitingResponse: true }).find((tab) => tab.value === "apoio")).toMatchObject({ dot: "atendimento sem resposta" })
    // Sem o papel: nenhuma aba de apoio.
    expect(profileTabsFor(OPERATOR_CONTEXT.capabilities).some((tab) => tab.value === "apoio")).toBe(false)
  })

  it("Anjo: o estado na aba \"Apoio\" — ícone, texto e dica por estado, com \"Em atendimento\" à parte; sem leitura ainda, nada", () => {
    const apoio = (presence: AnjoTabSignal["presence"], attendances = 0) => profileTabsFor(OPERATOR_CONTEXT.capabilities, 0, { unread: 0, awaitingResponse: false, attendances, presence }).find((tab) => tab.value === "apoio")!
    expect(apoio({ status: "AVAILABLE", pauseReason: null })).toMatchObject({ status: { key: "AVAILABLE", text: "Disponível" }, tooltip: "Apoio com Anjo: você está Disponível. Você recebe novos atendimentos." })
    // Disponível com atendimento aberto = Em atendimento (a regra do painel "Situação dos Anjos agora"), com ícone próprio.
    const attending = apoio({ status: "AVAILABLE", pauseReason: null }, 2)
    expect(attending).toMatchObject({ status: { key: "IN_ATTENDANCE", text: "Em atendimento" }, tooltip: "Apoio com Anjo: você está Em atendimento. 2 atendimentos em andamento. Novos chegam enquanto houver vaga." })
    expect(attending.status?.icon).not.toBe(apoio({ status: "AVAILABLE", pauseReason: null }).status?.icon)
    // Em pausa com atendimento aberto continua "Em pausa".
    expect(apoio({ status: "PAUSED", pauseReason: "LUNCH" }, 1)).toMatchObject({ status: { key: "PAUSED", text: "Em pausa · Lanche" } })
    expect(apoio({ status: "OFFLINE", pauseReason: null }).tooltip).toBe("Apoio com Anjo: você está Indisponível. Abra a aba para ficar disponível.")
    expect(apoio({ status: "AVAILABLE", pauseReason: null, scheduled: { status: "PAUSED", pauseReason: "MEETING" } }, 1).tooltip).toBe("Apoio com Anjo: você está Em atendimento. 1 atendimento em andamento. Você não recebe novos atendimentos. Programado para depois dos atendimentos: pausa (Reunião).")
    expect(apoio(null).status).toBeUndefined()
  })

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

  it("a dica da aba \"Apoio\" não apaga o destaque da aba ativa", async () => {
    const { installJsdomStubs } = await import("@/components/analytics/testing/jsdom-stubs")
    installJsdomStubs()
    const { render, screen } = await import("@testing-library/react")
    const { Tabs } = await import("@/components/ui/tabs")
    const { TooltipProvider } = await import("@/components/ui/tooltip")
    const { ProfileTabsList } = await import("./profile-tabs")
    const tabs = profileTabsFor(OPERATOR_CONTEXT.capabilities, 0, { unread: 0, awaitingResponse: false, presence: { status: "AVAILABLE", pauseReason: null } })
    render(<TooltipProvider><Tabs value="apoio"><ProfileTabsList tabs={tabs} active="apoio" /></Tabs></TooltipProvider>)
    const apoio = screen.getByRole("tab", { name: /Apoio/ })
    expect(apoio).toHaveAttribute("data-state", "active")
    expect(apoio).toHaveAccessibleName("Apoio : Disponível")
    // Nome e ícone em verde (Disponível), também com a aba aberta.
    expect(apoio.className).toContain("data-[state=active]:text-emerald-700")
  })
})
