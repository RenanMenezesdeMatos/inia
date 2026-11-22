/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const service = vi.hoisted(() => ({
  fetchQualityCallRule: vi.fn(),
  updateQualityCallRule: vi.fn(),
}))
vi.mock("@/services/admin/governance-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { QualityCallRulePanel } = await import("./quality-call-rule-panel")

const ruleOf = (seconds: number, canEdit = true) => ({ minimumQualityCallSeconds: seconds, ruleVersion: "QUALITY_CALL_MIN_DURATION_V1", description: `Chamadas com menos de ${seconds} s (ou sem duração conhecida) ficam fora da análise de qualidade.`, limits: { min: 0, max: 600 }, canEdit })

beforeEach(() => {
  service.fetchQualityCallRule.mockReset().mockResolvedValue(ruleOf(60))
  service.updateQualityCallRule.mockReset().mockImplementation(async (seconds: number) => ruleOf(seconds))
})
afterEach(() => cleanup())

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(<QualityCallRulePanel />, { wrapper })
}

describe("Governança › Chamadas curtas", () => {
  it("mostra a regra em vigor e onde ela vale e não vale", async () => {
    renderPanel()
    expect(await screen.findByLabelText("Duração mínima para análise de qualidade (segundos)")).toHaveValue(60)
    expect(screen.getByText(/Monitoria aleatória dos Workflows/)).toBeInTheDocument()
    expect(screen.getByText(/Gatilho por Flag de canal/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
  })

  it("salva o novo mínimo; valor fora do limite não pode ser salvo", async () => {
    renderPanel()
    const input = await screen.findByLabelText("Duração mínima para análise de qualidade (segundos)")
    fireEvent.change(input, { target: { value: "900" } })
    expect(screen.getByText("Use um número inteiro de 0 a 600.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
    fireEvent.change(input, { target: { value: "45" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.updateQualityCallRule).toHaveBeenCalledWith(45))
  })

  it("quem administra a configuração só num recorte vê a regra, mas o campo e o Salvar ficam desabilitados com o motivo", async () => {
    service.fetchQualityCallRule.mockResolvedValue(ruleOf(60, false))
    renderPanel()
    const input = await screen.findByLabelText("Duração mínima para análise de qualidade (segundos)")
    expect(input).toBeDisabled()
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
    expect(screen.getByText(/só quem administra a configuração em toda a organização pode alterá-la/)).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription(/organização inteira/)
  })
})
