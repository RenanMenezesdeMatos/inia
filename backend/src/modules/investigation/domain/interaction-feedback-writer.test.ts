import { describe, expect, it } from "vitest"
import { assertDisplaySafe, composeInteractionFeedback, displayableView, FeedbackRedactionPendingError, INTERNAL_REF_PATTERN, type ProceduralLineage } from "./interaction-feedback.js"
import { buildFeedbackWriterInput, fallbackItemWording, projectDisplayEvidence, resolveFeedbackWording, toWriterItem, validateItemWording, WRITER_CONSTRAINTS, type FeedbackWriterInputV1, type WriterItem } from "./interaction-feedback-writer.js"
import type { InteractionFinding, InteractionSemanticFrame, SemanticObservation } from "./interaction-semantic-frame.js"
import { projectPeerTranscript } from "./peer-privacy-projection.js"

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
const obs = (id: string, kind: SemanticObservation["kind"], speaker: string, turn: string, quote: string): SemanticObservation => ({ id, kind, summary: `RESUMO-DO-MODELO ${id} (I6)`, evidence: [unit(turn, speaker, quote)] })
let seq = 0
const finding = (kind: InteractionFinding["kind"], observations: SemanticObservation[], extra: Partial<InteractionFinding> = {}): InteractionFinding => {
  seq += 1
  return { id: `F${seq}`, interactionRef: "I6", kind, summary: "SUMMARY-DO-MODELO SF2", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${seq}`, ownership: "AGENT", ...extra }
}
const frame = (observations: SemanticObservation[], findings: InteractionFinding[]): InteractionSemanticFrame => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: observations.filter((item) => item.kind === "AGENT_ACTION") as never, agentStatements: observations.filter((item) => item.kind === "AGENT_STATEMENT") as never, commitments: [], customerSignals: observations.filter((item) => item.kind === "CUSTOMER_SIGNAL") as never, procedureAssertions: observations.filter((item) => item.kind === "PROCEDURE_ASSERTION") as never, interactionEvents: [], findings, empty: false })
const compose = (f: InteractionSemanticFrame, lineage?: Map<string, ProceduralLineage>) => composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: f, interactionLabel: "14/03/2026 · Segunda via", sourceRun: "run-1", proceduralLineage: lineage })

const RAW_CPF = "Confirmei aqui o seu CPF 123.456.789-09 e o telefone (11) 98765-4321, pode seguir."
const action = obs("A1", "AGENT_ACTION", "OPERADOR", "T4", RAW_CPF)
const statement = obs("D1", "AGENT_STATEMENT", "OPERADOR", "T19", "Isso é o ciclo de faturamento retroativo com pro rata do upgrade.")
const signal = obs("S1", "CUSTOMER_SIGNAL", "CLIENTE", "T20", "Pro rata? Moça, fala em português, por favor.")
const assertion = obs("P1", "PROCEDURE_ASSERTION", "OPERADOR", "T15", "Não precisa explicar, vou refazer por aqui.")
const kbLineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "Antes de acessar ou alterar informações protegidas, o operador deve explicar a necessidade da validação.", documentId: "11111111-2222-4333-8444-555555555555" }]])
const divergence = () => finding("PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })

describe("DISPLAY EVIDENCE — raw → display pela redaction canônica", () => {
  it("mascara só os fragmentos sensíveis com a MESMA lista da projeção de pares; raw intacto; origem registrada", () => {
    const display = projectDisplayEvidence({ turnRef: "T4", speaker: "OPERADOR", quote: RAW_CPF }, { factIndex: 0, evidenceType: "AGENT_ACTION" })
    expect(display).toMatchObject({ status: "DISPLAYED", text: "Confirmei aqui o seu CPF [CPF] e o telefone [TELEFONE], pode seguir.", wasRedacted: true, redactionKinds: ["CPF", "PHONE"], origin: { factIndex: 0, turnRef: "T4" } })
    // Equivalência com a infraestrutura canônica: o mesmo texto pela projeção de pares dá o mesmo resultado.
    expect(projectPeerTranscript({ sourceInteractionId: "x", transcript: RAW_CPF, peer: { personId: "p", fullName: "Nome Inexistente Qualquer" } }).projected).toBe((display as { text: string }).text)
    expect(action.evidence[0]!.quote).toBe(RAW_CPF)
    expect(JSON.stringify(display)).not.toContain("123.456.789-09")
  })
  it("sem PII o texto é o trecho verificado, sem alteração nenhuma", () => {
    expect(projectDisplayEvidence({ turnRef: "T19", speaker: "OPERADOR", quote: statement.evidence[0]!.quote }, { factIndex: 0, evidenceType: "AGENT_STATEMENT" })).toMatchObject({ text: statement.evidence[0]!.quote, wasRedacted: false, redactionKinds: [] })
  })
  it("fail-closed: identificador numérico que a infraestrutura não sabe mascarar e nome de outro operador não são exibidos", () => {
    expect(projectDisplayEvidence({ turnRef: "T1", speaker: "CLIENTE", quote: "O número da minha conta é 1234567890123, anota." }, { factIndex: 0, evidenceType: "CUSTOMER_NEED" })).toMatchObject({ status: "WITHHELD", reason: "UNMASKED_NUMERIC_IDENTIFIER" })
    // Cartão em blocos de 4 cai no padrão canônico de telefone: mascarado (rótulo impreciso), nenhum dígito exibido.
    const card = projectDisplayEvidence({ turnRef: "T1", speaker: "CLIENTE", quote: "Meu cartão é 4111 1111 1111 1111, anota." }, { factIndex: 0, evidenceType: "CUSTOMER_NEED" })
    expect(card.status === "DISPLAYED" ? card.text : "").not.toMatch(/\d{4}/)
    expect(projectDisplayEvidence({ turnRef: "T1", speaker: "OPERADOR", quote: "Vou te passar para o Carlos Menezes do suporte." }, { factIndex: 0, evidenceType: "AGENT_ACTION" }, { otherOperatorNames: ["Carlos Menezes"] })).toMatchObject({ status: "WITHHELD", reason: "OPERATOR_IDENTITY" })
    // Datas e horários não são identificador.
    expect(projectDisplayEvidence({ turnRef: "T1", speaker: "OPERADOR", quote: "A fatura vence em 14/03/2026 às 10:30." }, { factIndex: 0, evidenceType: "AGENT_STATEMENT" }).status).toBe("DISPLAYED")
  })
  it("redaction acontece ANTES do corte (nunca meio CPF sem máscara) e o corte não quebra marcador", () => {
    const quote = `${"a".repeat(236)} CPF 123.456.789-09 fim`
    const display = projectDisplayEvidence({ turnRef: "T1", speaker: "CLIENTE", quote }, { factIndex: 0, evidenceType: "CUSTOMER_NEED" })
    expect(display).toMatchObject({ status: "DISPLAYED", truncated: true })
    expect((display as { text: string }).text).not.toMatch(/\d/)
    expect((display as { text: string }).text.endsWith("[")).toBe(false)
  })
  it("raw nunca vira display automaticamente: FACT bruto falha no assertDisplaySafe; display passa", () => {
    const feedback = compose(frame([action], [finding("STRENGTH", [action])]))
    expect(() => assertDisplaySafe(feedback.items[0]!.fact[0]!)).toThrow(FeedbackRedactionPendingError)
    const display = projectDisplayEvidence(feedback.items[0]!.provenance.rawEvidence[0]!, { factIndex: 0, evidenceType: "AGENT_ACTION" })
    expect(() => assertDisplaySafe(display as never)).not.toThrow()
  })
})

describe("FEEDBACK WRITER INPUT V1 — só o necessário para escrever", () => {
  const feedback = compose(frame([action, statement, signal, assertion], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal]), divergence(), finding("INTERACTION_FRICTION", [signal], { ownership: "INTERACTION" })]), kbLineage)
  const prepared = buildFeedbackWriterInput(feedback)
  if (!prepared.invoke) throw new Error("deveria invocar")
  const text = JSON.stringify(prepared.input)
  it("só itens do colaborador; evidência só de display; knowledge só em KB_RULE com lineage", () => {
    // KB_RULE bloqueado para entrega: NÃO vai ao redator; fica registrado na auditoria.
    expect(prepared.input.items.map((item) => [item.slot, item.section, item.guidance.source])).toEqual([["ITEM_1", "STRENGTH", "REINFORCEMENT"], ["ITEM_2", "OPPORTUNITY", "COACHING_SUGGESTION"]])
    expect(prepared.audit.blocked).toEqual([{ itemIndex: 2, findingRef: expect.stringMatching(/^I6\/F\d+$/), reason: "PROCEDURAL_MATCHING_NOT_VALIDATED" }])
    expect(prepared.input.items[0]!.evidence[0]!.text).toContain("[CPF]")
    expect(prepared.input.items[1]!.guidance.knowledge).toBeNull()
    // Para o futuro (quando liberado), o item KB do redator leva título + trecho da regra — nunca ruleRef nem link.
    const kbItem = toWriterItem(feedback.items[2]!, "ITEM_X")!.writerItem
    expect(kbItem.guidance.knowledge).toEqual({ documentTitle: "Procedimento de Validação", ruleText: kbLineage.get("I6/P1")!.ruleQuote })
    expect(JSON.stringify(kbItem)).not.toMatch(/href|materiais|KR3|11111111/)
    expect(prepared.input.constraints.map((item) => item.code)).toEqual(WRITER_CONSTRAINTS.map((item) => item.code))
  })
  it("proibidos: handles, refs, provenance, candidato, summary do modelo, ids técnicos, raw", () => {
    expect(text).not.toMatch(INTERNAL_REF_PATTERN)
    expect(text).not.toMatch(/\bT\d+\b/)
    for (const forbidden of ["observationRef", "findingRef", "provenance", "candidate", "RESUMO-DO-MODELO", "SUMMARY-DO-MODELO", "123.456.789-09", "98765-4321", "0f0e0d0c", "ownership", "review", "audience", "rawSha256", "origin", "ledger"]) expect(text).not.toContain(forbidden)
    expect(prepared.audit.slots.map((slot) => [slot.slot, slot.itemIndex])).toEqual([["ITEM_1", 0], ["ITEM_2", 1]])
    for (const forbidden of ["href", "/materiais/", "openBehavior", "11111111"]) expect(text).not.toContain(forbidden)
    for (const slot of prepared.audit.slots) expect(slot.findingRef).toMatch(/^I6\/F\d+$/)
  })
  it("NOTHING_MATERIAL e INSUFFICIENT_EVIDENCE não invocam o redator", () => {
    expect(buildFeedbackWriterInput(compose(frame([signal], [finding("INTERACTION_FRICTION", [signal], { ownership: "INTERACTION" })])))).toEqual({ invoke: false, reason: "NOTHING_MATERIAL", audit: null })
    expect(buildFeedbackWriterInput(compose({ ...frame([], []), empty: true }))).toMatchObject({ invoke: false, reason: "INSUFFICIENT_EVIDENCE" })
    // Só KB_RULE: HAS_POINTS estrutural, mas o redator NÃO é chamado (entrega bloqueada).
    expect(buildFeedbackWriterInput(compose(frame([assertion], [divergence()]), kbLineage))).toMatchObject({ invoke: false, reason: "DELIVERY_BLOCKED", audit: { blocked: [{ reason: "PROCEDURAL_MATCHING_NOT_VALIDATED" }] } })
  })
})

describe("SAÍDA DO REDATOR — validação por item + fallback determinístico", () => {
  const feedback = compose(frame([action, statement, signal, assertion], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal]), divergence()]), kbLineage)
  const input = (buildFeedbackWriterInput(feedback) as { input: FeedbackWriterInputV1 }).input
  const [strength, coaching] = input.items as [WriterItem, WriterItem]
  const kb = toWriterItem(feedback.items[2]!, "ITEM_3")!.writerItem
  const good = { slot: "ITEM_1", observed: "Nesta conversa você confirmou os dados do cliente antes de seguir.", whyItMatters: "Isso dá segurança ao cliente sobre o atendimento.", whatYouCanDo: "Considere repetir essa confirmação em atendimentos parecidos." }
  it("fallbacks de todos os tipos passam pelos próprios validadores", () => {
    for (const item of [strength, coaching, kb]) expect(validateItemWording(fallbackItemWording(item), item, input.interactionLabel)).toEqual([])
    expect(fallbackItemWording(kb).whyItMatters).toContain(kbLineage.get("I6/P1")!.ruleQuote!)
  })
  it("saída válida é usada; violação em QUALQUER campo derruba o item inteiro para o fallback", () => {
    const resolved = resolveFeedbackWording(input, { items: [good, { ...good, slot: "ITEM_2", whatYouCanDo: "Você deve sempre explicar os termos (SF2)." }] })
    expect(resolved[0]).toMatchObject({ source: "WRITER", wording: { observed: good.observed } })
    expect(resolved[1]!.source).toBe("FALLBACK")
    expect(resolved[1]!.violations).toEqual(expect.arrayContaining(["INTERNAL_REF", "PATTERN_LANGUAGE", "UNSUPPORTED_PROCEDURE"]))
    expect(resolved[1]!.wording).toEqual(fallbackItemWording(coaching))
    expect(resolved).toHaveLength(2)
    expect(resolveFeedbackWording(input, { items: [good] })[1]).toMatchObject({ source: "FALLBACK", violations: ["SCHEMA"] })
  })
  it("o redator não decide estrutura: campo extra (section/ownership/review/evidence) invalida o item", () => {
    for (const extra of [{ section: "NEUTRAL_CONTEXT" }, { ownership: "CUSTOMER" }, { reviewRequired: false }, { evidence: ["x"] }, { summaryWording: "x" }]) expect(resolveFeedbackWording(input, { items: [{ ...good, ...extra }] })[0]!.source).toBe("FALLBACK")
    expect(resolveFeedbackWording(input, "texto livre").every((item) => item.source === "FALLBACK")).toBe(true)
  })
  it.each([
    ["INTERNAL_JSON_LEAKAGE", { observed: 'Nesta conversa {"candidateRef": "x"} houve confirmação.' }],
    ["INTERNAL_JSON_LEAKAGE", { whyItMatters: "Item classificado como INTERACTION_SPECIFIC." }],
    ["POLARITY_MISMATCH", { observed: "Nesta conversa houve uma falha na confirmação." }],
    ["PERMANENT_TRAIT", { whyItMatters: "Você é uma profissional cuidadosa." }],
    ["TEMPORAL_RELATION", { whyItMatters: "Você passou a confirmar os dados ao longo do período." }],
    ["PROCEDURAL_COMPLETENESS", { whyItMatters: "Você seguiu integralmente o procedimento." }],
    ["UNSUPPORTED_NUMBER", { whatYouCanDo: "Confirme os dados em até 48 horas." }],
    ["EVIDENCE_ALTERATION", { observed: "Você disse: “Confirmei o seu cadastro completo agora”." }],
    ["INTERNAL_REF", { observed: "Na interação I6 você confirmou os dados." }],
  ] as const)("%s", (violation, patch) => {
    expect(validateItemWording({ ...good, ...patch }, strength, input.interactionLabel)).toContain(violation)
  })
  it("linguagem normativa e conclusão procedimental só em KB_RULE; citação literal da evidência exibível é aceita", () => {
    const normative = { observed: "Nesta conversa a validação não foi explicada ao cliente.", whyItMatters: "O documento orienta explicar a validação antes de acessar dados protegidos.", whatYouCanDo: "Você deve explicar a necessidade da validação antes de acessar dados protegidos." }
    expect(validateItemWording(normative, kb, input.interactionLabel)).toEqual([])
    expect(validateItemWording(normative, coaching, input.interactionLabel)).toContain("UNSUPPORTED_PROCEDURE")
    expect(validateItemWording({ ...good, observed: "Você disse: “Confirmei aqui o seu CPF [CPF] e o telefone [TELEFONE], pode seguir.”" }, strength, input.interactionLabel)).toEqual([])
  })
})

describe("validação léxica só na prosa do redator", () => {
  it("palavra positiva DENTRO da citação literal não vira polaridade da oportunidade; fora dela, vira", () => {
    const said = obs("D9", "AGENT_STATEMENT", "OPERADOR", "T9", "A cobrança está correta segundo o contrato, sempre foi assim.")
    // Atrito precisa de fala do operador + reação do cliente exibíveis (readiness V1.4.9d).
    const input = (buildFeedbackWriterInput(compose(frame([said, signal], [finding("FRICTION", [said, signal])]))) as { input: FeedbackWriterInputV1 }).input
    const item = input.items[0]!
    expect(validateItemWording(fallbackItemWording(item), item, input.interactionLabel)).toEqual([])
    expect(validateItemWording({ ...fallbackItemWording(item), observed: "Nesta conversa a explicação foi correta." }, item, input.interactionLabel)).toContain("POLARITY_MISMATCH")
  })
})

describe("conteúdo procedimental (divergência E aderência) bloqueado para entrega enquanto o casamento não for validado", () => {
  const adherenceLineage = new Map([["I6/P1", { ...kbLineage.get("I6/P1")!, status: "CONSISTENT" as const }]])
  const adherence = () => finding("STRENGTH", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONSISTENT", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })
  it("divergência procedimental (KB_RULE) bloqueada; preservada na auditoria com lineage, knowledgeRef e href", () => {
    const feedback = compose(frame([assertion], [divergence()]), kbLineage)
    const item = feedback.items[0]!
    expect(item).toMatchObject({ section: "OPPORTUNITY", guidance: { source: "KB_RULE" }, delivery: { collaborator: false, blocked: "PROCEDURAL_MATCHING_NOT_VALIDATED" } })
    expect(item.guidance.knowledge).toEqual({ documentTitle: "Procedimento de Validação", ruleRef: "KR3", href: "/materiais/11111111-2222-4333-8444-555555555555", openBehavior: "NEW_TAB" })
    expect(item.provenance.proceduralLineage).toMatchObject({ ruleRef: "KR3", documentRef: "K5", documentId: "11111111-2222-4333-8444-555555555555", status: "CONTRADICTED" })
    expect(feedback).toMatchObject({ review: { required: true }, delivery: { collaborator: false, notification: false, audit: true } })
  })
  it("aderência procedimental (STRENGTH com lineage) bloqueada; preservada na auditoria com lineage, knowledgeRef e href", () => {
    const feedback = compose(frame([assertion], [adherence()]), adherenceLineage)
    const item = feedback.items[0]!
    expect(item).toMatchObject({ section: "STRENGTH", guidance: { source: "REINFORCEMENT" }, delivery: { collaborator: false, blocked: "PROCEDURAL_MATCHING_NOT_VALIDATED" } })
    expect(item.guidance.knowledge).toMatchObject({ ruleRef: "KR3", href: "/materiais/11111111-2222-4333-8444-555555555555", openBehavior: "NEW_TAB" })
    expect(item.provenance.proceduralLineage).toMatchObject({ status: "CONSISTENT", documentId: "11111111-2222-4333-8444-555555555555" })
    expect(feedback).toMatchObject({ status: "HAS_POINTS", delivery: { collaborator: false, notification: false, audit: true } })
    expect(buildFeedbackWriterInput(feedback)).toMatchObject({ invoke: false, reason: "DELIVERY_BLOCKED", audit: { blocked: [{ itemIndex: 0, reason: "PROCEDURAL_MATCHING_NOT_VALIDATED" }] } })
  })
  it("ambos ausentes do Writer Input; comportamento continua elegível; supervisor vê bloqueados, colaborador não", () => {
    const feedback = compose(frame([action, statement, signal, assertion], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal]), divergence(), adherence()]), new Map([...kbLineage]))
    // Aderência com lineage CONTRADICTED não casa (status diferente) → EXCLUDED; usa-se um feedback próprio para ela abaixo.
    const both = [feedback, compose(frame([action, statement, signal, assertion], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal]), adherence()]), adherenceLineage)]
    for (const entry of both) {
      const prepared = buildFeedbackWriterInput(entry)
      if (!prepared.invoke) throw new Error("comportamento deveria invocar")
      expect(prepared.input.items.map((item) => [item.section, item.guidance.source, item.interpretation.kind])).toEqual([["STRENGTH", "REINFORCEMENT", "STRENGTH"], ["OPPORTUNITY", "COACHING_SUGGESTION", "FRICTION"]])
      expect(prepared.input.items.every((item) => item.guidance.knowledge === null)).toBe(true)
      expect(prepared.audit.blocked.map((item) => item.reason)).toEqual(["PROCEDURAL_MATCHING_NOT_VALIDATED"])
      expect(JSON.stringify(prepared.input)).not.toMatch(/Procedimento de Validação|href|\/materiais\//)
      expect(entry.delivery).toMatchObject({ collaborator: true, notification: true })
      expect(displayableView(entry, "COLLABORATOR").items.map((item) => item.deliveryBlocked)).toEqual([null, null])
      expect(displayableView(entry, "SUPERVISOR").items.filter((item) => item.deliveryBlocked === "PROCEDURAL_MATCHING_NOT_VALIDATED")).toHaveLength(1)
    }
  })
})

describe("V1.4.9d — o Writer Input só recebe itens READY", () => {
  it("item sem evidência exibível suficiente não entra; o resto do feedback continua indo; tudo bloqueado = redator não chamado", () => {
    const operatorOnly = obs("D8", "AGENT_STATEMENT", "OPERADOR", "T8", "Deixa comigo, vou gerar aqui e enviar pelo canal que você me passar.")
    const feedback = compose(frame([action, operatorOnly], [finding("STRENGTH", [action]), finding("FRICTION", [operatorOnly])]))
    const prepared = buildFeedbackWriterInput(feedback)
    if (!prepared.invoke) throw new Error("deveria invocar")
    expect(prepared.input.items.map((item) => item.section)).toEqual(["STRENGTH"])
    expect(prepared.audit.blocked).toEqual([{ itemIndex: 1, findingRef: expect.stringMatching(/^I6\/F\d+$/), reason: "INSUFFICIENT_DISPLAY_EVIDENCE" }])
    const onlyBlocked = compose(frame([operatorOnly], [finding("FRICTION", [operatorOnly])]))
    expect(buildFeedbackWriterInput(onlyBlocked)).toEqual({ invoke: false, reason: "DELIVERY_BLOCKED", audit: { blocked: [{ itemIndex: 0, findingRef: expect.any(String), reason: "INSUFFICIENT_DISPLAY_EVIDENCE" }] } })
    expect(onlyBlocked.delivery).toMatchObject({ state: "NOT_DELIVERABLE", collaborator: false, notification: false, audit: true })
  })
})

describe("V1.4.9e — protocolo de 13 dígitos com contexto explícito na redaction CANÔNICA", () => {
  const redact = (text: string) => projectDisplayEvidence({ turnRef: "T1", speaker: "OPERADOR", quote: text }, { factIndex: 0, evidenceType: "AGENT_ACTION" })
  it("contexto explícito → só o número vira [PROTOCOLO]; mesmo resultado na projeção de pares (uma implementação)", () => {
    for (const [raw, shown] of [
      ["Anota o protocolo, por favor: 1234567890123.", "Anota o protocolo, por favor: [PROTOCOLO]."],
      ["Vou te passar o protocolo deste atendimento: 1234567890123.", "Vou te passar o protocolo deste atendimento: [PROTOCOLO]."],
      ["O número do protocolo é 1234567890123.", "O número do protocolo é [PROTOCOLO]."],
      ["Protocolo: 1234567890123, anotou?", "Protocolo: [PROTOCOLO], anotou?"],
    ] as const) {
      expect(redact(raw)).toMatchObject({ status: "DISPLAYED", text: shown, wasRedacted: true, redactionKinds: ["PROTOCOL"] })
      expect(projectPeerTranscript({ sourceInteractionId: "x", transcript: raw, peer: { personId: "p", fullName: "Nome Inexistente Qualquer" } }).projected).toBe(shown)
    }
  })
  it("formatos antigos continuam mascarados", () => {
    expect(redact("Registrei tudo no protocolo 1234567890123.")).toMatchObject({ text: "Registrei tudo no protocolo [PROTOCOLO]." })
    expect(redact("Seu protocolo é DEMO-202603-A123.")).toMatchObject({ text: "Seu protocolo é [PROTOCOLO]." })
    expect(redact("Anota: 202603123456.")).toMatchObject({ text: "Anota: [PROTOCOLO]." })
    expect(redact("CPF 123.456.789-09, telefone (11) 98765-4321, e-mail a@b.com.")).toMatchObject({ text: "CPF [CPF], telefone [TELEFONE], e-mail [EMAIL]." })
  })
  it("13 dígitos SEM contexto de protocolo não viram protocolo e continuam retidos (fail-closed)", () => {
    for (const raw of ["Anota aí esse número: 1234567890123.", "O protocolo e o número 1234567890123 são diferentes.", "Conta 1234567890123 no protocolo."]) expect(redact(raw)).toMatchObject({ status: "WITHHELD", reason: "UNMASKED_NUMERIC_IDENTIFIER" })
  })
  it("valores, prazos, datas e números operacionais não são afetados", () => {
    const raw = "O valor é R$ 1.234,56, o prazo é de 3 dias úteis, vence em 26/03/2026 às 10:30 e são 48 horas de análise."
    expect(redact(raw)).toMatchObject({ status: "DISPLAYED", text: raw, wasRedacted: false })
  })
  it("readiness usa o display mascarado: STRENGTH antes retido por protocolo fica READY; raw só na provenance; redator nunca recebe o número", () => {
    const said = obs("A7", "AGENT_ACTION", "OPERADOR", "T30", "Anota o protocolo, por favor: 1234567890123.")
    const feedback = compose(frame([said], [finding("STRENGTH", [said])]))
    expect(feedback.items[0]).toMatchObject({ readiness: { status: "READY" }, delivery: { collaborator: true, blocked: null }, displayEvidence: [{ status: "DISPLAYED", text: "Anota o protocolo, por favor: [PROTOCOLO]." }] })
    expect(feedback.items[0]!.provenance.rawEvidence[0]!.quote).toContain("1234567890123")
    expect(() => assertDisplaySafe(feedback.items[0]!.fact[0]!)).toThrow(FeedbackRedactionPendingError)
    const prepared = buildFeedbackWriterInput(feedback)
    if (!prepared.invoke) throw new Error("deveria invocar")
    expect(JSON.stringify(prepared.input)).not.toContain("1234567890123")
    expect(prepared.input.items[0]!.evidence[0]!.text).toBe("Anota o protocolo, por favor: [PROTOCOLO].")
  })
})

describe("V1.4.9g — CLAIM CEILING (effectClaimMode POTENTIAL_ONLY) + validação ciente do slot", () => {
  const said = obs("D9", "AGENT_STATEMENT", "OPERADOR", "T9", "Resumindo antes de executar: a linha será cancelada a partir de hoje. Posso seguir?")
  const input = (buildFeedbackWriterInput(compose(frame([said], [finding("STRENGTH", [said])]))) as { input: FeedbackWriterInputV1 }).input
  const item = input.items[0]!
  const base = { observed: "Nesta conversa você resumiu as consequências antes de seguir.", whyItMatters: "Resumir antes de executar pode ajudar o cliente a compreender os próximos passos.", whatYouCanDo: "Continue resumindo os principais impactos antes de prosseguir." }
  const check = (patch: Partial<typeof base>) => validateItemWording({ ...base, ...patch }, item, input.interactionLabel)

  it("contrato: effectClaimMode POTENTIAL_ONLY e as constraints de teto de efeito/reforço no input", () => {
    expect(input.effectClaimMode).toBe("POTENTIAL_ONLY")
    expect(input.constraints.map((entry) => entry.code)).toEqual(expect.arrayContaining(["POTENTIAL_EFFECT_ONLY", "REINFORCE_OBSERVED_ONLY"]))
  })
  it("benefício potencial é permitido", () => {
    expect(check({})).toEqual([])
    expect(check({ whyItMatters: "Isso contribui para maior clareza na conversa." })).toEqual([])
    expect(check({ whyItMatters: "Essa prática permite que o cliente acompanhe os próximos passos." })).toEqual([])
  })
  it("efeito garantido/ocorrido na prosa do redator é rejeitado (GUARANTEED_EFFECT)", () => {
    for (const whyItMatters of ["Isso garante que o cliente compreendeu os detalhes.", "Isso ajuda, garantindo que ele recebeu a informação.", "Resumir assim assegura que o cliente está ciente.", "Isso fez com que o cliente entendesse o cancelamento.", "O resumo resultou em um cliente mais tranquilo."]) expect(check({ whyItMatters })).toContain("GUARANTEED_EFFECT")
    // Garantir POSSE/finalidade não é estado do cliente; em whatYouCanDo o texto é prospectivo (finalidade da sugestão).
    expect(check({ whyItMatters: "Isso ajuda a garantir que ele tenha em mãos a referência do atendimento." })).toEqual([])
    expect(check({ whatYouCanDo: "Continue resumindo, garantindo que o cliente entenda os próximos passos." })).toEqual([])
  })
  it("a mesma construção DENTRO de citação literal da evidência não é prosa do redator", () => {
    const quoting = obs("D10", "AGENT_STATEMENT", "OPERADOR", "T10", "Eu garanto que o senhor vai receber hoje ainda.")
    const quotingInput = (buildFeedbackWriterInput(compose(frame([quoting], [finding("STRENGTH", [quoting])]))) as { input: FeedbackWriterInputV1 }).input
    expect(validateItemWording({ ...base, observed: "Você disse: “Eu garanto que o senhor vai receber hoje ainda.”" }, quotingInput.items[0]!, quotingInput.interactionLabel)).not.toContain("GUARANTEED_EFFECT")
  })
  it("slot-aware: 'sempre que possível' em whatYouCanDo é prospectivo; retrospectivo continua bloqueado", () => {
    expect(check({ whatYouCanDo: "Continue reforçando o número de referência sempre que possível." })).toEqual([])
    expect(check({ observed: "Você sempre faz um resumo antes de executar." })).toContain("PATTERN_LANGUAGE")
    expect(check({ whyItMatters: "Isso acontece sempre que o cliente liga." })).toContain("PATTERN_LANGUAGE")
    expect(check({ whatYouCanDo: "Continue fazendo o que você sempre faz." })).toContain("PATTERN_LANGUAGE")
    expect(check({ whatYouCanDo: "Você costuma resumir; continue assim." })).toContain("PATTERN_LANGUAGE")
  })
  it("reforço: comportamento adjacente não é detectável estruturalmente — só o efeito garantido é pego (o resto fica para a revisão humana)", () => {
    expect(check({ whatYouCanDo: "Continue confirmando o entendimento do cliente antes de finalizar." })).toEqual([])
    expect(check({ whyItMatters: "Confirmar assim garante que o cliente compreendeu tudo." })).toContain("GUARANTEED_EFFECT")
  })
  it("regressão: validadores antigos continuam valendo e os fallbacks passam", () => {
    expect(check({ observed: "Nesta conversa houve uma falha no resumo." })).toContain("POLARITY_MISMATCH")
    expect(check({ whatYouCanDo: "Você deve resumir antes de executar." })).toContain("UNSUPPORTED_PROCEDURE")
    expect(check({ whyItMatters: "Você é uma profissional cuidadosa." })).toContain("PERMANENT_TRAIT")
    expect(validateItemWording(fallbackItemWording(item), item, input.interactionLabel)).toEqual([])
  })
})

describe("V1.5.3 — CLAIM BOUNDARIES V2 (estruturais, alta precisão)", () => {
  const writerItem = (evidence: { speaker: string; text: string }[], section: WriterItem["section"] = "STRENGTH"): WriterItem => ({ slot: "ITEM_1", section, interpretation: { kind: section === "STRENGTH" ? "STRENGTH" : "FRICTION", polarity: section === "STRENGTH" ? "POSITIVE" : "NEGATIVE", scope: "INTERACTION_SPECIFIC", safeMeaning: "comportamento observado nesta interação" }, guidance: { source: section === "STRENGTH" ? "REINFORCEMENT" : "COACHING_SUGGESTION", mandatory: false, knowledge: null }, evidence: evidence.map((entry) => ({ ...entry, truncated: false, wasRedacted: false })), evidenceWithheld: 0, actionClaimMode: "DECLARED_ONLY" })
  const wording = (observed: string, whyItMatters = "Isso pode ajudar o cliente a acompanhar o atendimento.", whatYouCanDo = "Você pode manter essa prática em conversas parecidas.") => ({ observed, whyItMatters, whatYouCanDo })
  const declared = writerItem([{ speaker: "OPERADOR", text: "Pronto, acabei de disparar a segunda via para o seu e-mail." }])

  it("actionClaimMode é estrutural: todo item do redator nasce DECLARED_ONLY (OBSERVED_EVENT_ALLOWED reservado, nunca produzido na V1)", () => {
    const prepared = buildFeedbackWriterInput(compose(frame([statement, signal], [finding("FRICTION", [statement, signal])])))
    if (!prepared.invoke) throw new Error(prepared.reason)
    expect(prepared.input.items.map((item) => item.actionClaimMode)).toEqual(["DECLARED_ONLY"])
    expect(prepared.input.constraints.map((item) => item.code)).toEqual(expect.arrayContaining(["NO_CAUSAL_UPGRADE", "DECLARED_ACTION_ONLY", "POTENTIAL_EFFECT_ONLY", "REINFORCE_OBSERVED_ONLY"]))
  })

  it("DECLARED_ACTION_UPGRADE: declaração do operador escrita como execução no observed", () => {
    expect(validateItemWording(wording("Você enviou a segunda via para o e-mail do cliente."), declared, "x")).toContain("DECLARED_ACTION_UPGRADE")
    expect(validateItemWording(wording("Você atendeu o pedido ao realizar a alteração do plano."), writerItem([{ speaker: "OPERADOR", text: "Pronto, já alterei o plano aqui." }]), "x")).toContain("DECLARED_ACTION_UPGRADE")
  })

  it("não pega: forma declarativa, citação literal, negação, whyItMatters, ou evidência sem declaração de ação concluída", () => {
    expect(validateItemWording(wording("Você informou ao cliente que enviou a segunda via para o e-mail."), declared, "x")).not.toContain("DECLARED_ACTION_UPGRADE")
    expect(validateItemWording(wording("Você comunicou o envio da segunda via."), declared, "x")).not.toContain("DECLARED_ACTION_UPGRADE")
    expect(validateItemWording(wording("Você disse: \"Pronto, acabei de disparar a segunda via para o seu e-mail.\""), declared, "x")).not.toContain("DECLARED_ACTION_UPGRADE")
    expect(validateItemWording(wording("Nesta conversa você não enviou nada antes de explicar."), declared, "x")).not.toContain("DECLARED_ACTION_UPGRADE")
    expect(validateItemWording(wording("Você comunicou o próximo passo.", "Saber que o documento foi enviado pode facilitar o acompanhamento."), declared, "x")).not.toContain("DECLARED_ACTION_UPGRADE")
    // Sem declaração de ação concluída na fala do operador ("vou enviar"), a guarda não age — nada estrutural a proteger.
    expect(validateItemWording(wording("Você enviou a segunda via."), writerItem([{ speaker: "OPERADOR", text: "Vou enviar a segunda via agora mesmo." }]), "x")).not.toContain("DECLARED_ACTION_UPGRADE")
    // Fala do CLIENTE não é declaração do operador.
    expect(validateItemWording(wording("Você enviou a segunda via."), writerItem([{ speaker: "CLIENTE", text: "Já enviei o comprovante para vocês." }]), "x")).not.toContain("DECLARED_ACTION_UPGRADE")
  })

  it("COMPREHENSION_UNOBSERVED: confirmar/assegurar compreensão sem nenhuma fala do cliente na evidência (observed/whyItMatters)", () => {
    const summary = writerItem([{ speaker: "OPERADOR", text: "Recapitulando: a linha fica bloqueada no fim do ciclo. Posso seguir?" }])
    expect(validateItemWording(wording("Você recapitulou as condições antes de seguir.", "Isso pode ajudar a confirmar que o cliente compreende as condições."), summary, "x")).toContain("COMPREHENSION_UNOBSERVED")
    expect(validateItemWording(wording("Você recapitulou as condições e assegurou o entendimento do cliente."), summary, "x")).toContain("COMPREHENSION_UNOBSERVED")
    // Com o cliente na evidência, a estrutura não permite decidir — fica para a revisão humana.
    const withCustomer = writerItem([{ speaker: "OPERADOR", text: "Recapitulando: a linha fica bloqueada no fim do ciclo. Posso seguir?" }, { speaker: "CLIENTE", text: "Entendi, pode seguir." }])
    expect(validateItemWording(wording("Você recapitulou as condições antes de seguir.", "Isso pode ajudar a confirmar que o cliente compreende as condições."), withCustomer, "x")).not.toContain("COMPREHENSION_UNOBSERVED")
    // whatYouCanDo prospectivo: sugerir confirmar o entendimento é orientação legítima.
    expect(validateItemWording(wording("Você recapitulou as condições antes de seguir.", "Isso pode facilitar a compreensão.", "Você pode perguntar se ficou alguma dúvida para confirmar o entendimento do cliente."), summary, "x")).not.toContain("COMPREHENSION_UNOBSERVED")
    expect(validateItemWording(wording("Você recapitulou as condições antes de seguir.", "Isso pode tornar as condições mais claras antes de prosseguir."), summary, "x")).toEqual([])
  })

  it("causalidade NÃO tem guarda automática (sem sinal estrutural; ver contrafactual V1.5.3) — fica no contrato + revisão humana", () => {
    const friction = writerItem([{ speaker: "OPERADOR", text: "É o faturamento pro rata do ciclo." }, { speaker: "CLIENTE", text: "Não entendi nada disso." }], "OPPORTUNITY")
    expect(validateItemWording(wording("Você usou um termo técnico, o que levou o cliente a dizer que não entendeu."), friction, "x")).toEqual([])
  })

  it("os fallbacks determinísticos continuam passando pelas guardas novas", () => {
    for (const item of [declared, writerItem([{ speaker: "OPERADOR", text: "Pronto, já alterei o plano aqui." }], "OPPORTUNITY")]) expect(validateItemWording(fallbackItemWording(item), item, "x")).toEqual([])
  })
})
