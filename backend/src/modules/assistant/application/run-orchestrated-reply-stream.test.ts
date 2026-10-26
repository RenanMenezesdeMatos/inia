import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { OrchestrationSuperseded, runOrchestratedReply, type OrchestrationProgress, type OrchestrationStream } from "./run-orchestrated-reply.js"
import type { ResolvedOrchestrator } from "./resolve-orchestrator.js"
import { reconcileShownText } from "../domain/reply-stream.js"

/**
 * CHAT EM FLUXO — a resposta final aparece enquanto é escrita, sem marcador interno, sem duplicar e sem mostrar texto que não é
 * a resposta. O modelo é falso: cada chamada devolve um roteiro (pedaços de texto e/ou chamadas de ferramenta), entregue pelo
 * MESMO cliente em fluxo que o chat usa (`streamWithTools`); a orquestração é a real.
 */
type Script = { text?: string[]; calls?: { name: string; args: Record<string, unknown> }[] }
const scripts: Script[] = []
const requests: { system: string; tools: unknown[]; streamed: boolean }[] = []
const runSpecialistTool = vi.fn()

function take(): Script {
  const next = scripts.shift()
  if (!next) throw new Error("sem roteiro")
  return next
}
vi.mock("./run-specialist-tool.js", () => ({ runSpecialistTool: (...args: unknown[]) => runSpecialistTool(...args) }))
vi.mock("../infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: async (_contents: unknown, system: string, tools: unknown[]) => {
    requests.push({ system, tools, streamed: false })
    const script = take()
    return script.calls ? { kind: "functionCalls", calls: script.calls } : { kind: "text", text: (script.text ?? []).join("") }
  },
  streamWithTools: async (_contents: unknown, system: string, tools: unknown[], onText: (text: string) => void) => {
    requests.push({ system, tools, streamed: true })
    const script = take()
    let streamedChars = 0
    for (const chunk of script.text ?? []) {
      // Como o cliente real: depois de uma chamada de ferramenta, nenhum texto vai para a tela.
      streamedChars += chunk.length
      onText(chunk)
    }
    return script.calls ? { kind: "functionCalls", calls: script.calls, streamedChars, firstTokenMs: 1 } : { kind: "text", text: (script.text ?? []).join(""), streamedChars, firstTokenMs: 1 }
  },
}))

const fakeDb = {} as Database
const SPECIALIST = { name: "agent_processos", description: "Processos.", parameters: { type: "object" as const, properties: { query: { type: "string" } } } }

function orchestrator(overrides: Partial<ResolvedOrchestrator> = {}): ResolvedOrchestrator {
  return { organizationId: "org-1", orchestratorId: "orch-1", orchestratorName: "INIA", orchestratorAgentId: "agent-orch", systemPrompt: "Você é a INIA.", specialists: [{ agentId: "agent-proc", toolName: "agent_processos" }], tools: [SPECIALIST], recommendSupportMaterials: false, outputInstructions: null, structuredOutput: null, ...overrides }
}

/** Saída em fluxo gravada como a tela a veria: texto visível (com retiradas aplicadas), retiradas e progresso. */
function recorder() {
  const log: { shown: string; retracts: number; progress: OrchestrationProgress[]; chunks: string[] } = { shown: "", retracts: 0, progress: [], chunks: [] }
  const stream: OrchestrationStream = {
    text: (chunk) => {
      log.chunks.push(chunk)
      log.shown += chunk
    },
    retract: () => {
      log.retracts += 1
      log.shown = ""
    },
    progress: (event) => log.progress.push(event),
  }
  return { log, stream }
}

/** O que a tela mostra no fim: o fluxo + o que o envio final completa (`reconcileShownText`). */
function screenAfter(log: { shown: string }, reply: { text: string; streamedText?: string }): string {
  const pending = reconcileShownText(reply.streamedText ?? "", reply.text)
  return (pending.retract ? "" : log.shown) + pending.append
}

beforeEach(() => {
  scripts.length = 0
  requests.length = 0
  runSpecialistTool.mockReset().mockResolvedValue({ contract: "TEXT", text: "Abra a contestação em até 30 dias.", knowledge: { documents: [] }, supportMaterialCandidates: [{ materialId: "M1", title: "Guia", reason: "r" }] })
})

describe("runOrchestratedReply — resposta em fluxo", () => {
  it("resposta direta (sem ferramenta): cada pedaço vai para a tela na hora e o texto final é exatamente o mostrado", async () => {
    scripts.push({ text: ["Oi! ", "Posso ajudar ", "com processos."] })
    const { log, stream } = recorder()
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "oi" }], "", "op-1", {}, {}, { stream })
    expect(log.chunks).toEqual(["Oi! ", "Posso ajudar ", "com processos."])
    expect(reply.text).toBe("Oi! Posso ajudar com processos.")
    expect(reply.streamedText).toBe(reply.text)
    expect(screenAfter(log, reply)).toBe(reply.text)
    expect(requests[0]!.streamed).toBe(true)
  })

  it("síntese em fluxo SEM as linhas internas: o marcador de materiais nunca aparece, e o texto da tela é o gravado", async () => {
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "contestação" } }] })
    scripts.push({ text: ["Para contestar, ", "abra a contestação.\n", "SUPPORT_MATER", 'IALS_JSON: [{"materialId":"M1","reason":"O guia mostra o passo a passo da contestação."}]'] })
    const { log, stream } = recorder()
    const reply = await runOrchestratedReply(fakeDb, orchestrator({ recommendSupportMaterials: true }), [{ role: "user", text: "como contesto?" }], "", "op-1", {}, {}, { stream })
    expect(log.shown).not.toContain("SUPPORT")
    expect(log.shown).toBe("Para contestar, abra a contestação.\n")
    expect(reply.supportMaterials).toEqual([expect.objectContaining({ materialId: "M1" })])
    expect(reply.text).toBe("Para contestar, abra a contestação.")
    // A tela termina com o texto gravado (a quebra de linha antes do marcador não muda o que se lê).
    expect(screenAfter(log, reply).trimEnd()).toBe(reply.text)
    // Progresso verdadeiro: a ferramenta acionada e, depois, a escrita da resposta.
    expect(log.progress).toEqual([{ stage: "TOOLS", tools: ["agent_processos"] }, { stage: "WRITING" }])
  })

  it("o modelo escreve e DEPOIS pede uma ferramenta: o que apareceu é retirado e a resposta final não duplica", async () => {
    scripts.push({ text: ["Vou verificar…"], calls: [{ name: "agent_processos", args: { query: "x" } }] })
    scripts.push({ text: ["Resposta ", "final."] })
    const { log, stream } = recorder()
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "pergunta" }], "", "op-1", {}, {}, { stream })
    expect(log.retracts).toBe(1)
    expect(log.shown).toBe("Resposta final.")
    expect(screenAfter(log, reply)).toBe("Resposta final.")
  })

  it("síntese que precisa de validação (especialista investigou): nada em fluxo — o texto só sai depois do gating", async () => {
    runSpecialistTool.mockReset().mockResolvedValue({ contract: "TEXT", text: "Em 1 de 3 interações houve pausa.", toolTrace: [], investigation: { synthesis: { behavioralClaims: [], limitations: [] }, stopReason: "SUFFICIENT" } })
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "x" } }] })
    // Síntese e (se o gating recusar) a correção: nenhuma das duas em fluxo.
    scripts.push({ text: ['Resposta validada.\nEVIDENCE_JSON: {"claims":[]}'] })
    scripts.push({ text: ['Resposta corrigida.\nEVIDENCE_JSON: {"claims":[]}'] })
    const { log, stream } = recorder()
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "pergunta" }], "", "op-1", {}, {}, { stream })
    expect(log.chunks).toEqual([])
    expect(requests.slice(1).every((entry) => !entry.streamed)).toBe(true)
    expect(reply.streamedText).toBeUndefined()
    expect(screenAfter(log, reply)).toBe(reply.text)
  })

  it("só especialistas na 1ª rodada e síntese obrigatória (materiais): a rodada extra com ferramentas não roda — vai direto à síntese", async () => {
    const execute = vi.fn()
    const dataTool = { name: "my_results", description: "Meus resultados", parameters: { type: "object" as const, properties: {} } }
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "contestação" } }] })
    scripts.push({ text: ['Síntese.\nSUPPORT_MATERIALS_JSON: []'] })
    const { stream } = recorder()
    const reply = await runOrchestratedReply(fakeDb, orchestrator({ recommendSupportMaterials: true }), [{ role: "user", text: "como contesto?" }], "", "op-1", {}, {}, { stream, directTools: { declarations: [dataTool], handles: (name) => name === "my_results", execute } })
    // Roteamento + síntese: 2 chamadas (antes: roteamento + rodada extra descartada + síntese = 3).
    expect(requests).toHaveLength(2)
    expect(requests[1]!.tools).toEqual([])
    expect(reply.text).toBe("Síntese.")
  })

  it("com ferramenta de dados na 1ª rodada, as rodadas extras continuam (aprofundamento) e o texto final da rodada vai em fluxo", async () => {
    const execute = vi.fn().mockResolvedValue({ text: "TMA 320 s.", card: { id: "c1" } })
    const dataTool = { name: "my_results", description: "Meus resultados", parameters: { type: "object" as const, properties: {} } }
    scripts.push({ calls: [{ name: "my_results", args: {} }] })
    scripts.push({ text: ["Seu TMA ", "está em 320 s."] })
    const { log, stream } = recorder()
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "meu TMA?" }], "", "op-1", {}, {}, { stream, directTools: { declarations: [dataTool], handles: (name) => name === "my_results", execute } })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.tools).not.toEqual([])
    expect(log.chunks).toEqual(["Seu TMA ", "está em 320 s."])
    expect(reply.text).toBe("Seu TMA está em 320 s.")
    expect(reply.streamedText).toBe(reply.text)
  })

  it("superada antes das ferramentas (`proceed` = false): nenhum especialista roda e a orquestração termina com OrchestrationSuperseded", async () => {
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "x" } }] })
    await expect(runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "pergunta" }], "", "op-1", {}, {}, { proceed: async () => false })).rejects.toBeInstanceOf(OrchestrationSuperseded)
    expect(runSpecialistTool).not.toHaveBeenCalled()
  })

  it("sem `stream` (Workflow, voz): nenhuma chamada em fluxo e nada de texto exibido", async () => {
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "x" } }] })
    scripts.push({ text: ["Síntese."] })
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "pergunta" }], "", "op-1")
    expect(requests.every((entry) => !entry.streamed)).toBe(true)
    expect(reply.streamedText).toBeUndefined()
    expect(reply.text).toBe("Síntese.")
  })
})

describe("runOrchestratedReply — conversa tolera a falha de UMA ferramenta", () => {
  const dataTool = { name: "my_results", description: "Meus resultados", parameters: { type: "object" as const, properties: {} } }

  it("especialista falha e a ferramenta de dados responde: a síntese recebe 'não foi possível consultar' e a resposta sai", async () => {
    runSpecialistTool.mockReset().mockRejectedValue(Object.assign(new Error("prazo"), { name: "TimeoutError" }))
    const execute = vi.fn().mockResolvedValue({ text: "TMA 320 s.", card: null })
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "x" } }, { name: "my_results", args: {} }] })
    scripts.push({ text: ["Seu TMA está em 320 s; a orientação de processo não pôde ser consultada agora."] })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const reply = await runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "meu TMA e como melhorar?" }], "", "op-1", {}, {}, { toleratesToolFailure: true, directTools: { declarations: [dataTool], handles: (name) => name === "my_results", execute } })
    expect(reply.text).toContain("320 s")
    expect(reply.results.find((result) => result.toolName === "agent_processos")!.text).toMatch(/^Consulta não concluída/)
  })

  it("todas as ferramentas falham: o erro de sempre (nada de resposta sem fonte)", async () => {
    runSpecialistTool.mockReset().mockRejectedValue(new Error("prazo"))
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "x" } }] })
    await expect(runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "pergunta" }], "", "op-1", {}, {}, { toleratesToolFailure: true })).rejects.toThrow("prazo")
  })

  it("Workflow (sem a opção): a falha sobe como sempre, para a retentativa do nó", async () => {
    runSpecialistTool.mockReset().mockRejectedValue(new Error("prazo"))
    const execute = vi.fn().mockResolvedValue({ text: "dados", card: null })
    scripts.push({ calls: [{ name: "agent_processos", args: { query: "x" } }, { name: "my_results", args: {} }] })
    await expect(runOrchestratedReply(fakeDb, orchestrator(), [{ role: "user", text: "pergunta" }], "", "op-1", {}, {}, { directTools: { declarations: [dataTool], handles: (name) => name === "my_results", execute } })).rejects.toThrow("prazo")
  })
})
