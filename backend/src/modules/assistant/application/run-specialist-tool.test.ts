import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"

const generateWithTools = vi.fn<(contents: unknown, systemPrompt: string, tools: unknown[]) => Promise<{ kind: "text"; text: string }>>()
vi.mock("../infrastructure/gemini-function-calling-client.js", () => ({ generateWithTools: (...args: [unknown, string, unknown[]]) => generateWithTools(...args) }))
// V1.7.1c — o contrato FEEDBACK pede saída JSON ao provedor (cliente estruturado): o fake registra o modo e responde pelo
// MESMO roteiro de `generateWithTools` (um turno de usuário), para os asserts de prompt continuarem valendo.
const jsonModeCalls = vi.fn<(options: unknown) => void>()
vi.mock("../../agents/infrastructure/gemini-agent-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/infrastructure/gemini-agent-client.js")>()),
  generateAgentReplyWithUsage: async (systemPrompt: string, inputContext: string, options: unknown) => {
    jsonModeCalls(options)
    const reply = await generateWithTools([{ role: "user", text: inputContext }], systemPrompt, [])
    return { text: reply.text, usage: { promptTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null }, durationMs: 0, model: "fake-model" }
  },
}))
const KNOWLEDGE = { mode: "RETRIEVAL", authorizedDocuments: [], retrieved: [{ documentId: "11111111-1111-4111-8111-111111111111", documentTitle: "Procedimento Operacional — Contestação de Contas Móvel", heading: "", excerpt: "x", score: 1 }], injectedChars: 1, estimatedTokens: 1, authorizedChars: 1, budget: { maxChunks: 8, maxTotalChars: 9000 } }
const promptOptions = vi.fn<(options: unknown) => void>()
vi.mock("../../agents/application/build-system-prompt.js", () => ({
  buildSystemPromptWithTrace: async (_db: unknown, _id: string, agent: { context_prompt: string }, options: unknown) => { promptOptions(options); return { systemPrompt: `SYSTEM:${agent.context_prompt}`, knowledge: KNOWLEDGE } },
}))
vi.mock("../../../shared/application/llm-telemetry.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../shared/application/llm-telemetry.js")>()), attachKnowledgeTrace: () => {} }))
const runInvestigation = vi.fn()
vi.mock("../../investigation/application/investigation-runtime.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../investigation/application/investigation-runtime.js")>()), runInvestigation: (...args: unknown[]) => runInvestigation(...args) }))
vi.mock("../../workflows/application/organization-timezone.js", () => ({ resolveOrganizationTimezone: async () => "America/Fortaleza", DEFAULT_ORGANIZATION_TIMEZONE: "America/Fortaleza" }))
vi.mock("./build-operator-context.js", () => ({
  buildOperatorIdentity: async () => ({ name: "Rafael Cardoso", teamId: "team-1", teamName: "B2C · Atendimento Geral" }),
  buildIndicatorSnapshot: async () => null,
  buildFeedbackHistory: async () => null,
}))

const { runSpecialistTool, specialistContractFor } = await import("./run-specialist-tool.js")

const ORG = "org-1"
const TRANSCRIPT = "Operador: Boa tarde, meu nome é Rafael.\nCliente: Minha fatura veio errada.\nOperador: Vou localizar o protocolo anterior pra não recomeçar do zero."

function fakeDb(agent: Record<string, unknown>): Database {
  return {
    query: async (sql: string) => {
      if (sql.includes("from agents where id = $1")) return { rows: [agent], rowCount: 1 }
      if (sql.includes("from people p left join teams")) return { rows: [{ name: "Rafael Cardoso", team_id: "team-1", team_name: "B2C · Atendimento Geral", subteam_id: null, subteam_name: null }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
}
const faturamento = { name: "Especialista de Faturamento", objective: "o", description: "d", context_prompt: "P", active: true, specialty: "FATURAMENTO", specialty_kind: "DOMAIN", domain: "FATURAMENTO", capability: null, consolidated_input: false }
const legacy = { name: "Agente de Indicadores", objective: "o", description: "d", context_prompt: "P", active: true, specialty: null, specialty_kind: null, domain: null, capability: null, consolidated_input: false }
const structured = { title: "Contestação", summary: "Resumo", impactedIndicator: "Reincidência", evidenceFound: "Vou localizar o protocolo anterior pra não recomeçar do zero.", observedBehavior: "Retomou o protocolo", relatedProcedure: "Procedimento Operacional — Contestação de Contas Móvel", recommendation: "Continue." }

beforeEach(() => { generateWithTools.mockReset(); jsonModeCalls.mockReset(); promptOptions.mockReset(); runInvestigation.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}) })

describe("runSpecialistTool — especialista com ferramentas de investigação (capacidades do PRÓPRIO Agent)", () => {
  const trace = [{ sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "TMA: 452 s", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "" }]

  it("sem capacidades não investiga (comportamento de sempre)", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: "ok" })
    const result = await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Como estou?", "op-1")
    expect(runInvestigation).not.toHaveBeenCalled()
    expect(result.toolTrace).toBeUndefined()
  })

  it("com capacidades: investiga sobre o operador da conversa (+ interação do Workflow quando há), o dossiê entra no input e o trace vai no resultado — o Orquestrador não ganha Tools", async () => {
    runInvestigation.mockResolvedValue({ notes: "n", trace, summary: { toolCalls: 1, cachedCalls: 0, rejectedCalls: 0, budget: 10, outcome: "ANSWERED" }, ledger: [], limitations: [], requests: [], knowledgeCandidates: [{ materialId: "22222222-2222-4222-8222-222222222222", title: "Consultado na investigação" }], dossier: "EVIDÊNCIAS: F1. TMA 452 s" })
    generateWithTools.mockResolvedValue({ kind: "text", text: "Seu TMA subiu por concentração em segunda via." })
    const result = await runSpecialistTool(fakeDb({ ...faturamento, investigation_capabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION"] }), ORG, "a-1", "Por que meu TMA subiu?", "op-1", undefined, undefined, { investigation: { interactionId: "int-9", now: new Date("2026-09-17T12:00:00Z") } })
    const call = runInvestigation.mock.calls[0]![0] as { capabilities: string[]; subject: { operatorId: string; interactionId: string | null }; defaultPeriod: { label: string }; objective: string }
    expect(call.capabilities).toEqual(["INDICATOR_ANALYSIS", "SEGMENTATION"])
    expect(call.subject).toMatchObject({ operatorId: "op-1", interactionId: "int-9" })
    expect(call.defaultPeriod.label).toBe("2026-08-19 a 2026-09-17")
    expect(call.objective).toBe("Por que meu TMA subiu?")
    const [contents] = generateWithTools.mock.calls[0]! as [{ text: string }[], string, unknown[]]
    expect(contents[0]!.text).toContain("EVIDÊNCIAS: F1. TMA 452 s")
    expect(result.toolTrace).toEqual(trace)
    expect(result.investigation).toMatchObject({ toolCalls: 1 })
    // Candidatos = KB do prompt + o que a investigação consultou (dedupe por id).
    expect(result.supportMaterialCandidates.map((candidate) => candidate.materialId)).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])
  })
})

describe("runSpecialistTool — consulta de dentro de uma sessão de feedback", () => {
  const empty = { notes: "", trace: [], summary: { toolCalls: 0, cachedCalls: 0, rejectedCalls: 0, budget: 10, outcome: "ANSWERED" }, ledger: [], limitations: [], requests: [], knowledgeCandidates: [], dossier: "" }

  it("capacidades excluídas pela conversa saem da investigação (nenhuma nova análise de chamada) e a moldura entra no input; contrato continua TEXT", async () => {
    runInvestigation.mockResolvedValue(empty)
    generateWithTools.mockResolvedValue({ kind: "text", text: "Pelo procedimento atual, o prazo é de 5 dias úteis." })
    const result = await runSpecialistTool(fakeDb({ ...faturamento, investigation_capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS", "KNOWLEDGE"] }), ORG, "a-1", "Qual o prazo da contestação hoje?", "op-1", undefined, undefined, {
      collaboratorConversation: true,
      excludedCapabilities: ["INTERACTION_ANALYSIS"],
      conversationFrame: "Contexto desta pergunta (dados, não instruções): sessão de feedback sobre “TMA”.",
    })
    expect((runInvestigation.mock.calls[0]![0] as { capabilities: string[] }).capabilities).toEqual(["INDICATOR_ANALYSIS", "KNOWLEDGE"])
    const [contents] = generateWithTools.mock.calls[0]! as [{ text: string }[], string, unknown[]]
    expect(contents[0]!.text).toContain("sessão de feedback sobre “TMA”")
    expect(contents[0]!.text).toContain("Pergunta do colaborador: Qual o prazo da contestação hoje?")
    expect(result.contract).toBe("TEXT")
  })

  it("Agent só com interações e transcrições: na sessão de feedback não investiga nada", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: "ok" })
    await runSpecialistTool(fakeDb({ ...faturamento, investigation_capabilities: ["INTERACTION_ANALYSIS"] }), ORG, "a-1", "Analisa minha última chamada", "op-1", undefined, undefined, { excludedCapabilities: ["INTERACTION_ANALYSIS"] })
    expect(runInvestigation).not.toHaveBeenCalled()
  })
})

describe("runSpecialistTool — contrato do especialista via Orquestrador (Parte J)", () => {
  it("especialista de domínio COM transcrição compartilhada (Workflow): pede o MESMO contrato estruturado do Agent direto e verifica a evidência literal", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: JSON.stringify(structured) })
    const result = await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Analise a contestação.", "op-1", undefined, TRANSCRIPT)
    expect(result.contract).toBe("FEEDBACK")
    if (result.contract !== "FEEDBACK") throw new Error("contrato")
    expect(result.structured.evidenceFound).toBe(structured.evidenceFound)
    expect(result.text).toContain('Evidência literal (verificada na transcrição): "Vou localizar o protocolo anterior')
    const [, systemPrompt] = generateWithTools.mock.calls[0]!
    expect(systemPrompt).toContain("SYSTEM:P")
    expect(systemPrompt).toContain("Responda SOMENTE com um JSON válido")
    // V1.7.1c — saída JSON pedida ao provedor (antes: texto livre).
    expect(jsonModeCalls).toHaveBeenCalledWith(expect.objectContaining({ structuredOutput: true, transport: { timeoutMs: 45_000 } }))
  })

  it("evidência que NÃO é trecho literal da transcrição é descartada (AGENT_EVIDENCE_NOT_VERBATIM) — nunca transformada em citação", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: JSON.stringify({ ...structured, evidenceFound: "O operador disse que ia resolver tudo rapidamente." }) })
    await expect(runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Analise.", "op-1", undefined, TRANSCRIPT)).rejects.toMatchObject({ code: "AGENT_EVIDENCE_NOT_VERBATIM" })
  })

  it("adapter: sem transcrição (chat/voz) ou agente legado sem especialidade → texto livre, prompt inalterado", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: "Seus indicadores da semana estão dentro da meta." })
    const chat = await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Como está minha fatura?", "op-1")
    expect(chat).toMatchObject({ contract: "TEXT", text: "Seus indicadores da semana estão dentro da meta." })
    expect(generateWithTools.mock.calls[0]![1]).not.toContain("Responda SOMENTE com um JSON válido")
    expect(jsonModeCalls).not.toHaveBeenCalled()
    const legacyResult = await runSpecialistTool(fakeDb(legacy), ORG, "a-2", "Como estou?", "op-1", undefined, TRANSCRIPT)
    expect(legacyResult.contract).toBe("TEXT")
    expect(specialistContractFor({ kind: "PERFORMANCE", domain: null, capability: null, acceptsConsolidated: false }, TRANSCRIPT)).toBe("TEXT")
    expect(specialistContractFor({ kind: "CROSS_CUTTING", domain: null, capability: null, acceptsConsolidated: false }, TRANSCRIPT)).toBe("FEEDBACK")
  })
})

describe("runSpecialistTool — materiais de apoio: candidatos sim, seleção só no caminho de voz", () => {
  const REASON = "Este procedimento detalha como explicar a composição da conta antes de registrar a contestação."

  it("como especialista de Orquestrador entrega candidatos derivados do retrieval e NUNCA recomenda por conta própria (marcador ignorado)", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: `Resposta.\nSUPPORT_MATERIALS_JSON: [{"materialId":"11111111-1111-4111-8111-111111111111","reason":"${REASON}"}]` })
    const result = await runSpecialistTool(fakeDb(legacy), ORG, "a-1", "Como contestar?", "op-1")
    expect(result.supportMaterialCandidates).toEqual([{ materialId: "11111111-1111-4111-8111-111111111111", title: "Procedimento Operacional — Contestação de Contas Móvel" }])
    expect(result.knowledge.mode).toBe("RETRIEVAL")
    expect(result.supportMaterials).toBeUndefined()
    const [, systemPrompt] = generateWithTools.mock.calls[0]!
    expect(systemPrompt).not.toContain("MATERIAIS DE APOIO")
  })

  it("caminho de voz (selectSupportMaterials): a seção entra no prompt, o marcador é extraído do texto e a seleção é validada contra os candidatos", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: `Resposta falada.\nSUPPORT_MATERIALS_JSON: [{"materialId":"11111111-1111-4111-8111-111111111111","reason":"${REASON}","url":"https://x"},{"materialId":"inventado","reason":"${REASON}"}]` })
    const result = await runSpecialistTool(fakeDb(legacy), ORG, "a-1", "Como contestar?", "op-1", undefined, undefined, { selectSupportMaterials: true })
    expect(result.text).toBe("Resposta falada.")
    expect(result.supportMaterials).toEqual([{ materialId: "11111111-1111-4111-8111-111111111111", title: "Procedimento Operacional — Contestação de Contas Móvel", reason: REASON }])
    expect(result.supportMaterialsRejected).toEqual([{ materialId: "inventado", code: "MATERIAL_NOT_IN_CANDIDATES" }])
    const [, systemPrompt] = generateWithTools.mock.calls[0]!
    expect(systemPrompt).toContain("MATERIAIS DE APOIO DISPONÍVEIS")
    expect(systemPrompt).toContain('- M1 — Título: "Procedimento Operacional — Contestação de Contas Móvel"')
    expect(systemPrompt).not.toContain("11111111-1111-4111-8111-111111111111")
    expect(systemPrompt).not.toMatch(/https?:\/\//)
  })
})

describe("runSpecialistTool — EVIDENCE GATING do especialista (V1.2)", () => {
  const ledger = [
    { ref: "F1", sequence: 1, round: 0, tool: "get_indicator_snapshot", capability: "INDICATOR_ANALYSIS", keyArgs: "", summary: "TMA 452 s", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 21, periodLabel: null, preflight: true },
    { ref: "F2", sequence: 2, round: 1, tool: "analyze_interactions", capability: "INTERACTION_ANALYSIS", keyArgs: "", summary: "2 transcrições: repete confirmação", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 2, periodLabel: null, preflight: false },
  ]
  const investigated = { notes: "n", trace: [{ sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "TMA: 452 s", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "" }], summary: { toolCalls: 2, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED", interactionsInPeriod: 1267 }, ledger, limitations: ["amostra de 2 interações"], requests: [], knowledgeCandidates: [], dossier: "EVIDÊNCIAS: F1 F2" }
  const agentWithTools = { ...faturamento, investigation_capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] }

  it("chat/voz (TEXT): pede a linha EVIDENCE_JSON, rejeita generalização (EMPLOYEE_PATTERN com 2 de 1.267), corrige em UMA re-request e persiste gating/representatividade no resumo", async () => {
    runInvestigation.mockResolvedValue(investigated)
    generateWithTools
      .mockResolvedValueOnce({ kind: "text", text: 'Você costuma repetir a confirmação.\nEVIDENCE_JSON: {"behavioralClaims":[{"text":"Você costuma repetir a confirmação","evidenceRefs":["F2"],"scope":"EMPLOYEE_PATTERN"}]}' })
      .mockResolvedValueOnce({ kind: "text", text: 'Nas duas interações analisadas você repetiu a confirmação.\nEVIDENCE_JSON: {"behavioralClaims":[{"text":"Nas duas interações analisadas você repetiu a confirmação","evidenceRefs":["F2"],"scope":"INTERACTION_SPECIFIC"}],"limitations":["amostra de 2"]}' })
    const result = await runSpecialistTool(fakeDb(agentWithTools), ORG, "a-1", "Por que meu TMA subiu?", "op-1")
    expect(result.text).toBe("Nas duas interações analisadas você repetiu a confirmação.")
    expect((generateWithTools.mock.calls[0]![1] as string)).toContain("EVIDENCE_JSON:")
    expect((generateWithTools.mock.calls[1]![0] as { text: string }[])[0]!.text).toContain("CORREÇÃO OBRIGATÓRIA")
    expect(result.investigation?.evidenceGating).toMatchObject({ corrected: true })
    expect(result.investigation?.evidenceGating?.rejectedClaims[0]?.reason).toContain("escopo EMPLOYEE_PATTERN")
    expect(result.investigation?.synthesis?.evidenceRepresentativeness).toMatchObject([{ ref: "F2", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL", universeRelationship: "UNKNOWN" }])
  })

  it("chat/voz: violação persistente → resposta FACTUAL (só fatos + limitações), nunca a afirmação sem evidência", async () => {
    runInvestigation.mockResolvedValue(investigated)
    generateWithTools.mockResolvedValue({ kind: "text", text: 'Você navega lentamente.\nEVIDENCE_JSON: {"behavioralClaims":[{"text":"Você navega lentamente","evidenceRefs":["F1"]}]}' })
    const result = await runSpecialistTool(fakeDb(agentWithTools), ORG, "a-1", "Por que meu TMA subiu?", "op-1")
    expect(result.text).toContain("limitada aos fatos apurados")
    expect(result.text).not.toContain("navega lentamente")
    expect(result.investigation?.evidenceGating).toMatchObject({ corrected: false })
    expect(result.investigation?.evidenceGating?.rejectedClaims).toHaveLength(2)
  })

  it("Workflow (FEEDBACK com transcrição): campos de evidência no JSON, TRANSCRICAO vale como evidência; violação persistente descarta (AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM)", async () => {
    runInvestigation.mockResolvedValue(investigated)
    generateWithTools.mockResolvedValue({ kind: "text", text: JSON.stringify({ ...structured, behavioralClaims: [{ text: "Você repetiu a confirmação", evidenceRefs: ["TRANSCRICAO"], scope: "INTERACTION_SPECIFIC" }] }) })
    const ok = await runSpecialistTool(fakeDb(agentWithTools), ORG, "a-1", "Analise.", "op-1", undefined, TRANSCRIPT)
    expect(ok.contract).toBe("FEEDBACK")
    expect(ok.investigation?.evidenceGating).toMatchObject({ rejectedClaims: [], corrected: false, envelopePresent: true, fallbackUsed: false })
    expect((generateWithTools.mock.calls[0]![1] as string)).toContain("refs válidas são somente TRANSCRICAO, F1, F2")
    generateWithTools.mockReset().mockResolvedValue({ kind: "text", text: JSON.stringify({ ...structured, behavioralClaims: [{ text: "Você sempre demora", evidenceRefs: ["F1"], scope: "EMPLOYEE_PATTERN" }] }) })
    await expect(runSpecialistTool(fakeDb(agentWithTools), ORG, "a-1", "Analise.", "op-1", undefined, TRANSCRIPT)).rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM" })
    expect(generateWithTools).toHaveBeenCalledTimes(2)
  })
})

describe("V1.7.1d — plano de cobertura da base no especialista", () => {
  it("avaliação de processo de uma chamada que chegou ao fim pede a cobertura da fase de fechamento; sem avaliação de processo, não", async () => {
    const assessment = { processes: [], applicability: [] }
    generateWithTools.mockResolvedValue({ kind: "text", text: JSON.stringify({ ...structured, processAssessment: assessment }) })
    await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Avalie.", "op-1", undefined, TRANSCRIPT, { outputContract: "PROCESS_ASSESSMENT" })
    // V1.7.1l — a avaliação de processo também pede o rótulo de CONTEXTO nas seções não executáveis (espaço de candidatos).
    expect(promptOptions).toHaveBeenLastCalledWith(expect.objectContaining({ coverage: { phases: ["CLOSING"], subject: null }, markProcessRoles: true }))
    generateWithTools.mockResolvedValue({ kind: "text", text: JSON.stringify(structured) })
    await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Avalie.", "op-1", undefined, TRANSCRIPT)
    expect(promptOptions).toHaveBeenLastCalledWith(expect.objectContaining({ coverage: null, markProcessRoles: false }))
  })
})

describe("conversa: a busca na base considera também a última pergunta da pessoa (ASKER_QUESTION_RETRIEVAL_V1)", () => {
  const PERSON = "Como faço para registrar a contestação da fatura de um cliente?"
  const ROUTING = "Como registrar a contestação da fatura de um cliente? Passo a passo e procedimentos."

  it("chat/voz: a pergunta da pessoa vai para a busca e o input do especialista continua com a pergunta do roteamento", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: "Registre conta, linha, valor e data." })
    await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", ROUTING, "op-1", undefined, undefined, { collaboratorConversation: true, askerQuestion: PERSON })
    expect(promptOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: ROUTING, collaboratorConversation: true, askerQuestion: PERSON }))
    const [contents] = generateWithTools.mock.calls[0]! as [{ text: string }[], string, unknown[]]
    expect(contents[0]!.text).toContain(`Pergunta do colaborador: ${ROUTING}`)
  })

  it("fora da conversa (Workflow, QA Lab) a pergunta nunca entra na busca, mesmo se vier", async () => {
    generateWithTools.mockResolvedValue({ kind: "text", text: JSON.stringify(structured) })
    await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", "Analise a contestação.", "op-1", undefined, TRANSCRIPT, { askerQuestion: PERSON })
    expect(promptOptions).toHaveBeenLastCalledWith(expect.objectContaining({ collaboratorConversation: false, askerQuestion: null }))
    generateWithTools.mockResolvedValue({ kind: "text", text: "ok" })
    await runSpecialistTool(fakeDb(faturamento), ORG, "a-1", ROUTING, "op-1")
    expect(promptOptions).toHaveBeenLastCalledWith(expect.objectContaining({ askerQuestion: null }))
  })
})
