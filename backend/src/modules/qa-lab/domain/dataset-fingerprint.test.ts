import { describe, expect, it } from "vitest"
import { compareFingerprints, datasetLabelOf, fingerprintOf } from "./dataset-fingerprint.js"
import { buildQaRunTelemetry } from "./qa-run-telemetry.js"

const base = { people: 2109, interactions: 22590, transcripts: 22590, measurements: 380000, indicatorDefinitions: 12, knowledgeDocuments: 14, subject: { interactions: 2, transcripts: 2, measurements: 21, periodStart: null, periodEnd: null } }

// V1.3.1 — §41–43/§58: mesma massa → comparação; massa diferente → aviso sem percentual; run antigo → UNKNOWN.
describe("dataset fingerprint e compatibilidade de benchmark", () => {
  it("hash determinístico sobre contagens (nunca conteúdo): mesma massa = mesmo hash; qualquer contagem diferente = hash diferente", () => {
    const now = new Date("2026-09-18T12:00:00Z")
    const a = fingerprintOf(base, now)
    expect(a).toMatchObject({ version: 1, computedAt: "2026-09-18T12:00:00.000Z" })
    expect(a.hash).toHaveLength(16)
    expect(fingerprintOf({ ...base }, new Date()).hash).toBe(a.hash)
    expect(fingerprintOf({ ...base, interactions: base.interactions + 90 }, now).hash).not.toBe(a.hash)
    expect(JSON.stringify(a)).not.toMatch(/Operador:|Cliente:/)
  })

  it("compatibilidade: COMPATIBLE autoriza percentuais; DATASET_CHANGED avisa e bloqueia; sem fingerprint = UNKNOWN", () => {
    const a = fingerprintOf(base, new Date())
    const b = fingerprintOf({ ...base, interactions: 1 }, new Date())
    expect(compareFingerprints(a, a).status).toBe("COMPATIBLE")
    expect(compareFingerprints(a, b)).toMatchObject({ status: "DATASET_CHANGED", message: expect.stringContaining("Dataset diferente") })
    expect(compareFingerprints(null, a).status).toBe("UNKNOWN")
    expect(compareFingerprints(a, null).status).toBe("UNKNOWN")
  })

  it("telemetria do run: comparison vem da referência (hash) e sufficiency do resumo da investigação (runs antigos → null)", () => {
    const a = fingerprintOf(base, new Date())
    const investigation = { toolCalls: 5, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED" as const, objective: { kind: "EXPLAIN_INDICATOR_DEVIATION" as const, question: "?", requiredScope: null, causal: true }, stopReason: "INSUFFICIENT_DATA" as const, sufficiency: { status: "INSUFFICIENT_DATA" as const, requiredScope: null, stopProposed: true, stopAccepted: true, rejections: [{ round: 2, reasons: ["causa comportamental sem evidência"] }], evidenceNeeds: [{ id: "E_INDICATOR_STATE", question: "q", requiredForClaimScope: null, status: "SATISFIED" as const, evidenceRefs: ["F1"], candidateTools: [], material: true, source: "RUNTIME" as const }, { id: "E_BEHAVIORAL_EVIDENCE", question: "q2", requiredForClaimScope: "INTERACTION_SPECIFIC" as const, status: "BLOCKED" as const, blockedBy: "NO_DATA" as const, evidenceRefs: [], candidateTools: [], material: true, source: "RUNTIME" as const }], hypotheses: [{ hypothesis: "h", status: "OPEN" as const, material: true, evidenceRefs: [], candidateTools: [] }], contradictoryEvidence: [], additionalEvidenceCouldChangeConclusion: true, additionalEvidenceCouldIncreaseRequiredScope: false, dataLimitations: ["x"], criticalFacts: [{ ref: "F1", kind: "INDICATOR_STATE", label: "valor × meta" }] } }
    const step = { index: 0, nodeId: "n", nodeType: "action", label: "Agent", status: "completed", startedAt: "", simulatedNow: "", durationMs: 1, outcome: null, nodeOutput: { text: "x", toolTrace: [], investigation }, aiCalls: 0, totalTokens: 0 } as never
    const telemetry = buildQaRunTelemetry({ aiCalls: [], steps: [step], datasetFingerprint: a }, { runId: "r", createdAt: "", requests: 1, toolCalls: 1, tokens: { input: 1, output: 1, total: 2, cached: null }, durationMs: 1, datasetFingerprint: { hash: "outro" } })
    expect(telemetry.comparison?.status).toBe("DATASET_CHANGED")
    expect(telemetry.sufficiency).toMatchObject({ objective: "EXPLAIN_INDICATOR_DEVIATION", objectiveLabel: "Explicar o desvio do indicador", stopReason: "INSUFFICIENT_DATA", stopReasonLabel: expect.stringContaining("Dados insuficientes"), status: "INSUFFICIENT_DATA", stopProposed: true, stopAccepted: true, needs: { satisfied: 1, open: 0, blocked: 1, notNeeded: 0 }, hypotheses: { open: 1, material: 1 }, contradictoryEvidence: false, additionalEvidenceCouldChangeConclusion: true })
    expect(telemetry.sufficiency?.rejections).toEqual([{ round: 2, reasons: ["causa comportamental sem evidência"] }])
    const legacy = buildQaRunTelemetry({ aiCalls: [], steps: [] }, { runId: "r", createdAt: "", requests: 1, toolCalls: 1, tokens: { input: 1, output: 1, total: 2, cached: null }, durationMs: 1 })
    expect(legacy.comparison?.status).toBe("UNKNOWN")
    expect(legacy.sufficiency).toBeNull()
  })
})

describe("dataset de diagnóstico no fingerprint (hotfix 2026-09-18)", () => {
  const base = { people: 10, interactions: 100, transcripts: 100, measurements: 1000, indicatorDefinitions: 5, knowledgeDocuments: 2 }
  const at = new Date("2026-09-18T12:00:00Z")

  it("mesmo dataset = comparável; dataset diferente (só o conteúdo mudou, contagens iguais) = DATASET_CHANGED com as versões; sem stamp = hash igual ao histórico", () => {
    const v1 = fingerprintOf({ ...base, dataset: { version: "DIAGNOSTIC_DATASET_V1", fingerprint: "a".repeat(64) } }, at)
    const v1Again = fingerprintOf({ ...base, dataset: { version: "DIAGNOSTIC_DATASET_V1", fingerprint: "a".repeat(64) } }, at)
    const v11 = fingerprintOf({ ...base, dataset: { version: "DIAGNOSTIC_DATASET_V1_1", fingerprint: "b".repeat(64) } }, at)
    expect(compareFingerprints(v1, v1Again)).toMatchObject({ status: "COMPATIBLE", currentDataset: "DIAGNOSTIC_DATASET_V1", referenceDataset: "DIAGNOSTIC_DATASET_V1" })
    const changed = compareFingerprints(v11, v1)
    expect(changed).toMatchObject({ status: "DATASET_CHANGED", currentDataset: "DIAGNOSTIC_DATASET_V1_1", referenceDataset: "DIAGNOSTIC_DATASET_V1" })
    expect(changed.message).toContain("Dataset diferente")
    expect(changed.message).toContain("DIAGNOSTIC_DATASET_V1 → DIAGNOSTIC_DATASET_V1_1")
    // A referência antiga guarda só { hash, dataset } no run: mesma comparação.
    expect(compareFingerprints(v11, { hash: v1.hash, dataset: { version: "DIAGNOSTIC_DATASET_V1", fingerprint: "a".repeat(64) } }).status).toBe("DATASET_CHANGED")
    // Fora da massa de diagnóstico não há chave `dataset`: o hash é o mesmo de antes do hotfix (runs históricos continuam comparáveis).
    expect(fingerprintOf(base, at).hash).toBe(fingerprintOf({ ...base }, at).hash)
    expect(compareFingerprints(fingerprintOf(base, at), fingerprintOf(base, at)).status).toBe("COMPATIBLE")
    // Run histórico sem fingerprint: UNKNOWN, nunca quebra.
    expect(compareFingerprints(v11, null)).toMatchObject({ status: "UNKNOWN", currentDataset: "DIAGNOSTIC_DATASET_V1_1", referenceDataset: null })
  })

  it("rótulo do dataset: APPLIED (versão + fingerprint resumido), NOT_APPLICABLE fora da massa, NOT_INFORMED em run antigo", () => {
    const stamped = fingerprintOf({ ...base, dataset: { version: "DIAGNOSTIC_DATASET_V1_1", fingerprint: "ab530ce1e398f01afb41d5144093ed29286d9f03025cc9d6069b4ab80b641b46" } }, at)
    expect(datasetLabelOf(stamped)).toEqual({ status: "APPLIED", version: "DIAGNOSTIC_DATASET_V1_1", fingerprint: "ab530ce1e398f01afb41d5144093ed29286d9f03025cc9d6069b4ab80b641b46", shortFingerprint: "ab530ce1…1b46", hash: stamped.hash })
    expect(datasetLabelOf(fingerprintOf(base, at))).toMatchObject({ status: "NOT_APPLICABLE", version: null })
    expect(datasetLabelOf(null)).toMatchObject({ status: "NOT_INFORMED", version: null, hash: null })
  })
})
