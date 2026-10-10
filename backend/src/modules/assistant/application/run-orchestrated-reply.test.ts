import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { runOrchestratedReply } from "./run-orchestrated-reply.js"
import type { ResolvedOrchestrator } from "./resolve-orchestrator.js"

const generateWithTools = vi.fn()
const runSpecialistTool = vi.fn()
vi.mock("./run-specialist-tool.js", () => ({ runSpecialistTool: (...args: unknown[]) => runSpecialistTool(...args) }))
vi.mock("../infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: (...args: unknown[]) => generateWithTools(...args),
}))

const fakeDb = {} as Database

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
