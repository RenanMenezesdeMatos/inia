import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments, type VerifiedProcessAssessment } from "../domain/process-assessment.js"
import { buildProcessCheckpointCatalog, renderExcerptWithCheckpoints, sourceQuoteMatchOf, stripCheckpointTags, type ProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { canonicalBehaviorOf } from "../domain/canonical-behavior.js"
import { behaviorPolarityOf, facetPolarityOf } from "../domain/evidence-polarity.js"
import { PROCESS_ASSESSMENT_INSTRUCTIONS, PROCESS_ASSESSMENT_MODEL_CONTRACT_VERSION, validateProcessAssessmentOutput, type RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import { aggregateProcessPatterns, observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { isObservationEligibleForAnalytics, summarizeObservations } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { V171M_ASSESSMENT, V171M_CHECKLIST_ID, V171M_COLLABORATOR_NAME, V171M_DOC_ID, V171M_DOC_TITLE, V171M_PRESENTED, V171M_PUBLISHED, V171M_SUBJECT, V171M_TRANSCRIPT, V171M_WRITER_RAW } from "../testing/contestacao-v171m-smoke-fixture.js"

/**
 * V1.7.1n — ETAPAS ENDEREÇADAS PELO SISTEMA (checkpointRef) + COBERTURA OBRIGATÓRIA + POLARIDADE DA EVIDÊNCIA, sobre o smoke
 * REAL da V1.7.1m (SMOKE-V171M-CONTESTACAO-001; sem modelo). A resposta real do especialista foi no contrato V2 (identidade pela
 * citação); o replay no contrato V3 usa as MESMAS conclusões, falas e citações do modelo, com o código da etapa que cada citação
 * escolheu no catálogo apresentado — e, como no smoke, sem avaliar a recapitulação.
 */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const CATALOG = buildProcessCheckpointCatalog({ excerpts: V171M_PRESENTED, contentOf: (id) => V171M_PUBLISHED.get(id)?.content, subject: V171M_SUBJECT, coveragePlan: true })
const refOf = (pattern: RegExp, catalog: ProcessCheckpointCatalog = CATALOG) => { const entry = catalog.entries.find((candidate) => pattern.test(candidate.sourceText)); if (!entry) throw new Error(`sem etapa ${pattern}`); return entry.ref }
const REF = {
  cancel: refOf(/Cancelar a recorr/),
  register: refOf(/^2\. Registrar contesta/),
  deadline: refOf(/^O operador deverá informar o prazo/),
  block: refOf(/Ativar bloqueio/),
  doubts: refOf(/Confirmei se restaram/),
  protocol: refOf(/Forneci protocolo/),
  nextStep: refOf(/^\(3\) explique/),
  confirmDoubt: refOf(/^\(4\) confirme/),
  recap: refOf(/^Antes de encerrar, informar:/),
}
/** A avaliação REAL do smoke no contrato V3: mesmas conclusões/falas/citações + o código da etapa escolhida. */
function v3Assessment(mutate: (assessment: RawProcessAssessment) => void = () => {}): RawProcessAssessment {
  const assessment = clone(V171M_ASSESSMENT) as unknown as RawProcessAssessment
  const refs = [REF.cancel, REF.register, REF.deadline, REF.block, REF.doubts, REF.protocol, REF.nextStep, REF.confirmDoubt]
  let position = 0
  for (const process of assessment.processes) for (const checkpoint of process.checkpoints) checkpoint.checkpointRef = refs[position++]!
  delete assessment.validation
  mutate(assessment)
  const validated = validateProcessAssessmentOutput(assessment, { presented: V171M_PRESENTED, catalog: CATALOG })
  if (!validated.ok) throw new Error(JSON.stringify(validated.issues))
  // O smoke da V1.7.1m é ANTERIOR ao plano de cobertura da avaliação (V1.7.3): a avaliação daquele contrato não traz o plano
  // persistido nem a lista de MUST_ASSESS faltantes — a verificação a trata como avaliação anterior (só a recapitulação obrigatória
  // no processo). O plano novo é coberto em `assessment-coverage-v173.test.ts`.
  const { assessmentCoverage: _plan, missingMustAssess: _missing, ...legacy } = validated.assessment.validation!
  void _plan; void _missing
  const legacyMissing = (legacy.missingRequired ?? []).filter((entry) => entry.checkpointRef === REF.recap)
  return { ...validated.assessment, validation: { ...legacy, missingRequired: legacyMissing, completeness: legacy.invalidItems.length > 0 || legacyMissing.length > 0 ? "PARTIAL" : "COMPLETE" } }
}
const verify = (assessment: RawProcessAssessment, transcript = V171M_TRANSCRIPT, interactionId = "int-n", coveragePlan = true): VerifiedProcessAssessment =>
  verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: clone(assessment), presented: V171M_PRESENTED }], interactionId, transcript, published: V171M_PUBLISHED, subject: V171M_SUBJECT, coveragePlan })
const bySource = (assessment: VerifiedProcessAssessment, ref: string) => assessment.checkpoints.find((checkpoint) => checkpoint.source?.ref === ref)!

describe("V1.7.1n — catálogo de etapas (checkpointRef) e representação apresentada ao especialista", () => {
  it("identidade DETERMINÍSTICA: mesmos trechos → mesmos códigos; item de lista, lista composta e frase normativa; exemplo e contexto fora", () => {
    const again = buildProcessCheckpointCatalog({ excerpts: [...V171M_PRESENTED].reverse(), contentOf: (id) => V171M_PUBLISHED.get(id)?.content, subject: V171M_SUBJECT, coveragePlan: true })
    expect(new Set(again.entries.map((entry) => entry.ref))).toEqual(new Set(CATALOG.entries.map((entry) => entry.ref)))
    expect(CATALOG.entries.every((entry) => /^CP-[0-9a-f]{10}$/.test(entry.ref))).toBe(true)
    expect(new Set(CATALOG.entries.map((entry) => entry.ref)).size).toBe(CATALOG.entries.length)
    const entry = (ref: string) => CATALOG.entries.find((candidate) => candidate.ref === ref)!
    expect(entry(REF.nextStep)).toMatchObject({ kind: "LIST_ITEM", documentId: V171M_CHECKLIST_ID, position: 3, canonicalBehavior: "INFORM_DEADLINE", facets: ["DEADLINE", "NEXT_STEP"] })
    expect(entry(REF.confirmDoubt)).toMatchObject({ kind: "LIST_ITEM", position: 4, canonicalBehavior: "CONFIRM_UNDERSTANDING" })
    expect(entry(REF.protocol)).toMatchObject({ kind: "LIST_ITEM", sourceText: "- [ ] Forneci protocolo?", canonicalBehavior: "PROVIDE_PROTOCOL" })
    expect(entry(REF.deadline)).toMatchObject({ kind: "SENTENCE", heading: "35. Prazo da análise", canonicalBehavior: "INFORM_DEADLINE" })
    expect(entry(REF.recap)).toMatchObject({ kind: "COMPOSITE_LIST", composite: true, canonicalBehavior: "RECAPITULATE_INTERACTION", processRequirement: "REQUIRED", assessmentRequirement: "MUST_ASSESS", assessmentBasis: "PROCESS_REQUIRED", primaryProcess: true })
    // Nenhuma fala-modelo, lista de referência ou seção de exemplos (Jeito Vivo "Perguntas recomendadas") vira etapa.
    expect(CATALOG.entries.some((candidate) => /cinco dias úteis\. O retorno|Ajuste dentro da alçada|A solução atendeu/.test(candidate.sourceText))).toBe(false)
    // Pergunta PRESCRITA por "Perguntar:" é etapa (regra), mesmo entre aspas.
    expect(CATALOG.entries.find((candidate) => candidate.sourceText === "- “As informações ficaram claras?”")).toMatchObject({ segmentRole: "RULE", canonicalBehavior: "CONFIRM_UNDERSTANDING" })
  })

  it("§10/§11 obrigatória NO PROCESSO só para a recapitulação composta do processo PRIMÁRIO com o plano de cobertura ativo; transversal nunca", () => {
    expect(CATALOG.entries.filter((entry) => entry.processRequirement === "REQUIRED").map((entry) => entry.ref)).toEqual([REF.recap])
    // "Recapitulei as ações?" (checklist do procedimento) e "Recapitulei a solução" (Jeito Vivo) = só apoio do mesmo comportamento.
    expect(CATALOG.entries.filter((entry) => entry.assessmentRequirement === "SUPPORT_ONLY").map((entry) => entry.sourceText)).toEqual(["- [ ] Recapitulei as ações?", "- Recapitulei a solução;"])
    // V1.7.3 — transversal nunca é MUST_ASSESS por conta própria.
    expect(CATALOG.entries.filter((entry) => entry.assessmentRequirement === "MUST_ASSESS").every((entry) => entry.primaryProcess)).toBe(true)
    const withoutPlan = buildProcessCheckpointCatalog({ excerpts: V171M_PRESENTED, contentOf: (id) => V171M_PUBLISHED.get(id)?.content, subject: V171M_SUBJECT, coveragePlan: false })
    expect(withoutPlan.entries.some((entry) => entry.assessmentRequirement !== "MAY_ASSESS" || entry.processRequirement !== "NOT_DECLARED")).toBe(false)
    const withoutSubject = buildProcessCheckpointCatalog({ excerpts: V171M_PRESENTED, contentOf: (id) => V171M_PUBLISHED.get(id)?.content, subject: null, coveragePlan: true })
    expect(withoutSubject.entries.some((entry) => entry.processRequirement === "REQUIRED" || entry.assessmentRequirement === "MUST_ASSESS")).toBe(false)
  })

  it("§28 prompt: etapas marcadas no próprio trecho; a de avaliação obrigatória diz AVALIAR; a instrução pede o código e a cobertura", () => {
    const checklist = renderExcerptWithCheckpoints(V171M_PRESENTED.find((excerpt) => excerpt.documentId === V171M_CHECKLIST_ID)!, CATALOG)
    expect(checklist).toBe(`Antes de encerrar qualquer chamada: [${refOf(/^\(1\)/)}] (1) confirme a solução aplicada; [${refOf(/^\(2\)/)}] (2) informe o número do protocolo; [${REF.nextStep}] (3) explique o próximo passo e o prazo; [${REF.confirmDoubt}] (4) confirme se o cliente tem mais alguma dúvida.`)
    expect(stripCheckpointTags(checklist)).toBe(V171M_PRESENTED.find((excerpt) => excerpt.documentId === V171M_CHECKLIST_ID)!.excerpt)
    expect(renderExcerptWithCheckpoints(V171M_PRESENTED.find((excerpt) => excerpt.heading.startsWith("46"))!, CATALOG)).toMatch(new RegExp(`^\\[${REF.recap} · AVALIAR\\] Antes de encerrar, informar:`))
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS).toContain('"checkpointRef"')
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS).toContain('Todo código marcado "AVALIAR" ([CP-… · AVALIAR]) PRECISA receber exatamente uma disposição')
    // Impacto no prompt: 83 etapas (V1.7.3: MUST_ASSESS = recapitulação + uma representante por comportamento do processo primário).
    const tagChars = V171M_PRESENTED.reduce((sum, excerpt) => sum + renderExcerptWithCheckpoints(excerpt, CATALOG).length - excerpt.excerpt.length, 0)
    const mustAssess = CATALOG.entries.filter((entry) => entry.assessmentRequirement === "MUST_ASSESS").length
    expect({ presented: CATALOG.entries.length, mustAssess, mayAssess: CATALOG.entries.filter((entry) => entry.assessmentRequirement === "MAY_ASSESS").length, tagChars }).toEqual({ presented: 83, mustAssess, mayAssess: 83 - 2 - mustAssess, tagChars: 83 * 16 + mustAssess * " · AVALIAR".length })
  })
})

describe("V1.7.1n — contrato do especialista (A/B/F/G)", () => {
  it("A) o especialista escolhe o código; decoração é removida; o requisito ausente vem da etapa", () => {
    const assessment = v3Assessment((raw) => {
      raw.processes[0]!.checkpoints[0]!.checkpointRef = `[${REF.cancel}]`
      ;(raw.processes[0]!.checkpoints[1] as { requirement?: string }).requirement = ""
    })
    expect(assessment.validation).toMatchObject({ contractVersion: PROCESS_ASSESSMENT_MODEL_CONTRACT_VERSION, invalidItems: [] })
    expect(assessment.validation!.normalizations).toEqual(expect.arrayContaining([{ path: "processAssessment.processes.0.checkpoints.0.checkpointRef", code: "CHECKPOINT_REF_DECORATION_REMOVED" }, { path: "processAssessment.processes.0.checkpoints.1.requirement", code: "REQUIREMENT_FROM_CHECKPOINT_REF" }]))
    expect(assessment.processes[0]!.checkpoints[0]!.checkpointRef).toBe(REF.cancel)
    expect(assessment.processes[0]!.checkpoints[1]!.requirement).toBe("Registrar contestação;")
  })

  it("B) código desconhecido ou ausente é recusado (o modelo não cria etapa escrevendo texto parecido)", () => {
    const raw = clone(V171M_ASSESSMENT) as unknown as RawProcessAssessment
    delete raw.validation
    raw.processes[0]!.checkpoints.forEach((checkpoint, index) => { checkpoint.checkpointRef = index === 0 ? "CP-0000000000" : index === 1 ? null : REF.deadline })
    raw.processes[1]!.checkpoints.forEach((checkpoint) => { checkpoint.checkpointRef = REF.nextStep })
    const result = validateProcessAssessmentOutput(raw, { presented: V171M_PRESENTED, catalog: CATALOG })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validation.invalidItems.map((item) => [item.path, item.code])).toEqual(expect.arrayContaining([
      ["processAssessment.processes.0.checkpoints.0", "CHECKPOINT_REF_UNKNOWN"],
      ["processAssessment.processes.0.checkpoints.1", "CHECKPOINT_REF_REQUIRED"],
      // O mesmo código com status opostos: o modelo se contradisse — nenhuma das duas vale.
      ["processAssessment.processes.1.checkpoints.0", "CHECKPOINT_CONFLICTING_DUPLICATE"],
    ]))
    expect(result.validation.completeness).toBe("PARTIAL")
  })

  it("F/G) etapa OBRIGATÓRIA: avaliada = cobertura completa; omitida = MISSING_REQUIRED_CHECKPOINT e análise PARCIAL", () => {
    const covered = v3Assessment((raw) => { raw.processes[0]!.checkpoints.push({ checkpointRef: REF.recap, requirement: "Recapitulação", status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null }) })
    expect(covered.validation).toMatchObject({ completeness: "COMPLETE", missingRequired: [], catalog: { presented: 83, required: 1, supportOnly: 2 } })
    const missing = v3Assessment()
    expect(missing.validation).toMatchObject({ completeness: "PARTIAL", invalidItems: [], missingRequired: [{ checkpointRef: REF.recap, heading: "46. Recapitulação obrigatória", behavior: "RECAPITULATE_INTERACTION" }] })
    // V1.7.3 — o validador (sem o recorte histórico do helper) também aponta as MUST_ASSESS do plano que o smoke não avaliou.
    const recapOmitted = clone(V171M_ASSESSMENT) as unknown as RawProcessAssessment
    const refs = [REF.cancel, REF.register, REF.deadline, REF.block, REF.doubts, REF.protocol, REF.nextStep, REF.confirmDoubt]
    let position = 0
    for (const process of recapOmitted.processes) for (const checkpoint of process.checkpoints) checkpoint.checkpointRef = refs[position++]!
    delete recapOmitted.validation
    const planned = validateProcessAssessmentOutput(recapOmitted, { presented: V171M_PRESENTED, catalog: CATALOG })
    if (!planned.ok) throw new Error("contrato")
    expect(planned.validation.assessmentCoverage?.missingAfterInitial).toContain(REF.recap)
    expect(planned.validation.missingMustAssess.map((entry) => entry.behavior)).toEqual(expect.arrayContaining(["RECAPITULATE_INTERACTION", "IDENTIFY_CHARGE", "CHECK_PAYMENT"]))
    // Avaliada pelo especialista (mesmo NOT_OBSERVABLE) conta como coberta; nada é completado por cima.
    expect(verify(covered).coverage).toEqual({ required: 1, assessedByModel: 1, completedDeterministically: 0, missingUnresolved: [] })
  })
})

describe("V1.7.1n — identidade pela etapa, nunca pela citação (C/D/E)", () => {
  it("C) citação do Checklist INTEIRO não reclassifica o item (3); o item (4) na mesma string não vira a identidade", () => {
    const assessment = verify(v3Assessment())
    const nextStep = bySource(assessment, REF.nextStep)
    expect(nextStep.source).toMatchObject({ ref: REF.nextStep, quoteMatch: "SPANS_SIBLINGS", canonicalBehavior: "INFORM_DEADLINE", facets: ["DEADLINE", "NEXT_STEP"] })
    expect(nextStep.canonical).toMatchObject({ behavior: "INFORM_DEADLINE", role: "SUPPORTING", conflict: false })
    // A citação ampla é auditada, mas o trecho verificado é o do item.
    expect(nextStep.knowledge).toMatchObject({ quote: "(3) explique o próximo passo e o prazo;", applicability: "VERIFIED" })
    expect(nextStep.knowledge!.citedQuote).toContain("(4) confirme se o cliente tem mais alguma dúvida")
    // Sem o código (V2), a mesma citação inteira não classifica mais nenhum comportamento (lista em linha) — nunca a confirmação.
    expect(canonicalBehaviorOf({ step: null, quote: "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) explique o próximo passo e o prazo; (4) confirme se o cliente tem mais alguma dúvida.", heading: "", documentTitle: "Checklist de Encerramento de Chamada", contentKind: "RULE_CONTENT" })).toBeNull()
  })

  it("D) \"- Forneci protocolo?\" sem o \"[ ]\" da base continua a mesma etapa; marcador é editorial, palavra não", () => {
    const entry = CATALOG.entries.find((candidate) => candidate.ref === REF.protocol)!
    expect(sourceQuoteMatchOf(entry, "- Forneci protocolo?", CATALOG.entries)).toBe("EXACT")
    expect(sourceQuoteMatchOf(entry, "Forneci protocolo?", CATALOG.entries)).toBe("EXACT")
    expect(sourceQuoteMatchOf(entry, "☐ Forneci protocolo?", CATALOG.entries)).not.toBe("EXACT")
    expect(sourceQuoteMatchOf(entry, "- [ ] Registrei todos os fatos?", CATALOG.entries)).toBe("OTHER_CHECKPOINT")
    expect(sourceQuoteMatchOf(entry, "Forneci o número do protocolo?", CATALOG.entries)).toBe("UNRELATED")
    const protocol = bySource(verify(v3Assessment()), REF.protocol)
    expect(protocol).toMatchObject({ status: "FOLLOWED", source: { quoteMatch: "EXACT" }, knowledge: { applicability: "VERIFIED", quote: "- [ ] Forneci protocolo?" } })
  })

  it("E) comportamento vem do código: mesma citação, código de outra etapa = outro comportamento; citação de OUTRA etapa = QA", () => {
    const swapped = verify(v3Assessment((raw) => { raw.processes[1]!.checkpoints[1]!.checkpointRef = refOf(/^\(1\) confirme a solução/) }))
    expect(bySource(swapped, refOf(/^\(1\) confirme a solução/)).source).toMatchObject({ canonicalBehavior: "CONFIRM_SOLUTION" })
    const otherQuote = verify(v3Assessment((raw) => { raw.processes[0]!.checkpoints[5]!.knowledgeQuote = "- [ ] Registrei todos os fatos?" }))
    const protocol = bySource(otherQuote, REF.protocol)
    expect(protocol.source).toMatchObject({ canonicalBehavior: "PROVIDE_PROTOCOL", quoteMatch: "OTHER_CHECKPOINT" })
    expect(protocol.knowledge!.applicability).toBe("LITERAL_ONLY")
  })
})

describe("V1.7.1n — cobertura obrigatória e completude determinística (H/I)", () => {
  it("H) recapitulação omitida pelo especialista: o momento \"Resumindo…\" é avaliado pela lista composta → PARCIAL", () => {
    const assessment = verify(v3Assessment())
    expect(assessment.coverage).toEqual({ required: 1, assessedByModel: 0, completedDeterministically: 1, missingUnresolved: [] })
    const recap = bySource(assessment, REF.recap)
    expect(recap).toMatchObject({ origin: "SYSTEM_COMPLETION", status: "NOT_FOLLOWED", statusDowngradeReason: "COMPOSITE_PARTIAL", completion: { basis: "RECAP_MOMENT_DETECTED", marker: "Resumindo", resolved: true }, knowledge: { applicability: "VERIFIED" }, canonical: { behavior: "RECAPITULATE_INTERACTION", role: "PRIMARY" } })
    const of = (status: string) => recap.completeness!.items.filter((item) => item.status === status).map((item) => item.text)
    expect(recap.completeness!.status).toBe("PARTIAL")
    expect(of("VERIFIED_ABSENT")).toEqual(["prazo", "canal de retorno"])
    expect(of("OBSERVED")).toEqual(["lançamento contestado", "valor", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"])
  })

  it("I) sem momento seguro (nenhum ou dois \"Resumindo\", transcrição cortada): FALTANDO, análise parcial e QA — nunca inventado", async () => {
    const noMoment = V171M_TRANSCRIPT.replace("Operador: Resumindo, Renata: abri", "Operador: Então, Renata: abri")
    const unresolved = verify(v3Assessment(), noMoment)
    expect(unresolved.coverage).toMatchObject({ completedDeterministically: 0, missingUnresolved: [{ ref: REF.recap, reason: "NO_SAFE_RECAP_MOMENT", behavior: "RECAPITULATE_INTERACTION" }] })
    expect(unresolved.checkpoints.some((checkpoint) => checkpoint.source?.ref === REF.recap)).toBe(false)
    const twice = V171M_TRANSCRIPT.replace("Operador: Ficou alguma dúvida", "Operador: Resumindo de novo: contestação aberta. Ficou alguma dúvida")
    expect(verify(v3Assessment(), twice).coverage!.missingUnresolved).toEqual([expect.objectContaining({ reason: "NO_SAFE_RECAP_MOMENT" })])
    // Transcrição cortada: a chamada não chegou ao fechamento — o plano de cobertura não vale (nem no prompt, nem aqui): nada é obrigatório.
    const cut = `${V171M_TRANSCRIPT}\nOperador: Então é…`
    expect(verify(v3Assessment(), cut).coverage).toEqual({ required: 0, assessedByModel: 0, completedDeterministically: 0, missingUnresolved: [] })
    // O feedback não sai sozinho com a análise incompleta.
    const { artifact } = await replay(v3Assessment(), noMoment)
    expect(artifact.items.filter((item) => item.process).every((item) => item.decision?.disposition !== "READY" && item.decision?.reasons.includes("MISSING_REQUIRED_ASSESSMENT"))).toBe(true)
  })
})

describe("V1.7.1n — polaridade da evidência (J–N)", () => {
  it("J/K/L) prazo: não saber/não conseguir = INABILITY; prazo concreto = FULFILLED; negação de OUTRA oração não contamina", () => {
    const deadline = (text: string) => behaviorPolarityOf("INFORM_DEADLINE", text)!.polarity
    for (const text of ["Não sei te dizer um prazo certinho, depende da fila deles.", "Não sei informar o prazo.", "Não tenho como informar o prazo.", "O prazo eu não consigo confirmar.", "Não sei quando vai ficar pronto."]) expect([text, deadline(text)]).toEqual([text, "INABILITY"])
    for (const text of ["O prazo é de 5 dias.", "A análise sai em até cinco dias úteis.", "O prazo é de 48 horas.", "Fica pronto até amanhã.", "Não há problema, o prazo é de 5 dias.", "Não sei o prazo exato, mas é em até 5 dias úteis."]) expect([text, deadline(text)]).toEqual([text, "FULFILLED"])
    expect(deadline("Não tem prazo.")).toBe("NEGATED")
    expect(deadline("O prazo depende da fila deles.")).toBe("UNFULFILLED")
    // M) palavra solta não cumpre nem contraprova.
    expect(facetPolarityOf("DEADLINE", "Vou ver o prazo com eles.")).toEqual({ polarity: "UNKNOWN", mentioned: true })
    expect(facetPolarityOf("DEADLINE", "Não, tudo certo.")).toEqual({ polarity: "UNKNOWN", mentioned: false })
  })

  it("N) protocolo: \"não tenho o protocolo\" ≠ \"seu protocolo é 123…\"; canal de retorno pela relação, não pela palavra", () => {
    const protocol = (text: string) => behaviorPolarityOf("PROVIDE_PROTOCOL", text)!.polarity
    expect(protocol("Resumindo, Renata: abri a contestação, e o seu protocolo é 2026 0926 3357.")).toBe("FULFILLED")
    expect(protocol("Protocolo: 202609130184.")).toBe("FULFILLED")
    expect(protocol("Não tenho o protocolo agora.")).toBe("INABILITY")
    expect(protocol("Não consigo te passar o protocolo.")).toBe("INABILITY")
    expect(protocol("Vou registrar no protocolo.")).toBe("UNKNOWN")
    expect(facetPolarityOf("RETURN_CHANNEL", "O retorno será enviado por SMS.").polarity).toBe("FULFILLED")
    expect(facetPolarityOf("RETURN_CHANNEL", "Não sei por onde vai ser o retorno.").polarity).toBe("INABILITY")
    expect(facetPolarityOf("RETURN_CHANNEL", "Eles vão verificar e te dão um retorno.").polarity).toBe("UNKNOWN")
    // Comportamento sem detector confiável: nenhuma polaridade (as regras anteriores continuam).
    expect(behaviorPolarityOf("REGISTER_DISPUTE", "Não registrei.")).toBeNull()
  })

  it("G/H/M) prazo NÃO CUMPRIDO VERIFICADO: \"Não sei te dizer um prazo\" é evidência do descumprimento, não contraprova", () => {
    const deadline = bySource(verify(v3Assessment()), REF.deadline)
    expect(deadline).toMatchObject({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED_ACTION", knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "OBSERVED_DEVIATION" } }, evidencePolarity: { behavior: "INFORM_DEADLINE", evidence: "INABILITY", fulfilledTurns: [], conflict: null }, canonical: { behavior: "INFORM_DEADLINE", role: "PRIMARY", conflict: false } })
    // Com o prazo dito em outro momento da chamada, o "não cumprido" deixa de se sustentar sozinho (contraprova REAL).
    const informed = V171M_TRANSCRIPT.replace("Operador: Agora é aguardar a análise, eles vão verificar e te dão um retorno.", "Operador: Agora é aguardar a análise, que sai em até cinco dias úteis.")
    const contradicted = bySource(verify(v3Assessment(), informed), REF.deadline)
    expect(contradicted.evidencePolarity).toMatchObject({ conflict: "BEHAVIOR_FULFILLED_ELSEWHERE", fulfilledTurns: ["T15"] })
    expect(contradicted.knowledge!.applicability).toBe("LITERAL_ONLY")
  })
})

describe("V1.7.1n — Chat futuro: prazo MENCIONADO ≠ prazo INFORMADO (§25)", () => {
  it("\"Não sei informar o prazo\" nunca produz INFORM_DEADLINE = FOLLOWED verificado", () => {
    const transcript = V171M_TRANSCRIPT.replace("Operador: Não sei te dizer um prazo certinho, depende da fila deles.", "Operador: Não sei informar o prazo, depende da fila deles.")
    const assessment = verify(v3Assessment((raw) => {
      Object.assign(raw.processes[0]!.checkpoints[2]!, { status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Não sei informar o prazo, depende da fila deles."] })
      raw.processes[1]!.checkpoints.splice(0, 1)
    }), transcript)
    const deadline = bySource(assessment, REF.deadline)
    expect(deadline.evidencePolarity).toMatchObject({ evidence: "INABILITY", conflict: "FOLLOWED_WITHOUT_FULFILLING_EVIDENCE" })
    expect(deadline.knowledge!.applicability).not.toBe("VERIFIED")
    const observation = observationsFrom("op-n", [{ interactionId: "int-n", assessment }]).find((entry) => entry.canonicalBehavior === "INFORM_DEADLINE")!
    expect(observation).toMatchObject({ status: "FOLLOWED", analyticsStatus: "NEEDS_REVIEW", analyticsReasons: expect.arrayContaining(["EVIDENCE_POLARITY_CONFLICT"]) })
    expect(isObservationEligibleForAnalytics(observation)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// P — replay do smoke REAL da V1.7.1m (A–K) pelo "Gerar feedback" inteiro, com a resposta REAL do redator
// ---------------------------------------------------------------------------------------------------------------------
/** O redator real respondeu por slot (ordem dos itens daquela execução): mapeia pelo requisito. */
const SLOTS: [RegExp, number][] = [[/prazo objetivo/, 0], [/^Cancelar a recorrência/, 2], [/^Registrar contestação/, 3], [/restaram dúvidas/, 4], [/protocolo/, 5]]
function writer(): ReliableFeedbackWriterPort & { requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    writeMonitoring: async (input) => {
      requested.push(...input.items.map((item) => item.requirement ?? ""))
      return { rawOutput: { items: input.items.flatMap((item) => { const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? "")); return hit ? [{ ...V171M_WRITER_RAW.items[hit[1]]!, slot: item.slot }] : [] }), presentation: V171M_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay(assessment: RawProcessAssessment = v3Assessment(), transcript = V171M_TRANSCRIPT) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const port = writer()
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript, label: `Atendimento de 26/09/2026 · ${V171M_SUBJECT}`, otherOperatorNames: [], subjectOperatorName: V171M_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171M_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-26T14:30:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171M_PRESENTED, input: { organizationId: "org-n", operatorId: "op-n", interactionId: "int-n", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171M_DOC_TITLE, recommendation: "r", processAssessment: clone(assessment) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-n", enrollmentId: "enr-n", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-n", interactionId: "int-n", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, result, artifact, text, requested: port.requested }
}

describe("V1.7.1n — P) replay do smoke REAL da V1.7.1m (A–K)", () => {
  it("cada comportamento uma vez; sem 'Confirmação de entendimento' falando de prazo; recapitulação parcial; prazo sem QA por palavra", async () => {
    const { artifact, text, requested, store } = await replay()
    const titles = [...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])
    // Ordem do procedimento: prazo (seção 35) antes da recapitulação (46); pontos fortes depois.
    // V1.7.2 — blocos só para os ajustes; os cumpridos em "O que manter", uma vez cada.
    expect(titles).toEqual(["Prazo da análise", "Recapitulação obrigatória"])
    for (const title of titles) expect(titles.filter((entry) => entry === title)).toHaveLength(1)
    // B/C/D) a confirmação de entendimento é UM ponto cumprido, com a pergunta real no item — nunca sobre prazo.
    const maintain = text.slice(text.indexOf("## O que manter"), text.indexOf("**Materiais utilizados**"))
    // Feedback Experience V2 — "O que manter" são as evidências: cada comportamento UMA vez (título único).
    const maintainTitles = [...maintain.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => match[1])
    expect(new Set(maintainTitles).size).toBe(maintainTitles.length)
    expect(maintainTitles.filter((title) => /entendimento/i.test(title ?? ""))).toHaveLength(1)
    const confirmation = artifact.items.find((item) => item.process?.behavior?.code === "CONFIRM_UNDERSTANDING")!
    expect(confirmation.facts.map((fact) => fact.text)).toContain("Ficou alguma dúvida sobre o que a gente combinou?")
    expect(confirmation.proposedWording!.observed).not.toMatch(/prazo certinho|próximo passo e o prazo/)
    // G/H) prazo: um ponto de desenvolvimento verificado, com a faceta do próximo passo do Checklist como fonte oficial.
    const deadline = artifact.items.find((item) => item.process?.behavior?.code === "INFORM_DEADLINE")!
    expect(deadline).toMatchObject({ section: "OPPORTUNITY", knowledge: { applicability: "VERIFIED" }, process: { behavior: { facets: ["DEADLINE", "NEXT_STEP"], conflict: false }, sourceCheckpoint: { ref: REF.deadline, origin: "MODEL" }, evidencePolarity: { evidence: "INABILITY", conflict: null } } })
    expect(deadline.decision!.reasons).not.toContain("KNOWLEDGE_APPLICABILITY_UNVERIFIED")
    // E/F) protocolo VERIFICADO pela etapa "- [ ] Forneci protocolo?" (a citação sem "[ ]" não importa).
    expect(artifact.items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")).toMatchObject({ section: "STRENGTH", knowledge: { applicability: "VERIFIED" }, decision: { disposition: "READY" } })
    // I/J) recapitulação completada pelo sistema: parcial, texto do sistema, sem QA.
    expect(artifact.items.find((item) => item.process?.behavior?.code === "RECAPITULATE_INTERACTION")).toMatchObject({ section: "OPPORTUNITY", wordingSource: "SYSTEM", decision: { disposition: "READY" }, process: { sourceCheckpoint: { ref: REF.recap, origin: "SYSTEM_COMPLETION", processRequirement: "REQUIRED" }, completeness: { status: "PARTIAL", absent: ["prazo", "canal de retorno"] } } })
    // K) nenhum comportamento duplicado; nada de conflito falso.
    expect(artifact.items.every((item) => !item.process?.behavior?.conflict)).toBe(true)
    // Ao redator vão só os pontos com texto dele (a recapitulação parcial é do sistema): 5 (antes 6, com a confirmação duplicada).
    expect(requested).toHaveLength(5)
    // QA remanescente (§27): só o que é legítimo — nada por lista na citação, "[ ]" ausente, palavra negada ou recapitulação omitida.
    expect(store.reviews.map((review) => artifact.items[review.itemIndex]!.decision!.reasons)).toEqual([])
    expect(artifact.findings).toMatchObject({ inFeedback: 6, heldForQa: 0, blocked: 0 })
  })

  it("visão analítica: CÓDIGO DA ETAPA → COMPORTAMENTO → OBSERVAÇÃO; uma contribuição por comportamento, nenhum conflito falso", () => {
    const assessment = verify(v3Assessment())
    const observations = observationsFrom("op-n", [{ interactionId: "int-n", assessment }])
    expect(observations.map((observation) => [observation.canonicalBehavior, observation.checkpointRef, observation.status, observation.completeness, observation.analyticsStatus, observation.sourceLineages?.length ?? 0])).toEqual([
      ["CANCEL_RECURRING_SERVICE", REF.cancel, "FOLLOWED", null, "VERIFIED", 1],
      ["REGISTER_DISPUTE", REF.register, "FOLLOWED", null, "VERIFIED", 1],
      ["INFORM_DEADLINE", REF.deadline, "NOT_FOLLOWED", null, "VERIFIED", 2],
      ["CONFIRM_UNDERSTANDING", REF.doubts, "FOLLOWED", null, "VERIFIED", 2],
      ["PROVIDE_PROTOCOL", REF.protocol, "FOLLOWED", null, "VERIFIED", 1],
      ["RECAPITULATE_INTERACTION", REF.recap, "NOT_FOLLOWED", "PARTIAL", "VERIFIED", 1],
    ])
    expect(observations.every(isObservationEligibleForAnalytics)).toBe(true)
    expect(observations.find((observation) => observation.canonicalBehavior === "INFORM_DEADLINE")!.sourceLineages!.map((lineage) => [lineage.sourceCheckpointRef, lineage.role, lineage.status])).toEqual([[REF.deadline, "PRIMARY", "NOT_FOLLOWED"], [REF.nextStep, "SUPPORTING", "NOT_FOLLOWED"]])
    expect(observations.find((observation) => observation.canonicalBehavior === "RECAPITULATE_INTERACTION")!.sourceLineages![0]).toMatchObject({ origin: "SYSTEM_COMPLETION" })
    expect(assessment.behaviors!.filter((group) => group.conflict)).toEqual([])
  })
})

describe("V1.7.1n — O) INDICATOR SAFETY: 5 interações × (prazo + fonte transversal) × \"não consigo informar o prazo\"", () => {
  it("5 interações → 5 gaps de prazo (nunca 0 por contraprova léxica, nunca 10 por fonte duplicada)", () => {
    const transcript = [
      "Operador: Bom dia, aqui é a Larissa. Com quem eu falo?",
      "Cliente: Oi, aqui é a Renata. Veio uma cobrança que eu não reconheço.",
      "Operador: Vou abrir a contestação das cobranças pra área de faturamento analisar.",
      "Cliente: E demora?",
      "Operador: Não consigo informar o prazo, depende da fila deles.",
      "Cliente: Tá bom.",
      "Operador: Obrigada pela ligação, Renata, bom dia!",
    ].join("\n")
    const unit = { requirement: "Informar o prazo", status: "NOT_FOLLOWED" as const, evidenceType: "OBSERVED" as const, transcriptEvidence: ["Operador: Não consigo informar o prazo, depende da fila deles."], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE" as const, text: null }, uncertainty: null }
    const assessment: RawProcessAssessment = { processes: [{ documentTitle: V171M_DOC_TITLE, product: null, checkpoints: [{ ...unit, checkpointRef: REF.deadline }] }, { documentTitle: "Checklist de Encerramento de Chamada", product: null, checkpoints: [{ ...unit, checkpointRef: REF.nextStep }] }], applicability: [] }
    const interactions = [1, 2, 3, 4, 5].map((n) => ({ interactionId: `int-${n}`, handle: `I${n}`, assessment: verify(assessment, transcript, `int-${n}`, false), label: `Atendimento ${n}`, otherOperatorNames: [] }))
    for (const interaction of interactions) expect(bySource(interaction.assessment, REF.deadline)).toMatchObject({ status: "NOT_FOLLOWED", knowledge: { applicability: "VERIFIED" }, canonical: { role: "PRIMARY" } })
    const observations = observationsFrom("op-n", interactions)
    expect(observations).toHaveLength(5)
    expect(summarizeObservations(observations).find((entry) => entry.practiceKey === "BEHAVIOR:INFORM_DEADLINE")).toEqual({ practiceKey: "BEHAVIOR:INFORM_DEADLINE", followed: 0, notFollowed: 5, partial: 0, excluded: 0 })
    expect(aggregateProcessPatterns(interactions).find((pattern) => pattern.practiceKey === "BEHAVIOR:INFORM_DEADLINE")).toMatchObject({ analyzed: 5, notFollowed: ["I1", "I2", "I3", "I4", "I5"] })
    expect(V171M_PUBLISHED.has(V171M_DOC_ID)).toBe(true)
  })
})
