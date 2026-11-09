import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { MAX_TOOL_CALLS_PER_ROUND, MAX_TOOL_CALLS_PER_TURN, runOrchestratedReply, SPECIALIST_UNAVAILABLE_TEXT, TOOL_CALL_LIMIT_TEXT } from "./run-orchestrated-reply.js"
import type { ResolvedOrchestrator } from "./resolve-orchestrator.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"

const generateWithTools = vi.fn()
const runSpecialistTool = vi.fn()
vi.mock("./run-specialist-tool.js", () => ({ runSpecialistTool: (...args: unknown[]) => runSpecialistTool(...args) }))
vi.mock("../infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: (...args: unknown[]) => generateWithTools(...args),
}))

/** Banco simulado: só a conferência de ativo na hora de acionar cada especialista (PEN-070). `agentOf` = linha simulada do agente
 * (padrão: todo agente existe e está ativo). */
function fakeDatabase(agentOf: (agentId: string) => Record<string, unknown> | undefined = () => ({})): Database {
  return { query: async (text: string, params?: unknown[]) => answerAgentVersionQuery(text, params, agentOf) ?? { rows: [], rowCount: 0 } } as unknown as Database
}
const fakeDb = fakeDatabase()

function orchestrator(overrides: Partial<ResolvedOrchestrator> = {}): ResolvedOrchestrator {
  return {
    organizationId: "org-1",
    orchestratorId: "orch-1",
    orchestratorName: "Monitoria Geral",
    orchestratorAgentId: "agent-orch-1",
    systemPrompt: "Você é a INIA.",
    specialists: [],
    tools: [],
    recommendSupportMaterials: false,
    outputInstructions: null,
    structuredOutput: null,
    ...overrides,
  }
}

describe("runOrchestratedReply — ferramentas diretas do backend (liderança)", () => {
  it("executa a ferramenta no backend, passa o texto factual à síntese e devolve o cartão à parte", async () => {
    const declaration = { name: "leadership_indicator_analysis", description: "Análise de um indicador", parameters: { type: "object" as const, properties: { indicador: { type: "string" } }, required: ["indicador"] } }
    const execute = vi.fn().mockResolvedValue({ text: "Fora da referência: 9 de 23 (39,1%).", card: { type: "INDICATOR_ANALYSIS", id: "card-1" } })
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "leadership_indicator_analysis", args: { indicador: "TMA" } }] })
      .mockResolvedValueOnce({ kind: "text", text: "9 de 23 pessoas estão fora da referência em TMA." })
    runSpecialistTool.mockReset()

    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "qual % do time está ruim em TMA?" }], "", "leader-1", {}, {}, { directTools: { declarations: [declaration], handles: (name) => name === declaration.name, execute } })

    // A ferramenta foi oferecida no roteamento e executada pelo backend — nenhum especialista acionado.
    expect(generateWithTools.mock.calls[0]![2]).toEqual(expect.arrayContaining([expect.objectContaining({ name: "leadership_indicator_analysis" })]))
    expect(execute).toHaveBeenCalledWith("leadership_indicator_analysis", { indicador: "TMA" })
    expect(runSpecialistTool).not.toHaveBeenCalled()
    // A síntese recebe o texto factual como resposta da função.
    expect(JSON.stringify(generateWithTools.mock.calls[1]![0])).toContain("9 de 23 (39,1%)")
    expect(reply.text).toBe("9 de 23 pessoas estão fora da referência em TMA.")
    expect(reply.directResults).toEqual([{ toolName: "leadership_indicator_analysis", args: { indicador: "TMA" }, card: { type: "INDICATOR_ANALYSIS", id: "card-1" } }])
    expect(reply.agentId).toBeNull()
  })

  it("rodadas: a IA lê o resultado, consulta de novo e responde com tudo (sem síntese a mais)", async () => {
    const declaration = { name: "leadership_indicator_query", description: "Consulta", parameters: { type: "object" as const, properties: {} } }
    const execute = vi.fn().mockResolvedValueOnce({ text: "Piores: Ana, Bia.", card: { id: "c1" } }).mockResolvedValueOnce({ text: "Motivo: Fatura +30 s.", card: { id: "c2" } })
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "leadership_indicator_query", args: { agrupar_por: "PESSOA" } }] })
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "leadership_indicator_query", args: { visao: "DIAGNOSTICO" } }] })
      .mockResolvedValueOnce({ kind: "text", text: "Os piores são Ana e Bia; o motivo Fatura pesa mais." })
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "onde está o problema em TMA?" }], "", "leader-1", {}, {}, { directTools: { declarations: [declaration], handles: () => true, execute } })
    expect(generateWithTools).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(generateWithTools.mock.calls[2]![0])).toContain("Motivo: Fatura +30 s.")
    expect(reply.text).toBe("Os piores são Ana e Bia; o motivo Fatura pesa mais.")
    expect(reply.directResults?.map((result) => result.card)).toEqual([{ id: "c1" }, { id: "c2" }])
    expect(reply.calls).toHaveLength(2)
  })

  it("teto de chamadas: 30 pedidas numa rodada executam só o teto por rodada; o turno inteiro para no teto total", async () => {
    const declaration = { name: "leadership_indicator_query", description: "Consulta", parameters: { type: "object" as const, properties: {} } }
    const execute = vi.fn().mockResolvedValue({ text: "dados", card: null })
    const burst = { kind: "functionCalls", calls: Array.from({ length: 30 }, (_, index) => ({ name: "leadership_indicator_query", args: { n: index } })) }
    generateWithTools.mockReset().mockResolvedValueOnce(burst).mockResolvedValueOnce(burst).mockResolvedValueOnce(burst).mockResolvedValueOnce({ kind: "text", text: "Síntese final." })
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "consulte tudo em paralelo" }], "", "leader-1", {}, {}, { directTools: { declarations: [declaration], handles: () => true, execute } })
    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_TURN)
    // A 1ª rodada executou só o teto por rodada; as recusadas voltaram ao modelo com o aviso.
    expect(execute.mock.calls.slice(0, MAX_TOOL_CALLS_PER_ROUND).map((call) => call[1])).toEqual(Array.from({ length: MAX_TOOL_CALLS_PER_ROUND }, (_, index) => ({ n: index })))
    expect(JSON.stringify(generateWithTools.mock.calls[1]![0])).toContain(TOOL_CALL_LIMIT_TEXT)
    expect(reply.text).toBe("Síntese final.")
  })

  it("rodadas: no limite, a síntese sem ferramentas fecha a resposta", async () => {
    const declaration = { name: "leadership_indicator_query", description: "Consulta", parameters: { type: "object" as const, properties: {} } }
    const execute = vi.fn().mockResolvedValue({ text: "dados", card: null })
    const toolCall = { kind: "functionCalls", calls: [{ name: "leadership_indicator_query", args: {} }] }
    generateWithTools.mockReset().mockResolvedValueOnce(toolCall).mockResolvedValueOnce(toolCall).mockResolvedValueOnce(toolCall).mockResolvedValueOnce({ kind: "text", text: "Síntese final." })
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "x" }], "", "leader-1", {}, {}, { directTools: { declarations: [declaration], handles: () => true, execute } })
    expect(execute).toHaveBeenCalledTimes(3)
    expect(generateWithTools.mock.calls[3]![2]).toEqual([])
    expect(reply.text).toBe("Síntese final.")
  })

  it("sem ferramentas diretas, nada muda (o operador continua com os especialistas de sempre)", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Olá!" })
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "oi" }], "", "operator-1")
    expect(reply.directResults).toBeUndefined()
    expect(generateWithTools.mock.calls[0]![2]).toEqual([])
  })
})

describe("runOrchestratedReply", () => {
  it("returns plain text with no structuredResult when the orchestrator has no outputInstructions", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Olá! Como posso ajudar?" })

    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "oi" }], "", "operator-1")

    expect(reply).toEqual({ text: "Olá! Como posso ajudar?", agentId: null, calls: [], results: [], structuredResult: null, supportMaterialCandidates: [], orchestration: { routing: { mode: "MODEL", reason: "NOT_DECLARED" }, synthesis: { mode: "NONE", reason: "NO_SPECIALIST_CALLED" } } })
  })

  it("extracts a structured JSON result from the marker line when outputInstructions is configured", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({
      kind: "text",
      text: 'Resumo do atendimento.\nSTRUCTURED_RESULT_JSON: {"diagnosis":{"severity":"CRITICAL"},"flags":{"offensiveLanguage":false}}',
    })

    const reply = await runOrchestratedReply(
      fakeDb,
      orchestrator({ outputInstructions: '{"diagnosis":{"severity":"HIGH|CRITICAL"},"flags":{"offensiveLanguage":boolean}}' }),
      [{ role: "user", text: "Analise esta ocorrência" }],
      "",
      "operator-1",
    )

    expect(reply.text).toBe("Resumo do atendimento.")
    expect(reply.structuredResult).toEqual({ diagnosis: { severity: "CRITICAL" }, flags: { offensiveLanguage: false } })
    // a instrução de formato foi anexada ao system prompt mandado pro modelo
    expect(generateWithTools).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("STRUCTURED_RESULT_JSON"), expect.anything(), expect.anything())
  })

  it("falls back to the raw text with structuredResult null when the marker's JSON is invalid", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Resumo.\nSTRUCTURED_RESULT_JSON: {isso não é json}" })

    const reply = await runOrchestratedReply(fakeDb, orchestrator({ outputInstructions: "qualquer coisa" }), [{ role: "user", text: "oi" }], "", "operator-1")

    expect(reply.structuredResult).toBeNull()
    expect(reply.text).toBe("Resumo.\nSTRUCTURED_RESULT_JSON: {isso não é json}")
  })

  // Fonte única da verdade (structured-output-definition.ts): com a definição nova o JSON
  // devolvido é VALIDADO — inválido nunca chega a um Condition como se fosse válido.
  const ANALISE = {
    schemaVersion: 1 as const,
    nodes: [
      {
        kind: "GROUP" as const,
        key: "analise",
        label: "Análise",
        children: [
          { kind: "FIELD" as const, key: "assunto", label: "Assunto", type: "STRING" as const, required: true },
          { kind: "FIELD" as const, key: "severidade", label: "Severidade", type: "ENUM" as const, required: false, options: [{ value: "BAIXA", label: "Baixa" }, { value: "ALTA", label: "Alta" }] },
          { kind: "FIELD" as const, key: "requerAcompanhamento", label: "Requer acompanhamento", type: "BOOLEAN" as const, required: false },
        ],
      },
    ],
  }

  it("validates the structured JSON against the definition and describes it with labels (valid)", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({
      kind: "text",
      text: 'Resumo.\nSTRUCTURED_RESULT_JSON: ```json\n{"analise":{"assunto":"Cobrança em duplicidade","severidade":"alta","requerAcompanhamento":"true","extra":1}}\n```',
    })
    const reply = await runOrchestratedReply(fakeDb, orchestrator({ outputInstructions: "contrato gerado", structuredOutput: ANALISE }), [{ role: "user", text: "oi" }], "", "operator-1")
    expect(reply.text).toBe("Resumo.")
    expect(reply.structuredResult).toEqual({ analise: { assunto: "Cobrança em duplicidade", severidade: "ALTA", requerAcompanhamento: true } })
    expect(reply.structuredResultValidation).toEqual({
      valid: true,
      fields: [
        { path: "analise.assunto", label: "Análise › Assunto", displayValue: "Cobrança em duplicidade" },
        { path: "analise.severidade", label: "Análise › Severidade", displayValue: "Alta" },
        { path: "analise.requerAcompanhamento", label: "Análise › Requer acompanhamento", displayValue: "Sim" },
      ],
    })
  })

  it("keeps structuredResult null and records the reasons when the JSON violates the definition (invalid enum / missing required)", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: 'Resumo.\nSTRUCTURED_RESULT_JSON: {"analise":{"severidade":"URGENTISSIMA"}}' })
    const reply = await runOrchestratedReply(fakeDb, orchestrator({ outputInstructions: "contrato gerado", structuredOutput: ANALISE }), [{ role: "user", text: "oi" }], "", "operator-1")
    expect(reply.structuredResult).toBeNull()
    expect(reply.structuredResultValidation?.valid).toBe(false)
    if (reply.structuredResultValidation?.valid === false) {
      expect(reply.structuredResultValidation.issues.map((issue) => issue.path).sort()).toEqual(["analise.assunto", "analise.severidade"])
      expect(reply.structuredResultValidation.rawResult).toEqual({ analise: { severidade: "URGENTISSIMA" } })
    }
  })

  it("marks the result invalid when the definition expects a JSON but the marker never came", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Só texto." })
    const reply = await runOrchestratedReply(fakeDb, orchestrator({ outputInstructions: "contrato gerado", structuredOutput: ANALISE }), [{ role: "user", text: "oi" }], "", "operator-1")
    expect(reply.text).toBe("Só texto.")
    expect(reply.structuredResult).toBeNull()
    expect(reply.structuredResultValidation).toMatchObject({ valid: false, rawResult: null })
  })
})

describe("runOrchestratedReply — materiais de apoio (agregação dos especialistas + seleção final)", () => {
  const A = { materialId: "11111111-1111-4111-8111-111111111111", title: "Técnicas de sondagem em retenção" }
  const B = { materialId: "22222222-2222-4222-8222-222222222222", title: "Tratamento de objeções por preço" }
  const C = { materialId: "33333333-3333-4333-8333-333333333333", title: "Checklist de Encerramento" }
  const D = { materialId: "44444444-4444-4444-8444-444444444444", title: "Jeito de Atender" }
  const KNOWLEDGE = { mode: "RETRIEVAL", authorizedDocuments: [], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: { maxChunks: 8, maxTotalChars: 9000 } }
  const REASON = "Este material traz perguntas de sondagem para situações de retenção por preço."
  const withSpecialists = (overrides: Partial<ResolvedOrchestrator> = {}) =>
    orchestrator({
      specialists: [
        { agentId: "agent-a", toolName: "consultar_retencao" },
        { agentId: "agent-b", toolName: "consultar_faturamento" },
      ],
      tools: [{ name: "consultar_retencao", description: "x", parameters: { type: "OBJECT", properties: {} } } as never, { name: "consultar_faturamento", description: "y", parameters: { type: "OBJECT", properties: {} } } as never],
      ...overrides,
    })
  const twoCalls = { kind: "functionCalls", calls: [{ name: "consultar_retencao", args: { query: "q1" } }, { name: "consultar_faturamento", args: { query: "q2" } }] }

  function arrange(candidatesA: typeof A[], candidatesB: typeof A[], finalText: string) {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    runSpecialistTool.mockReset()
    runSpecialistTool.mockImplementation(async (_db: unknown, _organizationId: string, agentId: string) => ({ contract: "TEXT", text: `resposta de ${agentId}`, knowledge: KNOWLEDGE, supportMaterialCandidates: agentId === "agent-a" ? candidatesA : candidatesB }))
    generateWithTools.mockReset().mockResolvedValueOnce(twoCalls).mockResolvedValueOnce({ kind: "text", text: finalText })
  }

  it("OFF: especialistas usam KB normalmente, candidatos são agregados, mas nenhum material é recomendado e a seção não entra no prompt", async () => {
    arrange([A], [B], `Síntese.\nSUPPORT_MATERIALS_JSON: [{"materialId":"${A.materialId}","reason":"${REASON}"}]`)
    const reply = await runOrchestratedReply(fakeDb, withSpecialists(), [{ role: "user", text: "como reter?" }], "", "op-1")
    expect(reply.text).toBe("Síntese.")
    expect(reply.supportMaterials).toBeUndefined()
    expect(reply.supportMaterialCandidates).toEqual([A, B])
    const synthesisPrompt = generateWithTools.mock.calls[1]![1] as string
    expect(synthesisPrompt).not.toContain("MATERIAIS DE APOIO DISPONÍVEIS")
  })

  it("ON: agrega e deduplica candidatos de todos os especialistas (A,B + B,C → A,B,C), injeta a seção sem URL e aceita a seleção do modelo", async () => {
    // O modelo escolhe pelos handles M3/M1 (V1.2 — Zero-ID); um materialId real ainda seria aceito.
    arrange([A, B], [B, C], `Síntese final.\nSUPPORT_MATERIALS_JSON: [{"materialId":"M3","reason":"${REASON}"},{"materialId":"${A.materialId}","reason":"${REASON}"}]`)
    const reply = await runOrchestratedReply(fakeDb, withSpecialists({ recommendSupportMaterials: true }), [{ role: "user", text: "como reter?" }], "", "op-1")
    expect(reply.text).toBe("Síntese final.")
    expect(reply.supportMaterialCandidates).toEqual([A, B, C])
    expect(reply.supportMaterials).toEqual([
      { materialId: C.materialId, title: C.title, reason: REASON },
      { materialId: A.materialId, title: A.title, reason: REASON },
    ])
    const synthesisPrompt = generateWithTools.mock.calls[1]![1] as string
    expect(synthesisPrompt).toContain("MATERIAIS DE APOIO DISPONÍVEIS")
    expect(synthesisPrompt).toContain(`- M1 — Título: "${A.title}"`)
    expect(synthesisPrompt).not.toContain(A.materialId)
    expect(synthesisPrompt).toContain(`"${C.title}"`)
    expect(synthesisPrompt).not.toMatch(/https?:\/\//)
    expect(synthesisPrompt).not.toContain("/materiais/")
    // o resultado de cada especialista carrega candidatos + knowledge (nunca recomendação própria)
    expect(reply.results[0]?.supportMaterialCandidates).toEqual([A, B])
    expect(reply.results.every((result) => !("supportMaterials" in result))).toBe(true)
  })

  it("ON: máximo 3 (o 4º é rejeitado), id inventado descartado, URL ignorada, zero é válido", async () => {
    arrange([A, B], [C, D], `Síntese.\nSUPPORT_MATERIALS_JSON: [{"materialId":"${A.materialId}","reason":"${REASON}","url":"https://x"},{"materialId":"inventado","reason":"${REASON}"},{"materialId":"${B.materialId}","reason":"${REASON}"},{"materialId":"${C.materialId}","reason":"${REASON}"},{"materialId":"${D.materialId}","reason":"${REASON}"}]`)
    const reply = await runOrchestratedReply(fakeDb, withSpecialists({ recommendSupportMaterials: true }), [{ role: "user", text: "?" }], "", "op-1")
    expect(reply.supportMaterials?.map((item) => item.materialId)).toEqual([A.materialId, B.materialId, C.materialId])
    expect(reply.supportMaterialsRejected).toEqual([
      { materialId: "inventado", code: "MATERIAL_NOT_IN_CANDIDATES" },
      { materialId: D.materialId, code: "LIMIT_EXCEEDED" },
    ])
    expect(JSON.stringify(reply.supportMaterials)).not.toContain("https://x")

    arrange([A], [B], "Síntese sem material.\nSUPPORT_MATERIALS_JSON: []")
    const none = await runOrchestratedReply(fakeDb, withSpecialists({ recommendSupportMaterials: true }), [{ role: "user", text: "?" }], "", "op-1")
    expect(none.text).toBe("Síntese sem material.")
    expect(none.supportMaterials).toBeUndefined()
  })

  it("ON, mas sem especialista acionado (resposta direta do coordenador): não há candidato, logo nenhuma recomendação — e o marcador é removido do texto", async () => {
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: `Oi!\nSUPPORT_MATERIALS_JSON: [{"materialId":"${A.materialId}","reason":"${REASON}"}]` })
    const reply = await runOrchestratedReply(fakeDb, withSpecialists({ recommendSupportMaterials: true }), [{ role: "user", text: "oi" }], "", "op-1")
    expect(reply.text).toBe("Oi!")
    expect(reply.supportMaterials).toBeUndefined()
  })

  it("materiais e resultado estruturado coexistem: cada marcador é extraído de forma independente", async () => {
    arrange([A], [B], `Síntese.\nSUPPORT_MATERIALS_JSON: [{"materialId":"${A.materialId}","reason":"${REASON}"}]\nSTRUCTURED_RESULT_JSON: {"severity":"HIGH"}`)
    const reply = await runOrchestratedReply(fakeDb, withSpecialists({ recommendSupportMaterials: true, outputInstructions: "{severity}" }), [{ role: "user", text: "?" }], "", "op-1")
    expect(reply.text).toBe("Síntese.")
    expect(reply.structuredResult).toEqual({ severity: "HIGH" })
    expect(reply.supportMaterials?.[0]?.materialId).toBe(A.materialId)
    expect(reply.structuredResult).not.toHaveProperty("supportMaterials")
  })
})

describe("runOrchestratedReply — EVIDENCE GATING do Orquestrador (V1.2): nunca eleva o escopo do especialista", () => {
  const KNOWLEDGE = { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: { maxChunks: 8, maxTotalChars: 9000 } }
  const specialistWithClaim = {
    contract: "TEXT", text: "Em I1 houve uma pausa longa.", knowledge: KNOWLEDGE, supportMaterialCandidates: [],
    toolTrace: [], investigation: { toolCalls: 2, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED", synthesis: { supportedHypotheses: [], unsupportedHypotheses: [], limitations: ["amostra de 2"], behavioralClaims: [{ text: "Em I1 houve pausa longa", evidenceRefs: ["F2"], scope: "INTERACTION_SPECIFIC" }], recommendationSupport: [], evidenceRepresentativeness: [{ ref: "F2", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL" }] } },
  }
  const withOne = orchestrator({ specialists: [{ agentId: "agent-a", toolName: "consultar_retencao" }], tools: [{ name: "consultar_retencao", description: "x", parameters: { type: "OBJECT", properties: {} } } as never] })
  const oneCall = { kind: "functionCalls", calls: [{ name: "consultar_retencao", args: { query: "q1" } }] }

  it("a síntese recebe as claims C1..Cn com escopo/representatividade e a instrução EVIDENCE_JSON; 'pausas recorrentes' é corrigida em uma re-request e o gating fica no resultado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    runSpecialistTool.mockReset().mockResolvedValue(specialistWithClaim)
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce(oneCall)
      .mockResolvedValueOnce({ kind: "text", text: 'O colaborador apresenta pausas longas recorrentes.\nEVIDENCE_JSON: {"behavioralClaims":[{"text":"O colaborador apresenta pausas longas recorrentes","evidenceRefs":["C1"],"scope":"EMPLOYEE_PATTERN"}]}' })
      .mockResolvedValueOnce({ kind: "text", text: 'Na interação analisada houve uma pausa longa.\nEVIDENCE_JSON: {"behavioralClaims":[{"text":"Na interação analisada houve uma pausa longa","evidenceRefs":["C1"],"scope":"INTERACTION_SPECIFIC"}]}' })
    const reply = await runOrchestratedReply(fakeDb, withOne, [{ role: "user", text: "como estou?" }], "", "op-1")
    const synthesisPrompt = generateWithTools.mock.calls[1]![1] as string
    expect(synthesisPrompt).toContain("C1 [nesta(s) interação(ões) · evidência anecdotal] Em I1 houve pausa longa (consultar_retencao)")
    expect(synthesisPrompt).toContain("EVIDENCE_JSON:")
    expect(reply.text).toBe("Na interação analisada houve uma pausa longa.")
    expect(reply.evidenceGating).toMatchObject({ corrected: true })
    expect(reply.evidenceGating?.rejectedClaims[0]?.reason).toContain("amplia o que os especialistas sustentaram")
    expect(generateWithTools).toHaveBeenCalledTimes(3)
  })

  it("violação persistente: a síntese vira factual (respostas dos especialistas, já validadas) e nenhuma claim ampliada chega ao chat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    runSpecialistTool.mockReset().mockResolvedValue(specialistWithClaim)
    generateWithTools.mockReset().mockResolvedValueOnce(oneCall).mockResolvedValue({ kind: "text", text: 'Pausas recorrentes.\nEVIDENCE_JSON: {"behavioralClaims":[{"text":"Pausas recorrentes","evidenceRefs":["C1"],"scope":"EMPLOYEE_PATTERN"}]}' })
    const reply = await runOrchestratedReply(fakeDb, withOne, [{ role: "user", text: "como estou?" }], "", "op-1")
    expect(reply.text).toContain("Não foi possível sintetizar com evidência suficiente")
    expect(reply.text).toContain("Em I1 houve uma pausa longa.")
    expect(reply.evidenceGating).toMatchObject({ corrected: false })
    expect(reply.synthesis?.behavioralClaims).toEqual([])
  })

  it("sem investigação em nenhum especialista, nada muda: sem bloco de evidência e sem gating (comportamento de sempre)", async () => {
    runSpecialistTool.mockReset().mockResolvedValue({ contract: "TEXT", text: "resposta", knowledge: KNOWLEDGE, supportMaterialCandidates: [] })
    generateWithTools.mockReset().mockResolvedValueOnce(oneCall).mockResolvedValueOnce({ kind: "text", text: "Síntese." })
    const reply = await runOrchestratedReply(fakeDb, withOne, [{ role: "user", text: "oi" }], "", "op-1")
    expect(reply.text).toBe("Síntese.")
    expect(reply.evidenceGating).toBeUndefined()
    expect(generateWithTools.mock.calls[1]![1] as string).not.toContain("EVIDENCE_JSON")
  })
})

describe("runOrchestratedReply — V1.7.1 caminho rápido (roteamento declarado + síntese dispensada)", () => {
  const FAT = "d0000000-0000-4000-8000-00000000000f"
  const RET = "d0000000-0000-4000-8000-00000000000e"
  const KNOWLEDGE = { mode: "RETRIEVAL", authorizedDocuments: [], retrieved: [{ documentId: "doc", documentTitle: "Procedimento", heading: "15", excerpt: "Explicar prazo;" }], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: { maxChunks: 8, maxTotalChars: 9000 } }
  const structured = { title: "t", summary: "s", impactedIndicator: "i", evidenceFound: "e", observedBehavior: "o", relatedProcedure: "p", recommendation: "r", processAssessment: { processes: [] } }
  const monitoria = (overrides: Partial<ResolvedOrchestrator> = {}) =>
    orchestrator({
      specialists: [
        { agentId: "agent-fat", toolName: "especialista_faturamento", specialtyKind: "DOMAIN", businessDomainId: FAT },
        { agentId: "agent-ret", toolName: "especialista_retencao", specialtyKind: "DOMAIN", businessDomainId: RET },
      ],
      tools: [{ name: "especialista_faturamento", description: "x", parameters: { type: "OBJECT", properties: {} } } as never, { name: "especialista_retencao", description: "y", parameters: { type: "OBJECT", properties: {} } } as never],
      ...overrides,
    })
  const feedbackSpecialist = (agentId: string) => ({ contract: "FEEDBACK", text: `resultado estruturado de ${agentId}`, structured, knowledge: KNOWLEDGE, supportMaterialCandidates: [] })
  const history = [{ role: "user" as const, text: "Avalie a chamada pelos processos oficiais." }]

  it("A) domínio declarado + 1 especialista estruturado → ZERO chamada de roteamento e ZERO de síntese; resultado repassado", async () => {
    runSpecialistTool.mockReset().mockImplementation(async (_db: unknown, _organizationId: string, agentId: string) => feedbackSpecialist(agentId))
    generateWithTools.mockReset()
    const reply = await runOrchestratedReply(fakeDb, monitoria(), history, "TRANSCRIÇÃO", "op-1", { outputContract: "PROCESS_ASSESSMENT" }, { fixedDomainIds: [FAT], allowSynthesisPassthrough: true })
    expect(generateWithTools).not.toHaveBeenCalled()
    expect(runSpecialistTool).toHaveBeenCalledTimes(1)
    // A organização do especialista é a do Orquestrador que o aciona.
    expect(runSpecialistTool.mock.calls[0]![1]).toBe("org-1")
    expect(runSpecialistTool.mock.calls[0]![2]).toBe("agent-fat")
    expect(runSpecialistTool.mock.calls[0]![3]).toBe("Avalie a chamada pelos processos oficiais.")
    expect(reply).toMatchObject({ agentId: "agent-fat", text: "resultado estruturado de agent-fat", results: [{ agentId: "agent-fat", contract: "FEEDBACK", structured, knowledge: KNOWLEDGE }], orchestration: { routing: { mode: "DETERMINISTIC", reason: "DECLARED_DOMAINS", domainIds: [FAT] }, synthesis: { mode: "PASSTHROUGH", reason: "SINGLE_STRUCTURED_SPECIALIST" } } })
  })

  it("B) roteamento ambíguo (dois especialistas do mesmo domínio, ou domínio sem especialista) → a IA roteia (permitido e registrado)", async () => {
    const ambiguous = monitoria({ specialists: [{ agentId: "agent-fat", toolName: "especialista_faturamento", specialtyKind: "DOMAIN", businessDomainId: FAT }, { agentId: "agent-fat-2", toolName: "especialista_faturamento_2", specialtyKind: "DOMAIN", businessDomainId: FAT }] })
    for (const [orchestratorCase, domains] of [[ambiguous, [FAT]], [monitoria(), ["d0000000-0000-4000-8000-000000000999"]]] as const) {
      runSpecialistTool.mockReset().mockImplementation(async (_db: unknown, _organizationId: string, agentId: string) => feedbackSpecialist(agentId))
      generateWithTools.mockReset().mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "especialista_faturamento", args: { query: "q" } }] })
      const reply = await runOrchestratedReply(fakeDb, orchestratorCase, history, "", "op-1", {}, { fixedDomainIds: domains, allowSynthesisPassthrough: true })
      expect(generateWithTools).toHaveBeenCalledTimes(1)
      expect(reply.orchestration).toMatchObject({ routing: { mode: "MODEL", reason: "DECLARED_DOMAINS_AMBIGUOUS" }, synthesis: { mode: "PASSTHROUGH" } })
    }
  })

  it("C) dois especialistas declarados → síntese pela IA (coordenação real); a síntese recebe as respostas como texto, sem function call fabricada", async () => {
    runSpecialistTool.mockReset().mockImplementation(async (_db: unknown, _organizationId: string, agentId: string) => feedbackSpecialist(agentId))
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Síntese dos dois domínios." })
    const reply = await runOrchestratedReply(fakeDb, monitoria(), history, "", "op-1", {}, { fixedDomainIds: [FAT, RET], allowSynthesisPassthrough: true })
    expect(generateWithTools).toHaveBeenCalledTimes(1)
    const contents = generateWithTools.mock.calls[0]![0] as { role: string; functionCalls?: unknown; text?: string }[]
    expect(contents.some((turn) => turn.functionCalls)).toBe(false)
    expect(contents.at(-1)?.text).toContain("resultado estruturado de agent-ret")
    expect(reply).toMatchObject({ text: "Síntese dos dois domínios.", orchestration: { routing: { mode: "DETERMINISTIC" }, synthesis: { mode: "MODEL", reason: "MULTIPLE_SPECIALISTS" } } })
  })

  it("D) 1 especialista sem contrato compatível, com resultado estruturado pedido, ou fora do Workflow → nunca passthrough inseguro", async () => {
    const cases: { name: string; specialist: object; orch: ResolvedOrchestrator; allow: boolean; reason: string }[] = [
      { name: "texto livre", specialist: { contract: "TEXT", text: "texto", knowledge: KNOWLEDGE, supportMaterialCandidates: [] }, orch: monitoria(), allow: true, reason: "SPECIALIST_NOT_STRUCTURED" },
      { name: "resultado estruturado pedido", specialist: feedbackSpecialist("agent-fat"), orch: monitoria({ outputInstructions: "{severity}" }), allow: true, reason: "STRUCTURED_RESULT_REQUESTED" },
      { name: "chat (sem opção)", specialist: feedbackSpecialist("agent-fat"), orch: monitoria(), allow: false, reason: "PASSTHROUGH_NOT_ALLOWED" },
    ]
    for (const entry of cases) {
      runSpecialistTool.mockReset().mockResolvedValue(entry.specialist)
      generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Síntese." })
      const reply = await runOrchestratedReply(fakeDb, entry.orch, history, "", "op-1", {}, { fixedDomainIds: [FAT], allowSynthesisPassthrough: entry.allow })
      expect(generateWithTools, entry.name).toHaveBeenCalledTimes(1)
      expect(reply.orchestration, entry.name).toMatchObject({ routing: { mode: "DETERMINISTIC" }, synthesis: { mode: "MODEL", reason: entry.reason } })
    }
  })
})

describe("runOrchestratedReply — ganchos da conversa (sessão de feedback)", () => {
  it("a síntese lê a resposta do especialista + o bloco do sistema; o resultado devolvido e as opções do especialista ficam como pedidos", async () => {
    const knowledge = { mode: "RETRIEVAL", authorizedDocuments: [], retrieved: [{ documentId: "doc-1", documentTitle: "Contestação", heading: "35. Prazo da análise", excerpt: "x", score: 1 }], injectedChars: 1, estimatedTokens: 1, authorizedChars: 1, budget: { maxChunks: 8, maxTotalChars: 9000 } }
    runSpecialistTool.mockReset().mockResolvedValue({ contract: "TEXT", text: "Pelo procedimento atual, o prazo é de 5 dias úteis.", knowledge, supportMaterialCandidates: [] })
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "consultar_faturamento", args: { query: "prazo da contestação", periodDays: 30 } }] })
      .mockResolvedValueOnce({ kind: "text", text: "Hoje o procedimento diz 5 dias úteis — é o mesmo documento do seu feedback." })
    const annotate = vi.fn(async () => "RELAÇÃO COM O FEEDBACK EM TELA: mesmo documento")
    const session = orchestrator({ systemPrompt: "INSTRUÇÃO DA SESSÃO", specialists: [{ agentId: "agent-b", toolName: "consultar_faturamento" }], tools: [{ name: "consultar_faturamento", description: "y", parameters: { type: "OBJECT", properties: {} } } as never] })

    const reply = await runOrchestratedReply(fakeDb, session, [{ role: "user", text: "Qual o prazo hoje?" }], "", "op-1", { collaboratorConversation: true, conversationFrame: "MOLDURA", excludedCapabilities: ["INTERACTION_ANALYSIS"] }, {}, { annotateSpecialistResult: annotate })

    expect(annotate).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-b", toolName: "consultar_faturamento", query: "prazo da contestação", periodDays: 30, knowledge }))
    // Sem contexto compartilhado (o especialista nunca recebe o registro como análise) e com as opções da sessão.
    expect(runSpecialistTool.mock.calls[0]!.slice(1)).toEqual(["org-1", "agent-b", "prazo da contestação", "op-1", 30, undefined, expect.objectContaining({ conversationFrame: "MOLDURA", excludedCapabilities: ["INTERACTION_ANALYSIS"] })])
    const [synthesisTurns, synthesisPrompt] = generateWithTools.mock.calls[1]! as [{ functionResponses?: { response: { result: string } }[] }[], string]
    expect(synthesisPrompt).toContain("INSTRUÇÃO DA SESSÃO")
    expect(synthesisTurns.at(-1)!.functionResponses![0]!.response.result).toBe("Pelo procedimento atual, o prazo é de 5 dias úteis.\n\nRELAÇÃO COM O FEEDBACK EM TELA: mesmo documento")
    expect(reply.text).toBe("Hoje o procedimento diz 5 dias úteis — é o mesmo documento do seu feedback.")
    expect(reply.results[0]!.text).toBe("Pelo procedimento atual, o prazo é de 5 dias úteis.")
  })
})

describe("runOrchestratedReply — a busca do especialista considera a última pergunta da pessoa (ASKER_QUESTION_RETRIEVAL_V1)", () => {
  const KNOWLEDGE = { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: { maxChunks: 8, maxTotalChars: 9000 } }
  const PERSON = "Como faço para registrar a contestação da fatura de um cliente?"
  const ROUTING = "Como registrar a contestação da fatura de um cliente? Passo a passo e procedimentos."
  const processos = () => orchestrator({ specialists: [{ agentId: "agent-proc", toolName: "agente_de_processos" }], tools: [{ name: "agente_de_processos", description: "x", parameters: { type: "OBJECT", properties: {} } } as never] })
  const history = [{ role: "user" as const, text: "Oi" }, { role: "model" as const, text: "Olá!" }, { role: "user" as const, text: PERSON }]
  const run = (specialistOptions: Parameters<typeof runOrchestratedReply>[5]) => {
    runSpecialistTool.mockReset().mockResolvedValue({ contract: "TEXT", text: "Registre conta, linha, valor e data.", knowledge: KNOWLEDGE, supportMaterialCandidates: [] })
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "agente_de_processos", args: { query: ROUTING } }] }).mockResolvedValueOnce({ kind: "text", text: "Síntese." })
    return runOrchestratedReply(fakeDb, processos(), history, "", "op-1", specialistOptions)
  }

  it("chat: o especialista recebe a pergunta do roteamento e, para a busca, o último turno da pessoa", async () => {
    await run({ collaboratorConversation: true })
    expect(runSpecialistTool.mock.calls[0]![3]).toBe(ROUTING)
    expect(runSpecialistTool.mock.calls[0]![7]).toEqual({ collaboratorConversation: true, askerQuestion: PERSON })
  })

  it("voz: as palavras da pessoa vindas do chamador valem no lugar do último turno (a `query` do modelo de voz)", async () => {
    await run({ collaboratorConversation: true, askerQuestion: "registrar contestação da fatura" })
    expect(runSpecialistTool.mock.calls[0]![7]).toMatchObject({ askerQuestion: "registrar contestação da fatura" })
  })

  it("fora da conversa (Workflow, QA Lab) nada muda: as opções do especialista são as recebidas", async () => {
    await run({})
    expect(runSpecialistTool.mock.calls[0]![7]).toEqual({})
  })

  it("pergunta com dois assuntos: o roteamento continua acionando os dois especialistas, cada um com a sua pergunta, e a síntese lê os dois", async () => {
    const BOTH = "Como registro a contestação da fatura e quantos dias de férias eu tenho?"
    const twoSpecialists = orchestrator({
      specialists: [{ agentId: "agent-proc", toolName: "agente_de_processos" }, { agentId: "agent-rh", toolName: "agente_de_rh" }],
      tools: [{ name: "agente_de_processos", description: "x", parameters: { type: "OBJECT", properties: {} } } as never, { name: "agente_de_rh", description: "y", parameters: { type: "OBJECT", properties: {} } } as never],
    })
    runSpecialistTool.mockReset().mockImplementation(async (_db: unknown, _org: unknown, agentId: string) => ({ contract: "TEXT", text: `resposta de ${agentId}`, knowledge: KNOWLEDGE, supportMaterialCandidates: [] }))
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "agente_de_processos", args: { query: "Como registrar a contestação da fatura?" } }, { name: "agente_de_rh", args: { query: "Quantos dias de férias o colaborador tem?" } }] })
      .mockResolvedValueOnce({ kind: "text", text: "Síntese dos dois." })
    const reply = await runOrchestratedReply(fakeDb, twoSpecialists, [{ role: "user", text: BOTH }], "", "op-1", { collaboratorConversation: true })
    expect(runSpecialistTool.mock.calls.map((call) => [call[2], call[3], call[7]])).toEqual([
      ["agent-proc", "Como registrar a contestação da fatura?", { collaboratorConversation: true, askerQuestion: BOTH }],
      ["agent-rh", "Quantos dias de férias o colaborador tem?", { collaboratorConversation: true, askerQuestion: BOTH }],
    ])
    const synthesisTurns = generateWithTools.mock.calls[1]![0] as { functionResponses?: { response: { result: string } }[] }[]
    expect(synthesisTurns.at(-1)!.functionResponses!.map((entry) => entry.response.result)).toEqual(["resposta de agent-proc", "resposta de agent-rh"])
    expect(reply.text).toBe("Síntese dos dois.")
  })
})

describe("runOrchestratedReply — especialista desativado depois da resolução (PEN-070) e versões registradas (PEN-002, PEN-076)", () => {
  it("o especialista inativo na hora da chamada não roda: a síntese lê o aviso de indisponível e cada chamada registra o resultado e as versões usadas", async () => {
    runSpecialistTool.mockReset().mockImplementation(async (_db: unknown, _organizationId: string, agentId: string) => ({ contract: "TEXT", text: `resposta de ${agentId}`, supportMaterialCandidates: [] }))
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "consultar_retencao", args: { query: "q1" } }, { name: "consultar_faturamento", args: { query: "q2" } }] })
      .mockResolvedValueOnce({ kind: "text", text: "Síntese com a parte disponível." })
    const versioned = orchestrator({
      orchestratorVersionId: "orch-1-v3",
      orchestratorAgentVersionId: "agent-orch-1-v2",
      specialists: [
        { agentId: "agent-a", agentVersionId: "agent-a-v1", toolName: "consultar_retencao" },
        { agentId: "agent-b", agentVersionId: "agent-b-v4", toolName: "consultar_faturamento" },
      ],
      tools: [{ name: "consultar_retencao", description: "x", parameters: { type: "OBJECT", properties: {} } } as never, { name: "consultar_faturamento", description: "y", parameters: { type: "OBJECT", properties: {} } } as never],
    })
    const db = fakeDatabase((agentId) => (agentId === "agent-b" ? { active: false } : {}))

    const reply = await runOrchestratedReply(db, versioned, [{ role: "user", text: "como reter e o que cobrar?" }], "", "op-1")

    expect(runSpecialistTool).toHaveBeenCalledTimes(1)
    expect(runSpecialistTool.mock.calls[0]![2]).toBe("agent-a")
    const synthesisTurns = generateWithTools.mock.calls[1]![0] as { functionResponses?: { response: { result: string } }[] }[]
    expect(synthesisTurns.at(-1)!.functionResponses!.map((entry) => entry.response.result)).toEqual(["resposta de agent-a", SPECIALIST_UNAVAILABLE_TEXT])
    expect(reply.text).toBe("Síntese com a parte disponível.")
    const orchestratorRef = { orchestratorId: "orch-1", orchestratorVersionId: "orch-1-v3", orchestratorAgentId: "agent-orch-1", orchestratorAgentVersionId: "agent-orch-1-v2" }
    // Revisão da PEN-002/PEN-076 (03/11/2026): a versão registrada é a VIGENTE resolvida na hora da chamada (no banco simulado, a
    // vigente de cada agente tem o id do próprio agente), não a da montagem do Orquestrador.
    expect(reply.calls).toEqual([
      { toolName: "consultar_retencao", query: "q1", agentId: "agent-a", agentVersionId: "agent-a", outcome: "EXECUTED", ...orchestratorRef },
      { toolName: "consultar_faturamento", query: "q2", agentId: "agent-b", agentVersionId: "agent-b", outcome: "BLOCKED_INACTIVE", ...orchestratorRef },
    ])
  })

  it("versão vigente não autorizada para o alcance do Orquestrador na hora da chamada: não roda e fica registrada como acesso não autorizado", async () => {
    runSpecialistTool.mockReset().mockImplementation(async (_db: unknown, _organizationId: string, agentId: string) => ({ contract: "TEXT", text: `resposta de ${agentId}`, supportMaterialCandidates: [] }))
    generateWithTools
      .mockReset()
      .mockResolvedValueOnce({ kind: "functionCalls", calls: [{ name: "consultar_retencao", args: { query: "q1" } }] })
      .mockResolvedValueOnce({ kind: "text", text: "Essa parte está indisponível." })
    const scoped = orchestrator({
      orchestratorVersionId: "orch-1-v3",
      consumerScope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null },
      specialists: [{ agentId: "agent-a", agentVersionId: "agent-a-v1", toolName: "consultar_retencao" }],
      tools: [{ name: "consultar_retencao", description: "x", parameters: { type: "OBJECT", properties: {} } } as never],
    })
    // A versão vigente nova do especialista ficou restrita a um Grupo: não cobre um Orquestrador de "Todos os grupos".
    const db = fakeDatabase(() => ({ scope_type: "TEAM", team_id: "11111111-1111-4111-8111-111111111111" }))

    const reply = await runOrchestratedReply(db, scoped, [{ role: "user", text: "como reter?" }], "", "op-1")

    expect(runSpecialistTool).not.toHaveBeenCalled()
    expect(reply.calls[0]).toMatchObject({ agentId: "agent-a", outcome: "BLOCKED_UNAUTHORIZED" })
  })
})
