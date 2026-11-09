/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DeletedReportsList } from "./deleted-reports-list"

const service = vi.hoisted(() => ({ fetchDeletedReports: vi.fn(), restoreReport: vi.fn() }))
vi.mock("@/services/reports/reports-service", () => service)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const renderList = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeletedReportsList /></QueryClientProvider>)
const REPORT = { id: "r1", name: "Report antigo", deletedAt: "2026-11-06T12:00:00.000Z" }

beforeEach(() => {
  service.fetchDeletedReports.mockReset().mockResolvedValue([REPORT])
  service.restoreReport.mockReset().mockResolvedValue(undefined)
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(cleanup)

describe("Reports excluídos", () => {
  it("mostra os excluídos e restaura avisando que volta inativo", async () => {
    renderList()
    await screen.findByText("Report antigo")
    fireEvent.click(screen.getByRole("button", { name: /Restaurar/ }))
    await waitFor(() => expect(service.restoreReport).toHaveBeenCalledWith("r1"))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("voltou inativo")))
    await waitFor(() => expect(service.fetchDeletedReports).toHaveBeenCalledTimes(2))
  })

  it("recusa do servidor aparece e a lista continua", async () => {
    service.restoreReport.mockRejectedValue(new Error("Report excluído não encontrado."))
    renderList()
    fireEvent.click(await screen.findByRole("button", { name: /Restaurar/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Report excluído não encontrado."))
    expect(screen.getByText("Report antigo")).toBeInTheDocument()
  })

  it("sem nada excluído, diz isso", async () => {
    service.fetchDeletedReports.mockResolvedValue([])
    renderList()
    await screen.findByText("Nenhum report excluído.")
  })
})
