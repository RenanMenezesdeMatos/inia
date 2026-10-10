import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { triageIndicator } from "../../indicator-diagnosis/domain/closing-triage.js"
import { summarizeOperationalPatterns, type OperationalObservation } from "../../indicator-diagnosis/domain/operational-patterns.js"
import { mixShiftOf } from "../../indicator-diagnosis/domain/population-mix.js"
import type { OfficialIndicatorSnapshot, PrvClosing } from "../../indicator-diagnosis/domain/prv-closing.js"
import { buildIndicatorInvestigation, buildPrvClosingDiagnosis, teamPatternsOf, type PrvClosingDiagnosis } from "../../indicator-diagnosis/domain/prv-investigation.js"
import { buildPrvClosingItems, closingCanonicalContextOf, howToImproveOf } from "./prv-closing-items.js"
import { deterministicPrvNarrative, prvCollaboratorViewOf, prvNarrativeBriefOf, prvNarrativeViolations, prvSupervisorViewOf, prvTextViolations, resolvePrvNarrative, unqualifiedGeneralizations, type PrvClosingArtifactData } from "./prv-closing-views.js"
import { PRV_NARRATIVE_FREEZE_FILE, prvNarrativeFingerprint, PRV_NARRATIVE_SYSTEM_PROMPT, projectPrvBriefForModel } from "./prv-narrative-prompt.js"
import { emittedItems, type ArtifactItem, type ReliableFeedbackArtifactV1 } from "./reliable-feedback-artifact.js"
import { decideReliableItem, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY } from "./reliable-feedback-item.js"
import { toIndicatorWriterItem, validateIndicatorWording } from "./reliable-writer.js"

const TMA: OfficialIndicatorSnapshot = { snapshotId: "00000000-0000-4000-8000-0000000000a1", indicatorId: "00000000-0000-4000-8000-0000000000b1", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", direction: "LOWER", referencePeriod: "2026-08", value: 495, target: 450, achievementPercent: 90.9, weightPercent: 25, quartile: "Q4", subteamId: null }
const closing: PrvClosing = { contract: "PRV_CLOSING_V1", organizationId: "org", personId: "person", referencePeriod: "2026-08", prv: { snapshotId: "prv", referencePeriod: "2026-08", achievementPercent: 88, quartile: "Q4" }, indicators: [TMA], previous: { referencePeriod: "2026-07", prv: null, indicators: [{ ...TMA, snapshotId: "prev", referencePeriod: "2026-07", value: 410, quartile: "Q2" }] } }
const rule = { documentId: "00000000-0000-4000-8000-0000000000d1", documentTitle: "Procedimento de Contestação", heading: "46. Recapitulação", quote: "Antes de encerrar, recapitule o que foi feito e o próximo passo." }
const obs = (id: string, status: OperationalObservation["status"], overrides: Partial<OperationalObservation> = {}): OperationalObservation => ({ interactionId: id, practiceKey: "BEHAVIOR:RECAPITULATE_INTERACTION", behavior: "RECAPITULATE_INTERACTION", title: "Recapitulação", requirement: "Recapitular", documentId: rule.documentId, documentTitle: rule.documentTitle, status, completeness: status === "NOT_FOLLOWED" ? "PARTIAL" : null, analyticsStatus: "VERIFIED", origin: "ASSESSED", evidence: [{ text: `Então resumindo: fica aberta a contestação (${id}).`, truncated: false }], rule, guidance: null, ...overrides })

function diagnosisOf(input: { observations: OperationalObservation[]; ids: string[]; team?: ReturnType<typeof teamPatternsOf>; mix?: boolean }): PrvClosingDiagnosis {
  const triage = triageIndicator(TMA, closing.previous!.indicators[0]!, { versionId: "strategy-v1", version: 1, closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: false, quartileWorsened: false, recognitionQuartiles: ["Q1"] } })
  const interactions = input.ids.map((id, index) => ({ interactionId: id, localDate: `2026-08-${String(10 + index).padStart(2, "0")}`, weekday: (index % 5) + 1, hour: 10, segmentKey: "CONT", segmentLabel: "Contestação de cobrança", origin: index < 2 ? "REUSED" as const : "ASSESSED" as const }))
  const investigation = buildIndicatorInvestigation({
    closing,
    triage,
    strategy: { versionId: "strategy-v1", version: 1 },
    snapshot: { indicatorId: TMA.indicatorId, indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", direction: "LOWER", snapshotId: TMA.snapshotId },
    window: { startDate: "2026-08-01", endDate: "2026-09-01", timeZone: "America/Sao_Paulo" },
    metric: "INTERACTION_DURATION_SECONDS",
    interactionsInPeriod: 50,
    segments: [{ key: "CONT", label: "Contestação de cobrança", canonical: true, interactions: 17, withTranscript: 12, averageDurationSeconds: 620, sharePercent: 34, eligible: true }],
    selectedSegment: { key: "CONT", label: "Contestação de cobrança", reason: "maior tempo registrado acima da média geral" },
    overallAverageDurationSeconds: 460,
    sample: { eligibleCount: 12, reusableCount: 2, incompatibleCount: 0, unobservedCount: 10, selectedForAssessment: 3, analyzedCount: input.ids.length, reusedObservationCount: 2, reanalyzedInteractionCount: input.ids.length - 2, newObservationCount: input.ids.length - 2, selectionReason: "teste", sampling: null, discarded: [] },
    minimumAnalyzed: 3,
    mix: input.mix ? mixShiftOf([{ key: "CONT", label: "Contestação de cobrança", interactions: 17, totalDurationSeconds: 17 * 620 }, { key: "SEG", label: "Segunda via", interactions: 33, totalDurationSeconds: 33 * 380 }], [{ key: "CONT", label: "Contestação de cobrança", interactions: 9, totalDurationSeconds: 9 * 600 }, { key: "SEG", label: "Segunda via", interactions: 41, totalDurationSeconds: 41 * 370 }]) : null,
    patterns: summarizeOperationalPatterns({ interactions, observations: input.observations, eligiblePopulation: 12 }),
    team: input.team ?? { status: "NOT_AVAILABLE", contributors: 0, observedInteractions: 0, behaviors: [] },
  })
  return buildPrvClosingDiagnosis({ closing, triage: { version: "CLOSING_TRIAGE_V1", referencePeriod: "2026-08", decisions: [triage] }, investigations: [investigation], idempotencyKey: "PRV_DIAGNOSIS_V1:2026-08:abc", generatedAt: "2026-09-29T12:00:00.000Z" })
}

function artifactOf(diagnosis: PrvClosingDiagnosis, policy = RELIABLE_FEEDBACK_AUTONOMOUS_POLICY) {
  const built = buildPrvClosingItems(diagnosis)
  const canonical = closingCanonicalContextOf(diagnosis.investigations[0]!, "person", "2026-09-29T12:00:00.000Z")
  const items: ArtifactItem[] = built.items.map((item) => {
    const wording = built.wordings.get(item.index)!
    const writerItem = toIndicatorWriterItem(item, `ITEM_${item.index + 1}`, canonical)
    const violations = validateIndicatorWording(wording, writerItem, canonical)
    const { analysis, ...rest } = item
    void analysis
    return { ...rest, analysisUsed: false, slot: null, proposedWording: wording, wordingSource: "SYSTEM", writerViolations: violations, decision: decideReliableItem(item, { invoked: false, writerError: null, source: "SYSTEM", violations, wording, claimModes: null }, policy) }
  })
  const data: PrvClosingArtifactData = { contract: "PRV_CLOSING_FEEDBACK_V1", idempotencyKey: diagnosis.idempotencyKey, referencePeriod: "2026-08", diagnosis, itemRefs: built.items.map((item) => ({ index: item.index, indicatorCode: "TMA", practiceKey: item.claimRef.split(":").slice(1).join(":") === "OFFICIAL" ? null : item.claimRef.split(":").slice(1).join(":") })), recipient: { firstName: "Larissa" }, narrative: null, usage: { reanalysis: { agentRunId: null, assessedInteractions: 0 }, narrative: null } }
  const artifact: ReliableFeedbackArtifactV1 = { contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", domain: "INDICATOR", sourceNodeId: "agent", sourceType: "AGENT", subject: { collaboratorId: "person", interactionId: null, indicatorMeasurementId: null }, label: "Fechamento de agosto de 2026", items, uncertainties: [], blockedReason: null, policyVersion: policy.version, writer: { invoked: false, skippedReason: null, error: null, promptVersion: null }, prvClosing: data }
  return { artifact, data, items }
}

const actionable = () => diagnosisOf({ ids: ["i1", "i2", "i3", "i4", "i5", "i6"], observations: [obs("i1", "NOT_FOLLOWED"), obs("i2", "NOT_FOLLOWED"), obs("i3", "NOT_FOLLOWED"), obs("i4", "NOT_FOLLOWED"), obs("i5", "FOLLOWED"), obs("i6", "FOLLOWED"), ...["i1", "i2", "i3", "i4", "i5", "i6"].map((id) => obs(id, "FOLLOWED", { practiceKey: "BEHAVIOR:PROVIDE_PROTOCOL", behavior: "PROVIDE_PROTOCOL", title: "Protocolo", completeness: null }))] })

describe("Indicator Diagnosis V1 — feedback do fechamento (itens, projeções, narrativa)", () => {
  it("itens do sistema passam nos MESMOS validadores do feedback de indicador e seguem sem QA na política autônoma", () => {
    const { items } = artifactOf(actionable())
    expect(items.map((item) => item.kind)).toEqual(["INDICATOR_TARGET_NOT_MET", "INDICATOR_DEVELOPMENT_PATTERN", "INDICATOR_STRENGTH_PATTERN"])
    for (const item of items) expect(item.writerViolations).toEqual([])
    expect(items.every((item) => item.decision.disposition === "READY")).toBe(true)
    expect(items[1]!.proposedWording!.observed).toBe("A recapitulação não trouxe todos os pontos previstos em 4 de 6 chamadas analisadas de Contestação de cobrança.")
    // Piloto: tudo emitível passa por QA.
    expect(artifactOf(actionable(), RELIABLE_FEEDBACK_PILOT_POLICY).items.every((item) => item.decision.disposition === "HOLD_FOR_QA")).toBe(true)
  })

  it("L. NO_CAUSAL_UPGRADE: 'coincidiu com' passa; 'por causa de'/'provocou'/'foi responsável' é recusado (TMA e motivo)", () => {
    const { data, artifact } = artifactOf(diagnosisOf({ ids: ["i1", "i2", "i3", "i4", "i5"], mix: true, observations: ["i1", "i2", "i3", "i4"].map((id) => obs(id, "NOT_FOLLOWED")).concat(obs("i5", "FOLLOWED")) }))
    const brief = prvNarrativeBriefOf(emittedItems(artifact, []), data)
    expect(prvTextViolations("O TMA aumentou por causa das chamadas de Contestação de cobrança.", brief, "SUPERVISOR", { firstName: null })).toContain("CAUSAL_CLAIM")
    expect(prvTextViolations("As chamadas de Contestação de cobrança provocaram o aumento do tempo.", brief, "SUPERVISOR", { firstName: null })).toContain("CAUSAL_CLAIM")
    expect(prvTextViolations("A recapitulação foi responsável pelo resultado do TMA.", brief, "SUPERVISOR", { firstName: null })).toContain("CAUSAL_CLAIM")
    expect(prvTextViolations("O aumento das chamadas de Contestação de cobrança coincidiu com o TMA fora da meta.", brief, "SUPERVISOR", { firstName: null })).toEqual([])
    expect(brief.indicators[0]!.mix).toMatchObject({ before: "18%", now: "34%", longerDuration: true })
  })

  it("nunca recomenda pressa, traço, culpa, equipe, nome ou número fora da entrada", () => {
    const { data, artifact } = artifactOf(actionable())
    const brief = prvNarrativeBriefOf(emittedItems(artifact, []), data)
    const context = { firstName: "Larissa" }
    expect(prvTextViolations("Fale mais rápido e encerre mais cedo.", brief, "COLLABORATOR", context)).toContain("SPEED_ADVICE")
    expect(prvTextViolations("Reduza as explicações nas chamadas.", brief, "COLLABORATOR", context)).toContain("SPEED_ADVICE")
    expect(prvTextViolations("Você costuma esquecer a recapitulação.", brief, "COLLABORATOR", context)).toContain("PATTERN_OR_TRAIT_LANGUAGE")
    expect(prvTextViolations("Foi um erro não recapitular.", brief, "COLLABORATOR", context)).toContain("BLAME_LANGUAGE")
    expect(prvTextViolations("Sua equipe também tem esse ponto.", brief, "COLLABORATOR", context)).toContain("TEAM_REFERENCE")
    expect(prvTextViolations("Larissa, seu TMA ficou em 495 s.", brief, "COLLABORATOR", context)).toContain("NAME_OR_GREETING")
    expect(prvTextViolations("Seu TMA ficou em 512 s.", brief, "COLLABORATOR", context)).toContain("UNSUPPORTED_NUMBER")
    expect(prvTextViolations("Seu TMA oficial foi de 495 s, fora da meta de 450 s.", brief, "COLLABORATOR", context)).toEqual([])
    // Smoke real: "amostra" é vocabulário da visão técnica do supervisor, nunca da mensagem ao colaborador.
    expect(prvTextViolations("Não há padrão sustentado na amostra analisada.", brief, "SUPERVISOR", context)).toEqual([])
    expect(prvTextViolations("Não há padrão sustentado na amostra analisada.", brief, "COLLABORATOR", context)).toContain("INTERNAL_TERMS")
  })

  it("narrativa do sistema é sempre válida, cita o ajuste e nunca fala de equipe; rascunho inválido cai campo a campo", () => {
    const { data, artifact } = artifactOf(actionable())
    const items = emittedItems(artifact, [])
    const brief = prvNarrativeBriefOf(items, data)
    const system = deterministicPrvNarrative(brief)
    expect(prvNarrativeViolations(system.paragraphs, brief, { firstName: "Larissa" })).toEqual([])
    expect(system.paragraphs.join(" ")).toContain("recapitulação não trouxe todos os pontos previstos em 4 de 6")
    expect(system.paragraphs.join(" ")).toContain("Mantenha o que já funciona")
    const withDraft = { ...data, narrative: { version: "PRV_NARRATIVE_V1" as const, promptVersion: "PRV_INDICATOR_NARRATIVE_PROMPT_V1", itemsKey: brief.itemsKey, error: null, provenance: null, draft: { paragraphs: ["Seu TMA ficou fora da meta porque as recapitulações foram incompletas."], card: "TMA fora da meta; foco na recapitulação.", supervisorNotes: ["O aumento de Contestação de cobrança coincidiu com o resultado."] } } }
    const resolved = resolvePrvNarrative(withDraft.narrative, items, withDraft)
    expect(resolved.source).toEqual({ paragraphs: "SYSTEM", card: "WRITER", supervisorNotes: "WRITER" })
    expect(resolved.violations.paragraphs).toContain("CAUSAL_CLAIM")
    // Itens mudaram (QA rejeitou o padrão): o rascunho não vale para outros itens.
    const stale = resolvePrvNarrative(withDraft.narrative, items.slice(0, 1), withDraft)
    expect(stale.source.card).toBe("SYSTEM")
  })

  it("M. padrão só do Subgrupo nunca chega ao colaborador; aparece na visão do supervisor como não atribuído", () => {
    const team = teamPatternsOf(["p1", "p2", "p3", "p4"].flatMap((person) => [1, 2].map((n) => ({ personId: person, interactionId: `${person}-${n}`, practiceKey: "BEHAVIOR:RECAPITULATE_INTERACTION", title: "Recapitulação", status: "NOT_FOLLOWED" as const }))))
    const diagnosis = diagnosisOf({ ids: ["i1", "i2", "i3", "i4", "i5"], team, observations: ["i1", "i2", "i3", "i4", "i5"].map((id) => obs(id, "FOLLOWED", { completeness: null })) })
    const { data, artifact } = artifactOf(diagnosis)
    const items = emittedItems(artifact, [])
    expect(items.some((item) => item.kind === "INDICATOR_DEVELOPMENT_PATTERN")).toBe(false)
    const narrative = resolvePrvNarrative(null, items, data)
    const collaborator = prvCollaboratorViewOf(items, data, narrative)
    expect(JSON.stringify(collaborator)).not.toMatch(/Subgrupo|equipe|grupo/i)
    expect(collaborator.developments).toEqual([])
    const supervisor = prvSupervisorViewOf(data, narrative)
    expect(supervisor.indicators[0]!.patterns[0]!.attribution).toBe("só do Subgrupo — não atribuído ao colaborador")
    expect(supervisor.indicators[0]!.team.behaviors[0]).toMatchObject({ title: "Recapitulação", classification: "a desenvolver" })
  })

  it("visão do colaborador: narrativa primeiro, resultado do ciclo, padrão com exemplos e regra; supervisor: população, amostra, reuso e limitações", () => {
    const { data, artifact } = artifactOf(actionable())
    const items = emittedItems(artifact, [])
    const narrative = resolvePrvNarrative(null, items, data)
    const view = prvCollaboratorViewOf(items, data, narrative)
    expect(view.kind).toBe("INDICATOR")
    expect(view.greeting).toBe("Olá, Larissa!")
    expect(view.cycle?.indicators[0]!.lines).toEqual(expect.arrayContaining([{ label: "Resultado oficial", value: "495 s" }, { label: "Meta oficial", value: "450 s" }, { label: "Quartil oficial", value: "Q4 (Q1 = melhor, Q4 = pior)" }]))
    expect(view.developments[0]).toMatchObject({ title: "Recapitulação", call: { kind: "QUOTES" } })
    expect(view.developments[0]!.guidance.rules[0]).toEqual({ text: rule.quote, section: "Recapitulação" })
    expect(view.maintain?.evidence[0]?.title).toBe("Protocolo")
    expect(view.materials[0]).toMatchObject({ title: "Procedimento de Contestação", usedIn: ["Recapitulação", "Protocolo"] })
    const supervisor = prvSupervisorViewOf(data, narrative)
    expect(supervisor.indicators[0]!.sample).toMatchObject({ eligible: 12, analyzed: 6, reused: 2, reanalyzed: 4 })
    expect(supervisor.indicators[0]!.patterns[0]).toMatchObject({ title: "Recapitulação", eligible: 6, notFollowed: 4, followed: 2, partial: 4 })
    expect(supervisor.indicators[0]!.limitations.join(" ")).toContain("não demonstra que ele causou")
  })

  it("payload do modelo: lista branca, sem id/link e só com o que o sistema já contou; prompt congelado", () => {
    const { data, artifact } = artifactOf(actionable())
    const payload = projectPrvBriefForModel(prvNarrativeBriefOf(emittedItems(artifact, []), data))
    const text = JSON.stringify(payload)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(text).not.toContain("/materiais/")
    expect(text).not.toContain("Larissa")
    expect(payload.indicators[0]!.toAdjust[0]!.whatHappened).toContain("4 de 6")
    const freeze = JSON.parse(readFileSync(join(import.meta.dirname, PRV_NARRATIVE_FREEZE_FILE), "utf8")) as { promptSha256: string; writerSha256: string; systemPrompt: string }
    expect(freeze.systemPrompt).toBe(PRV_NARRATIVE_SYSTEM_PROMPT)
    expect(freeze.writerSha256).toBe(prvNarrativeFingerprint().writerSha256)
  })
})

describe("V1.0.2 — precisão da projeção ao colaborador", () => {
  it("'Como aplicar' vira ação humana derivada da regra verificada (nunca o item do checklist cru); sem ação reconhecível, a regra literal", () => {
    expect(howToImproveOf("- [ ] Informei prazo e canal de retorno?", "Contestação de cobrança")).toBe("Nas próximas chamadas de contestação de cobrança, informe prazo e canal de retorno.")
    expect(howToImproveOf("O operador deverá informar o prazo exibido na ferramenta.", "Contestação de cobrança")).toBe("Nas próximas chamadas de contestação de cobrança, informe o prazo exibido na ferramenta.")
    expect(howToImproveOf("Antes de encerrar, informar: Conta analisada; Valor; Prazo", "Contestação de cobrança")).toBe("Nas próximas chamadas de contestação de cobrança, antes de encerrar, informe: conta analisada, valor e prazo.")
    expect(howToImproveOf("Antes de encerrar, recapitule o que foi feito.", "Contestação de cobrança")).toBe("Nas próximas chamadas de contestação de cobrança: antes de encerrar, recapitule o que foi feito.")
    expect(howToImproveOf("- [ ] Recapitulei os prazos combinados?", "Contestação de cobrança")).toMatch(/^Nas próximas chamadas de contestação de cobrança, (?:recapitule|siga o que o procedimento orienta)/)
    expect(howToImproveOf("- [ ] Informei prazo e canal de retorno?", "Contestação de cobrança")).not.toMatch(/\[ \]|\?/)
  })

  it("frase REAL publicada no smoke V1.0.1 ('Nesses atendimentos, o prazo … não foi informado') generaliza além do denominador → recusada; com escopo passa", () => {
    const brief = { indicators: [{ adjust: [{ topic: "Prazo da análise" }] }] } as unknown as Parameters<typeof unqualifiedGeneralizations>[1]
    const published = "Observamos que o motivo Contestação de cobrança passou a representar 35,3% dos seus atendimentos, sendo que este tema apresenta uma duração média de 939 s. Nesses atendimentos, o prazo da análise não foi informado ao cliente. Para as próximas chamadas, lembre-se de conferir se informou o prazo e o canal de retorno ao cliente."
    expect(unqualifiedGeneralizations(published, brief)).toEqual(["Nesses atendimentos, o prazo da análise não foi informado ao cliente."])
    for (const scoped of ["Nas chamadas analisadas, o prazo da análise não foi informado de forma recorrente.", "Em 7 das 10 chamadas avaliadas, o prazo da análise não foi informado.", "Em parte relevante das chamadas analisadas, faltou informar o prazo da análise.", "Nas próximas chamadas, informe o prazo da análise."]) expect(unqualifiedGeneralizations(scoped, brief)).toEqual([])
  })
})
