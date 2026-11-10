/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const service = vi.hoisted(() => ({ acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })) }))
vi.mock("@/services/human-support/human-support-service", () => service)

import { acknowledgeOnce, resetAcknowledgementsForTests, useReadAcknowledgement } from "./receipt-acks"

/** Entregue e lido (migration 184): a aba só confirma o que avançou, e "lida" só com a conversa vista de verdade. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  resetAcknowledgementsForTests()
  service.acknowledgeSupportMessages.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe("acknowledgeOnce", () => {
  it("só chama quando o cursor avança; lida leva o entregue junto; cada pedido tem a própria memória", async () => {
    const send = vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 }))
    acknowledgeOnce("r1", { deliveredSeq: 3 }, send)
    acknowledgeOnce("r1", { deliveredSeq: 3 }, send)
    acknowledgeOnce("r1", { deliveredSeq: 2 }, send)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith("r1", { deliveredSeq: 3 })
    acknowledgeOnce("r1", { readSeq: 5 }, send)
    await flush()
    expect(send).toHaveBeenLastCalledWith("r1", { deliveredSeq: 5, readSeq: 5 })
    acknowledgeOnce("r2", { deliveredSeq: 1 }, send)
    await flush()
    expect(send).toHaveBeenCalledTimes(3)
  })

  it("falhou: a memória volta e a próxima oportunidade tenta de novo", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("rede")).mockResolvedValue({ deliveredSeq: 4, readSeq: 4 })
    acknowledgeOnce("r1", { readSeq: 4 }, send)
    await flush()
    acknowledgeOnce("r1", { readSeq: 4 }, send)
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe("useReadAcknowledgement", () => {
  it("lida só com a conversa na tela, a aba visível e a janela em foco", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const { rerender } = renderHook(({ active, seq }) => useReadAcknowledgement("req-1", seq, active), { initialProps: { active: true, seq: 4 } })
    await flush()
    expect(service.acknowledgeSupportMessages).not.toHaveBeenCalled()

    focus.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event("focus")))
    await flush()
    expect(service.acknowledgeSupportMessages).toHaveBeenCalledWith("req-1", { deliveredSeq: 4, readSeq: 4 })

    // Outra aba de atendimento na tela: a mensagem nova chega, mas não conta como lida.
    rerender({ active: false, seq: 6 })
    await flush()
    expect(service.acknowledgeSupportMessages).toHaveBeenCalledTimes(1)
    rerender({ active: true, seq: 6 })
    await flush()
    expect(service.acknowledgeSupportMessages).toHaveBeenLastCalledWith("req-1", { deliveredSeq: 6, readSeq: 6 })
  })
})
