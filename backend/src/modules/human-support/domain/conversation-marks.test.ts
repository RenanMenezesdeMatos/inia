import { describe, expect, it } from "vitest"
import { NO_RECEIPTS, peerOf, receiptsAfterAck, sameReceipts } from "./conversation-marks.js"

describe("receiptsAfterAck", () => {
  it("avança entregue e lida até a confirmação", () => {
    expect(receiptsAfterAck(NO_RECEIPTS, { deliveredSeq: 4, readSeq: 2 }, 10)).toEqual({ deliveredSeq: 4, readSeq: 2 })
  })

  it("nunca volta: confirmação atrasada (seq menor) não desfaz o que já foi entregue ou lido", () => {
    expect(receiptsAfterAck({ deliveredSeq: 8, readSeq: 6 }, { deliveredSeq: 3, readSeq: 1 }, 10)).toEqual({ deliveredSeq: 8, readSeq: 6 })
  })

  it("lida implica entregue", () => {
    expect(receiptsAfterAck({ deliveredSeq: 2, readSeq: 2 }, { readSeq: 7 }, 10)).toEqual({ deliveredSeq: 7, readSeq: 7 })
  })

  it("nunca passa da última mensagem do pedido (confirmação inventada fica no fim)", () => {
    expect(receiptsAfterAck(NO_RECEIPTS, { deliveredSeq: 999, readSeq: 500 }, 12)).toEqual({ deliveredSeq: 12, readSeq: 12 })
  })

  it("valor negativo ou ausente não muda nada", () => {
    expect(receiptsAfterAck({ deliveredSeq: 3, readSeq: 1 }, { deliveredSeq: -5 }, 10)).toEqual({ deliveredSeq: 3, readSeq: 1 })
    expect(sameReceipts(receiptsAfterAck({ deliveredSeq: 3, readSeq: 1 }, {}, 10), { deliveredSeq: 3, readSeq: 1 })).toBe(true)
  })

  it("a outra ponta", () => {
    expect(peerOf("OPERATOR")).toBe("ANJO")
    expect(peerOf("ANJO")).toBe("OPERATOR")
  })
})
