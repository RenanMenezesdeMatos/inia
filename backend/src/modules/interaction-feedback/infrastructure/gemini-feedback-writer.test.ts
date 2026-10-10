import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FEEDBACK_PILOT_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"

// Só a chave muda (placeholder de teste, nunca uma credencial real); o resto do ambiente é o real — a chamada passa pelo
// gateway, pelo adapter Gemini registrado e pelo cliente generateContent REAIS, com `fetch` falso. Zero rede.
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, GEMINI_API_KEY: "test-placeholder", INIA_PROMPT_CACHE: "NONE" } }
})

const { composeInteractionFeedback } = await import("../../investigation/domain/interaction-feedback.js")
const { buildFeedbackWriterInput, EFFECT_CLAIM_MODE } = await import("../../investigation/domain/interaction-feedback-writer.js")
const { createGeminiFeedbackWriter, feedbackWriterRoute } = await import("./gemini-feedback-writer.js")
const { FEEDBACK_WRITER_SYSTEM_PROMPT, FEEDBACK_WRITER_SYSTEM_PROMPTS, FEEDBACK_WRITER_PROMPT_VERSION, FEEDBACK_WRITER_PROMPT_VERSIONS, feedbackWriterFingerprint, feedbackWriterFreezeFile, parseWriterResponse, projectWriterInputForModel, assertWriterPayloadSafe, WriterPayloadViolation } = await import("../domain/feedback-writer-prompt.js")
const { FeedbackWriterError } = await import("../domain/feedback-writer-provenance.js")
const { runInteractionFeedbackPipeline } = await import("../application/interaction-feedback-pipeline.js")
const { createInMemoryInteractionFeedbackStore } = await import("../testing/in-memory-interaction-feedback-store.js")
const { useCaseForPurpose, findUseCase } = await import("../../../shared/application/model-routing/ai-use-cases.js")

type Frame = Parameters<typeof composeInteractionFeedback>[0]["frame"]
const INTERACTION_ID = "0f0e0d0c-0000-4000-8000-000000000006"
const RAW_WITHHELD = "Anota o código 99887766554433 aí."
const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: INTERACTION_ID, turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })

/** STRENGTH (1 trecho exibível + 1 RETIDO pela privacidade) + FRICTION (operador + cliente) + divergência procedimental (bloqueada). */
function feedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "RESUMO-DO-MODELO A1", evidence: [unit("T4", "OPERADOR", "Vou te passar o resumo do que combinamos agora."), unit("T5", "OPERADOR", RAW_WITHHELD)] }
  const statement = { id: "D1", kind: "AGENT_STATEMENT", summary: "RESUMO-DO-MODELO D1", evidence: [unit("T19", "OPERADOR", "Isso é o ciclo de faturamento retroativo do upgrade.")] }
  const signal = { id: "S1", kind: "CUSTOMER_SIGNAL", summary: "RESUMO-DO-MODELO S1", evidence: [unit("T20", "CLIENTE", "Não entendi nada disso, pode explicar melhor?")] }
  const assertion = { id: "P1", kind: "PROCEDURE_ASSERTION", summary: "RESUMO-DO-MODELO P1", evidence: [unit("T15", "OPERADOR", "Não precisa explicar a validação, vou refazer por aqui.")] }
  const finding = (id: string, kind: string, observations: { id: string; evidence: unknown[] }[], extra: object = {}) => ({ id, interactionRef: "I6", kind, summary: "SUMMARY-DO-MODELO", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: observations.length, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${id}`, ownership: "AGENT", ...extra })
  const frame = {
    interactionRef: "I6", interactionId: INTERACTION_ID, source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [statement], commitments: [], customerSignals: [signal], procedureAssertions: [assertion], interactionEvents: [], empty: false,
    findings: [finding("1", "STRENGTH", [action]), finding("2", "FRICTION", [statement, signal]), finding("3", "PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })],
  } as unknown as Frame
  const lineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "Antes de acessar informações protegidas, o operador deve explicar a validação.", documentId: "11111111-2222-4333-8444-555555555555" }]])
  return composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame, interactionLabel: "14/03/2026", sourceRun: "run-1", proceduralLineage: lineage })
}
function writerInput() {
  const prepared = buildFeedbackWriterInput(feedback())
  if (!prepared.invoke) throw new Error(prepared.reason)
  return prepared.input
}

const geminiText = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 150, totalTokenCount: 1650 }, modelVersion: "gemini-3.1-flash-lite" }), { status: 200 })
const validAnswer = (refs = ["ITEM_1", "ITEM_2"]) => JSON.stringify({ items: refs.map((itemRef) => ({ itemRef, observed: "Nesta conversa você apresentou um resumo do que foi combinado.", whyItMatters: "Isso pode ajudar o cliente a acompanhar os próximos passos.", whatYouCanDo: "Você pode repetir essa prática em conversas parecidas." })) })
const stubFetch = (impl: () => Promise<Response>) => { const mock = vi.fn(impl); vi.stubGlobal("fetch", mock); return mock }
type FetchCall = [string, { body: string; signal?: AbortSignal; headers: Record<string, string> }]
const bodyOf = (mock: ReturnType<typeof vi.fn>) => JSON.parse((mock.mock.calls[0] as unknown as FetchCall)[1].body) as { contents: { parts: { text: string }[] }[]; systemInstruction: { parts: { text: string }[] }; generationConfig?: { responseMimeType?: string } }
const failure = async (promise: Promise<unknown>) => { try { await promise } catch (error) { return error as InstanceType<typeof FeedbackWriterError> } throw new Error("esperava erro") }

afterEach(() => vi.unstubAllGlobals())

describe("V1.5.1 — adapter Gemini do Feedback Writer (gateway real, fetch falso, zero rede)", () => {
  it("resposta válida → só observed/whyItMatters/whatYouCanDo por item (itemRef → slot) + proveniência completa", async () => {
    const fetchMock = stubFetch(async () => geminiText(validAnswer()))
    const result = await createGeminiFeedbackWriter().write(writerInput())
    expect(result.rawOutput).toEqual({ items: [expect.objectContaining({ slot: "ITEM_1" }), expect.objectContaining({ slot: "ITEM_2" })] })
    for (const item of (result.rawOutput as { items: object[] }).items) expect(Object.keys(item).sort()).toEqual(["observed", "slot", "whatYouCanDo", "whyItMatters"])
    const fingerprint = feedbackWriterFingerprint()
    expect(result.provenance).toMatchObject({ provider: "GEMINI", requestedModel: "gemini-3.1-flash-lite", responseModel: "gemini-3.1-flash-lite", promptVersion: "FEEDBACK_WRITER_PROMPT_V2", promptSha256: fingerprint.promptSha256, schemaVersion: "FEEDBACK_WRITER_OUTPUT_V1", contractVersion: "FEEDBACK_WRITER_INPUT_V1", effectClaimMode: "POTENTIAL_ONLY", config: { responseMimeType: "application/json", timeoutMs: 30_000, retries: 0, modelFallback: false, escalation: false }, response: { usage: { promptTokens: 1500, outputTokens: 150, totalTokens: 1650 } }, validation: { status: "VALID", itemCount: 2, expectedItemCount: 2 } })
    expect(result.provenance!.requestSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.provenance!.responseSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(result.provenance)).not.toContain("test-placeholder")
    // Request real: modelo fixo, JSON mode, prompt congelado no systemInstruction, 30 s de timeout.
    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall
    expect(url).toContain("/models/gemini-3.1-flash-lite:generateContent")
    const body = bodyOf(fetchMock)
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json" })
    expect(body.systemInstruction.parts[0]!.text).toBe(FEEDBACK_WRITER_SYSTEM_PROMPT)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("o request carrega POTENTIAL_ONLY, POTENTIAL_EFFECT_ONLY e REINFORCE_OBSERVED_ONLY", async () => {
    const fetchMock = stubFetch(async () => geminiText(validAnswer()))
    await createGeminiFeedbackWriter().write(writerInput())
    const userTurn = bodyOf(fetchMock).contents[0]!.parts[0]!.text
    const payload = JSON.parse(userTurn.slice(userTurn.indexOf("\n") + 1)) as { effectClaimMode: string; constraints: { code: string }[] }
    expect(payload.effectClaimMode).toBe(EFFECT_CLAIM_MODE)
    expect(payload.effectClaimMode).toBe("POTENTIAL_ONLY")
    expect(payload.constraints.map((constraint) => constraint.code)).toEqual(expect.arrayContaining(["POTENTIAL_EFFECT_ONLY", "REINFORCE_OBSERVED_ONLY"]))
  })

  it("nenhum dado proibido no payload: raw retido, provenance, handles, refs internas, links, UUIDs, texto de modelo, procedimental bloqueado", async () => {
    const fetchMock = stubFetch(async () => geminiText(validAnswer()))
    await createGeminiFeedbackWriter().write(writerInput())
    const sent = JSON.stringify(bodyOf(fetchMock))
    for (const forbidden of [RAW_WITHHELD, "99887766554433", INTERACTION_ID, "11111111-2222-4333-8444-555555555555", "/materiais/", "http", "provenance", "rawEvidence", "findingRef", "SUMMARY-DO-MODELO", "RESUMO-DO-MODELO", "\"I6\"", "SF1", "KR3", "K5", "Procedimento de Validação", "Não precisa explicar a validação", "run-1", "C-1", "test-placeholder"]) expect(sent).not.toContain(forbidden)
    const userTurn = bodyOf(fetchMock).contents[0]!.parts[0]!.text
    const payload = JSON.parse(userTurn.slice(userTurn.indexOf("\n") + 1)) as { items: { itemRef: string; evidenceWithheldCount: number }[] }
    expect(payload.items.map((item) => item.itemRef)).toEqual(["ITEM_1", "ITEM_2"])
    expect(payload.items[0]!.evidenceWithheldCount).toBe(1)
  })

  it("defesa estrutural: campo fora da lista branca, itemRef não genérico, UUID ou link no payload → recusado ANTES da rede", async () => {
    const payload = projectWriterInputForModel(writerInput())
    expect(() => assertWriterPayloadSafe(payload)).not.toThrow()
    expect(() => assertWriterPayloadSafe({ ...payload, provenance: {} } as never)).toThrow(WriterPayloadViolation)
    expect(() => assertWriterPayloadSafe({ ...payload, items: [{ ...payload.items[0]!, itemRef: "SF1" }, payload.items[1]!] })).toThrow(WriterPayloadViolation)
    expect(() => assertWriterPayloadSafe({ ...payload, items: [{ ...payload.items[0]!, rawEvidence: "x" } as never, payload.items[1]!] })).toThrow(WriterPayloadViolation)
    expect(() => assertWriterPayloadSafe({ ...payload, interactionLabel: `14/03 ${INTERACTION_ID}` })).toThrow(WriterPayloadViolation)
    expect(() => assertWriterPayloadSafe({ ...payload, items: [{ ...payload.items[0]!, knowledge: { documentTitle: "Doc", ruleText: "ver /materiais/abc" } }, payload.items[1]!] })).toThrow(WriterPayloadViolation)
    const fetchMock = stubFetch(async () => geminiText(validAnswer()))
    const input = writerInput()
    const error = await failure(createGeminiFeedbackWriter().write({ ...input, items: [{ ...input.items[0]!, slot: "I6" }, input.items[1]!] }))
    expect(error).toBeInstanceOf(FeedbackWriterError)
    expect(error.code).toBe("WRITER_PAYLOAD_VIOLATION")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["JSON malformado", "{items: [", "WRITER_MALFORMED_JSON"],
    ["texto em volta do JSON (sem parser leniente)", `Aqui está: ${validAnswer()}`, "WRITER_MALFORMED_JSON"],
    ["campo extra no item", JSON.stringify({ items: [{ ...JSON.parse(validAnswer()).items[0], section: "STRENGTH" }, JSON.parse(validAnswer()).items[1]] }), "WRITER_SCHEMA_INVALID"],
    ["campo extra no envelope", JSON.stringify({ ...JSON.parse(validAnswer()), summary: "x" }), "WRITER_SCHEMA_INVALID"],
    ["texto vazio num slot", JSON.stringify({ items: [{ ...JSON.parse(validAnswer()).items[0], observed: " " }, JSON.parse(validAnswer()).items[1]] }), "WRITER_SCHEMA_INVALID"],
    ["item ausente", validAnswer(["ITEM_1"]), "WRITER_MISSING_ITEM"],
    ["item extra", validAnswer(["ITEM_1", "ITEM_2", "ITEM_3"]), "WRITER_EXTRA_ITEM"],
    ["item duplicado", validAnswer(["ITEM_1", "ITEM_1", "ITEM_2"]), "WRITER_DUPLICATE_ITEM"],
    ["ordem trocada", validAnswer(["ITEM_2", "ITEM_1"]), "WRITER_ITEM_ORDER_MISMATCH"],
    ["ref interna no lugar do itemRef", validAnswer(["SF1", "ITEM_2"]), "WRITER_EXTRA_ITEM"],
  ])("%s → %s (resposta inteira inválida, com proveniência)", async (_label, text, code) => {
    stubFetch(async () => geminiText(text))
    const error = await failure(createGeminiFeedbackWriter().write(writerInput()))
    expect(error).toBeInstanceOf(FeedbackWriterError)
    expect(error.code).toBe(code)
    expect(error.name).toBe(code)
    expect(error.provenance).toMatchObject({ validation: { status: code }, promptVersion: "FEEDBACK_WRITER_PROMPT_V2" })
    expect(error.provenance!.responseSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("timeout → WRITER_TIMEOUT; erro de rede → WRITER_TRANSPORT_ERROR; resposta vazia → WRITER_MALFORMED_JSON (uma chamada cada)", async () => {
    let fetchMock = stubFetch(async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }) })
    expect((await failure(createGeminiFeedbackWriter().write(writerInput()))).code).toBe("WRITER_TIMEOUT")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock = stubFetch(async () => { throw new TypeError("fetch failed") })
    expect((await failure(createGeminiFeedbackWriter().write(writerInput()))).code).toBe("WRITER_TRANSPORT_ERROR")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock = stubFetch(async () => geminiText(""))
    expect((await failure(createGeminiFeedbackWriter().write(writerInput()))).code).toBe("WRITER_MALFORMED_JSON")
  })

  it("erro do provider (503 inclusive) → WRITER_PROVIDER_ERROR com ZERO retry (o cliente padrão repetiria o 503 uma vez)", async () => {
    const fetchMock = stubFetch(async () => new Response("Service Unavailable", { status: 503 }))
    const error = await failure(createGeminiFeedbackWriter().write(writerInput()))
    expect(error.code).toBe("WRITER_PROVIDER_ERROR")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.provenance)).not.toContain("Service Unavailable")
    const fetch400 = stubFetch(async () => new Response("bad", { status: 400 }))
    expect((await failure(createGeminiFeedbackWriter().write(writerInput()))).code).toBe("WRITER_PROVIDER_ERROR")
    expect(fetch400).toHaveBeenCalledTimes(1)
  })

  it("rota fixa do piloto (sem policy da organização): Use Case dedicado, sem fallback nem escalação; a policy FEEDBACK_WRITER é que pode trocá-la", () => {
    const route = feedbackWriterRoute()
    expect(route).toMatchObject({ tier: "BASIC", escalated: false, fallback: false, purpose: "FEEDBACK_WRITING", profile: { provider: "GEMINI", model: "gemini-3.1-flash-lite", supportsPromptCache: false } })
    expect(useCaseForPurpose("FEEDBACK_WRITING")).toBe("FEEDBACK_WRITER")
    expect(findUseCase("FEEDBACK_WRITER")).toMatchObject({ routable: true, requiredCapabilities: ["STRUCTURED_OUTPUT"] })
  })

  it("roteado pela policy da organização: a proveniência registra o provider/modelo da policy e a rota (sem policy, nada muda)", async () => {
    const resolvedRoute = { requestedUseCase: "FEEDBACK_WRITER" as const, routingMode: "PINNED" as const, providerKey: "OPENAI", connectionId: "c1", connectionName: "OpenAI da operação", modelId: "m1", modelName: "gpt-x", routeReason: "PINNED", fallbackAttempt: 0, fallbackReason: null, correlationId: "k1" }
    const answer = { kind: "text" as const, text: validAnswer(), usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null, reasoningTokens: null }, durationMs: 3, model: "gpt-x-2026", provider: "OPENAI" as const, cache: { mode: "NONE" as const, cacheKeyVersion: null, cachedTokens: null, hitRate: null }, cost: { status: "NOT_CONFIGURED" as const } }
    const routed = await createGeminiFeedbackWriter({ generate: async () => ({ ...answer, resolvedRoute }) }).write(writerInput())
    expect(routed.provenance).toMatchObject({ provider: "OPENAI", requestedModel: "gpt-x", responseModel: "gpt-x-2026", route: { routingMode: "PINNED", providerKey: "OPENAI", connectionName: "OpenAI da operação", modelName: "gpt-x", fallbackAttempt: 0 }, validation: { status: "VALID" } })
    const legacy = await createGeminiFeedbackWriter({ generate: async () => answer }).write(writerInput())
    expect(legacy.provenance).toMatchObject({ provider: "GEMINI", requestedModel: "gemini-3.1-flash-lite" })
    expect(legacy.provenance).not.toHaveProperty("route")
  })

  it("pipeline usa o fallback determinístico quando o adapter falha, e grava a proveniência do erro", async () => {
    stubFetch(async () => geminiText("{não é json"))
    const memory = createInMemoryInteractionFeedbackStore()
    const context = { organizationId: "00000000-0000-4000-8000-000000000001", collaboratorId: "22222222-2222-4222-8222-222222222222", teamId: null, interactionId: INTERACTION_ID, occurredAt: null }
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer: createGeminiFeedbackWriter(), store: memory.store, now: () => new Date("2026-09-24T12:00:00Z"), deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(result.writerError).toBe("WRITER_MALFORMED_JSON")
    expect(result.reviews.map((review) => [review.wordingSource, review.reviewStatus])).toEqual([["FALLBACK", "PENDING_REVIEW"], ["FALLBACK", "PENDING_REVIEW"]])
    const run = [...memory.runs.values()][0]!
    expect(run.writerProvenance).toMatchObject({ promptVersion: "FEEDBACK_WRITER_PROMPT_V2", validation: { status: "WRITER_MALFORMED_JSON" } })
  })

  it("pipeline com resposta válida: texto do redator vira proposta (validadores do pipeline por cima), proveniência VALID", async () => {
    stubFetch(async () => geminiText(validAnswer()))
    const memory = createInMemoryInteractionFeedbackStore()
    const context = { organizationId: "00000000-0000-4000-8000-000000000001", collaboratorId: "22222222-2222-4222-8222-222222222222", teamId: null, interactionId: INTERACTION_ID, occurredAt: null }
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer: createGeminiFeedbackWriter(), store: memory.store, now: () => new Date("2026-09-24T12:00:00Z"), deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(result.reviews[0]!).toMatchObject({ wordingSource: "WRITER", writerOriginal: { slot: "ITEM_1" } })
    expect([...memory.runs.values()][0]!.writerProvenance).toMatchObject({ validation: { status: "VALID", itemCount: 2 } })
  })

  it("flag OFF: o pipeline não chama o adapter (zero fetch)", async () => {
    const fetchMock = stubFetch(async () => geminiText(validAnswer()))
    const memory = createInMemoryInteractionFeedbackStore()
    const result = await runInteractionFeedbackPipeline({ enabled: false, writer: createGeminiFeedbackWriter(), store: memory.store, now: () => new Date(), deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), { organizationId: "00000000-0000-4000-8000-000000000001", collaboratorId: "22222222-2222-4222-8222-222222222222", teamId: null, interactionId: null, occurredAt: null })
    expect(result).toEqual({ status: "SKIPPED_FLAG_OFF" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("V1.5.1 — prompt de produção congelado", () => {
  it.each(FEEDBACK_WRITER_PROMPT_VERSIONS)("freeze de %s confere byte a byte (V1 preservado; mudou algo → nova versão)", (version) => {
    const freeze = JSON.parse(readFileSync(join(__dirname, "..", "domain", feedbackWriterFreezeFile(version)), "utf8")) as ReturnType<typeof feedbackWriterFingerprint> & { systemPrompt: string }
    const { systemPrompt, ...frozen } = freeze
    expect(frozen).toEqual(JSON.parse(JSON.stringify(feedbackWriterFingerprint(version))))
    expect(systemPrompt).toBe(FEEDBACK_WRITER_SYSTEM_PROMPTS[version])
    expect(frozen).toMatchObject({ promptVersion: version, model: "gemini-3.1-flash-lite", schemaVersion: "FEEDBACK_WRITER_OUTPUT_V1", contractVersion: "FEEDBACK_WRITER_INPUT_V1", config: { responseMimeType: "application/json", timeoutMs: 30_000, retries: 0, modelFallback: false, escalation: false } })
  })

  it("V1 continua com o hash da V1.5.1; o adapter usa a V2", () => {
    expect(feedbackWriterFingerprint("FEEDBACK_WRITER_PROMPT_V1")).toMatchObject({ promptSha256: "b0e1961d6cd6934cf6ee763ee5f04669ded5371f963922271c0b29d7619538ba", writerSha256: "c5192d79a84d2a042efad81ca0cdc17979d1fe80479b0e7fdba33144b02fa1a2" })
    expect(FEEDBACK_WRITER_PROMPT_VERSION).toBe("FEEDBACK_WRITER_PROMPT_V2")
    expect(FEEDBACK_WRITER_SYSTEM_PROMPT).toBe(FEEDBACK_WRITER_SYSTEM_PROMPTS.FEEDBACK_WRITER_PROMPT_V2)
  })

  it("V2 explicita NO_CAUSAL_UPGRADE, DECLARED_ACTION_ONLY, POTENTIAL_EFFECT_ONLY e REINFORCE_OBSERVED_ONLY", () => {
    const prompt = FEEDBACK_WRITER_SYSTEM_PROMPT
    for (const required of ["Sequência não é causa", "descreva as duas coisas lado a lado", "levou, fez, provocou, gerou, causou ou resultou", "actionClaimMode DECLARED_ONLY", "é uma declaração dele", "informou, declarou ou comunicou que fez a ação", "Nunca escreva a ação como executada, realizada ou concluída", "comunicar, informar, explicar, resumir, orientar, declarar o encaminhamento", "Não afirme que a compreensão, o entendimento ou o alinhamento do cliente foram confirmados, assegurados ou garantidos", "pode facilitar a compreensão", "somente potencial"]) expect(prompt).toContain(required)
  })

  it("V2 não usa textos do smoke V1.5.2 como exemplo", () => {
    const smokeDir = join(__dirname, "..", "..", "..", "..", "scripts", "poc-tools", "holdout-v2", "dev-regression-v152-writer-smoke", "raw")
    for (const caseId of ["SMOKE-01", "SMOKE-02", "SMOKE-03", "SMOKE-04"]) {
      const raw = JSON.parse(readFileSync(join(smokeDir, `${caseId}.json`), "utf8")) as { input: { items: { evidence: { text: string }[] }[] }; pipeline: { reviews: { writerOriginal: Record<string, string> }[] } }
      const texts = [...raw.input.items.flatMap((item) => item.evidence.map((entry) => entry.text)), ...raw.pipeline.reviews.flatMap((review) => [review.writerOriginal.observed!, review.writerOriginal.whyItMatters!, review.writerOriginal.whatYouCanDo!])]
      for (const text of texts) for (const sentence of text.split(/[.!?]/).map((part) => part.trim()).filter((part) => part.length > 25)) expect(FEEDBACK_WRITER_SYSTEM_PROMPT).not.toContain(sentence)
    }
  })

  it("o prompt reflete o contrato: uma interação, sem padrão, sem intenção, sem causa, sem procedimento/número/sistema/IA inventados, sem tom disciplinar, sugestão, efeito potencial, reforço do observado, três slots", () => {
    const prompt = FEEDBACK_WRITER_SYSTEM_PROMPT
    for (const required of ["UMA única interação", "Nunca trate o item como padrão", "Não diagnostique intenção", "Sequência não é causa", "Não invente canal oficial, obrigação, política, procedimento, requisito, regra de segurança ou risco", "Não escreva número, valor, prazo, data ou meta", "nenhum sistema foi verificado", "Não mencione IA, INIA", "sem linguagem disciplinar", "sugestão prática", "nunca uma obrigação", "\"pode ajudar\", \"contribui para\", \"pode facilitar\"", "\"garante que\", \"assegura que\", \"fez com que\"", "resumir não é confirmar que o cliente entendeu", "enviar ou informar não é o cliente ter recebido", "informar não é o cliente ter ficado satisfeito", "ser objetivo não é ter resolvido o problema", "nenhum campo além de itemRef, observed, whyItMatters e whatYouCanDo"]) expect(prompt).toContain(required)
  })

  it("o prompt não herda nada dos gates históricos: sem códigos W-xx/W2-xx, sem frases das reprovações, sem identificadores com formato real", () => {
    const prompt = FEEDBACK_WRITER_SYSTEM_PROMPT
    expect(prompt).not.toMatch(/\bW2?-\d/)
    for (const phrase of ["garante a compreensão", "garantindo que", "garanta que o cliente receba", "canal oficial de atendimento", "dados pessoais do cliente", "recapitulou"]) expect(prompt).not.toContain(phrase)
    expect(prompt).not.toMatch(/\bITEM_\d/)
    expect(prompt).not.toMatch(/\b(?:I|SF|SP|CC|K|KR|M)-?\d+\b/)
    const gatePrompt = readFileSync(join(__dirname, "..", "..", "..", "..", "scripts", "poc-tools", "holdout-v2", "holdout-v149c-writer-gate-lib.ts"), "utf8")
    const promptLines = prompt.split("\n").filter((line) => line.trim().length > 40)
    expect(promptLines.filter((line) => gatePrompt.includes(line.trim()))).toEqual([])
  })

  it("parse aceita exatamente a identidade/ordem da entrada", () => {
    expect(parseWriterResponse(validAnswer(), ["ITEM_1", "ITEM_2"])).toMatchObject({ ok: true })
    expect(parseWriterResponse(validAnswer([]), [])).toMatchObject({ ok: true, output: { items: [] } })
  })
})
