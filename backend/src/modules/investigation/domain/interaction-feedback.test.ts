import { describe, expect, it } from "vitest"
import type { ClaimCandidate } from "./claim-candidates.js"
import { extractDecisionSignals } from "./decision-critical-facts.js"
import { assertDisplaySafe, composeInteractionFeedback, dedupeFeedbackItems, displayableView, documentIdResolverFromHandles, PROCEDURAL_MATCHING_DELIVERY_POLICY, KNOWLEDGE_LINK_POLICY, FALLBACK_INTERACTION_LABEL, FEEDBACK_QUOTE_MAX_CHARS, FeedbackRedactionPendingError, INTERNAL_REF_PATTERN, interactionDisplayLabel, proceduralLineageFromEvaluations, proceduralLineageFromSignalItems, SINGLE_INTERACTION_UNCERTAINTY, type ProceduralLineage } from "./interaction-feedback.js"
import type { InteractionFinding, InteractionSemanticFrame, SemanticObservation } from "./interaction-semantic-frame.js"
import type { ProceduralEvaluation } from "./procedural-semantics.js"

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
const obs = (id: string, kind: SemanticObservation["kind"], speaker: string, turn: string, quote = `trecho verificado do turno ${turn}`): SemanticObservation => ({ id, kind, summary: `RESUMO-DO-MODELO ${id} (I6)`, evidence: [unit(turn, speaker, quote)] })
let seq = 0
const finding = (kind: InteractionFinding["kind"], ownership: InteractionFinding["ownership"], observations: SemanticObservation[], extra: Partial<InteractionFinding> = {}): InteractionFinding => {
  seq += 1
  return { id: `F${seq}`, interactionRef: "I6", kind, summary: "SUMMARY-DO-MODELO cita I6 e SF2", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: observations.length, evidenceCount: observations.length }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${seq}`, ownership, ...extra }
}
const frame = (observations: SemanticObservation[], findings: InteractionFinding[], extra: Partial<InteractionSemanticFrame> = {}): InteractionSemanticFrame => ({
  interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", source: "MODEL",
  customerNeeds: observations.filter((item) => item.kind === "CUSTOMER_NEED") as never, questions: [], answers: [], agentActions: observations.filter((item) => item.kind === "AGENT_ACTION") as never,
  agentStatements: observations.filter((item) => item.kind === "AGENT_STATEMENT") as never, commitments: [], customerSignals: observations.filter((item) => item.kind === "CUSTOMER_SIGNAL") as never,
  procedureAssertions: observations.filter((item) => item.kind === "PROCEDURE_ASSERTION") as never, interactionEvents: [], findings, empty: observations.length === 0 && findings.length === 0, ...extra,
})
const compose = (f: InteractionSemanticFrame, extra: { lineage?: Map<string, ProceduralLineage> | undefined; candidates?: ClaimCandidate[] | undefined; label?: string | undefined } = {}) => composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: f, interactionLabel: extra.label ?? "14/03/2026 · Segunda via", sourceRun: "run-1", proceduralLineage: extra.lineage, claimCandidates: extra.candidates })
const lineage = (status: ProceduralLineage["status"], partial: Partial<ProceduralLineage> = {}) => new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "Antes de acessar informações protegidas, o operador deve explicar a validação.", documentId: "11111111-2222-4333-8444-555555555555", ...partial }]])

const action = obs("A1", "AGENT_ACTION", "OPERADOR", "T4")
const statement = obs("D1", "AGENT_STATEMENT", "OPERADOR", "T19")
const signal = obs("S1", "CUSTOMER_SIGNAL", "CLIENTE", "T20")
const need = obs("N1", "CUSTOMER_NEED", "CLIENTE", "T3")
const assertion = obs("P1", "PROCEDURE_ASSERTION", "OPERADOR", "T15")

describe("InteractionFeedback V1 — seções (só kind + ownership + evidência + lineage)", () => {
  it("STRENGTH do operador → STRENGTH, REINFORCEMENT, revisão não obrigatória, status HAS_POINTS", () => {
    const feedback = compose(frame([action], [finding("STRENGTH", "AGENT", [action])]))
    expect(feedback.items[0]).toMatchObject({ section: "STRENGTH", audience: "COLLABORATOR", guidance: { source: "REINFORCEMENT", mandatory: false, knowledge: null } })
    expect(feedback).toMatchObject({ status: "HAS_POINTS", review: { required: false, reasons: ["STRENGTH_ONLY"] }, delivery: { collaborator: true, notification: true, reviewBeforeCollaborator: false } })
  })
  it("STRENGTH sem observação do operador ou com ownership não AGENT nunca vira elogio individual", () => {
    expect(compose(frame([signal], [finding("STRENGTH", "AGENT", [signal])])).items[0]!.section).toBe("NEUTRAL_CONTEXT")
    expect(compose(frame([action], [finding("STRENGTH", "INTERACTION", [action])])).items[0]!.section).toBe("NEUTRAL_CONTEXT")
  })
  it("FRICTION AGENT → OPPORTUNITY com COACHING_SUGGESTION não obrigatória e revisão obrigatória", () => {
    const feedback = compose(frame([statement, signal], [finding("FRICTION", "AGENT", [statement, signal])]))
    expect(feedback.items[0]).toMatchObject({ section: "OPPORTUNITY", guidance: { source: "COACHING_SUGGESTION", mandatory: false }, interpretation: { polarity: "NEGATIVE", ownership: "AGENT" } })
    expect(feedback.review).toEqual({ required: true, reasons: ["OPPORTUNITY_PRESENT", "NEGATIVE_AGENT_FINDING"] })
    expect(feedback.delivery.reviewBeforeCollaborator).toBe(true)
  })
  it("UNRESOLVED_NEED AGENT → OPPORTUNITY (coaching); CONTRADICTION idem", () => {
    expect(compose(frame([need, statement], [finding("UNRESOLVED_NEED", "AGENT", [need, statement])])).items[0]!.section).toBe("OPPORTUNITY")
    expect(compose(frame([statement], [finding("CONTRADICTION", "AGENT", [statement])])).items[0]!.section).toBe("OPPORTUNITY")
  })
  it("ownership não AGENT (INTERACTION/CUSTOMER/PROCESS/UNKNOWN/ausente) nunca vira crítica — NEUTRAL_CONTEXT, supervisor", () => {
    for (const owner of ["INTERACTION", "CUSTOMER", "PROCESS", "UNKNOWN", undefined] as const) for (const kind of ["FRICTION", "CONTRADICTION", "UNRESOLVED_NEED"] as const) {
      const item = compose(frame([statement], [finding(kind, owner, [statement])])).items[0]!
      expect(item).toMatchObject({ section: "NEUTRAL_CONTEXT", audience: "SUPERVISOR_ONLY", guidance: { source: "NONE" } })
    }
  })
  it("INTERACTION_FRICTION / UNRESOLVED_OUTCOME → NEUTRAL_CONTEXT; sozinhos = NOTHING_MATERIAL sem entrega nem notificação", () => {
    const feedback = compose(frame([signal, need], [finding("INTERACTION_FRICTION", "INTERACTION", [signal]), finding("UNRESOLVED_OUTCOME", "PROCESS", [need])]))
    expect(feedback.items.map((item) => item.section)).toEqual(["NEUTRAL_CONTEXT", "NEUTRAL_CONTEXT"])
    expect(feedback).toMatchObject({ status: "NOTHING_MATERIAL", review: { required: false, reasons: ["NO_COLLABORATOR_CONTENT"] }, delivery: { collaborator: false, notification: false, audit: true } })
  })
  it("PROCEDURAL_QUESTION → UNCERTAINTY (supervisor), nunca erro", () => {
    const feedback = compose(frame([assertion], [finding("PROCEDURAL_QUESTION", "UNKNOWN", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "POTENTIAL_DIVERGENCE", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })]))
    expect(feedback.items[0]).toMatchObject({ section: "UNCERTAINTY", audience: "SUPERVISOR_ONLY", guidance: { source: "NONE" } })
    expect(feedback.uncertainties.map((item) => item.code)).toContain("PROCEDURE_PENDING_VERIFICATION")
    expect(feedback.status).toBe("NOTHING_MATERIAL")
  })
})

describe("InteractionFeedback V1 — lineage procedimental", () => {
  const divergence = () => finding("PROCEDURAL_DIVERGENCE", "AGENT", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })
  it("com lineage completo → OPPORTUNITY KB_RULE obrigatória; só o título é exibível; ids na provenance; revisão obrigatória", () => {
    const feedback = compose(frame([assertion], [divergence()]), { lineage: lineage("CONTRADICTED") })
    const item = feedback.items[0]!
    expect(item).toMatchObject({ section: "OPPORTUNITY", guidance: { source: "KB_RULE", mandatory: true, knowledge: { documentTitle: "Procedimento de Validação" } } })
    expect(item.provenance.proceduralLineage).toMatchObject({ ruleRef: "KR3", documentRef: "K5", assertionRef: "P1" })
    expect(feedback.review.reasons).toEqual(["OPPORTUNITY_PRESENT", "KB_RULE_GUIDANCE", "NEGATIVE_AGENT_FINDING"])
    expect(feedback.uncertainties.map((entry) => entry.code)).toContain("PROCEDURAL_COVERAGE_PARTIAL")
  })
  it("sem lineage, lineage incompleto, status diferente ou regra divergente → EXCLUDED, nunca KB_RULE", () => {
    const cases: (Map<string, ProceduralLineage> | undefined)[] = [undefined, new Map(), lineage("CONTRADICTED", { documentTitle: "" }), lineage("CONTRADICTED", { documentRef: "" }), lineage("CONTRADICTED", { ruleRef: "" }), lineage("CONSISTENT"), lineage("CONTRADICTED", { ruleRef: "KR9" })]
    for (const entry of cases) {
      const feedback = compose(frame([assertion], [divergence()]), { lineage: entry })
      expect(feedback.items[0]).toMatchObject({ section: "EXCLUDED", audience: "AUDIT_ONLY", guidance: { source: "NONE" } })
      expect(feedback.items.some((item) => item.guidance.source === "KB_RULE")).toBe(false)
      expect(feedback.status).toBe("NOTHING_MATERIAL")
    }
  })
  it("aderência verificada (STRENGTH procedimental) exige lineage CONSISTENT; sem ele é excluída", () => {
    const adherence = () => finding("STRENGTH", "AGENT", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONSISTENT", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })
    expect(compose(frame([assertion], [adherence()]), { lineage: lineage("CONSISTENT") }).items[0]).toMatchObject({ section: "STRENGTH", guidance: { source: "REINFORCEMENT", knowledge: { documentTitle: "Procedimento de Validação" } } })
    expect(compose(frame([assertion], [adherence()])).items[0]!.section).toBe("EXCLUDED")
  })
  it("lineage vem das avaliações do runtime e do sinal gravado — sem regra, sem lineage", () => {
    const rule = { ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", subject: "validação", modality: "REQUIRED", condition: null, action: null, valueText: null, value: null, quote: "trecho literal" } as const
    const evaluations = [{ interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED", rule }, { interactionRef: "I7", assertionRef: "P1", status: "INSUFFICIENT_KNOWLEDGE", rule: null }] as unknown as ProceduralEvaluation[]
    expect([...proceduralLineageFromEvaluations(evaluations).keys()]).toEqual(["I6/P1"])
    expect([...proceduralLineageFromSignalItems([{ interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentRef: "K5", documentTitle: "Doc" }, { interactionRef: "I7", assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentRef: null, documentTitle: "Doc" }]).keys()]).toEqual(["I6/P1"])
  })
  it("o sinal gravado no trace passa a carregar o lineage (regra, documento, título, trecho) e do finding até o feedback", () => {
    const data = {
      analyzedTranscriptCount: 1,
      procedural: { telemetry: { evaluations: 1 }, evaluations: [{ interactionRef: "I6", assertionRef: "P1", assertion: { modality: "ASSERTED_ABSENCE_OF_REQUIREMENT" }, status: "CONTRADICTED", rule: { modality: "REQUIRED", ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", quote: "trecho literal da base" }, conditionMatch: "MATCH" }] },
      semantic: { telemetry: { version: "x" }, frames: [{ interactionRef: "I6", findings: [{ id: "FP1", kind: "PROCEDURAL_DIVERGENCE", handle: "SF1", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação" } }] }] },
    }
    const analysis = extractDecisionSignals("analyze_interactions", data)!.interactionAnalysis!
    expect(analysis.procedural!.items![0]).toMatchObject({ ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "trecho literal da base" })
    expect(analysis.findingRefs![0]!.procedural).toEqual({ status: "CONTRADICTED", hasRule: true, assertionRef: "P1", ruleRef: "KR3", documentTitle: "Procedimento de Validação" })
    const feedback = compose(frame([assertion], [finding("PROCEDURAL_DIVERGENCE", "AGENT", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })]), { lineage: proceduralLineageFromSignalItems(analysis.procedural!.items!) })
    expect(feedback.items[0]!.guidance.source).toBe("KB_RULE")
  })
})

describe("InteractionFeedback V1 — FACT, provenance, status e contrato", () => {
  it("finding sem evidência verificada é excluído; frame sem observação = INSUFFICIENT_EVIDENCE; frame não devolvido idem", () => {
    const orphan = finding("FRICTION", "AGENT", [], { observationRefs: ["X9"] })
    const feedback = compose(frame([action], [orphan]))
    expect(feedback.items[0]).toMatchObject({ section: "EXCLUDED" })
    expect(feedback.items[0]!.provenance.sectionRule).toMatch(/sem evidência verificada/)
    expect(feedback.status).toBe("NOTHING_MATERIAL")
    expect(compose(frame([], [])).status).toBe("INSUFFICIENT_EVIDENCE")
    const missing = compose(frame([], [], { source: "NOT_RETURNED" }))
    expect(missing).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", delivery: { collaborator: false, notification: false, audit: true } })
    expect(missing.uncertainties.map((item) => item.code)).toContain("FRAME_NOT_RETURNED")
  })
  it("FACT = só evidência verificada (turno, falante, trecho literal curto, tipo); redaction pendente; nunca display-safe", () => {
    const long = obs("A2", "AGENT_ACTION", "OPERADOR", "T8", "x".repeat(FEEDBACK_QUOTE_MAX_CHARS + 50))
    const feedback = compose(frame([action, long], [finding("STRENGTH", "AGENT", [action, long])]))
    const [first, second] = feedback.items[0]!.fact
    expect(first).toEqual({ turnRef: "T4", speaker: "OPERADOR", quote: "trecho verificado do turno T4", truncated: false, evidenceType: "AGENT_ACTION", redaction: { required: true, status: "PENDING" } })
    expect(second!.quote.length).toBe(FEEDBACK_QUOTE_MAX_CHARS)
    expect(long.evidence[0]!.quote.startsWith(second!.quote)).toBe(true)
    expect(second!.truncated).toBe(true)
    for (const fact of feedback.items[0]!.fact) expect(() => assertDisplaySafe(fact)).toThrow(FeedbackRedactionPendingError)
  })
  it("refs internas (I-n, SF-n, SP-n, CC-n, F-n, K-n, KR-n) só na provenance; summary do modelo nunca entra; rótulo com handle é trocado", () => {
    const candidate = { ref: "CC2", support: { type: "FINDING", ref: "SF_PLACEHOLDER" }, kind: "PROCEDURAL_DIVERGENCE", polarity: "NEGATIVE", maximumClaimScope: "INTERACTION_SPECIFIC", safeMeaning: "divergência na interação I6" } as unknown as ClaimCandidate
    const divergence = finding("PROCEDURAL_DIVERGENCE", "AGENT", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })
    ;(candidate.support as { ref: string }).ref = divergence.handle!
    const feedback = compose(frame([action, assertion, signal], [finding("STRENGTH", "AGENT", [action]), divergence, finding("INTERACTION_FRICTION", "INTERACTION", [signal])]), { lineage: lineage("CONTRADICTED"), candidates: [candidate], label: "Interação I6 (SF2)" })
    for (const audience of ["COLLABORATOR", "SUPERVISOR"] as const) {
      // O único id real permitido na visão é o do MATERIAL dentro do href (link canônico) — nunca o id da interação.
      const text = JSON.stringify(displayableView(feedback, audience), (key, value) => (key === "href" ? "HREF" : value))
      expect(text).not.toMatch(INTERNAL_REF_PATTERN)
      expect(text).not.toContain("RESUMO-DO-MODELO")
      expect(text).not.toContain("SUMMARY-DO-MODELO")
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    expect(feedback.interaction.label).toBe(FALLBACK_INTERACTION_LABEL)
    expect(feedback.provenance).toMatchObject({ interactionRef: "I6", labelRejected: true, candidateRefs: ["CC2"] })
    expect(feedback.items[1]!.provenance).toMatchObject({ findingHandle: divergence.handle, candidateRef: "CC2", candidateSafeMeaning: "divergência na interação I6", candidatePolarityConflict: false })
    // KB_RULE bloqueado para entrega: fora da visão do colaborador; o supervisor vê com o bloqueio indicado.
    expect(displayableView(feedback, "COLLABORATOR").items.map((item) => item.section)).toEqual(["STRENGTH"])
    expect(displayableView(feedback, "SUPERVISOR").items.map((item) => [item.section, item.deliveryBlocked])).toEqual([["STRENGTH", null], ["OPPORTUNITY", "PROCEDURAL_MATCHING_NOT_VALIDATED"], ["NEUTRAL_CONTEXT", null]])
    expect(interactionDisplayLabel({ localDate: "2026-03-14", subject: "Segunda via" })).toBe("14/03/2026 · Segunda via")
  })
  it("wording sempre null; incerteza de interação única sempre presente; escopo nunca sobe mesmo com candidato de escopo maior", () => {
    const strength = finding("STRENGTH", "AGENT", [action])
    const candidate = { ref: "CC1", support: { type: "FINDING", ref: strength.handle }, kind: "STRENGTH", polarity: "NEGATIVE", maximumClaimScope: "EMPLOYEE_PATTERN", safeMeaning: "x" } as unknown as ClaimCandidate
    const feedback = compose(frame([action], [strength]), { candidates: [candidate] })
    expect(feedback.items.every((item) => item.wording === null)).toBe(true)
    expect(feedback.summaryWording).toBeNull()
    expect(feedback.uncertainties[0]).toEqual({ code: "SINGLE_INTERACTION", text: SINGLE_INTERACTION_UNCERTAINTY })
    expect(feedback.items[0]!.interpretation).toMatchObject({ scope: "INTERACTION_SPECIFIC", polarity: "POSITIVE" })
    expect(feedback.items[0]!.provenance.candidatePolarityConflict).toBe(true)
    expect(feedback.items[0]!.section).toBe("STRENGTH")
  })
  it("nenhuma promoção estrutural: o compositor não muda kind, ownership, atribuição nem o frame; materialidade inclui todo item exibível, na ordem", () => {
    const action2 = obs("A2", "AGENT_ACTION", "OPERADOR", "T8")
    const findings = [finding("STRENGTH", "AGENT", [action]), finding("FRICTION", "AGENT", [statement]), finding("STRENGTH", "AGENT", [action2]), finding("INTERACTION_FRICTION", "INTERACTION", [signal])]
    const f = frame([action, action2, statement, signal], findings)
    const before = JSON.stringify(f)
    const feedback = compose(f)
    expect(JSON.stringify(f)).toBe(before)
    expect(feedback.items.map((item) => [item.interpretation.kind, item.interpretation.ownership, item.provenance.attribution])).toEqual(findings.map((item) => [item.kind, item.ownership, item.attribution]))
    expect(feedback.items.map((item) => item.section)).toEqual(["STRENGTH", "OPPORTUNITY", "STRENGTH", "NEUTRAL_CONTEXT"])
    expect(feedback.counts).toEqual({ STRENGTH: 2, OPPORTUNITY: 1, NEUTRAL_CONTEXT: 1, UNCERTAINTY: 0, EXCLUDED: 0 })
    expect(compose(f)).toEqual(feedback)
  })
})

describe("InteractionFeedback V1 — isolado (sem fiação nesta etapa)", () => {
  it("só o pipeline controlado (modules/interaction-feedback, V1.5.0) e a camada de confiabilidade do Workflow (modules/reliable-feedback, V1.5.12 — reusa contrato/validadores/projeção de display) importam o compositor/contrato do redator — Output/Workflow/feedback legado intactos", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs")
    const { join, resolve } = await import("node:path")
    const root = resolve(__dirname, "../../..")
    const importers: string[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name) && !name.startsWith("interaction-feedback.") && !name.startsWith("interaction-feedback-writer.") && !name.startsWith("feedback-display-evidence.") && /from "[^"]*\/(?:interaction-feedback(?:-writer)?|feedback-display-evidence)\.js"/.test(readFileSync(path, "utf8"))) importers.push(path) } }
    walk(root)
    // O nome do ARQUIVO precisa bater inteiro (V1.5.10: "generate-interaction-feedback.js" não é o compositor).
    expect(importers.filter((path) => !path.includes(join("modules", "interaction-feedback")) && !path.includes(join("modules", "reliable-feedback")))).toEqual([])
  })
})

describe("InteractionFeedback V1 — knowledgeRef com link, KB_RULE bloqueado para entrega, deduplicação estrutural", () => {
  const divergence = () => finding("PROCEDURAL_DIVERGENCE", "AGENT", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })
  it("knowledgeRef = título + regra + href da rota canônica + NEW_TAB; sem id do documento, nenhum link", () => {
    const withId = compose(frame([assertion], [divergence()]), { lineage: lineage("CONTRADICTED") }).items[0]!
    expect(withId.guidance.knowledge).toEqual({ documentTitle: "Procedimento de Validação", ruleRef: "KR3", href: "/materiais/11111111-2222-4333-8444-555555555555", openBehavior: "NEW_TAB" })
    expect(KNOWLEDGE_LINK_POLICY).toMatchObject({ target: "_blank", rel: "noopener noreferrer", modelMayWriteHref: false })
    const withoutId = compose(frame([assertion], [divergence()]), { lineage: lineage("CONTRADICTED", { documentId: null }) }).items[0]!
    expect(withoutId.guidance.knowledge).toEqual({ documentTitle: "Procedimento de Validação", ruleRef: "KR3", href: null, openBehavior: null })
    expect(withoutId.section).toBe("OPPORTUNITY")
  })
  it("o id vem do mapa de handles da execução (K-n → id real); handle desconhecido = sem link", () => {
    const resolve = documentIdResolverFromHandles([{ handle: "K5", kind: "K", realId: "doc-real" }, { handle: "I1", kind: "I", realId: "int-real" }])
    const items = [{ interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Doc" }, { interactionRef: "I7", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR4", documentRef: "K9", documentTitle: "Doc" }]
    const map = proceduralLineageFromSignalItems(items, resolve)
    expect(map.get("I6/P1")!.documentId).toBe("doc-real")
    expect(map.get("I7/P1")!.documentId).toBeNull()
    expect(proceduralLineageFromSignalItems(items).get("I6/P1")!.documentId).toBeNull()
  })
  it("KB_RULE composto para auditoria mas NÃO entregue: revisão exigida não libera; sem outro item, nada vai ao colaborador", () => {
    const feedback = compose(frame([assertion], [divergence()]), { lineage: lineage("CONTRADICTED") })
    expect(PROCEDURAL_MATCHING_DELIVERY_POLICY).toEqual({ status: "BLOCKED", reason: "PROCEDURAL_MATCHING_NOT_VALIDATED", scope: ["PROCEDURAL_DIVERGENCE", "PROCEDURAL_ADHERENCE"], humanReviewUnblocks: false, writerGateCriterion: false })
    expect(feedback.items[0]).toMatchObject({ section: "OPPORTUNITY", guidance: { source: "KB_RULE" }, delivery: { collaborator: false, blocked: "PROCEDURAL_MATCHING_NOT_VALIDATED" } })
    expect(feedback).toMatchObject({ status: "HAS_POINTS", review: { required: true }, delivery: { collaborator: false, notification: false, audit: true, reviewBeforeCollaborator: false } })
    const mixed = compose(frame([action, assertion], [finding("STRENGTH", "AGENT", [action]), divergence()]), { lineage: lineage("CONTRADICTED") })
    expect(mixed.delivery).toMatchObject({ collaborator: true, notification: true })
    expect(mixed.items.map((item) => item.delivery.collaborator)).toEqual([true, false])
  })
  it("2 findings duplicados → 1 item exibível → provenance aponta para ambos; itens distintos nunca se fundem", () => {
    const first = divergence()
    const second = divergence()
    const feedback = compose(frame([assertion], [first, second]), { lineage: lineage("CONTRADICTED") })
    expect(feedback.items).toHaveLength(1)
    expect(feedback.items[0]!.provenance.findingRef).toBe(`I6/${first.id}`)
    expect(feedback.items[0]!.provenance.collapsedFindings.map((item) => item.findingRef)).toEqual([`I6/${second.id}`])
    expect(feedback.provenance).toMatchObject({ findingRefs: [`I6/${first.id}`, `I6/${second.id}`], collapsedDuplicates: 1 })
    expect(feedback.counts.OPPORTUNITY).toBe(1)
    const strengthA = finding("STRENGTH", "AGENT", [action])
    const strengthB = finding("STRENGTH", "AGENT", [action])
    expect(compose(frame([action], [strengthA, strengthB])).items).toHaveLength(1)
    const other = obs("A3", "AGENT_ACTION", "OPERADOR", "T9")
    expect(compose(frame([action, other], [finding("STRENGTH", "AGENT", [action]), finding("STRENGTH", "AGENT", [other])])).items).toHaveLength(2)
    expect(compose(frame([action], [finding("STRENGTH", "AGENT", [action]), finding("FRICTION", "AGENT", [action])])).items).toHaveLength(2)
    expect(dedupeFeedbackItems([])).toEqual([])
  })
})

describe("V1.4.9d — DELIVERY EVIDENCE READINESS (código, sobre a evidência já projetada para exibição)", () => {
  // Número SEM contexto de protocolo (a V1.4.9e mascara "protocolo é N"): continua não mascarável → retido.
  const protocolOnly = obs("A9", "AGENT_ACTION", "OPERADOR", "T9", "Anota aí esse número: 1234567890123.")
  const operatorLine = obs("D5", "AGENT_STATEMENT", "OPERADOR", "T5", "Deixa comigo, vou gerar aqui e enviar pelo canal que você me passar.")
  const customerReaction = obs("S5", "CUSTOMER_SIGNAL", "CLIENTE", "T6", "Pro rata? Moça, fala em português, por favor.")
  const overlap = obs("E1", "INTERACTION_EVENT", "EVENTO", "T7", "[Falas sobrepostas: o operador começa a falar antes de o cliente concluir.]")
  const customerNeed = obs("N5", "CUSTOMER_NEED", "CLIENTE", "T3", "Quero bloquear o chip que foi roubado ontem à noite.")
  const conduct = obs("A5", "AGENT_ACTION", "OPERADOR", "T21", "Vou transferir você e já registro tudo o que verificamos aqui.")
  const item = (kind: InteractionFinding["kind"], observations: SemanticObservation[]) => compose(frame(observations, [finding(kind, "AGENT", observations)]))
  const ready = (feedback: ReturnType<typeof compose>) => ({ readiness: feedback.items[0]!.readiness.status, delivery: feedback.items[0]!.delivery, state: feedback.delivery.state })

  it("STRENGTH: com evidência exibível do operador → READY; sem nenhum trecho exibível (retido) → BLOCKED, sem entrega/notificação, finding preservado", () => {
    expect(ready(item("STRENGTH", [action]))).toEqual({ readiness: "READY", delivery: { collaborator: true, blocked: null }, state: "DELIVERABLE" })
    const blocked = item("STRENGTH", [protocolOnly])
    expect(ready(blocked)).toEqual({ readiness: "INSUFFICIENT_DISPLAY_EVIDENCE", delivery: { collaborator: false, blocked: "INSUFFICIENT_DISPLAY_EVIDENCE" }, state: "NOT_DELIVERABLE" })
    expect(blocked.items[0]!.readiness).toMatchObject({ missing: ["OPERATOR_BEHAVIOR"], withheld: 1, displayed: { total: 0 } })
    expect(blocked).toMatchObject({ status: "HAS_POINTS", items: [{ section: "STRENGTH" }], delivery: { collaborator: false, notification: false, audit: true, blockedReasons: ["INSUFFICIENT_DISPLAY_EVIDENCE"] } })
    expect(blocked.items[0]!.displayEvidence[0]).toMatchObject({ status: "WITHHELD", reason: "UNMASKED_NUMERIC_IDENTIFIER" })
  })
  it("FRICTION: evento direto → READY; operador + reação do cliente → READY; só fala do operador → BLOCKED", () => {
    expect(ready(item("FRICTION", [overlap])).readiness).toBe("READY")
    expect(ready(item("FRICTION", [operatorLine, customerReaction])).readiness).toBe("READY")
    const onlyOperator = item("FRICTION", [operatorLine])
    expect(ready(onlyOperator)).toEqual({ readiness: "INSUFFICIENT_DISPLAY_EVIDENCE", delivery: { collaborator: false, blocked: "INSUFFICIENT_DISPLAY_EVIDENCE" }, state: "NOT_DELIVERABLE" })
    expect(onlyOperator.items[0]!.readiness.missing).toEqual(["EVENT_OR_OPERATOR_AND_CUSTOMER"])
    // Reação do cliente RETIDA por privacidade não conta.
    const withheldReaction = obs("S6", "CUSTOMER_SIGNAL", "CLIENTE", "T8", "Anota aí o meu cartão 4111111111111111, por favor.")
    expect(ready(item("FRICTION", [operatorLine, withheldReaction])).readiness).toBe("INSUFFICIENT_DISPLAY_EVIDENCE")
  })
  it("CONTRADICTION: conjunto completo exibível → READY; parte necessária retida ou parte única → BLOCKED", () => {
    expect(ready(item("CONTRADICTION", [customerNeed, statement])).readiness).toBe("READY")
    expect(ready(item("CONTRADICTION", [statement, protocolOnly])).readiness).toBe("INSUFFICIENT_DISPLAY_EVIDENCE")
    expect(item("CONTRADICTION", [statement]).items[0]!.readiness).toMatchObject({ status: "INSUFFICIENT_DISPLAY_EVIDENCE", missing: ["ALL_PARTS_DISPLAYABLE"] })
  })
  it("UNRESOLVED_NEED: necessidade + condução do operador → READY; uma ponta ausente → BLOCKED com o requisito que faltou", () => {
    expect(ready(item("UNRESOLVED_NEED", [customerNeed, conduct])).readiness).toBe("READY")
    expect(item("UNRESOLVED_NEED", [customerNeed]).items[0]!.readiness).toMatchObject({ status: "INSUFFICIENT_DISPLAY_EVIDENCE", missing: ["OPERATOR_CONDUCT"] })
    expect(item("UNRESOLVED_NEED", [conduct]).items[0]!.readiness).toMatchObject({ status: "INSUFFICIENT_DISPLAY_EVIDENCE", missing: ["CUSTOMER_NEED"] })
  })
  it("procedimental continua bloqueado pela política mesmo com evidência READY", () => {
    const feedback = compose(frame([assertion], [finding("PROCEDURAL_DIVERGENCE", "AGENT", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })]), { lineage: lineage("CONTRADICTED") })
    expect(feedback.items[0]).toMatchObject({ readiness: { status: "READY" }, delivery: { collaborator: false, blocked: "PROCEDURAL_MATCHING_NOT_VALIDATED" } })
  })
  it("seções fora do colaborador = NOT_APPLICABLE; readiness não muda seção, kind, dono, polaridade, escopo nem o frame", () => {
    const neutral = compose(frame([signal], [finding("INTERACTION_FRICTION", "INTERACTION", [signal])]))
    expect(neutral.items[0]!.readiness.status).toBe("NOT_APPLICABLE")
    expect(neutral.delivery.state).toBe("NOTHING_MATERIAL")
    const f = frame([operatorLine], [finding("FRICTION", "AGENT", [operatorLine])])
    const before = JSON.stringify(f)
    const feedback = compose(f)
    expect(JSON.stringify(f)).toBe(before)
    expect(feedback.items[0]).toMatchObject({ section: "OPPORTUNITY", interpretation: { kind: "FRICTION", ownership: "AGENT", polarity: "NEGATIVE", scope: "INTERACTION_SPECIFIC" } })
    expect(feedback.review.required).toBe(true)
  })
  it("nome de outro operador no trecho (contexto de display) → retido → não conta para a readiness", () => {
    const named = obs("D7", "AGENT_STATEMENT", "OPERADOR", "T4", "Vou te passar para o Carlos Menezes do suporte.")
    const feedback = composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: frame([named], [finding("STRENGTH", "AGENT", [named])]), interactionLabel: "x", sourceRun: "r", displayContext: { otherOperatorNames: ["Carlos Menezes"] } })
    expect(feedback.items[0]).toMatchObject({ readiness: { status: "INSUFFICIENT_DISPLAY_EVIDENCE" }, displayEvidence: [{ status: "WITHHELD", reason: "OPERATOR_IDENTITY" }] })
  })
})
