import { describe, expect, it } from "vitest"
import { acceptEnrichment, StructuralCheckpointExtractor, type CheckpointCandidate } from "./checkpoint-extraction.js"
import { reconcileCheckpoints, statusAfterReconciliation, type RegistryEntry } from "./checkpoint-reconciliation.js"
import { isInCheckpointScope } from "./checkpoint-scope.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { applyCheckpointGovernance, buildProcessCheckpointCatalog, CHECKPOINT_GOVERNANCE_VERSION, type CheckpointGovernanceSnapshot } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { verifyProcessAssessments } from "../../reliable-feedback/domain/process-assessment.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { isObservationEligibleForAnalytics } from "../../indicator-diagnosis/domain/observation-readiness.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import { REGISTRY_DOC_TITLE, REGISTRY_KB_V1, REGISTRY_KB_V2, RETENTION_WITH_PENALTY, RETENTION_WITHOUT_PENALTY, VISIT_TRANSCRIPT } from "../testing/checkpoint-registry-fixture.js"

/**
 * CHECKPOINT REGISTRY — extração, reconciliação, governança no runtime e cauda longa (sem modelo, sem banco). A prova contra o
 * Postgres (histórico, auditoria, escopo, regra oficial read-only) está em `checkpoint-registry-proof.test.ts`.
 */
const DOC = "doc-visita"
const extract = (content: string, version: number) => new StructuralCheckpointExtractor().extract({ organizationId: "org", documentId: DOC, documentTitle: REGISTRY_DOC_TITLE, version, content })
const byRequirement = (candidates: readonly CheckpointCandidate[], text: string) => candidates.find((candidate) => candidate.requirement.includes(text))!
const entryOf = (candidate: CheckpointCandidate, index: number, status: RegistryEntry["status"] = "ACTIVE"): RegistryEntry => ({
  definitionId: `def-${index}`, versionId: `ver-${index}`, definitionVersion: 1, status, checkpointRef: candidate.checkpointRef, kind: candidate.kind, segmentRole: candidate.segmentRole,
  sectionHeading: candidate.sectionHeading, listPosition: candidate.listPosition, sourceLiteral: candidate.sourceLiteral, requirement: candidate.requirement, applicability: candidate.applicability, canonicalBehavior: candidate.canonicalBehavior,
})

describe("Checkpoint Registry — extração (a base é a fonte da verdade)", () => {
  it("I/J) etapa de procedimento e regra de decisão viram candidatos; G/H) exemplo e objetivo nunca", async () => {
    const candidates = await extract(REGISTRY_KB_V1, 1)
    expect(candidates.map((candidate) => [candidate.name, candidate.kind, candidate.segmentRole, candidate.applicability, candidate.expectedEvidenceKind])).toEqual([
      ["Confirmar se haverá uma pessoa maior de idade disponível na residência para receber o…", "SENTENCE", "RULE", "Antes de confirmar a visita técnica", "OPERATOR_STATEMENT"],
      ["Confirmação do endereço completo do cliente", "LIST_ITEM", "RULE", null, "OPERATOR_STATEMENT"],
      ["Confirmação do telefone de contato do cliente", "LIST_ITEM", "RULE", null, "OPERATOR_STATEMENT"],
      ["Confirmação do ponto de referência do endereço", "LIST_ITEM", "RULE", null, "OPERATOR_STATEMENT"],
      ["Orientar o cliente sobre a multa antes de concluir o cancelamento", "SENTENCE", "RULE", "Quando houver fidelização vigente e multa aplicável", "OPERATOR_STATEMENT"],
      ["Não orientar o cliente apenas a aguardar", "LIST_ITEM", "AVOID", null, "AVOIDED_PHRASE"],
    ])
    // G/H — exemplo de fala e objetivo nunca viram obrigação.
    expect(candidates.some((candidate) => /Na hora da visita|Garantir que a visita/.test(candidate.sourceLiteral))).toBe(false)
    // O literal oficial é o da base, byte a byte; o código de etapa é o MESMO do catálogo do runtime.
    const chunks = chunkKnowledgeDocument({ id: DOC, title: REGISTRY_DOC_TITLE, content: REGISTRY_KB_V1 })
    const runtime = buildProcessCheckpointCatalog({ excerpts: chunks.map((chunk) => ({ documentId: DOC, documentTitle: REGISTRY_DOC_TITLE, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index })), contentOf: () => REGISTRY_KB_V1, subject: null, coveragePlan: false })
    expect(candidates.map((candidate) => candidate.checkpointRef)).toEqual(runtime.entries.map((entry) => entry.ref))
    for (const candidate of candidates) expect(REGISTRY_KB_V1).toContain(candidate.sourceLiteral)
  })

  it("B27) o enriquecimento (LLM, opcional) só nomeia — nunca muda a regra nem acrescenta obrigação ou número", async () => {
    const adult = byRequirement(await extract(REGISTRY_KB_V1, 1), "maior de idade")
    expect(acceptEnrichment(adult, { checkpointRef: adult.checkpointRef, name: "Maior de idade disponível para visita", applicability: "Visita técnica presencial" })).toMatchObject({ name: "Maior de idade disponível para visita", applicability: "Visita técnica presencial", sourceLiteral: adult.sourceLiteral, requirement: adult.requirement })
    expect(acceptEnrichment(adult, { checkpointRef: adult.checkpointRef, name: "Sempre exigir documento do adulto", applicability: "Visitas acima de 2 horas" })).toMatchObject({ name: adult.name, applicability: adult.applicability })
  })
})

describe("Checkpoint Registry — reconciliação (A–F, nunca só igualdade de texto)", () => {
  it("A/B/C/D/E) v1 → v2: mantido, reescrito, modificado, novo e removido", async () => {
    const v1 = await extract(REGISTRY_KB_V1, 1)
    const v2 = await extract(REGISTRY_KB_V2, 2)
    const registry = v1.map((candidate, index) => entryOf(candidate, index))
    const { items, counts } = reconcileCheckpoints(registry, v2)
    expect(counts).toEqual({ UNCHANGED: 3, SEMANTICALLY_EQUIVALENT: 1, MODIFIED: 1, NEW: 1, REMOVED: 1, AMBIGUOUS: 0 })
    const kindOf = (text: string) => items.find((item) => "candidate" in item && item.candidate.requirement.includes(text))!
    expect(kindOf("endereço completo")).toMatchObject({ kind: "UNCHANGED", match: { previous: { definitionId: "def-1" } } })
    // B — mesma obrigação, outra redação: mesma identidade lógica, sem mudança material.
    expect(kindOf("telefone de contato")).toMatchObject({ kind: "SEMANTICALLY_EQUIVALENT", match: { previous: { definitionId: "def-2" } }, materialChanges: [] })
    // C — "maior de idade" → "maior de 18 anos": a mesma obrigação lógica (mesma seção), mudança MATERIAL (número) → revisão.
    expect(kindOf("maior de 18 anos")).toMatchObject({ kind: "MODIFIED", match: { previous: { definitionId: "def-0" } }, materialChanges: ["NUMBERS"] })
    expect(kindOf("janela de horário")).toMatchObject({ kind: "NEW" })
    expect(items.find((item) => item.kind === "REMOVED")).toMatchObject({ previous: { definitionId: "def-3", requirement: "Confirme o ponto de referência do endereço" } })
    // A regra da multa e o "não orientar a aguardar" continuam (texto idêntico).
    expect(kindOf("multa")).toMatchObject({ kind: "UNCHANGED" })
    expect(kindOf("apenas a aguardar")).toMatchObject({ kind: "UNCHANGED" })
  })

  it("estado depois da reconciliação: ativa continua ativa (mantida/equivalente); modificada, nova e ambígua esperam o administrador; rejeitada continua rejeitada", async () => {
    const v1 = await extract(REGISTRY_KB_V1, 1)
    const registry = v1.map((candidate, index) => entryOf(candidate, index, index === 2 ? "REJECTED" : "ACTIVE"))
    const { items } = reconcileCheckpoints(registry, await extract(REGISTRY_KB_V2, 2))
    const statusOf = (text: string) => { const item = items.find((entry) => "candidate" in entry && entry.candidate.requirement.includes(text))!; return item.kind === "REMOVED" ? null : statusAfterReconciliation(item) }
    expect([statusOf("endereço completo"), statusOf("telefone"), statusOf("18 anos"), statusOf("janela")]).toEqual(["ACTIVE", "REJECTED", "NEEDS_REVIEW", "PROPOSED"])
  })

  it("F) um candidato que corresponde a duas regras com força parecida → AMBÍGUO (revisão humana); nenhuma das duas é removida em silêncio", () => {
    const candidate = (requirement: string, ref: string): CheckpointCandidate => ({ checkpointRef: ref, documentId: DOC, documentTitle: REGISTRY_DOC_TITLE, kind: "SENTENCE", segmentRole: "RULE", sectionHeading: "7. Encerramento", chunkIndex: 0, leadIn: null, listPosition: null, sourceLiteral: `${requirement}.`, requirement, name: requirement, applicability: null, expectedEvidenceKind: "OPERATOR_STATEMENT", canonicalBehavior: null })
    const previous = [entryOf(candidate("Informar o protocolo ao cliente", "CP-0000000001"), 1), entryOf(candidate("Informar o prazo ao cliente", "CP-0000000002"), 2)]
    const { items, counts } = reconcileCheckpoints(previous, [candidate("Informar o protocolo e o prazo ao cliente", "CP-0000000003")])
    expect(counts).toMatchObject({ AMBIGUOUS: 1, REMOVED: 0, NEW: 0 })
    expect(items[0]).toMatchObject({ kind: "AMBIGUOUS" })
    expect((items[0] as { matches: { previous: RegistryEntry }[] }).matches.map((match) => match.previous.definitionId).sort()).toEqual(["def-1", "def-2"])
  })

  it("regra que vira proibição (ou o contrário) nunca é a mesma obrigação", () => {
    const rule: CheckpointCandidate = { checkpointRef: "CP-000000000a", documentId: DOC, documentTitle: REGISTRY_DOC_TITLE, kind: "LIST_ITEM", segmentRole: "RULE", sectionHeading: "5. Condutas", chunkIndex: 0, leadIn: null, listPosition: 1, sourceLiteral: "- Orientar o cliente a aguardar a análise.", requirement: "Orientar o cliente a aguardar a análise", name: "x", applicability: null, expectedEvidenceKind: "OPERATOR_ACTION", canonicalBehavior: null }
    const { counts } = reconcileCheckpoints([entryOf(rule, 1)], [{ ...rule, checkpointRef: "CP-000000000b", segmentRole: "AVOID", sourceLiteral: "- Não orientar o cliente a aguardar a análise.", requirement: "Não orientar o cliente a aguardar a análise", expectedEvidenceKind: "AVOIDED_PHRASE" }])
    expect(counts).toMatchObject({ NEW: 1, REMOVED: 1, SEMANTICALLY_EQUIVALENT: 0, MODIFIED: 0 })
  })
})

describe("Checkpoint Registry — escopo (associação, nunca cópia)", () => {
  it("N) a mesma definição atende várias equipes; sem associação vale onde a base vale; colaborador desconhecido nunca some", () => {
    const scopes = [{ scopeType: "TEAM" as const, businessDomainId: null, teamId: "team-suporte", subteamId: null }, { scopeType: "SUBTEAM" as const, businessDomainId: null, teamId: null, subteamId: "sub-visita" }]
    expect(isInCheckpointScope(scopes, { businessDomainId: null, teamId: "team-suporte", subteamId: null, known: true })).toBe(true)
    expect(isInCheckpointScope(scopes, { businessDomainId: null, teamId: "team-retencao", subteamId: "sub-visita", known: true })).toBe(true)
    expect(isInCheckpointScope(scopes, { businessDomainId: null, teamId: "team-retencao", subteamId: null, known: true })).toBe(false)
    expect(isInCheckpointScope([], { businessDomainId: null, teamId: "qualquer", subteamId: null, known: true })).toBe(true)
    expect(isInCheckpointScope(scopes, { businessDomainId: null, teamId: null, subteamId: null, known: false })).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Runtime: checkpoint ATIVO + transcrição → especialista (mockado) → Reliability → ProcessObservation — sem código por regra
// ---------------------------------------------------------------------------------------------------------------------
async function runtimeContext(content: string, version: number) {
  const candidates = await extract(content, version)
  const chunks = chunkKnowledgeDocument({ id: DOC, title: REGISTRY_DOC_TITLE, content })
  const presented = chunks.map((chunk) => ({ documentId: DOC, documentTitle: REGISTRY_DOC_TITLE, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
  const governance: CheckpointGovernanceSnapshot = {
    version: CHECKPOINT_GOVERNANCE_VERSION, governed: [{ documentId: DOC, knowledgeVersion: version }], pendingExtraction: [], scopeEvaluated: true,
    active: candidates.map((candidate, index) => ({ ref: candidate.checkpointRef, documentId: DOC, definitionId: `def-${index}`, versionId: `ver-${index}`, definitionVersion: 1, knowledgeVersion: version, name: candidate.name, criticality: "NORMAL", feedbackEnabled: true, analyticsEnabled: true, highlight: false })),
  }
  const published = new Map([[DOC, { documentId: DOC, title: REGISTRY_DOC_TITLE, content, version }]])
  return { candidates, presented, governance, published }
}
function assessment(checkpoints: RawProcessAssessment["processes"][number]["checkpoints"]): RawProcessAssessment {
  return { processes: [{ documentTitle: REGISTRY_DOC_TITLE, product: null, checkpoints }], applicability: [], validation: { contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V3", completeness: "COMPLETE", invalidItems: [], normalizations: [], missingRequired: [] } } as unknown as RawProcessAssessment
}

describe("Checkpoint Registry — B34/B35) cauda longa pelo caminho genérico", () => {
  it("B34/O) 'maior de idade disponível': especialista relaciona a fala ao checkpoint; Reliability aceita; observação persistível pela identidade lógica", async () => {
    const { candidates, presented, governance, published } = await runtimeContext(REGISTRY_KB_V1, 1)
    const adult = byRequirement(candidates, "maior de idade")
    const verified = verifyProcessAssessments({
      sources: [{ sourceRef: "S", presented, governance, assessment: assessment([{ checkpointRef: adult.checkpointRef, requirement: adult.requirement, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Na hora da visita vai ter alguém de maior em casa para receber o técnico?"], knowledgeQuote: adult.sourceLiteral, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }]) }],
      interactionId: "int-visita", transcript: VISIT_TRANSCRIPT, published,
    })
    const checkpoint = verified.checkpoints.find((entry) => entry.source?.ref === adult.checkpointRef)!
    expect(checkpoint).toMatchObject({ status: "FOLLOWED", knowledge: { applicability: "VERIFIED" }, source: { registry: { definitionId: "def-0", versionId: "ver-0" } } })
    expect(checkpoint.canonical ?? null).toBeNull()
    const [observation] = observationsFrom("op", [{ interactionId: "int-visita", assessment: verified }])
    expect(observation).toMatchObject({ practiceKey: "CHECKPOINT:def-0", checkpointDefinitionId: "def-0", checkpointVersionId: "ver-0", checkpointRef: adult.checkpointRef, status: "FOLLOWED", analyticsStatus: "VERIFIED" })
    expect(isObservationEligibleForAnalytics(observation!)).toBe(true)
  })

  it("B35) multa: aplicável e orientada → cumprida; sem fidelização → não aplicável (nenhum ponto, nenhuma observação); 'não falou multa' nunca vira lacuna sozinho", async () => {
    const { candidates, presented, governance, published } = await runtimeContext(REGISTRY_KB_V1, 1)
    const penalty = byRequirement(candidates, "multa")
    const raw = (status: "FOLLOWED" | "NOT_FOLLOWED" | "NOT_APPLICABLE", evidence: string[], evidenceType: "OBSERVED" | "OMISSION" | null) => assessment([{ checkpointRef: penalty.checkpointRef, requirement: penalty.requirement, status, evidenceType, transcriptEvidence: evidence, knowledgeQuote: penalty.sourceLiteral, knowledgeDetailQuote: null, guidance: { source: status === "NOT_APPLICABLE" ? "NO_GROUNDED_GUIDANCE" : "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }] as RawProcessAssessment["processes"][number]["checkpoints"])
    const verify = (transcript: string, source: RawProcessAssessment) => verifyProcessAssessments({ sources: [{ sourceRef: "S", presented, governance, assessment: source }], interactionId: "int-ret", transcript, published })
    const followed = verify(RETENTION_WITH_PENALTY, raw("FOLLOWED", ["Operador: Como ainda existe fidelização, se você cancelar hoje haverá cobrança da multa prevista no contrato."], "OBSERVED"))
    expect(followed.checkpoints[0]).toMatchObject({ status: "FOLLOWED", knowledge: { applicability: "VERIFIED" }, source: { registry: { definitionId: "def-4" } } })
    const notApplicable = verify(RETENTION_WITHOUT_PENALTY, raw("NOT_APPLICABLE", [], null))
    expect(notApplicable.checkpoints[0]!.status).toBe("NOT_APPLICABLE")
    expect(observationsFrom("op", [{ interactionId: "int-ret", assessment: notApplicable }])).toEqual([])
    // Regra CONDICIONAL ("Quando houver…"): a ausência da fala sobre multa não prova omissão.
    const claimedOmission = verify(RETENTION_WITHOUT_PENALTY, raw("NOT_FOLLOWED", [], "OMISSION"))
    expect(claimedOmission.checkpoints[0]!.status).not.toBe("NOT_FOLLOWED")
    expect(observationsFrom("op", [{ interactionId: "int-ret", assessment: claimedOmission }])).toEqual([])
  })

  it("documento governado: etapa não ativa no registry não é oferecida nem aceita; documento não governado segue o catálogo de sempre", async () => {
    const { candidates, presented, governance, published } = await runtimeContext(REGISTRY_KB_V1, 1)
    const reference = byRequirement(candidates, "ponto de referência")
    const withoutReference = { ...governance, active: governance.active.filter((entry) => entry.ref !== reference.checkpointRef) }
    const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => REGISTRY_KB_V1, subject: null, coveragePlan: false })
    expect(applyCheckpointGovernance(catalog, withoutReference).entries.map((entry) => entry.ref)).not.toContain(reference.checkpointRef)
    expect(applyCheckpointGovernance(catalog, null).entries).toHaveLength(catalog.entries.length)
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", presented, governance: withoutReference, assessment: assessment([{ checkpointRef: reference.checkpointRef, requirement: reference.requirement, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Perfeito, então fica confirmado para quinta."], knowledgeQuote: reference.sourceLiteral, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }]) }], interactionId: "int-x", transcript: VISIT_TRANSCRIPT, published })
    expect(observationsFrom("op", [{ interactionId: "int-x", assessment: verified }]).filter((observation) => observation.analyticsStatus === "VERIFIED")).toEqual([])
  })

  it("analytics desligado pelo administrador: o fato fica gravado, fora da agregação", async () => {
    const { candidates, presented, governance, published } = await runtimeContext(REGISTRY_KB_V1, 1)
    const adult = byRequirement(candidates, "maior de idade")
    const off = { ...governance, active: governance.active.map((entry) => (entry.ref === adult.checkpointRef ? { ...entry, analyticsEnabled: false } : entry)) }
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", presented, governance: off, assessment: assessment([{ checkpointRef: adult.checkpointRef, requirement: adult.requirement, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Na hora da visita vai ter alguém de maior em casa para receber o técnico?"], knowledgeQuote: adult.sourceLiteral, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }]) }], interactionId: "int-v", transcript: VISIT_TRANSCRIPT, published })
    const [observation] = observationsFrom("op", [{ interactionId: "int-v", assessment: verified }])
    expect(observation).toMatchObject({ analyticsStatus: "REJECTED", analyticsReasons: ["CHECKPOINT_ANALYTICS_DISABLED"] })
    expect(isObservationEligibleForAnalytics(observation!)).toBe(false)
  })
})
