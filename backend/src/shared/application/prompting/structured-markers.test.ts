import { describe, expect, it } from "vitest"
import { extractMarkerPayload, scanBalancedJson } from "./structured-markers.js"

const E = "EVIDENCE_JSON:"
const S = "SUPPORT_MATERIALS_JSON:"
const evidence = { supportedHypotheses: [], unsupportedHypotheses: [], limitations: ["l"], behavioralClaims: [{ text: "x", evidenceRefs: ["F1"], scope: "INTERACTION_SPECIFIC" }], recommendationSupport: [] }
const materials = [{ materialId: "M1", reason: "r" }]

describe("framing de marcadores estruturados (V1.3.2 — §4)", () => {
  it("A) marcador único com JSON na mesma linha", () => {
    const out = extractMarkerPayload(`Texto para o colaborador.\n${E} ${JSON.stringify(evidence)}`, E)
    expect(out.status).toBe("VALID")
    expect(out.payload).toEqual(evidence)
    expect(out.text).toBe("Texto para o colaborador.")
  })

  it("B) EVIDENCE seguido de SUPPORT_MATERIALS: cada marcador extrai só o seu payload e o outro sobrevive no texto", () => {
    const raw = `Diagnóstico.\n\n${E}\n${JSON.stringify(evidence)}\n\n${S}\n${JSON.stringify(materials)}`
    const first = extractMarkerPayload(raw, E)
    expect(first.status).toBe("VALID")
    expect(first.payload).toEqual(evidence)
    expect(first.text).toContain(S)
    const second = extractMarkerPayload(first.text, S)
    expect(second.status).toBe("VALID")
    expect(second.payload).toEqual(materials)
    expect(second.text).toBe("Diagnóstico.")
  })

  it("C) SUPPORT_MATERIALS antes de EVIDENCE — ordem não importa", () => {
    const raw = `Diagnóstico.\n${S} ${JSON.stringify(materials)}\n${E} ${JSON.stringify(evidence)}`
    const evidenceOut = extractMarkerPayload(raw, E)
    expect(evidenceOut.status).toBe("VALID")
    expect(evidenceOut.text).toBe(`Diagnóstico.\n${S} ${JSON.stringify(materials)}`)
    const materialsOut = extractMarkerPayload(evidenceOut.text, S)
    expect(materialsOut.status).toBe("VALID")
    expect(materialsOut.text).toBe("Diagnóstico.")
  })

  it("D) texto antes e depois do bloco: o texto depois continua no output (nunca é engolido)", () => {
    const out = extractMarkerPayload(`Antes.\n${E} {"a":1}\nDepois do bloco.`, E)
    expect(out.status).toBe("VALID")
    expect(out.payload).toEqual({ a: 1 })
    expect(out.text).toBe("Antes.\nDepois do bloco.")
  })

  it("E) espaços, tabs e linhas em branco entre marcador e JSON", () => {
    const out = extractMarkerPayload(`Antes.\n\n   ${E}   \n\n  {"a": [1, 2]}  \n\n`, E)
    expect(out.status).toBe("VALID")
    expect(out.payload).toEqual({ a: [1, 2] })
    expect(out.text).toBe("Antes.")
  })

  it("F) cerca de markdown ```json … ``` é tolerada e removida junto com o bloco", () => {
    const out = extractMarkerPayload(`Antes.\n${E}\n\`\`\`json\n{"a":1}\n\`\`\`\nDepois.`, E)
    expect(out.status).toBe("VALID")
    expect(out.payload).toEqual({ a: 1 })
    expect(out.text).toBe("Antes.\nDepois.")
  })

  it("G) strings JSON contendo chaves e os próprios nomes dos marcadores não confundem o scanner", () => {
    const payload = { note: "veja {isto} e [aquilo] e \"EVIDENCE_JSON:\" e SUPPORT_MATERIALS_JSON: dentro da string", nested: { s: "}}]]" } }
    const raw = `Antes.\n${E} ${JSON.stringify(payload)}\n${S} ${JSON.stringify(materials)}`
    const out = extractMarkerPayload(raw, E)
    expect(out.status).toBe("VALID")
    expect(out.payload).toEqual(payload)
    expect(extractMarkerPayload(out.text, S).status).toBe("VALID")
  })

  it("H) JSON aninhado (objetos em arrays em objetos) fecha no lugar certo", () => {
    const payload = { claims: [{ text: "a", refs: ["F1", "F2"], meta: { deep: [{ x: [1, { y: 2 }] }] } }] }
    const out = extractMarkerPayload(`${E} ${JSON.stringify(payload)}\nSUPPORT_MATERIALS_JSON: []`, E)
    expect(out.status).toBe("VALID")
    expect(out.payload).toEqual(payload)
    expect(out.text).toBe("SUPPORT_MATERIALS_JSON: []")
  })

  it("I) marcador duplicado = MARKER_DUPLICATE (fail-closed: nenhum dos dois vale)", () => {
    const out = extractMarkerPayload(`${E} {"a":1}\ntexto\n${E} {"a":2}`, E)
    expect(out.status).toBe("MARKER_DUPLICATE")
    expect(out.payload).toBeUndefined()
    expect(out.occurrences).toBe(2)
  })

  it("J) malformado: sem JSON, JSON inválido e JSON não fechado — cada um com o seu status, nunca VALID", () => {
    expect(extractMarkerPayload(`${E} nada aqui\nDepois.`, E)).toMatchObject({ status: "MARKER_PAYLOAD_INVALID", payload: undefined, text: "Depois." })
    expect(extractMarkerPayload(`${E} {"a": }\n`, E).status).toBe("MARKER_PAYLOAD_INVALID")
    expect(extractMarkerPayload(`${E} {"a": [1, 2}\nDepois.`, E).status).toBe("MARKER_BOUNDARY_ERROR")
    expect(extractMarkerPayload(`${E} {"a": {"b": 1}\nDepois.`, E).status).toBe("MARKER_BOUNDARY_ERROR")
    expect(extractMarkerPayload("Sem marcador algum.", E)).toMatchObject({ status: "MARKER_NOT_FOUND", text: "Sem marcador algum." })
  })

  it("o marcador dentro de uma frase (não no início da linha) não conta como marcador", () => {
    const out = extractMarkerPayload(`A linha EVIDENCE_JSON: deve vir no fim.\n${E} {"a":1}`, E)
    expect(out.status).toBe("VALID")
    expect(out.text).toBe("A linha EVIDENCE_JSON: deve vir no fim.")
  })

  it("prefixos de markdown (**, -) antes do marcador são tolerados", () => {
    expect(extractMarkerPayload(`Antes.\n**${E}** {"a":1}`, E)).toMatchObject({ status: "VALID", payload: { a: 1 }, text: "Antes." })
    expect(extractMarkerPayload(`- ${E} [1]`, E)).toMatchObject({ status: "VALID", payload: [1], text: "" })
  })

  it("scanBalancedJson respeita escapes dentro de strings", () => {
    const text = '{"a":"\\"}\\\\"}resto'
    expect(text.slice(0, scanBalancedJson(text, 0))).toBe('{"a":"\\"}\\\\"}')
  })
})
