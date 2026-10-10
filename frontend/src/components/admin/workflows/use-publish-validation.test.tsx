/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/services/admin/workflow-service", () => ({ validateWorkflowDraft: vi.fn() }))

const { validateWorkflowDraft } = await import("@/services/admin/workflow-service")
const { combineIssues, usePublishValidation } = await import("./use-publish-validation")

const validate = vi.mocked(validateWorkflowDraft)

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

type Input = { workflowId: string; revision: string; isDirty: boolean; localIssueCount: number }

beforeEach(() => {
  validate.mockReset()
})

describe("usePublishValidation — 'Pronto para publicar' = local + backend", () => {
  it("rascunho salvo sem problema local → chama o dry-run UMA vez e fica ready", async () => {
    validate.mockResolvedValue({ valid: true, error: null })
    const { result } = renderHook((input: Input) => usePublishValidation(input), { wrapper: wrapper(), initialProps: { workflowId: "wf-1", revision: "r1", isDirty: false, localIssueCount: 0 } })
    expect(result.current.status).toBe("validating")
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledWith("wf-1")
    expect(result.current.backendIssue).toBeNull()
  })

  it("edição depois da validação → stale (sem request novo); salvar de novo (revisão nova) → revalida", async () => {
    validate.mockResolvedValue({ valid: true, error: null })
    const { result, rerender } = renderHook((input: Input) => usePublishValidation(input), { wrapper: wrapper(), initialProps: { workflowId: "wf-1", revision: "r1", isDirty: false, localIssueCount: 0 } })
    await waitFor(() => expect(result.current.status).toBe("ready"))
    rerender({ workflowId: "wf-1", revision: "r1", isDirty: true, localIssueCount: 0 })
    expect(result.current.status).toBe("stale")
    // Arrastar nós / digitar: continua sujo, nenhum request a mais.
    rerender({ workflowId: "wf-1", revision: "r1", isDirty: true, localIssueCount: 0 })
    rerender({ workflowId: "wf-1", revision: "r1", isDirty: true, localIssueCount: 0 })
    expect(validate).toHaveBeenCalledTimes(1)
    // Save → revisão nova → um request novo.
    rerender({ workflowId: "wf-1", revision: "r2", isDirty: false, localIssueCount: 0 })
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it("problema local bloqueia sem gastar request no backend", async () => {
    validate.mockResolvedValue({ valid: true, error: null })
    const { result } = renderHook((input: Input) => usePublishValidation(input), { wrapper: wrapper(), initialProps: { workflowId: "wf-1", revision: "r1", isDirty: false, localIssueCount: 2 } })
    expect(result.current.status).toBe("blocked_local")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(validate).not.toHaveBeenCalled()
  })

  it.each([
    ["WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS", "Esta estrutura possui mais de um Supervisor possível (5: A, B, C, D, E). Escolha um destinatário compatível ou uma estrutura com responsável inequívoco."],
    ["WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND", "Não foi possível determinar um Coordenador responsável por esta estrutura."],
  ])("erro do backend (%s) → invalid, com o nodeId devolvido para navegar até o nó", async (code, message) => {
    validate.mockResolvedValue({ valid: false, error: { code, message, nodeId: "output" } })
    const { result } = renderHook((input: Input) => usePublishValidation(input), { wrapper: wrapper(), initialProps: { workflowId: "wf-1", revision: "r1", isDirty: false, localIssueCount: 0 } })
    await waitFor(() => expect(result.current.status).toBe("invalid"))
    expect(result.current.backendIssue).toEqual({ nodeId: "output", message })
  })

  it("falha de rede → error, e 'revalidate' refaz o request (sem loop automático)", async () => {
    validate.mockRejectedValueOnce(new Error("rede"))
    const { result } = renderHook((input: Input) => usePublishValidation(input), { wrapper: wrapper(), initialProps: { workflowId: "wf-1", revision: "r1", isDirty: false, localIssueCount: 0 } })
    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(validate).toHaveBeenCalledTimes(1)
    validate.mockResolvedValueOnce({ valid: true, error: null })
    act(() => result.current.revalidate())
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(validate).toHaveBeenCalledTimes(2)
  })
})

describe("combineIssues — problemas locais + backend na mesma lista, sem duplicar", () => {
  it("acrescenta o problema do backend e ignora se a mesma mensagem já está na lista local", () => {
    const local = [{ nodeId: "out-mgr", message: "Output pós-Join com O próprio operador." }]
    expect(combineIssues(local, null)).toBe(local)
    expect(combineIssues(local, { nodeId: "output", message: "Ambíguo." })).toHaveLength(2)
    expect(combineIssues(local, { nodeId: "out-mgr", message: "Output pós-Join com O próprio operador." })).toHaveLength(1)
  })
})
