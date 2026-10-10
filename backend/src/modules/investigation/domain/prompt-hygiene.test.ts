import { describe, expect, it } from "vitest"
import { EXAMPLE_INTERACTION_REF, HANDLE_FORMAT } from "./frame-contract.js"
import { renderFrameExtractionInstructions, renderFramesForModel, renderPatternSynthesisInstructions, verifySemanticFrames } from "./interaction-semantic-frame.js"
import { renderSidecarInput, renderSidecarInstructions } from "./outcome-attribution.js"
import { projectTranscript, type ProjectedInteraction } from "./transcript-projection.js"
import { ANALYSIS_INSTRUCTIONS, TEMPORAL_ANALYSIS_INSTRUCTIONS } from "../application/tools/interaction-tools.js"

/**
 * V1.4.6.9 — SEMANTIC PROMPT CONTRACT HYGIENE (transversal, sem LLM). Princípio: exemplos em prompts de produção nunca
 * usam um valor que também pode ser um identificador válido de execução. Para interactionRef o exemplo é SEMPRE o
 * placeholder canônico `EXAMPLE_INTERACTION_REF`; handles reais só chegam pelas regiões DINÂMICAS (lista da Fase A,
 * entrada renderizada da Fase B e do sidecar).
 */
const HANDLE_TOKEN = /(?<![A-Za-z0-9_])I\d+(?![0-9])/g
const HANDLE_SETS: string[][] = [
  ["I1"],
  ["I6"],
  ["I10"],
  ["I10", "I9", "I8", "I7", "I6", "I5", "I4", "I3"],
  Array.from({ length: 25 }, (_, index) => `I${index + 1}`),
  ["I12", "I3", "I7"],
]
const occurrences = (text: string, handle: string) => text.match(new RegExp(`(?<![A-Za-z0-9_])${handle}(?![0-9])`, "g"))?.length ?? 0

/** Contratos ESTÁTICOS de produção que ilustram interactionRef (nenhum recebe handles; os reais vêm pela entrada). */
const STATIC_CONTRACTS: [name: string, text: string, placeholders: number][] = [
  ["Fase A (parte fixa)", renderFrameExtractionInstructions([]), 4],
  ["Fase B — síntese de patterns", renderPatternSynthesisInstructions(), 3],
  ["sidecar de atribuição", renderSidecarInstructions(), 2],
  ["contrato de padrões (pares)", ANALYSIS_INSTRUCTIONS, 1],
  ["adendo temporal (Fase B / pares)", TEMPORAL_ANALYSIS_INSTRUCTIONS, 2],
]

/** Frames verificados com os handles dados (uma observação por interação), para renderizar as entradas dinâmicas. */
function framesFor(handles: string[]) {
  const projected: ReadonlyMap<string, ProjectedInteraction> = new Map(handles.map((ref, index) => [ref, { interactionRef: ref, interactionId: `id-${index}`, projection: projectTranscript(`CLIENTE: Preciso da segunda via da conta ${index}.\nOPERADOR: Vou enviar a segunda via agora mesmo ${index}.`) }]))
  const declared = handles.map((ref, index) => ({ interactionRef: ref, customerNeeds: [{ id: "N1", summary: "pede a segunda via da conta", resolutionStatus: "UNRESOLVED", evidence: [{ interactionRef: ref, turnRef: "T1", speaker: "CLIENTE", quote: `Preciso da segunda via da conta ${index}.` }], resolutionEvidence: [] }], questions: [], answers: [], agentActions: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], findings: [] }))
  return verifySemanticFrames(declared as never, projected).frames
}

describe("V1.4.6.9 — contratos estáticos de produção não usam handle real como exemplo", () => {
  it.each(STATIC_CONTRACTS)("%s: nenhum valor com formato de handle; só o placeholder canônico", (_name, text, placeholders) => {
    expect(text.match(HANDLE_TOKEN)).toBeNull()
    expect(text.split(EXAMPLE_INTERACTION_REF).length - 1).toBe(placeholders)
  })

  it("renderização determinística", () => {
    expect(renderPatternSynthesisInstructions()).toBe(renderPatternSynthesisInstructions())
    expect(renderSidecarInstructions()).toBe(renderSidecarInstructions())
  })

  it("o placeholder canônico nunca satisfaz o formato de handle real", () => {
    expect(HANDLE_FORMAT.test(EXAMPLE_INTERACTION_REF)).toBe(false)
  })
})

describe("V1.4.6.9 — handles reais só nas regiões dinâmicas, na ordem dada", () => {
  it.each(HANDLE_SETS.map((handles) => [handles.join(","), handles] as const))("handles %s", (_label, handles) => {
    const frames = framesFor(handles)
    const phaseBInput = renderFramesForModel(frames)
    const sidecarInput = renderSidecarInput(frames)
    for (const input of [phaseBInput, sidecarInput]) {
      expect(input).not.toContain(EXAMPLE_INTERACTION_REF)
      const positions = handles.map((handle) => input.search(new RegExp(`(?<![A-Za-z0-9_])${handle}(?![0-9])`)))
      expect(positions.every((position) => position >= 0)).toBe(true)
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    }
    // Sistema (estático) + entrada (dinâmica): o handle real vem SÓ da entrada.
    for (const [, text] of STATIC_CONTRACTS) for (const handle of handles) expect(occurrences(text, handle)).toBe(0)
  })
})
