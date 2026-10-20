import { describe, expect, it } from "vitest"
import { composeStructuredInstructions, isVerbatimEvidence, parseStructuredFeedback, parseStructuredIndicatorFeedback, STRUCTURED_OUTPUT_INSTRUCTIONS } from "./run-agent.js"

const TRANSCRIPT = "Operador: preciso confirmar o CPF do titular. Cliente: 123. Operador: vou registrar o protocolo da contestação."

const BASE = {
  title: "Contestação sem explicação da composição",
  summary: "O operador registrou a contestação sem explicar a composição da conta.",
  impactedIndicator: "rechamada",
  evidenceFound: "vou registrar o protocolo da contestação",
  observedBehavior: "Registrou o protocolo sem explicar a conta.",
  relatedProcedure: "Procedimento Operacional — Contestação de Contas Móvel",
  recommendation: "Explique a composição da conta antes de registrar.",
}

describe("parseStructuredFeedback — contrato PROCESS_AUDIT", () => {
  it("FEEDBACK (padrão) ignora processAudit mesmo que o modelo envie", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, processAudit: { procedureTitle: "X", steps: [] } }), TRANSCRIPT)
    expect(parsed.processAudit).toBeUndefined()
  })

  it("PROCESS_AUDIT exige processAudit no formato do contrato", () => {
    expect(() => parseStructuredFeedback(JSON.stringify(BASE), TRANSCRIPT, "PROCESS_AUDIT")).toThrow(/processAudit/)
  })

  it("PROCESS_AUDIT verifica cada etapa por código (evidência literal ou rebaixamento)", () => {
    const raw = JSON.stringify({
      ...BASE,
      processAudit: {
        procedureTitle: "Procedimento Operacional — Contestação de Contas Móvel",
        steps: [
          { step: "Validar o titular", status: "CONFORME", evidence: "preciso confirmar o CPF do titular", knowledgeReference: "Seção 3", note: null },
          { step: "Explicar composição", status: "NAO_CONFORME", evidence: "o operador pulou a explicação", knowledgeReference: "Seção 3", note: null },
        ],
      },
    })
    const parsed = parseStructuredFeedback(raw, TRANSCRIPT, "PROCESS_AUDIT")
    expect(parsed.processAudit?.steps.map((step) => step.status)).toEqual(["CONFORME", "NAO_FOI_POSSIVEL_CONFIRMAR"])
    expect(parsed.processAudit?.downgradedCount).toBe(1)
  })

  it("evidência principal não literal continua descartando o resultado inteiro", () => {
    expect(() => parseStructuredFeedback(JSON.stringify({ ...BASE, evidenceFound: "o operador pediu o CPF" }), TRANSCRIPT)).toThrow(/literal/)
  })
})

describe("parseStructuredFeedback — materiais de apoio (só ids permitidos)", () => {
  const CANDIDATES = [
    { materialId: "11111111-1111-4111-8111-111111111111", title: "Procedimento Operacional — Contestação de Contas Móvel" },
    { materialId: "22222222-2222-4222-8222-222222222222", title: "Checklist de Encerramento de Chamada" },
  ]
  const REASON = "Este procedimento detalha como explicar a composição da conta antes de registrar a contestação."

  it("aceita um materialId dos candidatos com motivo específico e usa o título do material real", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, supportMaterials: [{ materialId: CANDIDATES[0]!.materialId, reason: REASON, title: "inventado" }] }), TRANSCRIPT, "FEEDBACK", CANDIDATES)
    expect(parsed.supportMaterials).toEqual([{ materialId: CANDIDATES[0]!.materialId, title: CANDIDATES[0]!.title, reason: REASON }])
    expect(parsed.supportMaterialsRejected).toBeUndefined()
  })

  it("descarta id inventado sem derrubar o feedback e registra a rejeição", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, supportMaterials: [{ materialId: "inventado", reason: REASON }] }), TRANSCRIPT, "FEEDBACK", CANDIDATES)
    expect(parsed.recommendation).toBe(BASE.recommendation)
    expect(parsed.supportMaterials).toBeUndefined()
    expect(parsed.supportMaterialsRejected).toEqual([{ materialId: "inventado", code: "MATERIAL_NOT_IN_CANDIDATES" }])
  })

  it("URL arbitrária devolvida pelo modelo não é consumida nem propagada", () => {
    const parsed = parseStructuredFeedback(
      JSON.stringify({ ...BASE, supportMaterials: [{ materialId: CANDIDATES[1]!.materialId, reason: REASON, url: "https://x.example/y" }] }),
      TRANSCRIPT,
      "FEEDBACK",
      CANDIDATES,
    )
    expect(JSON.stringify(parsed)).not.toContain("x.example")
  })

  it("sem candidatos (execução sem KB), qualquer supportMaterials é ignorado", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, supportMaterials: [{ materialId: CANDIDATES[0]!.materialId, reason: REASON }] }), TRANSCRIPT)
    expect(parsed.supportMaterials).toBeUndefined()
    expect(parsed.supportMaterialsRejected).toBeUndefined()
  })

  it("zero recomendações continua sendo um feedback válido", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, supportMaterials: [] }), TRANSCRIPT, "FEEDBACK", CANDIDATES)
    expect(parsed.supportMaterials).toBeUndefined()
  })

  it("o contrato de indicador aceita o mesmo campo", () => {
    const parsed = parseStructuredIndicatorFeedback(JSON.stringify({ title: "Título", summary: "Resumo", relatedProcedure: "Procedimento", recommendation: "Recomendação", supportMaterials: [{ materialId: CANDIDATES[1]!.materialId, reason: REASON }] }), CANDIDATES)
    expect(parsed.supportMaterials?.[0]?.title).toBe(CANDIDATES[1]!.title)
  })
})

describe("composeStructuredInstructions — o prompt enviado ao modelo", () => {
  const CANDIDATES = [{ materialId: "11111111-1111-4111-8111-111111111111", title: "Técnicas de sondagem em retenção" }]

  it("com candidatos: inclui ids permitidos, títulos, proibição de inventar/URL e a possibilidade de zero", () => {
    const prompt = composeStructuredInstructions(STRUCTURED_OUTPUT_INSTRUCTIONS, CANDIDATES)
    expect(prompt).toContain(STRUCTURED_OUTPUT_INSTRUCTIONS)
    expect(prompt).toContain("MATERIAIS DE APOIO")
    expect(prompt).toContain('- M1 — Título: "Técnicas de sondagem em retenção"')
    expect(prompt).not.toContain("11111111-1111-4111-8111-111111111111")
    expect(prompt).toMatch(/não invente materiais, não invente referências, não invente URLs/)
    expect(prompt).toMatch(/"supportMaterials": \[\]/)
    expect(prompt).not.toMatch(/https?:\/\//)
  })

  it("sem candidatos: as instruções ficam idênticas às de sempre", () => {
    expect(composeStructuredInstructions(STRUCTURED_OUTPUT_INSTRUCTIONS, [])).toBe(STRUCTURED_OUTPUT_INSTRUCTIONS)
  })
})

describe("parseStructuredFeedback — aspas normalizadas na verificação literal (V1.1)", () => {
  it("trecho copiado com aspas simples no lugar das duplas (escape de JSON) continua literal; texto reescrito continua rejeitado", () => {
    const transcript = 'Operador: vou colocar como "suporte técnico". Está de acordo?'
    const base = { title: "Título", summary: "Resumo", impactedIndicator: "rechamada", observedBehavior: "x", relatedProcedure: "p", recommendation: "r" }
    expect(parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "vou colocar como 'suporte técnico'. Está de acordo?" }), transcript).evidenceFound).toContain("suporte técnico")
    expect(() => parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Você: vou colocar como suporte técnico" }), transcript)).toThrow(/não corresponde a um trecho literal/)
  })
})

describe("parseStructuredFeedback — trechos literais emendados com reticências (V1.2)", () => {
  it("dois trechos reais separados por '...' passam (cada segmento é literal); segmento inventado ou curto demais continua rejeitado", () => {
    const transcript = "Operador: Vou pedir pra aguardar na linha um minutinho, tá bem? Cliente: Tá. Operador: Só um instante. Cliente: Alô? Ainda está aí? Operador: Estou sim."
    const base = { title: "Título", summary: "Resumo", impactedIndicator: "rechamada", observedBehavior: "x", relatedProcedure: "p", recommendation: "r" }
    expect(parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Vou pedir pra aguardar na linha um minutinho, tá bem? ... Alô? Ainda está aí?" }), transcript).evidenceFound).toContain("Alô?")
    expect(() => parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Vou pedir pra aguardar na linha um minutinho ... você desligou na cara do cliente" }), transcript)).toThrow(/não corresponde a um trecho literal/)
    expect(() => parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Tá. ... Estou sim." }), transcript)).toThrow(/não corresponde a um trecho literal/)
  })
})

describe("parseStructuredFeedback — formatação da citação (V1.3): aspas por fala e marcador [...]", () => {
  it("aspas em volta de cada fala e omissão marcada com [...] não são fabricação; paráfrase continua rejeitada", () => {
    const transcript = "Cliente: Retorno quando? Por onde?\nOperador: Assim que a análise concluir, a senhora vai ser avisada.\nCliente: Tá bom então.\nOperador: Se não pagar pode negativar."
    const base = { title: "Título", summary: "Resumo", impactedIndicator: "rechamada", observedBehavior: "x", relatedProcedure: "p", recommendation: "r" }
    expect(parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Cliente: 'Retorno quando? Por onde?' Operador: 'Assim que a análise concluir, a senhora vai ser avisada.'" }), transcript).evidenceFound).toContain("Retorno quando")
    expect(parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Cliente: Retorno quando? Por onde? [...] Operador: Se não pagar pode negativar." }), transcript).evidenceFound).toContain("negativar")
    expect(() => parseStructuredFeedback(JSON.stringify({ ...base, evidenceFound: "Cliente: 'Quando vou ter retorno?' Operador: 'Você será avisada.'" }), transcript)).toThrow(/não corresponde a um trecho literal/)
  })
})

describe("parseStructuredFeedback — contrato PROCESS_ASSESSMENT (V1.6.0: só o formato; verificação é da camada de confiabilidade)", () => {
  const assessment = { processes: [{ documentTitle: "Doc", checkpoints: [{ requirement: "Etapa", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["qualquer"], knowledgeQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null, conductEvidence: { role: "ACTION_PERFORMED", relation: "EQUIVALENT" } }] }] }
  it("devolve a avaliação proposta como veio (sem promover nem verificar)", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, processAssessment: assessment }), TRANSCRIPT, "PROCESS_ASSESSMENT")
    // V1.7.1b — produto e aplicabilidade são opcionais: ausentes = sem produto, sem aplicabilidade declarada.
    // V1.7.1c — o resultado da validação do contrato viaja junto (completa aqui).
    expect(parsed.processAssessment).toMatchObject({ applicability: [], processes: assessment.processes.map((process) => ({ product: null, ...process, checkpoints: process.checkpoints.map((checkpoint) => ({ knowledgeDetailQuote: null, ...checkpoint })) })), validation: { completeness: "COMPLETE", invalidItems: [] } })
  })
  it("ausente (structured output inválido) ou com status fora do contrato (AGENT_PROCESS_ASSESSMENT_INCOMPLETE) → falha fechada", () => {
    expect(() => parseStructuredFeedback(JSON.stringify(BASE), TRANSCRIPT, "PROCESS_ASSESSMENT")).toThrow(/processAssessment/)
    const invalid = { processes: [{ documentTitle: "Doc", checkpoints: [{ ...assessment.processes[0]!.checkpoints[0]!, status: "CONFORME" }] }] }
    expect(() => parseStructuredFeedback(JSON.stringify({ ...BASE, processAssessment: invalid }), TRANSCRIPT, "PROCESS_ASSESSMENT")).toThrow(/processAssessment/)
  })
  it("FEEDBACK continua sem processAssessment (nada muda no contrato padrão)", () => {
    expect(parseStructuredFeedback(JSON.stringify({ ...BASE, processAssessment: assessment }), TRANSCRIPT).processAssessment).toBeUndefined()
  })
})

describe("V1.7.4 — campo legado × avaliação de processo", () => {
  const assessment = { processes: [{ documentTitle: "Doc", checkpoints: [] }], applicability: [] }
  it("evidenceFound não literal NÃO derruba a avaliação de processo: o campo legado é esvaziado (nunca usado como reserva)", () => {
    const parsed = parseStructuredFeedback(JSON.stringify({ ...BASE, evidenceFound: "Operador: frase que não está na transcrição", processAssessment: assessment }), TRANSCRIPT, "PROCESS_ASSESSMENT")
    expect(parsed.evidenceFound).toBe("")
    expect(parsed.processAssessment).toBeDefined()
  })
  it("sem avaliação de processo a regra de sempre vale (resposta recusada)", () => {
    expect(() => parseStructuredFeedback(JSON.stringify({ ...BASE, evidenceFound: "Operador: frase que não está na transcrição" }), TRANSCRIPT, "PROCESS_ASSESSMENT")).toThrow()
    expect(() => parseStructuredFeedback(JSON.stringify({ ...BASE, evidenceFound: "Operador: frase que não está na transcrição" }), TRANSCRIPT, "FEEDBACK")).toThrow(/literal/)
  })
})

import { withStructuredOutputRetry } from "./structured-output-retry.js"
describe("V1.7.4 — retry técnico homologado também na monitoria por Flag", () => {
  const valid = JSON.stringify({ ...BASE, processAssessment: { processes: [], applicability: [] } })
  it("quebra de linha crua dentro de string (JSON ilegível) → UMA repetição da mesma tarefa, com o aviso de formato", async () => {
    const broken = valid.replace('"Explique a composição da conta antes de registrar."', '"Explique a composição\n\n- da conta."')
    const calls: (string | null)[] = []
    const result = await withStructuredOutputRetry({ call: async (notice) => { calls.push(notice); return calls.length === 1 ? broken : valid }, parse: (raw) => parseStructuredFeedback(raw, TRANSCRIPT, "PROCESS_ASSESSMENT") })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatch(/schema estruturado/)
    expect(result.telemetry.structuredOutputRetryCount).toBe(1)
  })
  it("processAssessment obrigatório ausente = structured output inválido: UMA repetição com o aviso de formato, e a 2ª resposta válida é aceita", async () => {
    const calls: (string | null)[] = []
    const result = await withStructuredOutputRetry({ call: async (notice) => { calls.push(notice); return calls.length === 1 ? JSON.stringify(BASE) : valid }, parse: (raw) => parseStructuredFeedback(raw, TRANSCRIPT, "PROCESS_ASSESSMENT") })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBeNull()
    expect(calls[1]).toMatch(/schema estruturado/)
    expect(result.value.processAssessment).toBeDefined()
    expect(result.telemetry.rejectedAttempts).toMatchObject([{ errorCode: "AGENT_STRUCTURED_OUTPUT_INVALID", violations: [{ path: "processAssessment", code: "PROCESS_ASSESSMENT_MISSING" }] }])
  })
  it("ausente de novo na repetição → falha fechada (sem 3ª chamada), mesmo com evidenceFound não literal ou processAssessment nulo/lista", async () => {
    for (const reply of [JSON.stringify(BASE), JSON.stringify({ ...BASE, evidenceFound: "Operador: frase inventada", processAssessment: null }), JSON.stringify({ ...BASE, processAssessment: [] })]) {
      let count = 0
      await expect(withStructuredOutputRetry({ call: async () => { count += 1; return reply }, parse: (raw) => parseStructuredFeedback(raw, TRANSCRIPT, "PROCESS_ASSESSMENT") })).rejects.toMatchObject({ code: "AGENT_STRUCTURED_OUTPUT_INVALID" })
      expect(count).toBe(2)
    }
  })
  it("processAssessment presente mas fora do contrato continua sem retry (AGENT_PROCESS_ASSESSMENT_INCOMPLETE na 1ª)", async () => {
    let count = 0
    const invalid = JSON.stringify({ ...BASE, processAssessment: { processes: [{ documentTitle: "Doc", checkpoints: [{ requirement: "Etapa", status: "CONFORME", evidenceType: "OBSERVED", transcriptEvidence: ["x"], knowledgeQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null }] }] } })
    await expect(withStructuredOutputRetry({ call: async () => { count += 1; return invalid }, parse: (raw) => parseStructuredFeedback(raw, TRANSCRIPT, "PROCESS_ASSESSMENT") })).rejects.toMatchObject({ code: "AGENT_PROCESS_ASSESSMENT_INCOMPLETE" })
    expect(count).toBe(1)
  })
  it("FEEDBACK (sem avaliação de processo) não exige processAssessment", () => {
    expect(() => parseStructuredFeedback(JSON.stringify(BASE), TRANSCRIPT, "FEEDBACK")).not.toThrow()
  })
})

describe("citação literal mínima (auditoria 17/10/2026, AI-07)", () => {
  const transcript = "Operador: Bom dia, em que posso ajudar? Cliente: Quero mudar o endereço de cobrança, por favor."
  it("trecho de 1 caractere, palavra solta, só aspas ou vazio não é evidência", () => {
    for (const evidence of ["'", "\"\"", "o", "sim", "Cliente", "   "]) expect(isVerbatimEvidence(transcript, evidence), evidence).toBe(false)
  })
  it("trecho real com duas palavras ou mais continua valendo (com ou sem aspas)", () => {
    expect(isVerbatimEvidence(transcript, "Cliente: Quero mudar o endereço")).toBe(true)
    expect(isVerbatimEvidence(transcript, "\"em que posso ajudar?\"")).toBe(true)
    expect(isVerbatimEvidence(transcript, "Quero mudar o endereço de entrega")).toBe(false)
  })
})
