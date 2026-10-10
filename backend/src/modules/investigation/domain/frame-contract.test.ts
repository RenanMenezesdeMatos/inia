import { describe, expect, it } from "vitest"
import { assessFrameContract, EXAMPLE_INTERACTION_REF, HANDLE_FORMAT, summarizeFrameContract } from "./frame-contract.js"
import { renderFrameExtractionInstructions, verifySemanticFrames } from "./interaction-semantic-frame.js"
import { projectTranscript, type ProjectedInteraction } from "./transcript-projection.js"

/**
 * V1.4.6.8 — SEMANTIC FRAME CONTRACT HYGIENE & COMPLETENESS. Sem LLM: o prompt é renderizado localmente e a completude é
 * medida sobre frames declarados em fixture.
 */
const HANDLE_SETS: string[][] = [
  ["I10", "I9", "I8", "I7", "I6", "I5", "I4", "I3"],
  ["I1", "I2"],
  ["I6"],
  ["I1"],
  Array.from({ length: 25 }, (_, index) => `I${index + 1}`),
  ["I3", "I12", "I7"],
]
const handleOccurrences = (text: string, handle: string) => text.match(new RegExp(`(?<![A-Za-z0-9_])${handle}(?![0-9])`, "g"))?.length ?? 0
/** Regiões DINÂMICAS: "SOMENTE: <lista> — nunca" e "referência (<lista>), nessa ordem". */
const dynamicRegions = (handles: string[]) => [`SOMENTE: ${handles.join(", ")} — nunca`, `um para cada referência (${handles.join(", ")}), nessa ordem`]

describe("V1.4.6.8 — higiene do contrato da Fase A (exemplos nunca usam handle real)", () => {
  it("o placeholder de exemplo nunca tem formato de handle de execução", () => {
    expect(HANDLE_FORMAT.test(EXAMPLE_INTERACTION_REF)).toBe(false)
    expect(HANDLE_FORMAT.test(EXAMPLE_INTERACTION_REF.toUpperCase())).toBe(false)
    for (const handles of HANDLE_SETS) expect(handles).not.toContain(EXAMPLE_INTERACTION_REF)
  })

  it("parte estática (sem handles) não contém NENHUM valor com formato de handle — só o placeholder", () => {
    const staticOnly = renderFrameExtractionInstructions([])
    expect(staticOnly.match(/(?<![A-Za-z0-9_])I\d+(?![0-9])/g)).toBeNull()
    expect(staticOnly.split(EXAMPLE_INTERACTION_REF).length - 1).toBe(4)
  })

  it.each(HANDLE_SETS.map((handles) => [handles.join(","), handles] as const))("handles %s aparecem SÓ nas duas regiões dinâmicas, na ordem dada", (_label, handles) => {
    const prompt = renderFrameExtractionInstructions(handles)
    for (const region of dynamicRegions(handles)) expect(prompt).toContain(region)
    let withoutDynamic = prompt
    for (const region of dynamicRegions(handles)) withoutDynamic = withoutDynamic.replace(region, "")
    for (const handle of handles) {
      expect(handleOccurrences(prompt, handle)).toBe(2)
      expect(handleOccurrences(withoutDynamic, handle)).toBe(0)
    }
    expect(prompt.split(EXAMPLE_INTERACTION_REF).length - 1).toBe(4)
  })

  it("placeholder presente nos 4 lugares de exemplo (cabeçalho, frame, evidence de evento, UNIT)", () => {
    const prompt = renderFrameExtractionInstructions(["I1", "I2"])
    expect(prompt).toContain(`"=== ${EXAMPLE_INTERACTION_REF} · … ==="`)
    expect(prompt).toContain(`{"frames":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}",`)
    expect(prompt).toContain(`"evidence":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}","turnRef":"T12"`)
    expect(prompt).toContain(`UNIT = {"interactionRef":"${EXAMPLE_INTERACTION_REF}","turnRef":"T3"`)
  })

  it("renderização determinística e só a lista muda entre conjuntos de handles", () => {
    const handles = HANDLE_SETS[0]!
    expect(renderFrameExtractionInstructions(handles)).toBe(renderFrameExtractionInstructions([...handles]))
    const a = renderFrameExtractionInstructions(["I1", "I2"]).replace("I1, I2", "#").replace("I1, I2", "#").replace("EXATAMENTE 2", "EXATAMENTE #")
    const b = renderFrameExtractionInstructions(["I7", "I8"]).replace("I7, I8", "#").replace("I7, I8", "#").replace("EXATAMENTE 2", "EXATAMENTE #")
    expect(a).toBe(b)
  })

  it("regressão do caso conhecido (I10…I3): I6 só nas listas reais, nunca como exemplo", () => {
    const handles = ["I10", "I9", "I8", "I7", "I6", "I5", "I4", "I3"]
    const prompt = renderFrameExtractionInstructions(handles)
    expect(handleOccurrences(prompt, "I6")).toBe(2)
    expect(prompt).not.toContain('"interactionRef":"I6"')
    expect(prompt).not.toContain('"=== I6 · … ==="')
    expect(prompt.indexOf(`SOMENTE: ${handles.join(", ")}`)).toBeGreaterThan(0)
  })
})

describe("V1.4.6.8 — placeholder nunca é aceito como referência real (fail-closed)", () => {
  const projected: ReadonlyMap<string, ProjectedInteraction> = new Map([["I1", { interactionRef: "I1", interactionId: "id-1", projection: projectTranscript("CLIENTE: Quero cancelar a linha hoje.\nOPERADOR: Posso te ajudar com o cancelamento agora.") }]])
  const unit = (ref: string, quote: string) => ({ interactionRef: ref, turnRef: "T2", speaker: "OPERADOR", quote })
  const frameOf = (interactionRef: string, evidenceRef: string) => ({ interactionRef, customerNeeds: [], questions: [], answers: [], agentActions: [], agentStatements: [{ id: "D1", summary: "oferece ajuda com o cancelamento", evidence: [unit(evidenceRef, "Posso te ajudar com o cancelamento agora.")] }], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], findings: [] })

  it("frame com o placeholder como interactionRef é descartado (interação desconhecida) e contado como inesperado", () => {
    const declared = [frameOf(EXAMPLE_INTERACTION_REF, EXAMPLE_INTERACTION_REF)]
    const result = verifySemanticFrames(declared as never, projected)
    expect(result.telemetry.drops.frameForUnknownInteraction).toBe(1)
    expect(result.frames.map((frame) => `${frame.interactionRef}:${frame.source}:${frame.empty}`)).toEqual(["I1:NOT_RETURNED:true"])
    const contract = assessFrameContract(declared, ["I1"])
    expect(contract).toMatchObject({ status: "INCOMPLETE", missingInteractionRefs: ["I1"], unexpectedInteractionRefs: [EXAMPLE_INTERACTION_REF], exampleRefEchoed: 1 })
  })

  it("evidência citando o placeholder dentro de um frame real é rejeitada (WRONG_INTERACTION) — nunca vira evidência de outra interação", () => {
    const result = verifySemanticFrames([frameOf("I1", EXAMPLE_INTERACTION_REF)] as never, projected)
    expect(result.telemetry.observationsCount).toBe(0)
    expect(result.verification.rejectionReasons.WRONG_INTERACTION).toBe(1)
  })
})

describe("V1.4.6.8 — completude estrutural (JSON válido ≠ contrato completo)", () => {
  const EXPECTED = ["I10", "I9", "I8", "I7", "I6", "I5", "I4", "I3"]
  const obs = { agentActions: [{ id: "A1" }] }
  const full = () => EXPECTED.map((interactionRef) => ({ interactionRef, ...obs }))

  it("8/8 corretos → COMPLETE", () => {
    expect(assessFrameContract(full(), EXPECTED)).toMatchObject({ status: "COMPLETE", frameCoveragePercent: 100, missingFrameCount: 0, emptyFrameCount: 0, duplicateFrameCount: 0, unexpectedFrameCount: 0 })
  })

  it("7/8 → INCOMPLETE com o ausente listado", () => {
    expect(assessFrameContract(full().slice(0, 7), EXPECTED)).toMatchObject({ status: "INCOMPLETE", missingInteractionRefs: ["I3"], frameCoveragePercent: 87.5 })
  })

  it("1/8 → INCOMPLETE (7 ausentes)", () => {
    expect(assessFrameContract([{ interactionRef: "I6", ...obs }], EXPECTED)).toMatchObject({ status: "INCOMPLETE", missingFrameCount: 7, uniqueExpectedReturned: 1, frameCoveragePercent: 12.5 })
  })

  it("8/8 + duplicado → INCOMPLETE; observações do duplicado contadas como descartadas", () => {
    const result = assessFrameContract([...full(), { interactionRef: "I6", agentActions: [{}, {}], customerSignals: [{}] }], EXPECTED)
    expect(result).toMatchObject({ status: "INCOMPLETE", duplicateInteractionRefs: ["I6"], duplicateFrameCount: 1, duplicateFrameObservationsDropped: 3, frameCoveragePercent: 100 })
  })

  it("8/8 + inesperados (I0, I2) → INCOMPLETE; inesperados não contam na cobertura", () => {
    const result = assessFrameContract([...full(), { interactionRef: "I2" }, { interactionRef: "I0" }, { interactionRef: "I0" }], EXPECTED)
    expect(result).toMatchObject({ status: "INCOMPLETE", unexpectedInteractionRefs: ["I2", "I0"], unexpectedFrameCount: 3, duplicateFrameCount: 0, uniqueExpectedReturned: 8 })
  })

  it("MISSING ≠ EMPTY: frame vazio é estruturalmente presente (não quebra o contrato), mas contado à parte", () => {
    const frames = full().map((frame) => (frame.interactionRef === "I9" || frame.interactionRef === "I8" ? { interactionRef: frame.interactionRef } : frame)).filter((frame) => frame.interactionRef !== "I3")
    const result = assessFrameContract(frames, EXPECTED)
    expect(result).toMatchObject({ missingInteractionRefs: ["I3"], emptyInteractionRefs: ["I9", "I8"], missingFrameCount: 1, emptyFrameCount: 2 })
    const allEmpty = assessFrameContract(EXPECTED.map((interactionRef) => ({ interactionRef })), EXPECTED)
    expect(allEmpty).toMatchObject({ status: "COMPLETE", emptyFrameCount: 8, missingFrameCount: 0 })
  })

  it("duplicado vazio depois de um frame com conteúdo: o PRIMEIRO decide se é vazio (como o runtime)", () => {
    const result = assessFrameContract([...full(), { interactionRef: "I6" }], EXPECTED)
    expect(result).toMatchObject({ emptyFrameCount: 0, duplicateFrameCount: 1, duplicateFrameObservationsDropped: 0 })
  })

  it("resposta que não parseou → INCOMPLETE, todos ausentes", () => {
    expect(assessFrameContract(null, EXPECTED)).toMatchObject({ parsed: false, status: "INCOMPLETE", missingFrameCount: 8, frameCoveragePercent: 0 })
  })

  it("normaliza caixa/espaço como o runtime; refs sem formato de handle não vão para a telemetria", () => {
    const result = assessFrameContract([...full().slice(1), { interactionRef: " i10 ", ...obs }, { interactionRef: "texto livre do modelo" }], EXPECTED)
    expect(result.missingFrameCount).toBe(0)
    expect(result.unexpectedInteractionRefs).toEqual(["TEXTO LIVRE DO MODELO"])
    expect(summarizeFrameContract(result).unexpectedInteractionRefs).toEqual([])
    expect(summarizeFrameContract(result).unexpectedFrameCount).toBe(1)
  })
})

describe("V1.4.6.8 — agregação da completude na execução (resumo seguro: só contagens)", () => {
  it("soma inicial × final (depois do retry), ausentes, vazios, duplicados e inesperados de várias chamadas", async () => {
    const { semanticCoverageOf } = await import("../application/investigation-runtime.js")
    const { emptySemanticTelemetry } = await import("./interaction-semantic-frame.js")
    const expected = ["I1", "I2", "I3"]
    const callA = emptySemanticTelemetry()
    callA.frameContract = { initial: summarizeFrameContract(assessFrameContract([{ interactionRef: "I1", agentActions: [{}] }], expected)), retryAttempted: true, afterRetry: summarizeFrameContract(assessFrameContract([{ interactionRef: "I1", agentActions: [{}] }, { interactionRef: "I2" }, { interactionRef: "I3", agentActions: [{}] }], expected)) }
    const callB = emptySemanticTelemetry()
    callB.frameContract = { initial: summarizeFrameContract(assessFrameContract([{ interactionRef: "I1", agentActions: [{}] }, { interactionRef: "I1", agentActions: [{}, {}] }, { interactionRef: "I2", agentActions: [{}] }, { interactionRef: "I3", agentActions: [{}] }, { interactionRef: "I0" }], expected)), retryAttempted: false, afterRetry: null }
    const legacy = emptySemanticTelemetry()
    const ledger = [callA, callB, legacy].map((semantic) => ({ signals: { interactionAnalysis: { semantic } } }))
    expect(semanticCoverageOf(ledger as never)?.frameContract).toEqual({ calls: 2, initialComplete: 0, finalComplete: 1, retries: 1, expectedFrames: 6, initialMissingFrames: 2, finalMissingFrames: 0, emptyFrames: 1, duplicateFrames: 1, duplicateFrameObservationsDropped: 2, unexpectedFrames: 1, exampleRefEchoed: 0 })
    expect(semanticCoverageOf([{ signals: { interactionAnalysis: { semantic: legacy } } }] as never)?.frameContract).toBeUndefined()
  })
})
