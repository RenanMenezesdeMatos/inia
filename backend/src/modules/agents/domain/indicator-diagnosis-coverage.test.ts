import { describe, expect, it, vi } from "vitest"
import fixture from "../../indicator-diagnosis/testing/prv-smoke-v1-fixture.json" with { type: "json" }
import { parseInteractionAssessments, type InteractionAssessment } from "./indicator-diagnosis-contract.js"
import { auditInitialAssessment, avoidFormulationsFor, finalizeInteractionCoverage, inconsistencyOf, planDiagnosisRepairs, renderDiagnosisRepairPrompt, repairTargetsOf } from "./indicator-diagnosis-coverage.js"
import { completeDiagnosisCoverage } from "../application/indicator-diagnosis-repair.js"
import { buildProcessCheckpointCatalog, type ProcessCheckpointCatalog, type ProcessCheckpointEntry } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { verifyProcessAssessments, type PublishedKnowledgeDocument } from "../../reliable-feedback/domain/process-assessment.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"

/**
 * INDICATOR DIAGNOSIS V1.0.1 — cobertura da avaliação no diagnóstico do fechamento, sobre a resposta REAL do Agent no smoke
 * anterior (fixture congelada `prv-smoke-v1-fixture.json`: 5 chamadas de Contestação, 1–2 etapas por chamada, e a etapa do
 * prazo marcada como OMISSÃO com a própria fala "É só aguardar…" como evidência). Nenhum modelo, nenhum banco.
 */
type Fixture = {
  agentRawOutput: string
  sourceNodeOutput: { sample: { handle: string; interactionId: string }[]; assessment: { knowledgeExcerpts: { documentId: string; documentTitle: string; heading: string; excerpt: string; chunkIndex?: number }[] } }
  contexts: { handle: string; interactionId: string; context: { transcript: string } }[]
  published: PublishedKnowledgeDocument[]
}
const F = fixture as unknown as Fixture
const presented = F.sourceNodeOutput.assessment.knowledgeExcerpts
const published = new Map(F.published.map((document) => [document.documentId, document]))
const catalog: ProcessCheckpointCatalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: (id) => published.get(id)?.content, subject: "Contestação de cobrança", coveragePlan: true })
const handles = F.sourceNodeOutput.sample.map((entry) => entry.handle)
const transcriptOf = (handle: string) => F.contexts.find((entry) => entry.handle === handle)!.context.transcript
const conversations = new Map(handles.map((handle) => [handle, transcriptOf(handle)]))
const raw = F.agentRawOutput
const initial = parseInteractionAssessments((JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { interactionAssessments: unknown }).interactionAssessments, handles, presented, catalog)
const mustAssess = catalog.entries.filter((entry) => entry.assessmentRequirement === "MUST_ASSESS")
const deadline = mustAssess.find((entry) => entry.canonicalBehavior === "INFORM_DEADLINE")!
const holder = mustAssess.find((entry) => entry.canonicalBehavior === "VALIDATE_HOLDER")!
const protocol = mustAssess.find((entry) => entry.canonicalBehavior === "PROVIDE_PROTOCOL")!
const avoidWait = catalog.entries.find((entry) => entry.segmentRole === "AVOID" && entry.stepText.includes("É só aguardar"))!

const disposition = (entry: ProcessCheckpointEntry, status: "FOLLOWED" | "NOT_FOLLOWED" | "NOT_OBSERVABLE" | "NOT_APPLICABLE", evidence: string[] = [], evidenceType: "OBSERVED" | "OMISSION" | null = status === "FOLLOWED" || status === "NOT_FOLLOWED" ? "OBSERVED" : null) => ({ checkpointRef: entry.ref, requirement: entry.stepText, status, evidenceType, transcriptEvidence: evidence, knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE" as const, text: null }, uncertainty: null })
/** Avaliação sintética (validada pelo contrato, com o plano de cobertura) — todas as MUST_ASSESS respondidas, salvo `omit`. */
function assessmentWith(checkpoints: ReturnType<typeof disposition>[], omit: readonly string[] = []): InteractionAssessment["processAssessment"] {
  const byDocument = new Map<string, unknown[]>()
  const refs = new Set(checkpoints.map((checkpoint) => checkpoint.checkpointRef))
  const all = [...checkpoints, ...mustAssess.filter((entry) => !refs.has(entry.ref) && !omit.includes(entry.ref)).map((entry) => disposition(entry, "NOT_OBSERVABLE"))]
  for (const checkpoint of all) {
    const entry = catalog.entries.find((candidate) => candidate.ref === checkpoint.checkpointRef)!
    byDocument.set(entry.documentTitle, [...(byDocument.get(entry.documentTitle) ?? []), checkpoint])
  }
  const parsed = parseInteractionAssessments([{ interactionRef: "I1", processAssessment: { processes: [...byDocument].map(([documentTitle, list]) => ({ documentTitle, checkpoints: list })) } }], ["I1"], presented, catalog)
  expect(parsed.accepted).toHaveLength(1)
  return parsed.accepted[0]!.processAssessment
}
const repairResponse = (assessments: unknown[]) => JSON.stringify({ assessments })

describe("V1.0.1 — replay do smoke anterior (resposta real do Agent)", () => {
  it("MUST_ASSESS: o planejador marca um conjunto pequeno por chamada e a primeira resposta cobriu só 1–2 etapas", () => {
    expect(mustAssess.length).toBeGreaterThanOrEqual(5)
    expect(mustAssess.length).toBeLessThan(catalog.entries.length / 4)
    const audits = handles.map((handle) => auditInitialAssessment(handle, initial.accepted.find((entry) => entry.interactionRef === handle)?.processAssessment ?? null, catalog))
    for (const audit of audits) {
      expect(audit.plannedMustAssess).toHaveLength(mustAssess.length)
      expect(audit.missingAfterInitial.length).toBeGreaterThanOrEqual(mustAssess.length - 3)
    }
  })

  it("'é só aguardar' + OMISSÃO + a própria fala como evidência = INCONSISTENT_ASSESSMENT (nada é reclassificado por código)", () => {
    const flagged = handles.flatMap((handle) => auditInitialAssessment(handle, initial.accepted.find((entry) => entry.interactionRef === handle)?.processAssessment ?? null, catalog).inconsistentAfterInitial.map((entry) => ({ handle, ...entry })))
    expect(flagged.map((entry) => [entry.handle, entry.checkpointRef, entry.reason])).toEqual([["I3", deadline.ref, "OMISSION_WITH_OBSERVED_CONDUCT"], ["I4", deadline.ref, "OMISSION_WITH_OBSERVED_CONDUCT"], ["I5", deadline.ref, "OMISSION_WITH_OBSERVED_CONDUCT"]])
    expect(flagged.map((entry) => entry.formulation)).toEqual(["É só aguardar.", "O setor vai verificar.", "Logo será resolvido."])
    // A disposição do Agent continua a dele: a auditoria só acusa.
    expect(flagged.every((entry) => entry.status === "NOT_FOLLOWED" && entry.evidenceType === "OMISSION")).toBe(true)
    // Omissão legítima (nenhuma fala citada / nenhuma formulação a evitar) NÃO é inconsistência.
    const i4 = initial.accepted.find((entry) => entry.interactionRef === "I4")!.processAssessment.processes.flatMap((process) => process.checkpoints)
    expect(inconsistencyOf(i4.find((checkpoint) => checkpoint.checkpointRef === protocol.ref)!, catalog)).toBeNull()
    // As formulações vêm da BASE (seção do mesmo comportamento), nunca de uma lista do código.
    expect(avoidFormulationsFor(deadline, catalog)).toEqual(expect.arrayContaining(["É só aguardar.", "Logo será resolvido.", "O setor vai verificar."]))
  })

  it("reparo simulado corrige a disposição → a verificação congelada da monitoria transforma em NOT_FOLLOWED + VERIFIED", async () => {
    const call = vi.fn(async ({ user }: { system: string; user: string }) => {
      expect(user).toContain("Avaliação anterior INCONSISTENTE")
      expect(user).toContain(deadline.ref)
      expect(user).toContain("CONVERSA (dados da chamada")
      // Só a conversa DESTA chamada entra no reparo.
      expect(user).toContain(transcriptOf("I3").split("\n")[0]!)
      expect(user).not.toContain(transcriptOf("I1").split("\n")[1]!)
      const targets = [...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => match[1]!)
      return repairResponse(targets.map((ref) => (ref === deadline.ref ? { checkpointRef: ref, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: É só aguardar, o setor vai verificar."] } : { checkpointRef: ref, status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [] })))
    })
    const onlyI3 = await completeDiagnosisCoverage({ sample: ["I3"], accepted: initial.accepted, catalog, presented, conversations, maxRepairInteractions: 10, call })
    expect(call).toHaveBeenCalledTimes(1)
    const audit = onlyI3.coverage.interactions[0]!
    expect(audit).toMatchObject({ repairTriggered: true, repairCalls: 1, missingAfterRepair: [], inconsistentAfterRepair: [], status: "COMPLETE" })
    expect(audit.repairAccepted).toContain(deadline.ref)
    const context = F.contexts.find((entry) => entry.handle === "I3")!
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "I3", assessment: onlyI3.assessments[0]!.processAssessment, presented }], interactionId: context.interactionId, transcript: context.context.transcript, published, subject: "Contestação de cobrança" })
    const observations = observationsFrom("p", [{ interactionId: context.interactionId, assessment: verified }])
    expect(observations.find((observation) => observation.practiceKey === "BEHAVIOR:INFORM_DEADLINE")).toMatchObject({ status: "NOT_FOLLOWED", analyticsStatus: "VERIFIED" })
  })
})

describe("V1.0.1 — reparo seletivo (§40 A–G)", () => {
  it("A. nada faltando nem inconsistente → ZERO reparo (repairTriggered = false)", async () => {
    const complete = assessmentWith([disposition(holder, "FOLLOWED", ["Operador: Me confirma a data de nascimento?"])])
    const call = vi.fn(async () => "{}")
    const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: complete }], catalog, presented, conversations: new Map([["I1", transcriptOf("I1")]]), maxRepairInteractions: 10, call })
    expect(call).not.toHaveBeenCalled()
    expect(result.coverage.interactions[0]).toMatchObject({ repairTriggered: false, repairSkippedReason: "NO_TARGETS", missingAfterInitial: [], status: "COMPLETE" })
    expect(result.coverage).toMatchObject({ repairInteractions: 0, repairTargets: 0, status: "COMPLETE" })
  })

  it("B. 2 faltantes → UMA chamada com as duas etapas", async () => {
    const partial = assessmentWith([], [holder.ref, protocol.ref])
    const call = vi.fn(async ({ user }: { user: string }) => { expect(user).toContain(holder.ref); expect(user).toContain(protocol.ref); expect(user).toContain("ficou SEM disposição"); return repairResponse([{ checkpointRef: holder.ref, status: "NOT_OBSERVABLE", evidenceType: null }, { checkpointRef: protocol.ref, status: "NOT_OBSERVABLE", evidenceType: null }]) })
    const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: partial }], catalog, presented, conversations: new Map([["I1", transcriptOf("I1")]]), maxRepairInteractions: 10, call })
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.coverage.interactions[0]).toMatchObject({ missingAfterInitial: [holder.ref, protocol.ref].sort((a, b) => catalog.entries.findIndex((e) => e.ref === a) - catalog.entries.findIndex((e) => e.ref === b)), repairAccepted: expect.arrayContaining([holder.ref, protocol.ref]), missingAfterRepair: [], status: "COMPLETE" })
  })

  it("C. 1 inconsistente → UMA chamada, a disposição inconsistente é substituída pela reavaliação", async () => {
    const assessment = assessmentWith([disposition(deadline, "NOT_FOLLOWED", ["Operador: É só aguardar, o setor vai verificar."], "OMISSION")])
    const plan = planDiagnosisRepairs({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, maxRepairInteractions: 10 })
    expect(repairTargetsOf(plan[0]!.initial, catalog).map((entry) => entry.ref)).toEqual([deadline.ref])
    const { assessment: final, audit } = finalizeInteractionCoverage({ initial: plan[0]!.initial, assessment, catalog, presented, skippedReason: null, outcome: { kind: "RESPONSE", value: { assessments: [{ checkpointRef: deadline.ref, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: É só aguardar, o setor vai verificar."] }] } } })
    const after = final.processes.flatMap((process) => process.checkpoints).filter((checkpoint) => checkpoint.checkpointRef === deadline.ref)
    expect(after).toEqual([expect.objectContaining({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED" })])
    expect(audit).toMatchObject({ inconsistentAfterInitial: [expect.objectContaining({ checkpointRef: deadline.ref })], repairAccepted: [deadline.ref], inconsistentAfterRepair: [], status: "COMPLETE" })
  })

  it("D. faltante + inconsistente → UMA chamada com as duas", async () => {
    const assessment = assessmentWith([disposition(deadline, "NOT_FOLLOWED", ["Operador: É só aguardar, o setor vai verificar."], "OMISSION")], [holder.ref])
    const call = vi.fn(async ({ user }: { user: string }) => { expect(user).toContain(holder.ref); expect(user).toContain(deadline.ref); return repairResponse([{ checkpointRef: holder.ref, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Vou verificar pra você."] }, { checkpointRef: deadline.ref, status: "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: É só aguardar."] }]) })
    await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, conversations: new Map([["I1", transcriptOf("I1")]]), maxRepairInteractions: 10, call })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it("E. reparo incompleto → PARCIAL (nada inferido para o que continuou faltando)", async () => {
    const assessment = assessmentWith([], [holder.ref, protocol.ref])
    const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, conversations: new Map([["I1", transcriptOf("I1")]]), maxRepairInteractions: 10, call: async () => repairResponse([{ checkpointRef: holder.ref, status: "NOT_OBSERVABLE", evidenceType: null }]) })
    const audit = result.coverage.interactions[0]!
    expect(audit).toMatchObject({ repairAccepted: [holder.ref], missingAfterRepair: [protocol.ref], status: "PARTIAL" })
    expect(result.coverage.status).toBe("PARTIAL")
    expect(result.assessments[0]!.processAssessment.processes.flatMap((process) => process.checkpoints).some((checkpoint) => checkpoint.checkpointRef === protocol.ref)).toBe(false)
    expect(result.assessments[0]!.processAssessment.validation?.completeness).toBe("PARTIAL")
  })

  it("F. reparo falha (transporte) → registrado, o diagnóstico continua; a inconsistente não volta como estava", async () => {
    const assessment = assessmentWith([disposition(deadline, "NOT_FOLLOWED", ["Operador: É só aguardar, o setor vai verificar."], "OMISSION")])
    const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, conversations: new Map([["I1", transcriptOf("I1")]]), maxRepairInteractions: 10, call: async () => { throw new Error("socket hang up") } })
    expect(result.coverage.interactions[0]).toMatchObject({ repairTriggered: true, repairError: expect.stringMatching(/^REPAIR_CALL_FAILED/), status: "PARTIAL" })
    expect(result.assessments[0]!.processAssessment.processes.flatMap((process) => process.checkpoints).some((checkpoint) => checkpoint.checkpointRef === deadline.ref)).toBe(false)
  })

  it("G. nunca uma segunda chamada: reparo que devolve de novo uma omissão de 'evitar' é descartado, sem terceiro modelo", async () => {
    const assessment = assessmentWith([disposition(avoidWait, "NOT_FOLLOWED", [], "OMISSION")])
    const call = vi.fn(async () => repairResponse([{ checkpointRef: avoidWait.ref, status: "NOT_FOLLOWED", evidenceType: "OMISSION", transcriptEvidence: [] }]))
    const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, conversations: new Map([["I1", transcriptOf("I1")]]), maxRepairInteractions: 10, call })
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.coverage.interactions[0]).toMatchObject({ repairCalls: 1, inconsistentAfterRepair: [expect.objectContaining({ reason: "OMISSION_ON_AVOID_RULE" })], status: "PARTIAL" })
    // A mescla marca o reparo único: o contrato de monitoria também recusa pedir outro.
    expect(result.assessments[0]!.processAssessment.validation?.assessmentCoverage?.repairTriggered).toBe(true)
  })

  it("mescla: não sobrescreve disposição válida da primeira resposta e recusa etapa não pedida", () => {
    const assessment = assessmentWith([disposition(holder, "FOLLOWED", ["Operador: Me confirma a data de nascimento?"])], [protocol.ref])
    const plan = planDiagnosisRepairs({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, maxRepairInteractions: 10 })[0]!
    const { assessment: final, audit } = finalizeInteractionCoverage({ initial: plan.initial, assessment, catalog, presented, skippedReason: null, outcome: { kind: "RESPONSE", value: { assessments: [{ checkpointRef: protocol.ref, status: "NOT_OBSERVABLE", evidenceType: null }, { checkpointRef: holder.ref, status: "NOT_FOLLOWED", evidenceType: "OMISSION" }, { checkpointRef: avoidWait.ref, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Obrigada."] }] } } })
    expect(audit.repairRejected).toEqual(expect.arrayContaining([{ checkpointRef: holder.ref, code: "REPAIR_REF_NOT_REQUESTED" }, { checkpointRef: avoidWait.ref, code: "REPAIR_REF_NOT_REQUESTED" }]))
    expect(final.processes.flatMap((process) => process.checkpoints).find((checkpoint) => checkpoint.checkpointRef === holder.ref)).toMatchObject({ status: "FOLLOWED" })
    expect(audit.repairAccepted).toEqual([protocol.ref])
  })

  it("limite do diagnóstico: acima de maxRepairInteractions a chamada não é reparada (PARCIAL + registrado), o custo não explode", async () => {
    const partial = assessmentWith([], [holder.ref])
    const call = vi.fn(async () => repairResponse([{ checkpointRef: holder.ref, status: "NOT_OBSERVABLE", evidenceType: null }]))
    const result = await completeDiagnosisCoverage({ sample: ["I1", "I2", "I3"], accepted: ["I1", "I2", "I3"].map((interactionRef) => ({ interactionRef, processAssessment: partial })), catalog, presented, conversations, maxRepairInteractions: 1, call })
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.coverage).toMatchObject({ repairInteractions: 1, repairBudget: { maxInteractions: 1, skipped: 2 }, status: "PARTIAL" })
    expect(result.coverage.interactions.map((entry) => entry.repairSkippedReason)).toEqual([null, "BUDGET", "BUDGET"])
  })

  it("chamada que não voltou na primeira resposta recebe o plano inteiro no reparo", async () => {
    const call = vi.fn(async ({ user }: { user: string }) => repairResponse([...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => ({ checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null }))))
    const result = await completeDiagnosisCoverage({ sample: ["I2"], accepted: [], catalog, presented, conversations, maxRepairInteractions: 10, call })
    expect(result.coverage.interactions[0]).toMatchObject({ initialReturned: false, repairTargets: expect.arrayContaining(mustAssess.map((entry) => entry.ref)), missingAfterRepair: [], status: "COMPLETE" })
  })
})

describe("V1.0.1 — presença textual NÃO é violação (§20, §38, §39)", () => {
  const cases = [
    { name: "negação", speech: "Operador: Eu não vou simplesmente dizer que é só aguardar; vou te explicar o prazo." },
    { name: "citação / explicação", speech: "Operador: O procedimento diz para não falar 'é só aguardar'." },
  ]
  for (const { name, speech } of cases) {
    it(`${name}: a auditoria só envia ao reparo; o sentido decidido pelo modelo é mantido (nada vira NOT_FOLLOWED por código)`, async () => {
      const assessment = assessmentWith([disposition(deadline, "FOLLOWED", [speech])])
      const flagged = auditInitialAssessment("I1", assessment, catalog).inconsistentAfterInitial
      expect(flagged).toEqual([expect.objectContaining({ checkpointRef: deadline.ref, reason: "FOLLOWED_WITH_AVOIDED_FORMULATION", status: "FOLLOWED" })])
      const call = vi.fn(async () => repairResponse([{ checkpointRef: deadline.ref, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [speech] }]))
      const result = await completeDiagnosisCoverage({ sample: ["I1"], accepted: [{ interactionRef: "I1", processAssessment: assessment }], catalog, presented, conversations: new Map([["I1", `${speech}\nCliente: Certo.`]]), maxRepairInteractions: 10, call })
      const after = result.assessments[0]!.processAssessment.processes.flatMap((process) => process.checkpoints).find((checkpoint) => checkpoint.checkpointRef === deadline.ref)
      expect(after).toMatchObject({ status: "FOLLOWED" })
      expect(result.coverage.interactions[0]).toMatchObject({ reaffirmedAfterRepair: [deadline.ref], inconsistentAfterRepair: [], status: "COMPLETE" })
    })
  }

  it("fala do CLIENTE com a formulação não acusa a disposição do operador", () => {
    const assessment = assessmentWith([disposition(deadline, "FOLLOWED", ["Cliente: Não quero que me digam que é só aguardar.", "Operador: A análise leva até cinco dias úteis."])])
    expect(auditInitialAssessment("I1", assessment, catalog).inconsistentAfterInitial).toEqual([])
  })

  it("o prompt do reparo traz a instrução semântica e a regra literal, nunca o diagnóstico inteiro", () => {
    const prompt = renderDiagnosisRepairPrompt({ targets: [deadline], inconsistent: [{ checkpointRef: deadline.ref, reason: "OMISSION_WITH_OBSERVED_CONDUCT", status: "NOT_FOLLOWED", evidenceType: "OMISSION", formulation: "É só aguardar.", evidence: ["Operador: É só aguardar."] }], conversation: "Operador: É só aguardar." })
    expect(prompt.system).toContain("Não assuma ausência se existe evidência do comportamento ocorrendo")
    expect(prompt.system).toContain("Não trate presença textual isolada como violação")
    expect(prompt.user).toContain(deadline.sourceText)
    expect(prompt.user).not.toMatch(/interactionAssessments|DIAGNÓSTICO DO INDICADOR/)
  })
})
