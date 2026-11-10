import { describe, expect, it } from "vitest"
import { signalsAfterResponseCheck, signalsOf, SUPPORT_SIGNALS } from "./reply-signals.js"

/** Sinais da resposta (`SUPPORT_SIGNALS_V1`): calculados só sobre os resultados estruturados do turno, nunca sobre o texto. */
describe("signalsOf", () => {
  it("nada aconteceu (sem especialista, sem esclarecimento) = lista vazia", () => {
    expect(signalsOf({})).toEqual([])
    expect(signalsOf({ specialists: [], direct: [{ card: null }] })).toEqual([])
  })

  it("KNOWLEDGE_NOT_FOUND: houve especialista consultado, nenhum resultado tem conteúdo e nenhum falhou", () => {
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NO_MATCH" } }] })).toEqual(["KNOWLEDGE_NOT_FOUND"])
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NONE" } }, {}] })).toEqual(["KNOWLEDGE_NOT_FOUND"])
    // Investigação que não terminou não é conteúdo.
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NO_MATCH" }, toolTrace: [{ status: "FAILED" }, { status: "SKIPPED" }] }] })).toEqual(["KNOWLEDGE_NOT_FOUND"])
    // Resultado direto sem cartão (pedido que a ferramenta não resolveu) não conta como conteúdo.
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NO_MATCH" } }], direct: [{ card: null }] })).toEqual(["KNOWLEDGE_NOT_FOUND"])
  })

  it("conteúdo: trecho das bases (RETRIEVAL ou FULL), investigação concluída (COMPLETED ou CACHED) ou cartão de dados", () => {
    expect(signalsOf({ specialists: [{ knowledge: { mode: "RETRIEVAL" } }] })).toEqual([])
    expect(signalsOf({ specialists: [{ knowledge: { mode: "FULL" } }] })).toEqual([])
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NONE" }, toolTrace: [{ status: "COMPLETED" }] }] })).toEqual([])
    expect(signalsOf({ specialists: [{ toolTrace: [{ status: "CACHED" }] }] })).toEqual([])
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NO_MATCH" } }, { knowledge: { mode: "RETRIEVAL" } }] })).toEqual([])
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NO_MATCH" } }], direct: [{ card: { type: "QUERY_TABLE" } }] })).toEqual([])
  })

  it("CONSULTATION_FAILED: alguma chamada falhou — e aí não se conclui que a informação não existe", () => {
    expect(signalsOf({ specialists: [{ knowledge: { mode: "NO_MATCH" } }, { failed: true }] })).toEqual(["CONSULTATION_FAILED"])
    expect(signalsOf({ specialists: [{ failed: true }] })).toEqual(["CONSULTATION_FAILED"])
    expect(signalsOf({ direct: [{ card: { type: "X" }, failed: true }] })).toEqual(["CONSULTATION_FAILED"])
  })

  it("SPECIALIST_BLOCKED: chamada impedida não conta como consulta feita", () => {
    expect(signalsOf({ specialists: [{ blocked: true }] })).toEqual(["SPECIALIST_BLOCKED"])
    expect(signalsOf({ blocked: true })).toEqual(["SPECIALIST_BLOCKED"])
    expect(signalsOf({ specialists: [{ blocked: true }, { knowledge: { mode: "NO_MATCH" } }] })).toEqual(["KNOWLEDGE_NOT_FOUND", "SPECIALIST_BLOCKED"])
    expect(signalsOf({ specialists: [{ blocked: true }, { knowledge: { mode: "RETRIEVAL" } }] })).toEqual(["SPECIALIST_BLOCKED"])
  })

  it("KNOWLEDGE_INSUFFICIENT: esclarecimento que terminou INSUFFICIENT ou NOT_CONVERGED; aberto ou respondido não", () => {
    expect(signalsOf({ clarificationStatus: "INSUFFICIENT" })).toEqual(["KNOWLEDGE_INSUFFICIENT"])
    expect(signalsOf({ clarificationStatus: "NOT_CONVERGED" })).toEqual(["KNOWLEDGE_INSUFFICIENT"])
    for (const status of ["OPEN", "ANSWERED", null]) expect(signalsOf({ clarificationStatus: status })).toEqual([])
  })

  it("vários sinais saem na ordem do catálogo, sem repetição", () => {
    const signals = signalsOf({ clarificationStatus: "INSUFFICIENT", specialists: [{ failed: true }, { failed: true }, { blocked: true }] })
    expect(signals).toEqual(["KNOWLEDGE_INSUFFICIENT", "CONSULTATION_FAILED", "SPECIALIST_BLOCKED"])
    expect(signals).toEqual(SUPPORT_SIGNALS.filter((signal) => signals.includes(signal)))
  })
})

describe("signalsAfterResponseCheck", () => {
  it("conferência que falhou e trocou o texto = consulta não concluída (a tela sugere o Anjo), sem os sinais do turno", () => {
    expect(signalsAfterResponseCheck({ replaced: true, checkOutcome: "CHECK_FAILED", computed: [] })).toEqual(["CONSULTATION_FAILED"])
    expect(signalsAfterResponseCheck({ replaced: true, checkOutcome: "CHECK_FAILED", computed: ["KNOWLEDGE_NOT_FOUND"] })).toEqual(["CONSULTATION_FAILED"])
  })

  it("resposta barrada por violação de regra = lista vazia (não é falta de informação)", () => {
    expect(signalsAfterResponseCheck({ replaced: true, checkOutcome: "VIOLATION", computed: ["KNOWLEDGE_NOT_FOUND"] })).toEqual([])
  })

  it("resposta que não foi trocada (inclusive a falha só registrada, em AUDIT) = os sinais calculados", () => {
    expect(signalsAfterResponseCheck({ replaced: false, checkOutcome: "CHECK_FAILED", computed: ["KNOWLEDGE_NOT_FOUND"] })).toEqual(["KNOWLEDGE_NOT_FOUND"])
    expect(signalsAfterResponseCheck({ replaced: false, checkOutcome: "ALLOWED", computed: [] })).toEqual([])
  })
})
