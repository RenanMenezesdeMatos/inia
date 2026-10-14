import { describe, expect, it } from "vitest"
import { decodeFollowUpCursor, encodeFollowUpCursor } from "./follow-up-cursor.js"

describe("Cursor do Acompanhamento", () => {
  it("ida e volta preserva o instante com microssegundos e o id", () => {
    const cursor = { at: "2026-09-20T10:00:00.123456Z", id: "2f0c1b9e-3c1d-4b8a-9e2f-1a2b3c4d5e6f" }
    expect(decodeFollowUpCursor(encodeFollowUpCursor(cursor))).toEqual(cursor)
  })

  it("ausente, adulterado ou fora do formato = null (a rota recusa o inválido)", () => {
    expect(decodeFollowUpCursor(undefined)).toBeNull()
    expect(decodeFollowUpCursor("")).toBeNull()
    expect(decodeFollowUpCursor("não-é-base64")).toBeNull()
    expect(decodeFollowUpCursor(encodeFollowUpCursor({ at: "2026-09-20T10:00:00.123Z", id: "2f0c1b9e-3c1d-4b8a-9e2f-1a2b3c4d5e6f" }))).toBeNull()
    expect(decodeFollowUpCursor(encodeFollowUpCursor({ at: "2026-09-20T10:00:00.123456Z", id: "1; drop table feedbacks" }))).toBeNull()
  })
})
