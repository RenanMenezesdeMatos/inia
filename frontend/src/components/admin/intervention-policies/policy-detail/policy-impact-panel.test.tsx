/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { ImpactPreview } from "@/schemas/admin/intervention-policy.schema"
import * as service from "@/services/admin/intervention-policy-service"

import { policyWithDraft } from "../testing/fixtures"
import { PolicyImpactPanel } from "./policy-impact-panel"

vi.mock("@/services/admin/intervention-policy-service", async () => (await import("../testing/fixtures")).createServiceMock())
const mocked = vi.mocked(service)

const PREVIEW: ImpactPreview = {
  effects: "NONE",
  asOf: "2026-11-18T15:00:00.000Z",
  policyVersion: { id: "v2", version: 2 },
  draftIssues: [],
  population: { inScope: 12, reachable: 10, requested: 10, evaluated: 10, truncated: false, historyHidden: 0 },
  summary: {
    evaluated: 10,
    people: { withNewFollowUp: 3, onlyNotified: 1, alreadyFollowed: 1, suppressed: 0, inconclusive: 2, noMatch: 3, conflict: 0, notApplicable: 0 },
    insufficientData: 2,
    continuitySuggestions: 1,
    unresolvedRecipients: 1,
    rules: [{ key: "R1", name: "Pior quartil em 3 fechamentos", priority: 1, met: 5, inconclusive: 2, notMet: 3, decided: 5 }],
    formats: [
      { typeKey: "PLANO", typeName: "Plano de ação", sensitive: false, created: 2, pendingApproval: 0, recommended: 0, notified: 1, existing: 1, suppressed: 0, conflict: 0 },
      { typeKey: "CONT", typeName: "Solicitar avaliação de continuidade", sensitive: true, created: 0, pendingApproval: 1, recommended: 0, notified: 0, existing: 0, suppressed: 0, conflict: 0 },
    ],
    leaders: { distinct: 2, top: [{ personId: "l1", name: "Daniela Rocha", opened: 2, notified: 1 }] },
    affected: { total: 1, items: [{ id: "p1", name: "Rafael Cardoso", teamName: "Retenção", outcome: "CREATED", rules: ["Pior quartil em 3 fechamentos"], decisions: [{ typeName: "Plano de ação", status: "CREATED" }] }] },
  },
  comparison: { baselineVersion: 1, compared: 10, gained: 2, lost: 1, kept: 2 },
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Prévia de impacto da política", () => {
  it("calcula o impacto do rascunho salvo e mostra a soma, sem estimar nada", async () => {
    mocked.previewPolicyImpact.mockResolvedValue(PREVIEW)
    renderWithQuery(<PolicyImpactPanel policy={policyWithDraft()} />)
    fireEvent.click(screen.getByRole("button", { name: /Calcular impacto/ }))
    const result = await screen.findByTestId("policy-impact-result")
    expect(mocked.previewPolicyImpact).toHaveBeenCalledWith("p1", "DRAFT")
    expect(within(result).getByText(/10 pessoas avaliadas/)).toBeInTheDocument()
    expect(within(result).getByText(/2 pessoas do escopo da política fora do que você pode consultar/)).toBeInTheDocument()
    expect(within(result).getByText("Ganhariam um acompanhamento").previousSibling).toHaveTextContent("3")
    expect(within(result).getByText("Sem dado suficiente para decidir").previousSibling).toHaveTextContent("2")
    expect(within(result).getByText(/1 sugestão de avaliação de continuidade/)).toBeInTheDocument()
    expect(within(result).getByText(/A INIA só sugere/)).toBeInTheDocument()
    expect(within(result).getByText(/1 ação ficaria sem destinatário/)).toBeInTheDocument()
    expect(within(result).getByText(/Em relação à versão 1, em vigor/)).toHaveTextContent("2 passariam a receber algo, 1 deixariam de receber")
    expect(within(result).getByText("Decisão humana restrita")).toBeInTheDocument()
    expect(within(result).getByText("Daniela Rocha")).toBeInTheDocument()
    expect(within(result).getByText("Abriria: Plano de ação")).toBeInTheDocument()
  })

  it("avisa quando a prévia volta parcial ou sem o histórico de acompanhamentos", async () => {
    mocked.previewPolicyImpact.mockResolvedValue({ ...PREVIEW, comparison: null, population: { inScope: 900, reachable: 900, requested: 900, evaluated: 400, truncated: true, historyHidden: 5 } })
    renderWithQuery(<PolicyImpactPanel policy={policyWithDraft()} />)
    fireEvent.click(screen.getByRole("button", { name: /Calcular impacto/ }))
    const result = await screen.findByTestId("policy-impact-result")
    expect(within(result).getByText(/avaliou 400 de 900 pessoas/)).toBeInTheDocument()
    expect(within(result).getByText(/Para 5 pessoas você não pode ver os acompanhamentos/)).toBeInTheDocument()
    expect(within(result).queryByText(/Em relação à versão/)).not.toBeInTheDocument()
  })
})
