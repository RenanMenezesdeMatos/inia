import { describe, expect, it } from "vitest"
import { decodeKnowledgeOptionsCursor, encodeKnowledgeOptionsCursor, foldSearchTerm } from "./knowledge-options-cursor.js"

const ID = "d0000000-0000-4000-8000-00000000000a"

describe("posição do seletor de bases do Agent", () => {
  it("volta a mesma posição depois de codificada", () => {
    const cursor = { key: "proof kbopt acido global", id: ID }
    expect(decodeKnowledgeOptionsCursor(encodeKnowledgeOptionsCursor(cursor))).toEqual(cursor)
  })

  it("recusa posição que não decodifica, com id inválido ou forma errada", () => {
    expect(decodeKnowledgeOptionsCursor("nao-e-um-cursor")).toBeNull()
    expect(decodeKnowledgeOptionsCursor(Buffer.from(JSON.stringify(["x", "1 or 1=1"])).toString("base64url"))).toBeNull()
    expect(decodeKnowledgeOptionsCursor(Buffer.from(JSON.stringify({ key: "x", id: ID })).toString("base64url"))).toBeNull()
  })

  it("dobra o termo da busca como o SQL: minúsculas e sem acento", () => {
    expect(foldSearchTerm("  Ácido Portabilidade NUMÉRICA ção ")).toBe("acido portabilidade numerica cao")
  })
})
