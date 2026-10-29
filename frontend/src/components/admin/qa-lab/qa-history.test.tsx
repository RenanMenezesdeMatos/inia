/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

import { QaRunsTable } from "./qa-history"
import type { QaRunSummary } from "@/schemas/admin/qa-lab.schema"

afterEach(cleanup)

const run: QaRunSummary = {
  id: "run-1",
  executedBy: "admin",
  executedByName: "Carla",
  resourceType: "AGENT",
  resourceId: "agent-1",
  resourceName: "Diagnóstico de Performance",
  status: "COMPLETED",
  input: {},
  aiCalls: 1,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  durationMs: 1_000,
  errorMessage: null,
  createdAt: "2026-09-17T12:00:00.000Z",
  updatedAt: "2026-09-17T12:00:00.000Z",
  contextSummary: null,
  telemetry: null,
}

describe("histórico do QA Lab em tabela", () => {
  it("a execução abre também pelo teclado: há um botão focável na linha, e ele abre uma vez só (sem repetir o clique da linha)", () => {
    const onOpen = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <QaRunsTable runs={[run]} onOpen={onOpen} />
      </QueryClientProvider>,
    )

    const open = screen.getByRole("button", { name: /^Abrir a execução de Diagnóstico de Performance/ })
    open.focus()
    expect(open).toHaveFocus()
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith("run-1")
  })
})
