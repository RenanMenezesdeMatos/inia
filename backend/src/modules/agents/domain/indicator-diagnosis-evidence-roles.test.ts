import { describe, expect, it, vi } from "vitest"
import fixture from "../../indicator-diagnosis/testing/prv-smoke-v101-thalita-fixture.json" with { type: "json" }
import { parseInteractionAssessments, type InteractionAssessment } from "./indicator-diagnosis-contract.js"
import { auditInitialAssessment, inconsistencyOf, normativeRoleOf, structuralInconsistencyOf, type EvidenceRoleContext } from "./indicator-diagnosis-coverage.js"
import { completeDiagnosisCoverage } from "../application/indicator-diagnosis-repair.js"
import { buildProcessCheckpointCatalog, type ProcessCheckpointCatalog } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { verifyProcessAssessments, type PublishedKnowledgeDocument } from "../../reliable-feedback/domain/process-assessment.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { summarizeOperationalPatterns } from "../../indicator-diagnosis/domain/operational-patterns.js"

/**
 * INDICATOR DIAGNOSIS V1.0.2 — INTEGRIDADE DE PAPÉIS DA EVIDÊNCIA, sobre os dados REAIS do smoke V1.0.1 (Thalita, 10 chamadas de
 * Contestação: 7 com a espera vaga no lugar do prazo, 3 corretas — uma longa). Fixture congelada `prv-smoke-v101-thalita-fixture.json`
 * = resposta inicial REAL do Agent + as avaliações MESCLADAS (depois do reparo V1.0.1) que foram para a verificação. Sem modelo,
 * sem banco. A verificação é a da monitoria, intacta.
 */
type Fixture = {
  agentRawOutput: string
  sourceNodeOutput: { sample: { handle: string; interactionId: string }[]; assessment: { interactionAssessments: InteractionAssessment[]; knowledgeExcerpts: { documentId: string; documentTitle: string; heading: string; excerpt: string; chunkIndex?: number }[] } }
  contexts: { handle: string; interactionId: string; context: { transcript: string } }[]
  published: PublishedKnowledgeDocument[]
}
const F = fixture as unknown as Fixture
const presented = F.sourceNodeOutput.assessment.knowledgeExcerpts
const published = new Map(F.published.map((document) => [document.documentId, document]))
const SUBJECT = "Contestação de cobrança"
const catalog: ProcessCheckpointCatalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: (id) => published.get(id)?.content, subject: SUBJECT, coveragePlan: true })
const handles = F.sourceNodeOutput.sample.map((entry) => entry.handle)
const transcriptOf = (handle: string) => F.contexts.find((entry) => entry.handle === handle)!.context.transcript
const interactionOf = (handle: string) => F.contexts.find((entry) => entry.handle === handle)!.interactionId
const conversations = new Map(handles.map((handle) => [handle, transcriptOf(handle)]))
const contextOf = (handle: string): EvidenceRoleContext => ({ transcript: transcriptOf(handle), presented })
/** Verdade da massa (construída para o teste; nunca vai ao motor): corretas informam prazo concreto. */
const CORRECT = handles.filter((handle) => transcriptOf(handle).includes("cinco dias úteis"))
const GAPS = handles.filter((handle) => !CORRECT.includes(handle))
const deadline = catalog.entries.find((entry) => entry.assessmentRequirement === "MUST_ASSESS" && entry.canonicalBehavior === "INFORM_DEADLINE")!
/** A fala da operadora logo depois de o cliente perguntar pelo retorno (o momento da etapa de prazo). */
const deadlineMoment = (handle: string) => { const lines = transcriptOf(handle).split("\n"); return lines[lines.findIndex((line) => line.includes("E quando eu tenho")) + 1]! }
const deadlineOf = (assessment: InteractionAssessment["processAssessment"]) => assessment.processes.flatMap((process) => process.checkpoints).find((checkpoint) => checkpoint.checkpointRef === deadline.ref) ?? null

function deadlineObservations(assessments: readonly InteractionAssessment[]) {
  return assessments.flatMap((entry) => {
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: entry.interactionRef, assessment: entry.processAssessment, presented }], interactionId: interactionOf(entry.interactionRef), transcript: transcriptOf(entry.interactionRef), published, subject: SUBJECT })
    return observationsFrom("thalita", [{ interactionId: interactionOf(entry.interactionRef), assessment: verified }]).filter((observation) => observation.practiceKey === "BEHAVIOR:INFORM_DEADLINE").map((observation) => ({ handle: entry.interactionRef, status: observation.status, analytics: observation.analyticsStatus }))
  })
}

describe("V1.0.2 — replay do smoke REAL (as avaliações que foram para a verificação)", () => {
  const merged = F.sourceNodeOutput.assessment.interactionAssessments

  it("a fixture reproduz o smoke: prazo = 3 NOT_FOLLOWED VERIFIED, 4 desvios e 3 corretas em revisão", () => {
    expect(GAPS).toHaveLength(7)
    expect(CORRECT).toHaveLength(3)
    const observed = deadlineObservations(merged)
    expect(observed.filter((entry) => entry.status === "NOT_FOLLOWED" && entry.analytics === "VERIFIED")).toHaveLength(3)
    expect(observed.filter((entry) => entry.status === "NOT_FOLLOWED" && entry.analytics === "NEEDS_REVIEW")).toHaveLength(4)
    expect(observed.filter((entry) => entry.status === "FOLLOWED" && entry.analytics === "VERIFIED")).toHaveLength(0)
    expect(observed.filter((entry) => entry.status === "FOLLOWED" && entry.analytics === "NEEDS_REVIEW")).toHaveLength(3)
  })

  it("ANTES × DEPOIS: a auditoria nova acusa exatamente as 7 disposições que caíram em revisão — e nenhuma das 3 que passaram", () => {
    const flagged = new Map(merged.flatMap((entry) => {
      const checkpoint = deadlineOf(entry.processAssessment)
      const found = checkpoint ? inconsistencyOf(checkpoint, catalog, contextOf(entry.interactionRef)) : null
      return found ? [[entry.interactionRef, found] as const] : []
    }))
    const paraphraseOmissions = GAPS.filter((handle) => deadlineOf(merged.find((entry) => entry.interactionRef === handle)!.processAssessment)?.evidenceType === "OMISSION")
    expect(paraphraseOmissions).toHaveLength(4)
    // As 4 paráfrases: omissão tendo como BASE a regra de evitar (a regra prova a expectativa, não a ausência).
    for (const handle of paraphraseOmissions) expect(flagged.get(handle)).toMatchObject({ reason: "OMISSION_GROUNDED_ON_AVOID_RULE", normativeRole: "AVOID", status: "NOT_FOLLOWED", evidenceType: "OMISSION" })
    // As 3 corretas: cumprida tendo como BASE a fala-modelo da base (exemplo não prova nem define a etapa).
    for (const handle of CORRECT) expect(flagged.get(handle)).toMatchObject({ reason: "EXAMPLE_AS_NORMATIVE_BASIS", normativeRole: "EXAMPLE", status: "FOLLOWED" })
    // As 3 que o reparo V1.0.1 já tinha acertado continuam coerentes (nada novo nelas).
    for (const handle of GAPS.filter((entry) => !paraphraseOmissions.includes(entry))) expect(flagged.has(handle)).toBe(false)
    expect(flagged.size).toBe(7)
    // Detectar ≠ corrigir: a disposição continua a do Agent.
    for (const handle of paraphraseOmissions) expect(deadlineOf(merged.find((entry) => entry.interactionRef === handle)!.processAssessment)).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "OMISSION" })
  })

  it("a fala da paráfrase NÃO tem a formulação literal da base — a acusação vem do PAPEL da norma, nunca de palavra-chave", () => {
    const paraphrase = GAPS.find((handle) => deadlineMoment(handle).includes("área vai olhar com calma"))!
    expect(deadlineMoment(paraphrase)).not.toMatch(/é só aguardar|logo será resolvido|o setor vai verificar/i)
    expect(inconsistencyOf(deadlineOf(merged.find((entry) => entry.interactionRef === paraphrase)!.processAssessment)!, catalog, contextOf(paraphrase))?.formulation).toBeNull()
  })
})

describe("V1.0.2 — quality gate MOCKADO sobre a resposta INICIAL real (§31)", () => {
  const raw = F.agentRawOutput
  const initial = parseInteractionAssessments((JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { interactionAssessments: unknown }).interactionAssessments, handles, presented, catalog)

  it("reparo semântico correto (mockado) → prazo 7/7 NOT_FOLLOWED VERIFIED e 3/3 FOLLOWED VERIFIED; chamada longa correta continua correta", async () => {
    const prompts: string[] = []
    // O mock faz a leitura SEMÂNTICA que se espera do modelo: espera vaga no lugar do prazo = conduta observada (OBSERVED);
    // prazo concreto dito = cumprida — sempre com a fala real da chamada e nunca com texto da base.
    const call = vi.fn(async ({ system, user }: { system: string; user: string }) => {
      prompts.push(`${system}\n${user}`)
      const handle = handles.find((entry) => user.includes(deadlineMoment(entry)))!
      const targets = [...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => match[1]!)
      return JSON.stringify({ assessments: targets.map((ref) => (ref === deadline.ref
        ? { checkpointRef: ref, status: CORRECT.includes(handle) ? "FOLLOWED" : "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [deadlineMoment(handle)], knowledgeQuote: null }
        : { checkpointRef: ref, status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [] })) })
    })
    const result = await completeDiagnosisCoverage({ sample: handles, accepted: initial.accepted, catalog, presented, conversations, maxRepairInteractions: 10, call })
    // Nunca mais de um reparo por chamada.
    expect(call.mock.calls.length).toBeLessThanOrEqual(handles.length)
    for (const prompt of prompts) {
      expect(prompt).toContain("PAPÉIS DA EVIDÊNCIA")
      expect(prompt.match(/CONVERSA \(dados da chamada/g)).toHaveLength(1)
    }
    const observed = deadlineObservations(result.assessments)
    const verifiedNotFollowed = observed.filter((entry) => entry.status === "NOT_FOLLOWED" && entry.analytics === "VERIFIED").map((entry) => entry.handle)
    const verifiedFollowed = observed.filter((entry) => entry.status === "FOLLOWED" && entry.analytics === "VERIFIED").map((entry) => entry.handle)
    expect(verifiedNotFollowed.sort()).toEqual([...GAPS].sort())
    expect(verifiedFollowed.sort()).toEqual([...CORRECT].sort())
    expect(observed.filter((entry) => entry.analytics !== "VERIFIED")).toEqual([])
    // A chamada longa e correta (a que tem a explicação da composição da fatura) está entre as FOLLOWED.
    const long = handles.find((handle) => transcriptOf(handle).includes("composição da fatura"))!
    expect(verifiedFollowed).toContain(long)
    // Denominador: só VERIFIED conta; 7 de 10 → padrão de desenvolvimento, sem ninguém "em revisão" no prazo.
    const summary = summarizeOperationalPatterns({ interactions: handles.map((handle) => ({ interactionId: interactionOf(handle), localDate: "2026-08-01", weekday: 1, hour: 10, segmentKey: "contestacao", segmentLabel: SUBJECT, origin: "ASSESSED" as const })), observations: observed.map((entry) => ({ interactionId: interactionOf(entry.handle), practiceKey: "BEHAVIOR:INFORM_DEADLINE", behavior: "INFORM_DEADLINE" as const, title: "Prazo da análise", requirement: "prazo", documentId: null, documentTitle: null, status: entry.status as "FOLLOWED" | "NOT_FOLLOWED", completeness: null, analyticsStatus: entry.analytics as "VERIFIED", origin: "ASSESSED" as const, evidence: [], rule: null, guidance: null })), eligiblePopulation: 12, minimumEligible: 3 })
    expect(summary.behaviors[0]).toMatchObject({ classification: "DEVELOPMENT", eligible: 10, counts: expect.objectContaining({ notFollowed: 7, followed: 3, ineligible: 0 }) })
  })
})

describe("V1.0.2 — contrato de papéis (§44 A–M)", () => {
  const gap = GAPS[0]!
  const good = CORRECT[0]!
  const example = "A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS."
  const avoidRule = "Evitar:\n\n- “É só aguardar.”"
  const checkpoint = (over: Record<string, unknown>) => ({ checkpointRef: deadline.ref, requirement: deadline.stepText, status: "FOLLOWED" as const, evidenceType: "OBSERVED" as const, transcriptEvidence: [] as string[], knowledgeQuote: null as string | null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE" as const, text: null }, uncertainty: null, ...over })

  it("papel da norma é lido da própria base apresentada: regra × exemplo × evitar", () => {
    expect(normativeRoleOf(deadline.sourceText, presented)).toBe("RULE")
    expect(normativeRoleOf(example, presented)).toBe("EXAMPLE")
    expect(normativeRoleOf(avoidRule, presented)).toBe("AVOID")
    expect(normativeRoleOf("texto que não está na base", presented)).toBe("UNLOCATED")
  })

  it("A. FOLLOWED com o EXEMPLO da base colado como evidência da chamada → inconsistente", () => {
    expect(inconsistencyOf(checkpoint({ transcriptEvidence: [`Operador: ${example}`] }), catalog, contextOf(good))?.reason).toBe("KB_TEXT_AS_OBSERVATION")
    expect(inconsistencyOf(checkpoint({ transcriptEvidence: [deadlineMoment(good)], knowledgeQuote: example }), catalog, contextOf(good))?.reason).toBe("EXAMPLE_AS_NORMATIVE_BASIS")
  })
  it("B. FOLLOWED com a fala real da chamada (e a regra da etapa como norma) → válido", () => {
    expect(inconsistencyOf(checkpoint({ transcriptEvidence: [deadlineMoment(good)], knowledgeQuote: deadline.sourceText }), catalog, contextOf(good))).toBeNull()
    expect(inconsistencyOf(checkpoint({ transcriptEvidence: [deadlineMoment(good)] }), catalog, contextOf(good))).toBeNull()
  })
  it("C. OMISSION tendo a regra de EVITAR como base → inconsistente", () => {
    expect(inconsistencyOf(checkpoint({ status: "NOT_FOLLOWED", evidenceType: "OMISSION", transcriptEvidence: [], knowledgeQuote: avoidRule }), catalog, contextOf(gap))?.reason).toBe("OMISSION_GROUNDED_ON_AVOID_RULE")
  })
  it("D. NOT_FOLLOWED observado com a fala real da chamada → válido; só a regra, sem fala → inconsistente", () => {
    expect(inconsistencyOf(checkpoint({ status: "NOT_FOLLOWED", transcriptEvidence: [deadlineMoment(gap)] }), catalog, contextOf(gap))).toBeNull()
    expect(inconsistencyOf(checkpoint({ status: "NOT_FOLLOWED", transcriptEvidence: [], knowledgeQuote: avoidRule }), catalog, contextOf(gap))?.reason).toBe("NO_OBSERVATION_EVIDENCE")
  })
  it("E. ausência legítima (omissão com a REGRA da etapa como norma, sem fala) → válida", () => {
    expect(inconsistencyOf(checkpoint({ status: "NOT_FOLLOWED", evidenceType: "OMISSION", transcriptEvidence: [], knowledgeQuote: deadline.sourceText }), catalog, contextOf(gap))).toBeNull()
  })
  it("F. a base continua válida como NORMA (regra da própria etapa, ou a própria formulação numa etapa de evitar)", () => {
    const avoidEntry = catalog.entries.find((entry) => entry.segmentRole === "AVOID" && entry.stepText.includes("É só aguardar"))!
    const avoidCheckpoint = { ...checkpoint({ status: "NOT_FOLLOWED", transcriptEvidence: ["Operador: É só aguardar, o setor vai verificar."] }), checkpointRef: avoidEntry.ref, knowledgeQuote: avoidEntry.sourceText }
    const lucia = GAPS.find((handle) => transcriptOf(handle).includes("É só aguardar, o setor vai verificar."))!
    expect(inconsistencyOf(avoidCheckpoint, catalog, contextOf(lucia))).toBeNull()
  })
  for (const [name, speech] of [["G. negação", "Operador: Eu não vou simplesmente dizer que é só aguardar; vou te explicar o prazo e o próximo passo."], ["H. citação da regra", "Operador: O procedimento orienta que eu não diga apenas 'é só aguardar'."]] as const) {
    it(`${name}: não vira desvio por código — vai ao reparo e a decisão semântica do modelo é mantida`, async () => {
      const transcript = `Cliente: E quando eu tenho uma resposta?\n${speech}\nCliente: Certo.`
      const context: EvidenceRoleContext = { transcript, presented }
      const followed = checkpoint({ transcriptEvidence: [speech], knowledgeQuote: deadline.sourceText })
      expect(inconsistencyOf(followed, catalog, context)?.reason).toBe("FOLLOWED_WITH_AVOIDED_FORMULATION")
      expect(structuralInconsistencyOf(followed, catalog, context)).toBeNull()
      const call = vi.fn(async () => JSON.stringify({ assessments: [{ checkpointRef: deadline.ref, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [speech] }] }))
      // Plano com só a etapa do prazo obrigatória (o resto do checklist não interessa ao caso); o contrato valida a entrada como no fluxo real.
      const onlyDeadline: ProcessCheckpointCatalog = { ...catalog, entries: catalog.entries.map((entry) => ({ ...entry, assessmentRequirement: entry.ref === deadline.ref ? "MUST_ASSESS" as const : entry.assessmentRequirement === "MUST_ASSESS" ? "MAY_ASSESS" as const : entry.assessmentRequirement })) }
      const accepted = parseInteractionAssessments([{ interactionRef: "I1", processAssessment: { processes: [{ documentTitle: deadline.documentTitle, checkpoints: [followed] }] } }], ["I1"], presented, onlyDeadline).accepted
      const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted, catalog: onlyDeadline, presented, conversations: new Map([["I1", transcript]]), maxRepairInteractions: 10, call })
      expect(call).toHaveBeenCalledTimes(1)
      expect(deadlineOf(result.assessments[0]!.processAssessment)).toMatchObject({ status: "FOLLOWED" })
      expect(result.coverage.interactions[0]).toMatchObject({ reaffirmedAfterRepair: [deadline.ref], inconsistentAfterRepair: [] })
    })
  }
  it("I. paráfrase sem a formulação literal: auditada pelo papel da norma e reavaliada pelo modelo (sem dicionário)", async () => {
    const paraphrase = GAPS.find((handle) => deadlineMoment(handle).includes("área vai olhar com calma"))!
    const omission = checkpoint({ status: "NOT_FOLLOWED", evidenceType: "OMISSION", transcriptEvidence: [deadlineMoment(paraphrase)], knowledgeQuote: "Evitar: [CP-540054981c] - “É só aguardar.”" })
    const audit = auditInitialAssessment(paraphrase, { processes: [{ documentTitle: deadline.documentTitle, checkpoints: [omission] }], applicability: [] }, catalog, contextOf(paraphrase))
    expect(audit.inconsistentAfterInitial.map((entry) => entry.reason)).toEqual(["OMISSION_GROUNDED_ON_AVOID_RULE"])
  })
  it("J/K/L. o reparo substitui SÓ a inconsistente, não sobrescreve a válida e recusa etapa não pedida", async () => {
    const holder = catalog.entries.find((entry) => entry.assessmentRequirement === "MUST_ASSESS" && entry.canonicalBehavior === "VALIDATE_HOLDER")!
    const holderSpeech = transcriptOf(gap).split("\n").find((line) => line.includes("data de nascimento"))!
    const assessments = parseInteractionAssessments([{ interactionRef: gap, processAssessment: { processes: [{ documentTitle: deadline.documentTitle, checkpoints: [
      checkpoint({ status: "NOT_FOLLOWED", evidenceType: "OMISSION", knowledgeQuote: avoidRule, transcriptEvidence: [] }),
      { ...checkpoint({ transcriptEvidence: [holderSpeech] }), checkpointRef: holder.ref, requirement: holder.stepText },
    ] }] } }], [gap], presented, catalog).accepted
    const other = catalog.entries.find((entry) => entry.segmentRole === "AVOID")!
    const call = vi.fn(async ({ user }: { user: string }) => JSON.stringify({ assessments: [
      ...[...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => (match[1] === deadline.ref ? { checkpointRef: deadline.ref, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [deadlineMoment(gap)] } : { checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null })),
      { checkpointRef: holder.ref, status: "NOT_FOLLOWED", evidenceType: "OMISSION" },
      { checkpointRef: other.ref, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [deadlineMoment(gap)] },
    ] }))
    const result = await completeDiagnosisCoverage({ sample: [gap], accepted: assessments, catalog, presented, conversations, maxRepairInteractions: 10, call })
    const final = result.assessments[0]!.processAssessment.processes.flatMap((process) => process.checkpoints)
    expect(final.find((entry) => entry.checkpointRef === deadline.ref)).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED" })
    expect(final.find((entry) => entry.checkpointRef === holder.ref)).toMatchObject({ status: "FOLLOWED" })
    expect(final.some((entry) => entry.checkpointRef === other.ref)).toBe(false)
    expect(result.coverage.interactions[0]!.repairRejected).toEqual(expect.arrayContaining([{ checkpointRef: holder.ref, code: "REPAIR_REF_NOT_REQUESTED" }, { checkpointRef: other.ref, code: "REPAIR_REF_NOT_REQUESTED" }]))
  })
  it("reparo que devolve de novo a troca de papéis (exemplo como base) → sai depois do reparo único, nunca uma terceira chamada", async () => {
    const assessments = parseInteractionAssessments([{ interactionRef: good, processAssessment: { processes: [{ documentTitle: deadline.documentTitle, checkpoints: [checkpoint({ transcriptEvidence: [deadlineMoment(good)], knowledgeQuote: example })] }] } }], [good], presented, catalog).accepted
    const call = vi.fn(async ({ user }: { user: string }) => JSON.stringify({ assessments: [...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => (match[1] === deadline.ref ? { checkpointRef: deadline.ref, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [deadlineMoment(good)], knowledgeQuote: example } : { checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null })) }))
    const result = await completeDiagnosisCoverage({ sample: [good], accepted: assessments, catalog, presented, conversations, maxRepairInteractions: 10, call })
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.coverage.interactions[0]!.inconsistentAfterRepair).toEqual([expect.objectContaining({ checkpointRef: deadline.ref, reason: "EXAMPLE_AS_NORMATIVE_BASIS" })])
    expect(deadlineOf(result.assessments[0]!.processAssessment)).toBeNull()
  })
  it("M. NEEDS_REVIEW fica fora do denominador", () => {
    const summary = summarizeOperationalPatterns({ interactions: ["a", "b", "c", "d"].map((id) => ({ interactionId: id, localDate: "2026-08-01", weekday: 1, hour: 10, segmentKey: "x", segmentLabel: "X", origin: "ASSESSED" as const })), observations: [["a", "NOT_FOLLOWED", "VERIFIED"], ["b", "NOT_FOLLOWED", "VERIFIED"], ["c", "NOT_FOLLOWED", "VERIFIED"], ["d", "FOLLOWED", "NEEDS_REVIEW"]].map(([id, status, analytics]) => ({ interactionId: id!, practiceKey: "BEHAVIOR:INFORM_DEADLINE", behavior: "INFORM_DEADLINE" as const, title: "Prazo", requirement: "prazo", documentId: null, documentTitle: null, status: status as "FOLLOWED", completeness: null, analyticsStatus: analytics as "VERIFIED", origin: "ASSESSED" as const, evidence: [], rule: null, guidance: null })), eligiblePopulation: 4, minimumEligible: 3 })
    expect(summary.behaviors[0]).toMatchObject({ eligible: 3, counts: expect.objectContaining({ notFollowed: 3, followed: 0, ineligible: 1 }) })
  })
})
