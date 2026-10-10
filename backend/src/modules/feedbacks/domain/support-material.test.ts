import { describe, expect, it } from "vitest"
import {
  buildSupportMaterialCandidates,
  buildSupportMaterialsFreeTextPromptSection,
  buildSupportMaterialsOutputField,
  buildSupportMaterialsPromptSection,
  extractSupportMaterialsMarker,
  MAX_SUPPORT_MATERIALS_PER_FEEDBACK,
  mergeSupportMaterialCandidates,
  readSupportMaterials,
  selectSupportMaterialRecommendations,
  SUPPORT_MATERIALS_MARKER,
} from "./support-material.js"

const A = { materialId: "11111111-1111-4111-8111-111111111111", title: "Técnicas de sondagem em retenção" }
const B = { materialId: "22222222-2222-4222-8222-222222222222", title: "Tratamento de objeções por preço" }
const C = { materialId: "33333333-3333-4333-8333-333333333333", title: "Checklist de Encerramento de Chamada" }
const D = { materialId: "44444444-4444-4444-8444-444444444444", title: "Procedimento de Segunda via" }
const CANDIDATES = [A, B, C, D]

const REASON = "Este material apresenta exemplos de perguntas de sondagem para situações de retenção por preço."

describe("buildSupportMaterialCandidates — chunk → material real, deduplicado", () => {
  it("vários trechos do mesmo documento viram UM candidato, na ordem de relevância do retrieval", () => {
    const candidates = buildSupportMaterialCandidates({
      mode: "RETRIEVAL",
      retrieved: [
        { documentId: A.materialId, documentTitle: A.title, heading: "1", excerpt: "x", score: 3 },
        { documentId: A.materialId, documentTitle: A.title, heading: "2", excerpt: "y", score: 2 },
        { documentId: B.materialId, documentTitle: B.title, heading: "1", excerpt: "z", score: 1 },
        { documentId: A.materialId, documentTitle: A.title, heading: "3", excerpt: "w", score: 1 },
      ],
    })
    expect(candidates).toEqual([A, B])
  })

  it("modo FULL também expõe candidatos; NONE e NO_MATCH não expõem nenhum", () => {
    const retrieved = [{ documentId: C.materialId, documentTitle: C.title, heading: "", excerpt: "x", score: 1 }]
    expect(buildSupportMaterialCandidates({ mode: "FULL", retrieved })).toEqual([C])
    expect(buildSupportMaterialCandidates({ mode: "NONE", retrieved: [] })).toEqual([])
    expect(buildSupportMaterialCandidates({ mode: "NO_MATCH", retrieved })).toEqual([])
  })
})

describe("selectSupportMaterialRecommendations — o LLM não é trust boundary", () => {
  it("zero recomendações é resultado válido (ausente, null ou lista vazia)", () => {
    expect(selectSupportMaterialRecommendations(undefined, CANDIDATES)).toEqual({ accepted: [], rejected: [] })
    expect(selectSupportMaterialRecommendations(null, CANDIDATES)).toEqual({ accepted: [], rejected: [] })
    expect(selectSupportMaterialRecommendations([], CANDIDATES)).toEqual({ accepted: [], rejected: [] })
  })

  it("um material válido é aceito com o título do candidato REAL, não o do modelo", () => {
    const selection = selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: REASON, title: "Título inventado pelo modelo" }], CANDIDATES)
    expect(selection.accepted).toEqual([{ materialId: A.materialId, title: A.title, reason: REASON }])
    expect(selection.rejected).toEqual([])
  })

  it("múltiplos materiais mantêm a ordem informada pela IA", () => {
    const selection = selectSupportMaterialRecommendations(
      [
        { materialId: B.materialId, reason: REASON },
        { materialId: A.materialId, reason: REASON },
      ],
      CANDIDATES,
    )
    expect(selection.accepted.map((item) => item.materialId)).toEqual([B.materialId, A.materialId])
  })

  it(`respeita o máximo de ${MAX_SUPPORT_MATERIALS_PER_FEEDBACK} por Feedback — o excedente é rejeitado com LIMIT_EXCEEDED`, () => {
    const selection = selectSupportMaterialRecommendations(
      CANDIDATES.map((candidate) => ({ materialId: candidate.materialId, reason: REASON })),
      CANDIDATES,
    )
    expect(selection.accepted).toHaveLength(MAX_SUPPORT_MATERIALS_PER_FEEDBACK)
    expect(selection.rejected).toEqual([{ materialId: D.materialId, code: "LIMIT_EXCEEDED" }])
  })

  it("deduplica por materialId (o título nunca identifica)", () => {
    const selection = selectSupportMaterialRecommendations(
      [
        { materialId: A.materialId, reason: REASON },
        { materialId: A.materialId, reason: `${REASON} Outra frase.` },
      ],
      CANDIDATES,
    )
    expect(selection.accepted).toHaveLength(1)
    expect(selection.rejected).toEqual([{ materialId: A.materialId, code: "DUPLICATE" }])
  })

  it("motivo é obrigatório, específico e curto", () => {
    expect(selectSupportMaterialRecommendations([{ materialId: A.materialId }], CANDIDATES).rejected).toEqual([{ materialId: A.materialId, code: "REASON_MISSING" }])
    expect(selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: "Útil." }], CANDIDATES).rejected).toEqual([{ materialId: A.materialId, code: "REASON_TOO_SHORT" }])
    expect(selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: "Leia este material para saber mais." }], CANDIDATES).rejected).toEqual([{ materialId: A.materialId, code: "REASON_GENERIC" }])
    expect(selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: "Este documento é relevante." }], CANDIDATES).rejected).toEqual([{ materialId: A.materialId, code: "REASON_GENERIC" }])
    expect(selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: "x".repeat(300) }], CANDIDATES).rejected).toEqual([{ materialId: A.materialId, code: "MALFORMED" }])
  })

  it("id inventado (fora dos candidatos desta execução) é descartado — inclusive um uuid válido de outro material", () => {
    const selection = selectSupportMaterialRecommendations(
      [
        { materialId: "mat_inventado", reason: REASON },
        { materialId: "99999999-9999-4999-8999-999999999999", reason: REASON },
        { materialId: A.materialId, reason: REASON },
      ],
      CANDIDATES,
    )
    expect(selection.accepted.map((item) => item.materialId)).toEqual([A.materialId])
    expect(selection.rejected).toEqual([
      { materialId: "mat_inventado", code: "MATERIAL_NOT_IN_CANDIDATES" },
      { materialId: "99999999-9999-4999-8999-999999999999", code: "MATERIAL_NOT_IN_CANDIDATES" },
    ])
  })

  it("URL ou link produzido pelo modelo não é consumido: o item aceito só carrega id, título real e motivo", () => {
    const selection = selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: REASON, url: "https://malicioso.example/x", href: "/qualquer" }], CANDIDATES)
    expect(selection.accepted[0]).toEqual({ materialId: A.materialId, title: A.title, reason: REASON })
    expect(Object.keys(selection.accepted[0]!)).not.toContain("url")
  })

  it("um item inválido não derruba os demais; entrada que não é lista é rejeitada inteira sem lançar", () => {
    const selection = selectSupportMaterialRecommendations([42, { materialId: B.materialId, reason: REASON }], CANDIDATES)
    expect(selection.accepted.map((item) => item.materialId)).toEqual([B.materialId])
    expect(selection.rejected).toEqual([{ materialId: null, code: "MALFORMED" }])
    expect(selectSupportMaterialRecommendations("texto", CANDIDATES)).toEqual({ accepted: [], rejected: [{ materialId: null, code: "MALFORMED" }] })
  })

  it("sem candidatos, nada é aceito mesmo que o modelo mande ids", () => {
    const selection = selectSupportMaterialRecommendations([{ materialId: A.materialId, reason: REASON }], [])
    expect(selection.accepted).toEqual([])
    expect(selection.rejected).toEqual([{ materialId: A.materialId, code: "MATERIAL_NOT_IN_CANDIDATES" }])
  })
})

describe("prompt de materiais de apoio", () => {
  it("lista os ids e títulos permitidos, proíbe inventar id/URL e admite zero recomendações — sem nenhuma URL", () => {
    const section = buildSupportMaterialsPromptSection([A, B])
    expect(section).toContain("MATERIAIS DE APOIO")
    expect(section).toContain("M1")
    expect(section).not.toContain(A.materialId)
    expect(section).toContain(`"${A.title}"`)
    expect(section).toContain("M2")
    expect(section).not.toContain(B.materialId)
    expect(section).toContain(`"${B.title}"`)
    expect(section).toMatch(/não invente materiais, não invente referências, não invente URLs/)
    expect(section).toMatch(/recomende somente materiais listados acima/)
    expect(section).toMatch(/exclusivamente pela referência informada \(M1, M2…\)/)
    expect(section).toMatch(/"supportMaterials": \[\]/)
    expect(section).toMatch(/zero recomendações é um resultado válido/)
    expect(section).not.toMatch(/https?:\/\//)
    expect(section).not.toMatch(/\/materiais\//)
  })

  it("campo de saída pede só materialId + reason e proíbe url/link/título", () => {
    const field = buildSupportMaterialsOutputField([A])
    expect(field).toContain('"supportMaterials"')
    expect(field).toContain('"materialId"')
    expect(field).toContain('"reason"')
    expect(field).toMatch(/Nunca inclua url, link ou título/)
  })

  it("sem candidatos, nenhuma seção entra no prompt (Feedback funciona exatamente como antes)", () => {
    expect(buildSupportMaterialsPromptSection([])).toBe("")
    expect(buildSupportMaterialsOutputField([])).toBe("")
  })
})

describe("capacidade comum — agregação, marcador de texto livre e leitura uniforme", () => {
  it("mergeSupportMaterialCandidates: A,B + B,C + D → A,B,C,D (dedupe por id, ordem de chegada)", () => {
    expect(mergeSupportMaterialCandidates([[A, B], [B, C], [D]])).toEqual([A, B, C, D])
    expect(mergeSupportMaterialCandidates([])).toEqual([])
    expect(mergeSupportMaterialCandidates([[{ materialId: A.materialId, title: "outro título, mesmo id" }], [A]])).toHaveLength(1)
  })

  it("seção de texto livre: ids e títulos, regras, zero válido, formato do marcador — sem URL", () => {
    const section = buildSupportMaterialsFreeTextPromptSection([A, B])
    expect(section).toContain("MATERIAIS DE APOIO DISPONÍVEIS")
    expect(section).toContain("M1")
    expect(section).not.toContain(A.materialId)
    expect(section).toContain(`"${B.title}"`)
    expect(section).toContain(SUPPORT_MATERIALS_MARKER)
    expect(section).toMatch(/não invente referência, material, URL nem link/)
    expect(section).toMatch(/zero recomendações é válido/)
    expect(section).not.toMatch(/https?:\/\//)
    expect(buildSupportMaterialsFreeTextPromptSection([])).toBe("")
  })

  it("extractSupportMaterialsMarker: separa o texto do JSON, tolera cerca de markdown, preserva o que vem depois em outra linha e nunca lança", () => {
    const raw = `Resposta ao usuário.\n${SUPPORT_MATERIALS_MARKER} [{"materialId":"${A.materialId}","reason":"${REASON}"}]\nSTRUCTURED_RESULT_JSON: {"a":1}`
    const extracted = extractSupportMaterialsMarker(raw)
    expect(extracted.text).toBe('Resposta ao usuário.\nSTRUCTURED_RESULT_JSON: {"a":1}')
    expect(extracted.raw).toEqual([{ materialId: A.materialId, reason: REASON }])
    expect(extractSupportMaterialsMarker("Sem marcador.")).toEqual({ text: "Sem marcador.", raw: undefined, markerStatus: "MARKER_NOT_FOUND" })
    expect(extractSupportMaterialsMarker(`Texto.\n${SUPPORT_MATERIALS_MARKER} \`\`\`json\n[]\n\`\`\``).raw).toEqual([])
    const malformed = extractSupportMaterialsMarker(`Texto.\n${SUPPORT_MATERIALS_MARKER} {isso não é json`)
    expect(malformed.text).toBe("Texto.")
    expect(selectSupportMaterialRecommendations(malformed.raw, CANDIDATES)).toEqual({ accepted: [], rejected: [{ materialId: null, code: "MALFORMED" }] })
  })

  it("readSupportMaterials: lê só recomendações válidas no topo de qualquer resultado (Agent, Orquestrador); nunca lança", () => {
    const valid = { materialId: A.materialId, title: A.title, reason: REASON }
    expect(readSupportMaterials({ kind: "monitoring", input: {}, supportMaterials: [valid, { materialId: "x" }, "lixo"] })).toEqual([valid])
    expect(readSupportMaterials({ text: "síntese", supportMaterials: [valid] })).toEqual([valid])
    expect(readSupportMaterials({ text: "sem materiais" })).toEqual([])
    expect(readSupportMaterials(null)).toEqual([])
    expect(readSupportMaterials("texto")).toEqual([])
  })
})

describe("handles de material (V1.2 — Zero-ID)", () => {
  it("o modelo escolhe por M1/M2 e a aplicação resolve para o materialId real; referência fora dos candidatos é rejeitada", () => {
    const selection = selectSupportMaterialRecommendations([{ materialId: "M2", reason: REASON }, { materialId: "m1", reason: REASON }, { materialId: "M9", reason: REASON }], CANDIDATES)
    expect(selection.accepted.map((item) => item.materialId)).toEqual([B.materialId, A.materialId])
    expect(selection.rejected).toEqual([{ materialId: "M9", code: "MATERIAL_NOT_IN_CANDIDATES" }])
  })
})
