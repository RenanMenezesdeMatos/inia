import { describe, expect, it } from "vitest"
import { completeTransition, isInviteEligible, pauseTransition, pickInvite, presentationEventAccepted, startTransition, type InviteCandidate } from "./feedback-application.js"
import { buildDeliveredFeedbackContext, buildPublishedFeedbackContext, renderHistoricalContextForModel, type PublishedFeedbackRecord } from "./historical-context.js"
import { buildApplicationPresentation, FEEDBACK_PRESENTATION_CUE, renderApplicationInstruction } from "./application-presentation.js"

const NOW = new Date("2026-10-01T15:00:00.000Z")

describe("estado da aplicação (separado do áudio e da ciência)", () => {
  it("iniciar é idempotente e concluída nunca reabre", () => {
    expect(startTransition("NOT_STARTED")).toEqual({ ok: true, changed: true, next: "IN_PROGRESS" })
    expect(startTransition("IN_PROGRESS")).toEqual({ ok: true, changed: false, next: "IN_PROGRESS" })
    expect(startTransition("COMPLETED")).toEqual({ ok: true, changed: false, next: "COMPLETED" })
  })
  it("concluir só a partir de em andamento; repetir é idempotente", () => {
    expect(completeTransition("IN_PROGRESS")).toEqual({ ok: true, changed: true, next: "COMPLETED" })
    expect(completeTransition("COMPLETED")).toEqual({ ok: true, changed: false, next: "COMPLETED" })
    expect(completeTransition("NOT_STARTED")).toEqual({ ok: false, reason: "NOT_STARTED" })
  })
  it("sair por agora mantém em andamento; áudio nunca muda o estado e não toca em modo consulta", () => {
    expect(pauseTransition("IN_PROGRESS")).toEqual({ ok: true, changed: true, next: "IN_PROGRESS" })
    expect(pauseTransition("COMPLETED")).toEqual({ ok: false, reason: "COMPLETED" })
    expect(presentationEventAccepted("IN_PROGRESS")).toBe(true)
    expect(presentationEventAccepted("COMPLETED")).toBe(false)
  })
})

describe("convite proativo", () => {
  const base: InviteCandidate = { source: { kind: "PUBLISHED_FEEDBACK", id: "a" }, publishedAt: new Date("2026-09-30T12:00:00.000Z"), acknowledged: false, status: "NOT_STARTED", inviteResolved: false }
  it("só feedback novo, não aplicado, sem ciência e sem decisão anterior", () => {
    expect(isInviteEligible(base, NOW)).toBe(true)
    expect(isInviteEligible({ ...base, publishedAt: new Date("2026-08-01T12:00:00.000Z") }, NOW)).toBe(false)
    expect(isInviteEligible({ ...base, acknowledged: true }, NOW)).toBe(false)
    expect(isInviteEligible({ ...base, inviteResolved: true }, NOW)).toBe(false)
    expect(isInviteEligible({ ...base, status: "IN_PROGRESS" }, NOW)).toBe(false)
    expect(isInviteEligible({ ...base, status: "COMPLETED" }, NOW)).toBe(false)
  })
  it("um convite por vez: o mais recente elegível", () => {
    const older = { ...base, source: { kind: "PUBLISHED_FEEDBACK" as const, id: "old" }, publishedAt: new Date("2026-09-28T12:00:00.000Z") }
    const snoozed = { ...base, source: { kind: "INTERACTION_FEEDBACK_DELIVERY" as const, id: "new" }, publishedAt: new Date("2026-10-01T09:00:00.000Z"), inviteResolved: true }
    expect(pickInvite([older, base, snoozed], NOW)?.source.id).toBe("a")
    expect(pickInvite([snoozed], NOW)).toBeNull()
  })
})

const INDICATOR_VIEW = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Rechamada", subtitle: "Agosto de 2026" },
  card: "Rechamada de 14,6%, fora da meta em agosto de 2026.",
  greeting: "Olá, Joana!",
  narrative: ["Em agosto de 2026, o resultado oficial de Rechamada foi de 14,6%, fora da meta de 10%.", "Os dados não indicam qual atendimento anterior originou a rechamada."],
  developments: [],
  maintain: null,
  attention: [],
  materials: [],
  context: null,
  kind: "INDICATOR",
  cycle: { title: "Resultado do período · agosto de 2026", indicators: [{ name: "Rechamada", lines: [{ label: "Resultado oficial", value: "14,6%" }, { label: "Meta oficial", value: "10%" }], notes: ["7 de 48 interações atendidas vieram marcadas como rechamada (14,6%)."] }] },
}

const record = (overrides: Partial<PublishedFeedbackRecord> = {}): PublishedFeedbackRecord => ({
  feedbackId: "f1", version: 1, kind: "INDICATOR", publishedAt: new Date("2026-09-12T13:00:00.000Z"),
  impactedIndicator: "Rechamada", evidenceFound: "", observedBehavior: "", relatedProcedure: "", recommendation: "texto", suggestedApproach: null,
  caseId: "c1", caseTitle: "Rechamada", caseSummary: "Rechamada de 14,6%.", snapshot: { reliableFeedback: { feedbackView: INDICATOR_VIEW } }, supportMaterials: [],
  ...overrides,
})

describe("contexto histórico — só o registro publicado", () => {
  it("copia indicadores, valores e metas DA AVALIAÇÃO (nunca consulta dado atual)", () => {
    const context = buildPublishedFeedbackContext(record(), NOW)
    expect(context.provenance).toBe("PUBLISHED_RECORD")
    expect(context.subject).toBe("Rechamada")
    expect(context.periodLabel).toBe("Agosto de 2026")
    expect(context.indicators).toEqual([{ name: "Rechamada", lines: [{ label: "Resultado oficial", value: "14,6%" }, { label: "Meta oficial", value: "10%" }], notes: ["7 de 48 interações atendidas vieram marcadas como rechamada (14,6%)."] }])
    const rendered = renderHistoricalContextForModel(context)
    expect(rendered).toContain("Registro publicado em 12/09/2026 (versão 1)")
    expect(rendered).toContain("Meta oficial = 10%")
  })

  it("rótulo relativo ('Ontem (D-1)') vira as DATAS registradas; sem datas, não é usado e vira limitação", () => {
    const legacy = record({ kind: "INDICATOR", snapshot: { periodSummary: { periodLabel: "Ontem (D-1)", periodStart: "2026-09-10T03:00:00.000Z", periodEnd: "2026-09-11T03:00:00.000Z" } }, evidenceFound: "Ontem (D-1) — Tempo Disponível: 77.21 PERCENT (meta vigente: 82 PERCENT)", recommendation: "Foque no pós-atendimento." })
    const context = buildPublishedFeedbackContext(legacy, NOW)
    expect(context.periodLabel).toBe("10/09/2026")
    expect(context.evidence).toContain("Ontem (D-1) — Tempo Disponível: 77.21 PERCENT (meta vigente: 82 PERCENT)")
    expect(context.limitations.join(" ")).toMatch(/não uma tabela estruturada de valores e metas/)
    expect(context.limitations.join(" ")).toMatch(/publicado antes da apresentação detalhada/)

    const noDates = buildPublishedFeedbackContext(record({ snapshot: { periodSummary: { periodLabel: "Mês anterior" } } }), NOW)
    expect(noDates.periodLabel).toBeNull()
    expect(noDates.limitations.join(" ")).toMatch(/não informa o período avaliado/)
  })

  it("feedback de atendimento: só a entrega já mascarada, sem indicadores", () => {
    const context = buildDeliveredFeedbackContext({ deliveryId: "d1", title: "Feedback de atendimento", sectionLabel: "Ponto positivo", section: "STRENGTH", interactionLabel: "14/09/2026", interactionAt: null, deliveredAt: "2026-09-15T12:00:00.000Z", blocks: [{ key: "observed", label: "O que observamos", text: "Você confirmou os dados do cliente." }], evidence: [{ speakerLabel: "Você", text: "Pode confirmar o CPF?", truncated: false }] }, NOW)
    expect(context.source).toEqual({ kind: "INTERACTION_FEEDBACK_DELIVERY", id: "d1", version: null })
    expect(context.periodLabel).toBe("Atendimento de 14/09/2026")
    expect(context.strengths).toEqual(["Você confirmou os dados do cliente."])
    expect(context.indicators).toEqual([])
  })
})

describe("apresentação — fala do que já foi publicado, situando o período", () => {
  it("histórico: diz o período e a data de publicação; usa o nome de tratamento; sem marcação na fala", () => {
    const context = buildPublishedFeedbackContext(record(), NOW)
    const presentation = buildApplicationPresentation({ context, view: INDICATOR_VIEW as never, addressName: "Jô", now: NOW })
    expect(presentation.historical).toBe(true)
    expect(presentation.chatText.startsWith("Olá, Jô! Este feedback se refere aos seus resultados de agosto de 2026 e foi publicado em 12/09/2026. Vamos conversar sobre os pontos observados naquele período.")).toBe(true)
    expect(presentation.chatText).toContain("fora da meta de 10%")
    expect(presentation.speechText).toMatch(/^Oi, Jô\. Este feedback se refere aos seus resultados de agosto de 2026 e foi publicado em 12 de setembro de 2026\./)
    expect(presentation.speechText).not.toMatch(/[*#_[\]]/)
    expect(presentation.suggestions).toContain("Como aplico essa orientação?")
  })

  it("saudação só com o primeiro nome do tratamento (escrita e falada)", () => {
    const context = buildPublishedFeedbackContext(record(), NOW)
    const presentation = buildApplicationPresentation({ context, view: INDICATOR_VIEW as never, addressName: "Larissa Monteiro", now: NOW })
    expect(presentation.chatText.startsWith("Olá, Larissa! ")).toBe(true)
    expect(presentation.speechText.startsWith("Oi, Larissa. ")).toBe(true)
  })

  it("publicado hoje não é tratado como histórico", () => {
    const context = buildPublishedFeedbackContext(record({ publishedAt: new Date("2026-10-01T12:00:00.000Z") }), NOW)
    expect(buildApplicationPresentation({ context, view: INDICATOR_VIEW as never, addressName: null, now: NOW }).historical).toBe(false)
  })

  it("instrução do modelo: só o registro, sem dados atuais, separando o período", () => {
    const context = buildPublishedFeedbackContext(record(), NOW)
    const presentation = buildApplicationPresentation({ context, view: INDICATOR_VIEW as never, addressName: "Joana", now: NOW })
    const instruction = renderApplicationInstruction({ context, presentation, now: NOW })
    expect(instruction).toContain("NÃO tem acesso aos resultados atuais")
    expect(instruction).toContain("Conversar sobre meus resultados atuais")
    expect(instruction).toContain("Hoje é 01/10/2026")
    expect(instruction).toContain("Resultado oficial = 14,6%")
    // Abertura ao vivo: o sinal da tela faz a INIA falar o texto JÁ aprovado da apresentação, sem gerar outro.
    expect(instruction).toContain(`quando a mensagem for exatamente ${FEEDBACK_PRESENTATION_CUE}`)
    expect(instruction).toContain(`<<<APRESENTACAO\n${presentation.speechText}\nAPRESENTACAO>>>`)
    // Dúvidas depois da conclusão: nada de reapresentar o feedback.
    const followUp = renderApplicationInstruction({ context, presentation, now: NOW, followUp: { completedDay: "01/10/2026", originalTurns: [] } })
    expect(followUp).not.toContain(FEEDBACK_PRESENTATION_CUE)
    expect(followUp).not.toContain("<<<APRESENTACAO")
  })
})
