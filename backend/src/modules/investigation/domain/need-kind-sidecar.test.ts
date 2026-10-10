import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { frameExtractionOutputSchema, renderFrameExtractionInstructions, renderFramesForModel, renderPatternSynthesisInstructions, verifySemanticFrames, type InteractionSemanticFrame } from "./interaction-semantic-frame.js"
import { applyNeedKindAnnotations, buildNeedKindItems, NEED_KIND_SIDECAR_VERSION, NEED_KIND_SYSTEM_PROMPT, needKindProviderFailure, needKindTelemetryOf, renderNeedKindInput, validateNeedKindOutput, type NeedKindItem } from "./need-kind-sidecar.js"
import { renderSidecarInput, renderSidecarInstructions } from "./outcome-attribution.js"
import { projectTranscript, type ProjectedInteraction } from "./transcript-projection.js"

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
const transcript = "OPERADOR: Bom dia, em que posso ajudar?\nCLIENTE: Me mandaram um plano novo e quero entender o que muda.\nOPERADOR: Vou verificar.\nCLIENTE: E também quero cancelar o serviço extra.\nOPERADOR: Pronto."
const projected = new Map<string, ProjectedInteraction>([["I1", { interactionRef: "I1", interactionId: "I1", projection: projectTranscript(transcript) }]])
const phaseA = { frames: [{ interactionRef: "I1", customerNeeds: [
  { id: "N1", summary: "RESUMO-DO-MODELO entender plano", resolutionStatus: "UNRESOLVED", evidence: [{ interactionRef: "I1", turnRef: "T2", speaker: "CLIENTE", quote: "quero entender o que muda" }], resolutionEvidence: [] },
  { id: "N2", summary: "cancelar serviço", resolutionStatus: "RESOLVED", evidence: [{ interactionRef: "I1", turnRef: "T4", speaker: "CLIENTE", quote: "quero cancelar o serviço extra" }], resolutionEvidence: [{ interactionRef: "I1", turnRef: "T5", speaker: "OPERADOR", quote: "Pronto." }] },
], questions: [], answers: [], agentActions: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], findings: [] }] }
const verifiedFrames = () => verifySemanticFrames(frameExtractionOutputSchema.parse(phaseA).frames, projected).frames
const items = (): NeedKindItem[] => buildNeedKindItems(verifiedFrames(), projected)
const output = (needs: unknown[]) => JSON.stringify({ needs })
const provenance = { model: "gemini-3.1-flash-lite", requestSha256: "a".repeat(64) }

describe("sidecar needKind — entrada mínima", () => {
  it("item = evidência literal verificada + turnos ±1; summary e status nunca entram", () => {
    const [first] = items()
    expect(first).toEqual({ interactionRef: "I1", needRef: "N1", evidence: [{ turnRef: "T2", speaker: "CLIENTE", quote: "quero entender o que muda" }], previousTurn: { turnRef: "T1", speaker: "OPERADOR", text: "Bom dia, em que posso ajudar?" }, nextTurn: { turnRef: "T3", speaker: "OPERADOR", text: "Vou verificar." }, presentedTurns: ["T1", "T2", "T3"] })
    const input = renderNeedKindInput(items())
    expect(input).not.toMatch(/RESUMO-DO-MODELO|UNRESOLVED|RESOLVED/)
    expect(input.startsWith("Necessidades nesta análise: I1/N1, I1/N2\n\n=== I1 · necessidade N1 ===")).toBe(true)
  })
  it("prompt é o congelado no G-NK1", () => {
    expect(sha(NEED_KIND_SYSTEM_PROMPT).startsWith("61c3289b78f9bf41")).toBe(true)
    expect(NEED_KIND_SYSTEM_PROMPT).not.toMatch(/"interactionRef":"I\d+"/)
  })
})

describe("sidecar needKind — anotação e provenance", () => {
  it.each(["ACTION", "INFORMATION", "MIXED", "UNKNOWN"] as const)("%s válido é anotado com provenance completa", (kind) => {
    const frames = verifiedFrames()
    const validation = validateNeedKindOutput(output([{ interactionRef: "I1", needRef: "N1", needKind: kind.toLowerCase(), basisTurns: ["T2"] }, { interactionRef: "I1", needRef: "N2", needKind: "ACTION", basisTurns: ["T4"] }]), buildNeedKindItems(frames, projected))
    expect(applyNeedKindAnnotations(frames, validation, provenance)).toBe(2)
    expect(frames[0]!.customerNeeds[0]!.needKind).toEqual({ needKind: kind, basisTurns: ["T2"], status: "VALID", fallbackReason: null, source: NEED_KIND_SIDECAR_VERSION, model: provenance.model, requestSha256: provenance.requestSha256 })
  })
  it("anotação nunca altera summary/status/evidência nem cria necessidade", () => {
    const frames = verifiedFrames()
    const before = JSON.parse(JSON.stringify(frames)) as InteractionSemanticFrame[]
    const validation = validateNeedKindOutput(output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T2"] }, { interactionRef: "I1", needRef: "N2", needKind: "ACTION", basisTurns: ["T4"] }]), buildNeedKindItems(frames, projected))
    applyNeedKindAnnotations(frames, { ...validation, items: [...validation.items, { interactionRef: "I1", needRef: "N9", needKind: "INFORMATION", basisTurns: ["T2"], status: "VALID", fallbackReason: null, declaredNeedKind: "INFORMATION" }] }, provenance)
    const stripped = frames.map((frame) => ({ ...frame, customerNeeds: frame.customerNeeds.map((need) => { const copy = { ...need }; delete copy.needKind; return copy }) }))
    expect(stripped).toEqual(before)
    expect(frames[0]!.customerNeeds.map((need) => need.id)).toEqual(["N1", "N2"])
  })
})

describe("sidecar needKind — fail-closed (nenhum caminho de erro produz INFORMATION)", () => {
  const annotate = (validation: ReturnType<typeof validateNeedKindOutput>) => { const frames = verifiedFrames(); applyNeedKindAnnotations(frames, validation, provenance); return frames[0]!.customerNeeds.map((need) => need.needKind!) }
  it("item ausente → UNKNOWN (MISSING)", () => {
    const [n1, n2] = annotate(validateNeedKindOutput(output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T2"] }]), items()))
    expect(n1!.needKind).toBe("INFORMATION")
    expect(n2).toMatchObject({ needKind: "UNKNOWN", status: "FALLBACK", fallbackReason: "MISSING" })
  })
  it("JSON malformado (sem parser leniente), sem `needs`, sem texto → todos UNKNOWN", () => {
    for (const text of [`${output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T2"] }])}]}`, "{\"frames\":[]}", "", null]) {
      expect(annotate(validateNeedKindOutput(text, items())).map((item) => [item.needKind, item.fallbackReason])).toEqual([["UNKNOWN", "MALFORMED"], ["UNKNOWN", "MALFORMED"]])
    }
  })
  it("id inventado é descartado e contado; não anota nada fora do lote", () => {
    const validation = validateNeedKindOutput(output([{ interactionRef: "I7", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T2"] }, { interactionRef: "I1", needRef: "N3", needKind: "INFORMATION", basisTurns: ["T2"] }]), items())
    expect(validation.inventedRefs).toEqual(["I7/N1", "I1/N3"])
    expect(annotate(validation).map((item) => item.needKind)).toEqual(["UNKNOWN", "UNKNOWN"])
  })
  it("basisTurns fora dos turnos apresentados ou vazio → UNKNOWN mesmo com INFORMATION declarado", () => {
    const [n1, n2] = annotate(validateNeedKindOutput(output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T5"] }, { interactionRef: "I1", needRef: "N2", needKind: "INFORMATION", basisTurns: [] }]), items()))
    expect([n1, n2].map((item) => [item!.needKind, item!.fallbackReason])).toEqual([["UNKNOWN", "INVALID_BASIS"], ["UNKNOWN", "INVALID_BASIS"]])
  })
  it("enum inválido → UNKNOWN", () => {
    expect(annotate(validateNeedKindOutput(output([{ interactionRef: "I1", needRef: "N1", needKind: "INFO", basisTurns: ["T2"] }, { interactionRef: "I1", needRef: "N2", needKind: "ACTION", basisTurns: ["T4"] }]), items()))[0]).toMatchObject({ needKind: "UNKNOWN", fallbackReason: "INVALID_ENUM" })
  })
  it("erro do provider → todos UNKNOWN (PROVIDER_ERROR); telemetria FAILED", () => {
    const validation = needKindProviderFailure(items())
    expect(annotate(validation).map((item) => [item.needKind, item.fallbackReason])).toEqual([["UNKNOWN", "PROVIDER_ERROR"], ["UNKNOWN", "PROVIDER_ERROR"]])
    expect(needKindTelemetryOf(validation)).toMatchObject({ status: "FAILED", valid: 0, fallback: 2, byKind: { UNKNOWN: 2, INFORMATION: 0 } })
  })
  it("sem promoção falsa: nenhuma resposta inválida produz INFORMATION", () => {
    const hostile = [null, "", "nada", "{}", output([]), output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION" }]), output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: "T2" }]), output([{ interactionRef: "I1", needRef: "N1", needKind: "information?", basisTurns: ["T2"] }])]
    for (const text of hostile) expect(validateNeedKindOutput(text, items()).items.every((item) => item.needKind === "UNKNOWN")).toBe(true)
  })
})

describe("sidecar needKind — isolamento (Fase A byte-idêntica; needKind não gera finding/claim)", () => {
  it("instruções da Fase A, da Fase B e do sidecar de atribuição idênticas às anteriores ao sidecar (784fe37)", () => {
    expect(sha(renderFrameExtractionInstructions(["I1", "I2"]))).toBe("409f790dd9c5e464f09822da7658a1159cfc4077935c23b1321f54cd6ff1fe51")
    expect(sha(renderPatternSynthesisInstructions())).toBe("c08cb7886789d8abcf833dbdd36fa4fa864829b980953e254ec6d7c915d111ca")
    expect(sha(renderSidecarInstructions())).toBe("ef63ae2d77cd1e44e20587f4370a6ac9204f269e998e46acbca59cce597c5776")
  })
  it("o schema da Fase A não aceita needKind: o modelo da extração nunca consegue anotar intenção", () => {
    const injected = { frames: [{ ...phaseA.frames[0], customerNeeds: phaseA.frames[0]!.customerNeeds.map((need) => ({ ...need, needKind: { needKind: "INFORMATION", status: "VALID" } })) }] }
    const frames = verifySemanticFrames(frameExtractionOutputSchema.parse(injected).frames, projected).frames
    expect(frames[0]!.customerNeeds.every((need) => need.needKind === undefined)).toBe(true)
  })
  it("entradas da Fase B e do sidecar de atribuição não mudam com a anotação", () => {
    const plain = verifiedFrames()
    const annotated = verifiedFrames()
    applyNeedKindAnnotations(annotated, validateNeedKindOutput(output([{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T2"] }, { interactionRef: "I1", needRef: "N2", needKind: "ACTION", basisTurns: ["T4"] }]), items()), provenance)
    expect(renderFramesForModel(annotated)).toBe(renderFramesForModel(plain))
    expect(renderSidecarInput(annotated)).toBe(renderSidecarInput(plain))
  })
  it("nenhum módulo de src além do sidecar, do tipo e da fiação lê needKind", () => {
    const root = join(import.meta.dirname, "../../..")
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] })
    const readers = walk(root).filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && /\bneedKind\b|NEED_KIND/.test(readFileSync(path, "utf8"))).map((path) => path.slice(root.length + 1)).sort()
    expect(readers).toEqual(["config/env.ts", "modules/investigation/application/tool-context.ts", "modules/investigation/application/tools/interaction-tools.ts", "modules/investigation/domain/interaction-semantic-frame.ts", "modules/investigation/domain/need-kind-sidecar.ts", "shared/application/model-routing/ai-use-cases.ts"])
  })
})
