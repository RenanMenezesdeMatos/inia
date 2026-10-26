import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AiProviderError } from "../../../shared/application/model-routing/ai-errors.js"
import { DEFAULT_NAVIGATION_BUDGET, type NavigationBudget } from "../domain/knowledge-workspace.js"
import { KNOWLEDGE_CLARIFICATION_VERSION, optionIdFor, stepIdFor, type ClarificationState, type ClarificationStep } from "../domain/clarification-state.js"
import { FailAfterStreaming, TEST_ORCHESTRATOR_AGENT, TEST_ORG, TEST_OTHER_SPECIALIST_AGENT, TEST_PERSON, TEST_SPECIALIST_AGENT, fixtureKnowledge, refOf, refsInPrompt, scriptedModel, type ScriptedCall } from "../testing/clarification-fixtures.js"
import { ANSWER_DRAFTING_STATUS, createKnowledgeClarification, type ClarificationOutcome, type ClarificationRequest, type ClarificationStream } from "./knowledge-clarification-service.js"

/**
 * Esclarecimento pelas bases de ponta a ponta: o catálogo REAL (autorização, acesso, sumários, leitura de seções), a navegação em
 * rodadas, os prompts, a validação do contrato, as correções e o estado — só a IA é roteirizada (decide como o teste manda,
 * apontando para os marcadores B-n/K-n que o prompt realmente trouxe). Os exemplos são de teste: nenhum vira regra de produção.
 */
const NOW = new Date("2026-10-20T12:00:00.000Z")

function setup(script: (call: ScriptedCall, index: number) => unknown, options: Parameters<typeof fixtureKnowledge>[0] & { knowledge?: () => Promise<never>; budget?: Partial<NavigationBudget> } = {}) {
  const fixture = fixtureKnowledge(options)
  const { model, calls } = scriptedModel(script)
  let sequence = 0
  const service = createKnowledgeClarification({
    knowledge: options.knowledge ?? fixture.knowledge,
    budget: { ...DEFAULT_NAVIGATION_BUDGET, ...options.budget },
    model,
    guardrails: async (_organizationId, agentIds) => `LIMITES DE TESTE (${agentIds.length} agentes)`,
    specialistInstructions: async (_organizationId, agentIds) => (agentIds.length > 0 ? "INSTRUÇÕES DO ESPECIALISTA DE TESTE" : ""),
    now: () => NOW,
    newId: () => `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`,
  })
  const request = (text: string, extra: Partial<ClarificationRequest> = {}): ClarificationRequest => ({ organizationId: TEST_ORG, personId: TEST_PERSON, orchestratorAgentId: TEST_ORCHESTRATOR_AGENT, specialistAgentIds: [TEST_SPECIALIST_AGENT, TEST_OTHER_SPECIALIST_AGENT], text, answer: null, previous: null, recentTurns: [], ...extra })
  const ask = (text: string, extra: Partial<ClarificationRequest> = {}) => service.handle(request(text, extra))
  /** Escolha pelo formulário (ou correção) sobre o estado gravado. */
  const choose = (state: ClarificationState, stepIndex: number, labels: string[], extra: { revise?: boolean; freeText?: string; noneMatched?: boolean } = {}) => {
    const step = state.steps[stepIndex]!
    const optionIds = step.options.filter((option) => labels.includes(option.label)).map((option) => option.id)
    return service.handle(request(labels.join("; ") || extra.freeText || "—", { answer: { clarificationId: state.id, stepId: step.id, optionIds, noneMatched: extra.noneMatched ?? false, revise: extra.revise ?? false, ...(extra.freeText ? { freeText: extra.freeText } : {}) }, previous: { state, isLatestAssistantMessage: true } }))
  }
  return { ask, choose, calls, fixture }
}

const reply = (outcome: ClarificationOutcome) => {
  if (outcome.kind !== "REPLY") throw new Error(`Esperava REPLY, veio PASS (${outcome.reason}): ${outcome.trace.issues.join(" | ")}`)
  return outcome
}
const clarify = (dimension: string, question: string, options: { label: string; evidence: string[]; description?: string }[], selectionMode: "SINGLE" | "MULTIPLE" = "SINGLE") => ({ decision: "CLARIFY", questionFacts: [], clarification: { dimension, question, selectionMode, options } })
const answerWith = (user: string, parts: { text: string; document: string; heading: string }[]) => ({ answer: parts.map((part) => `${part.text} [${refOf(user, part.document, part.heading)}]`).join("\n"), sources: parts.map((part) => refOf(user, part.document, part.heading)), limitations: null })

/** Orçamento apertado: nenhuma base começa aberta e a lista mostra só a 1ª seção de cada uma (força a navegação). */
const NARROW: Partial<NavigationBudget> = { fullOutlineChars: 0, sampleSectionsPerBase: 1 }

describe("esclarecimento pelas bases — cenários", () => {
  it("pergunta genérica com vários produtos: pergunta qual, com uma opção por cenário (documentos do mesmo cenário juntos)", async () => {
    const { ask, calls } = setup((call) =>
      clarify("Produto", "Você se refere à mudança de endereço de qual produto?", [
        { label: "Linha básica", evidence: [refOf(call.prompt, "Linha básica")] },
        { label: "LP de Dados", evidence: [refOf(call.prompt, "LP de Dados")] },
        { label: "Banda larga", evidence: [refOf(call.prompt, "— Banda larga")] },
        // A IA repete o cenário por causa do guia: o código junta as duas numa opção (documentos ≠ cenários).
        { label: "banda larga", evidence: [refOf(call.prompt, "Guia rápido")] },
        { label: "SIP", evidence: [refOf(call.prompt, "— SIP")] },
        { label: "Linha FWT", evidence: [refOf(call.prompt, "Linha FWT")] },
      ]),
    )
    const outcome = reply(await ask("Como faço uma mudança de endereço?"))
    // A IA vê TODAS as bases que a pessoa pode consultar — quem escolhe o que importa é ela, não uma busca por palavra.
    for (const title of ["Linha básica", "LP de Dados", "— Banda larga", "Guia rápido", "— SIP", "Linha FWT", "Política de férias"]) expect(calls[0]!.prompt).toContain(title)
    expect(calls[0]!.system).toContain("LIMITES DE TESTE")
    expect(outcome.state.status).toBe("OPEN")
    const step = outcome.state.steps[0]!
    expect(step.options.map((option) => option.label)).toEqual(["Linha básica", "LP de Dados", "Banda larga", "SIP", "Linha FWT"])
    expect(step.options.find((option) => option.label === "Banda larga")!.evidence.map((source) => source.documentId).sort()).toEqual(["kb-fic-end-bl", "kb-fic-end-bl-guia"])
    expect(step.id).toBe(stepIdFor(1, "Produto"))
    expect(outcome.content).toContain("Você se refere à mudança de endereço de qual produto?")
    expect(outcome.content).toContain("Opções encontradas nas bases consultadas")
    expect(outcome.state.coverage).toMatchObject({ complete: true, omittedDocuments: 0 })
    expect(calls).toHaveLength(1)
  })

  it("produto já informado na pergunta: responde sem esclarecer, pela consulta direcionada às seções e com as fontes numeradas", async () => {
    const { ask, calls } = setup((call) =>
      call.stage === "PLANNER"
        ? { decision: "ANSWER", questionFacts: [{ dimension: "Produto", value: "linha FWT" }], answerEvidence: [refOf(call.prompt, "Linha FWT", "Cobertura"), refOf(call.prompt, "Linha FWT", "Prazo")] }
        : answerWith(call.prompt, [
            { text: "Só é possível com cobertura celular no novo endereço.", document: "Linha FWT", heading: "Cobertura" },
            { text: "O prazo é imediato depois da validação da cobertura.", document: "Linha FWT", heading: "Prazo" },
          ]),
    )
    const outcome = reply(await ask("Qual o prazo da mudança de endereço da linha FWT?"))
    expect(outcome.state.status).toBe("ANSWERED")
    expect(outcome.state.steps).toEqual([])
    expect(outcome.state.questionFacts).toEqual([{ dimension: "Produto", value: "linha FWT" }])
    expect(outcome.content).toBe("Só é possível com cobertura celular no novo endereço. [1]\nO prazo é imediato depois da validação da cobertura. [2]")
    expect(outcome.state.sources.map((source) => [source.documentId, source.heading])).toEqual([["kb-fic-end-fwt", "2. Cobertura"], ["kb-fic-end-fwt", "3. Prazo"]])
    // Consulta DIRECIONADA: a resposta recebe o texto inteiro das seções escolhidas — e só delas.
    const answerPrompt = calls[1]!.user
    expect(answerPrompt).toContain("só é possível se o novo endereço tiver cobertura celular")
    expect(answerPrompt).not.toContain("LP de Dados")
    expect(refsInPrompt(answerPrompt).every((entry) => entry.documentTitle.includes("Linha FWT"))).toBe(true)
    // Quem responde segue as instruções e os limites do especialista dono da base.
    expect(calls[1]!.system).toContain("INSTRUÇÕES DO ESPECIALISTA DE TESTE")
    expect(calls[1]!.system).toContain("LIMITES DE TESTE (2 agentes)")
  })

  it("mesmo produto com modalidades diferentes: as opções vêm de seções da MESMA base", async () => {
    const { ask } = setup((call) =>
      clarify("Tecnologia no novo endereço", "O novo endereço tem a mesma tecnologia de hoje?", [
        { label: "Mesma tecnologia", evidence: [refOf(call.prompt, "— Banda larga", "mesma tecnologia")] },
        { label: "Outra tecnologia", evidence: [refOf(call.prompt, "— Banda larga", "troca de tecnologia"), refOf(call.prompt, "Guia rápido")] },
      ]),
    )
    const outcome = reply(await ask("Como faço a mudança de endereço da Banda larga?"))
    const [same, other] = outcome.state.steps[0]!.options
    expect(same!.evidence[0]!.documentId).toBe("kb-fic-end-bl")
    expect(other!.evidence[0]!.documentId).toBe("kb-fic-end-bl")
    expect(same!.evidence[0]!.chunkIndex).not.toBe(other!.evidence[0]!.chunkIndex)
  })

  it("esclarecimento em várias etapas: público → titulares → situação → resposta, com foco e cenário acumulado a cada escolha", async () => {
    const script = (call: ScriptedCall, index: number) => {
      if (index === 0) return clarify("Tipo de cliente", "Para qual tipo de cliente é a troca de titularidade?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }])
      if (index === 1) return clarify("Titulares", "A troca será entre quais tipos de titulares?", [
        { label: "PJ → PJ", evidence: [refOf(call.prompt, "titularidade — Empresa", "Tipos de troca")] },
        { label: "PJ → PF", evidence: [refOf(call.prompt, "titularidade — Empresa", "PJ para PF")] },
        { label: "PF → PJ", evidence: [refOf(call.prompt, "titularidade — Empresa", "PF para PJ")] },
      ])
      if (index === 2) return clarify("Situação da troca", "Qual situação se aplica à troca?", [
        { label: "Troca comum entre empresas", evidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] },
        { label: "Sucessão empresarial", evidence: [refOf(call.prompt, "titularidade — Empresa", "Sucessão")] },
      ])
      if (index === 3) return { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum"), refOf(call.prompt, "titularidade — Empresa", "Sucessão")] }
      return answerWith(call.prompt, [
        { text: "Contrato social das duas empresas e identificação dos representantes.", document: "titularidade — Empresa", heading: "troca comum" },
        { text: "Na sucessão, também o documento que formaliza a sucessão.", document: "titularidade — Empresa", heading: "Sucessão" },
      ])
    }
    const { ask, choose, calls } = setup(script)
    const first = reply(await ask("Quais documentos preciso para troca de titularidade?"))
    const second = reply(await choose(first.state, 0, ["Empresa"]))
    // O cenário acumulado entra no prompt.
    expect(calls[1]!.user).toContain("Tipo de cliente: Empresa (escolhido pelo colaborador)")
    expect(calls[1]!.user).toContain("Etapas já feitas")
    expect(calls[1]!.user).toContain("Etapas de esclarecimento restantes: 3")
    const third = reply(await choose(second.state, 1, ["PJ → PJ"]))
    expect(calls[2]!.user).toContain("Titulares: PJ → PJ (escolhido pelo colaborador)")
    // A seção que a própria IA citou para a escolha já chega LIDA (texto inteiro) na etapa seguinte.
    expect(calls[2]!.user).toContain("SEÇÕES LIDAS")
    expect(calls[2]!.user).toContain("A troca de titularidade empresarial pode ser entre pessoas jurídicas")
    const final = reply(await choose(third.state, 2, ["Sucessão empresarial"]))
    expect(final.state.status).toBe("ANSWERED")
    expect(final.state.steps.map((step) => step.answer?.optionIds.length)).toEqual([1, 1, 1])
    expect(final.state.steps.map((step) => step.dimension)).toEqual(["Tipo de cliente", "Titulares", "Situação da troca"])
    expect(final.state.sources.map((source) => source.heading)).toEqual(["2. Documentos da troca PJ para PJ — troca comum", "5. Sucessão empresarial (PJ para PJ)"])
    expect(final.content).toContain("[1]")
    // O mesmo fluxo (mesmo id) do começo ao fim, com a pergunta original preservada.
    expect(new Set([first, second, third, final].map((outcome) => outcome.state.id)).size).toBe(1)
    expect(final.state.originalQuestion).toBe("Quais documentos preciso para troca de titularidade?")
  })

  it("nenhuma fonte suficiente: sem nada nas bases segue o caminho de sempre; com bases que não cobrem, diz o que falta", async () => {
    const empty = setup(() => ({ decision: "CLARIFY" }), { accessible: () => false })
    const passed = await empty.ask("Como peço reembolso de viagem internacional?")
    expect(passed).toMatchObject({ kind: "PASS", reason: "NO_KNOWLEDGE" })
    expect(empty.calls).toHaveLength(0)

    const { ask } = setup(() => ({ decision: "INSUFFICIENT", insufficient: { reason: "As bases tratam da mudança de endereço, mas nenhuma cita mudança para outro estado.", ask: "Informe se a mudança é na mesma cidade." } }))
    const outcome = reply(await ask("Como faço a mudança de endereço para outro estado?"))
    expect(outcome.state.status).toBe("INSUFFICIENT")
    expect(outcome.content).toMatch(/^Não encontrei nas bases consultadas/)
    expect(outcome.content).toContain("Informe se a mudança é na mesma cidade.")
    expect(outcome.state.sources).toEqual([])
  })

  it("pergunta fora das bases (resultados do próprio colaborador): a IA declara NOT_APPLICABLE e o caminho de sempre responde", async () => {
    const { ask } = setup(() => ({ decision: "NOT_APPLICABLE" }))
    expect(await ask("Qual foi meu prazo médio de atendimento ontem na mudança de endereço?")).toMatchObject({ kind: "PASS", reason: "NOT_APPLICABLE" })
  })

  it("correção de uma escolha anterior: as etapas dependentes saem e o fluxo recalcula a partir dela", async () => {
    const script = (call: ScriptedCall, index: number) => {
      if (index === 0) return clarify("Tipo de cliente", "Para qual tipo de cliente é a troca de titularidade?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }])
      if (index === 1) return clarify("Titulares", "A troca será entre quais tipos de titulares?", [{ label: "PJ → PJ", evidence: [refOf(call.prompt, "titularidade — Empresa", "Tipos de troca")] }, { label: "PJ → PF", evidence: [refOf(call.prompt, "titularidade — Empresa", "PJ para PF")] }])
      if (index === 2) return { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "— Residencial", "titular atual"), refOf(call.prompt, "— Residencial", "novo titular")] }
      return answerWith(call.prompt, [{ text: "Titular atual: identificação e autorização assinada.", document: "— Residencial", heading: "titular atual" }, { text: "Novo titular: identificação e comprovante de endereço.", document: "— Residencial", heading: "novo titular" }])
    }
    const { ask, choose, calls } = setup(script)
    const first = reply(await ask("Quais documentos preciso para troca de titularidade?"))
    const second = reply(await choose(first.state, 0, ["Empresa"]))
    const corrected = reply(await choose(second.state, 0, ["Residencial"], { revise: true }))
    expect(calls[2]!.user).toContain("Tipo de cliente: Residencial (escolhido pelo colaborador)")
    expect(calls[2]!.user).not.toContain("Titulares")
    expect(corrected.state.steps).toHaveLength(1)
    expect(corrected.state.status).toBe("ANSWERED")
    expect(corrected.state.sources.every((source) => source.documentId === "kb-fic-tt-residencial")).toBe(true)
  })

  it("esclarecimento digitado em texto livre: a mensagem é interpretada como escolha da etapa aberta (ou outro assunto)", async () => {
    let decide: (call: ScriptedCall, index: number) => unknown = (call) => clarify("Tipo de cliente", "Para qual tipo de cliente é a troca de titularidade?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }])
    const { ask, calls } = setup((call, index) => decide(call, index))
    const first = reply(await ask("Quais documentos preciso para troca de titularidade?"))
    const previous = { state: first.state, isLatestAssistantMessage: true }

    decide = (call) => ({ ...clarify("Situação da troca", "Qual situação se aplica à troca?", [{ label: "Troca comum entre empresas", evidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] }, { label: "Sucessão empresarial", evidence: [refOf(call.prompt, "titularidade — Empresa", "Sucessão")] }]), pendingReply: { kind: "OPTIONS", optionRefs: ["O1"] }, questionFacts: [{ dimension: "Titulares", value: "PJ para PJ" }] })
    const typed = reply(await ask("é para uma empresa, de PJ para PJ", { previous }))
    expect(calls[1]!.user).toContain("Pergunta de esclarecimento EM ABERTO")
    expect(calls[1]!.user).toContain('O1 = "Empresa"')
    expect(calls[1]!.user).toContain('Mensagem do colaborador agora: "é para uma empresa, de PJ para PJ"')
    expect(typed.state.steps[0]!.answer).toMatchObject({ via: "TEXT", optionIds: [optionIdFor("Tipo de cliente", "Empresa")] })
    // O que o texto já disse (PJ para PJ) não é perguntado de novo.
    expect(typed.state.questionFacts).toContainEqual({ dimension: "Titulares", value: "PJ para PJ" })
    expect(typed.state.steps[1]!.dimension).toBe("Situação da troca")

    decide = () => ({ decision: "NOT_APPLICABLE", pendingReply: { kind: "NEW_QUESTION" } })
    expect(await ask("qual é o meu resultado hoje?", { previous })).toMatchObject({ kind: "PASS", reason: "NOT_APPLICABLE" })

    // Outra pergunta sobre as bases: um esclarecimento NOVO para ela (o antigo continua aberto no formulário).
    decide = (call) => {
      if (call.stage === "ANSWER") return answerWith(call.prompt, [{ text: "Imediato depois de validar a cobertura.", document: "Linha FWT", heading: "Prazo" }])
      if (call.user.includes("EM ABERTO")) return { decision: "INSUFFICIENT", insufficient: { reason: "A mensagem é outro assunto." }, pendingReply: { kind: "NEW_QUESTION" } }
      return { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "Linha FWT", "Prazo")] }
    }
    const switched = reply(await ask("e qual o prazo da mudança de endereço da linha FWT?", { previous }))
    expect(switched.state.id).not.toBe(first.state.id)
    expect(switched.state).toMatchObject({ status: "ANSWERED", originalQuestion: "e qual o prazo da mudança de endereço da linha FWT?" })
    const newFlowPrompt = calls.filter((call) => call.stage === "PLANNER").at(-1)!.user
    expect(newFlowPrompt).not.toContain("EM ABERTO")
  })

  it("opções sem evidência são rejeitadas; sem duas opções válidas, UMA correção é pedida (com o que foi rejeitado)", async () => {
    const { ask, calls } = setup((call, index) =>
      index === 0
        ? clarify("Produto", "Qual produto?", [{ label: "Linha básica", evidence: [refOf(call.prompt, "Linha básica")] }, { label: "Produto inventado", evidence: [] }, { label: "Outro inventado", evidence: ["K999"] }])
        : clarify("Produto", "Qual produto?", [{ label: "Linha básica", evidence: [refOf(call.prompt, "Linha básica")] }, { label: "Linha FWT", evidence: [refOf(call.prompt, "Linha FWT")] }]),
    )
    const outcome = reply(await ask("Como faço uma mudança de endereço?"))
    expect(calls).toHaveLength(2)
    expect(calls[1]!.correction).toBe(true)
    expect(calls[1]!.user).toContain("CORREÇÃO OBRIGATÓRIA")
    expect(calls[1]!.user).toContain("Produto inventado")
    expect(outcome.state.steps[0]!.options.map((option) => option.label)).toEqual(["Linha básica", "Linha FWT"])
    expect(outcome.trace.rejectedOptions.map((option) => option.label)).toEqual(["Produto inventado", "Outro inventado"])
    expect(outcome.trace.plannerAttempts).toBe(2)
  })

  it("contrato descumprido duas vezes numa pergunta nova: o caminho de sempre responde (nunca opções sem fonte na tela)", async () => {
    const { ask } = setup(() => clarify("Produto", "Qual produto?", [{ label: "Inventado 1", evidence: [] }, { label: "Inventado 2", evidence: ["K404"] }]))
    expect(await ask("Como faço uma mudança de endereço?")).toMatchObject({ kind: "PASS", reason: "PLANNER_FAILED" })
  })

  it("permissões: base que a pessoa não pode ler não aparece para a IA, nem como opção ou fonte", async () => {
    // A IA "tenta" citar a base inacessível com um marcador que o prompt não trouxe: a opção é rejeitada.
    const { ask, calls } = setup((call) => clarify("Tipo de cliente", "Para qual tipo de cliente?", [{ label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }, { label: "Empresa", evidence: ["K99"] }]), { accessible: (id) => id !== "kb-fic-tt-empresa" })
    const outcome = await ask("Quais documentos preciso para troca de titularidade?")
    expect(calls[0]!.prompt).toContain("— Residencial")
    expect(calls[0]!.prompt).not.toContain("titularidade — Empresa")
    expect(outcome.kind).toBe("PASS")
    expect(outcome.trace.navigation?.excludedByAccess).toBe(1)
    expect(outcome.trace.rejectedOptions.map((option) => option.label)).toContain("Empresa")
  })

  it("ciclos: a mesma dimensão de novo (mesmo depois da correção) encerra o fluxo explicando o que falta, sem resposta sem fonte", async () => {
    const repeat = (call: ScriptedCall) => clarify("Tipo de cliente", "Para qual tipo de cliente?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }])
    const { ask, choose, calls } = setup(repeat)
    const first = reply(await ask("Quais documentos preciso para troca de titularidade?"))
    const looped = reply(await choose(first.state, 0, ["Empresa"]))
    expect(calls).toHaveLength(3)
    expect(looped.state.status).toBe("NOT_CONVERGED")
    expect(looped.content).toContain("Ainda não consegui identificar o cenário com segurança")
    expect(looped.content).toContain("Tipo de cliente: Empresa")
    expect(looped.state.sources).toEqual([])
    expect(looped.state.steps.every((step) => step.answer !== null)).toBe(true)
  })

  it("ciclos: no limite de etapas a IA é avisada e, insistindo em perguntar, o fluxo encerra", async () => {
    const { choose, calls } = setup((call) => clarify("Mais uma dimensão", "Mais uma pergunta?", [{ label: "A", evidence: [refOf(call.prompt, "Linha básica")] }, { label: "B", evidence: [refOf(call.prompt, "Linha FWT")] }]))
    const dimensions = ["D1", "D2", "D3", "D4"]
    const steps: ClarificationStep[] = dimensions.map((dimension, index) => ({ id: stepIdFor(index + 1, dimension), dimension, question: `${dimension}?`, selectionMode: "SINGLE", options: ["X", "Y"].map((label) => ({ id: optionIdFor(dimension, label), label, description: null, group: null, evidence: [{ documentId: "kb-fic-end-basica", documentTitle: "Mudança de endereço — Linha básica (fictícia)", versionId: "kb-fic-end-basica-v1", heading: "1. Quando se aplica", chunkIndex: 0 }] })), answer: index < 3 ? { optionIds: [optionIdFor(dimension, "X")], freeText: null, noneMatched: false, via: "FORM", answeredAt: NOW.toISOString() } : null }))
    const state: ClarificationState = { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "22222222-2222-4222-8222-222222222222", originalQuestion: "Como faço uma mudança de endereço?", status: "OPEN", steps, questionFacts: [], coverage: { consideredDocuments: 9, matchedDocuments: 6, presentedDocuments: 6, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: NOW.toISOString() }
    const outcome = reply(await choose(state, 3, ["X"]))
    expect(calls[0]!.user).toContain("Etapas de esclarecimento restantes: 0 — decida ANSWER ou INSUFFICIENT.")
    expect(outcome.state.status).toBe("NOT_CONVERGED")
    expect(outcome.state.steps).toHaveLength(4)
  })

  it("fontes conflitantes: a resposta recebe o conflito e o estado o registra (nada escolhido em silêncio)", async () => {
    const { ask, calls } = setup((call) =>
      call.stage === "PLANNER"
        ? { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "— Banda larga", "troca de tecnologia")], conflicts: [{ description: "O guia e o procedimento descrevem a troca de tecnologia de formas diferentes.", evidence: [refOf(call.prompt, "— Banda larga", "troca de tecnologia"), refOf(call.prompt, "Guia rápido", "Resumo")] }] }
        : answerWith(call.prompt, [{ text: "As bases divergem: uma fala em nova instalação.", document: "— Banda larga", heading: "troca de tecnologia" }, { text: "O guia resume como outra instalação.", document: "Guia rápido", heading: "Resumo" }]),
    )
    const outcome = reply(await ask("Como faço a mudança de endereço da Banda larga com troca de tecnologia?"))
    expect(calls[1]!.user).toContain("Conflitos entre fontes vigentes")
    expect(outcome.state.conflicts).toHaveLength(1)
    expect(outcome.state.sources.map((source) => source.documentId)).toEqual(["kb-fic-end-bl", "kb-fic-end-bl-guia"])
  })

  it("continuação de uma resposta anterior (\"e se for…?\"): a IA vê a pergunta anterior e o cenário dela", async () => {
    const { ask, calls } = setup((call) => clarify("Situação da troca", "Qual situação?", [{ label: "Troca comum", evidence: [refOf(call.prompt, "titularidade — Empresa", "troca comum")] }, { label: "Falecimento", evidence: [refOf(call.prompt, "titularidade — Empresa", "Falecimento")] }]))
    const previous: ClarificationState = { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "33333333-3333-4333-8333-333333333333", originalQuestion: "Quais documentos para troca de titularidade de empresa?", status: "ANSWERED", steps: [], questionFacts: [{ dimension: "Tipo de cliente", value: "empresa" }], coverage: { consideredDocuments: 9, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: NOW.toISOString() }
    reply(await ask("e se for PF para PJ?", { previous: { state: previous, isLatestAssistantMessage: true } }))
    expect(calls[0]!.user).toContain("Pergunta anterior nesta conversa (contexto)")
  })
})

describe("esclarecimento pelas bases — a IA navega; nenhuma busca por palavra escolhe por ela", () => {
  it("a pergunta não filtra o que a IA vê: perguntas diferentes recebem exatamente a mesma lista de bases", async () => {
    const { ask, calls } = setup(() => ({ decision: "NOT_APPLICABLE" }))
    await ask("Como faço uma mudança de endereço?")
    await ask("Quero saber das férias")
    // O começo fixo do prompt (regras, limites, glossário e a lista das bases) é idêntico.
    expect(calls[0]!.system).toBe(calls[1]!.system)
    expect(calls[0]!.system).toContain("BASES QUE ESTA PESSOA PODE CONSULTAR")
  })

  it("abre uma base e lê uma seção antes de decidir (READ); a resposta cita a seção que a IA escolheu no sumário", async () => {
    const { ask, calls } = setup((call, index) => {
      if (index === 0) return { decision: "READ", read: [refOf(call.prompt, "Linha FWT"), refOf(call.prompt, "Linha FWT", "Quando se aplica")] }
      if (index === 1) return { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "Linha FWT", "Prazo")] }
      return answerWith(call.prompt, [{ text: "Imediato depois de validar a cobertura.", document: "Linha FWT", heading: "Prazo" }])
    }, { budget: NARROW })
    const outcome = reply(await ask("Em quanto tempo sai a mudança de endereço do fixo sem fio?"))
    // 1ª rodada: só a lista (uma seção de amostra por base), nada aberto nem lido.
    expect(calls[0]!.user).not.toContain("BASES ABERTAS")
    expect(calls[0]!.user).toContain("Consultas (READ) restantes nesta mensagem: 2.")
    // 2ª rodada: o sumário completo da base aberta e o texto da seção lida.
    expect(calls[1]!.user).toMatch(/### Mudança de endereço — Linha FWT \(fictícia\) \[B\d+\]/)
    expect(calls[1]!.user).toContain("3. Prazo")
    expect(calls[1]!.user).toContain("SEÇÕES LIDAS")
    expect(calls[1]!.user).toContain("Mudança de endereço da linha FWT (fixo sem fio).")
    expect(calls[1]!.user).toContain("Consultas (READ) restantes nesta mensagem: 1.")
    expect(outcome.state.sources.map((source) => source.heading)).toEqual(["3. Prazo"])
    expect(outcome.trace.navigation).toMatchObject({ readRounds: 1, read: 1, opened: ["Mudança de endereço — Linha FWT (fictícia)"] })
  })

  it("consultas além do limite: a IA é avisada e, insistindo, a pergunta nova segue o caminho de sempre", async () => {
    const { ask, calls } = setup((call) => ({ decision: "READ", read: refsInPrompt(call.prompt).filter((entry) => entry.ref.startsWith("B")).map((entry) => entry.ref) }), { budget: NARROW })
    expect(await ask("Como faço uma mudança de endereço?")).toMatchObject({ kind: "PASS", reason: "PLANNER_FAILED" })
    expect(calls[2]!.user).toContain("Consultas (READ) restantes nesta mensagem: 0 — decida com o que está abaixo.")
    expect(calls[3]!.user).toContain("Não há mais consultas para esta pergunta")
    expect(calls).toHaveLength(4)
  })
})

describe("esclarecimento pelas bases — falhas nunca quebram o chat nem perdem o contexto", () => {
  it("pergunta nova: falha ao ler as bases ou da IA = PASS (o caminho de sempre responde)", async () => {
    const failingKnowledge = setup(() => ({}), { knowledge: async () => Promise.reject(new Error("banco fora")) })
    expect(await failingKnowledge.ask("Como faço uma mudança de endereço?")).toMatchObject({ kind: "PASS", reason: "KNOWLEDGE_UNAVAILABLE" })
    const failingModel = setup(() => new Error("provedor fora"))
    expect(await failingModel.ask("Como faço uma mudança de endereço?")).toMatchObject({ kind: "PASS", reason: "PLANNER_FAILED" })
  })

  it("escolha pelo formulário: falha da IA = erro explícito, estado gravado intacto (a escolha pode ser reenviada)", async () => {
    let fail = false
    const { ask, choose } = setup((call) => (fail ? new Error("provedor fora") : clarify("Tipo de cliente", "Qual cliente?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }])))
    const first = reply(await ask("Quais documentos preciso para troca de titularidade?"))
    fail = true
    await expect(choose(first.state, 0, ["Empresa"])).rejects.toMatchObject({ code: "KNOWLEDGE_CLARIFICATION_UNAVAILABLE" })
    expect(first.state.steps[0]!.answer).toBeNull()
  })

  it("resposta final inválida duas vezes: pergunta nova = PASS; escolha pelo formulário = erro explícito", async () => {
    const script = (call: ScriptedCall) => (call.stage === "PLANNER" ? { decision: "ANSWER", answerEvidence: [refOf(call.prompt, "Linha FWT", "Prazo")] } : { answer: "Fonte inventada [K999].", sources: ["K999"] })
    const { ask, calls } = setup(script)
    expect(await ask("Qual o prazo da mudança de endereço da linha FWT?")).toMatchObject({ kind: "PASS", reason: "ANSWER_FAILED" })
    expect(calls.filter((call) => call.stage === "ANSWER")).toHaveLength(2)
  })

  it("escolha de um esclarecimento substituído por outro mais recente = 409, nada aplicado", async () => {
    const { ask } = setup((call) => clarify("Tipo de cliente", "Qual cliente?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }]))
    const first = reply(await ask("Quais documentos preciso para troca de titularidade?"))
    const step = first.state.steps[0]!
    const stale = ask("Empresa", { answer: { clarificationId: "44444444-4444-4444-8444-444444444444", stepId: step.id, optionIds: [step.options[0]!.id], noneMatched: false, revise: false }, previous: { state: first.state, isLatestAssistantMessage: true } })
    await expect(stale).rejects.toMatchObject({ code: "KNOWLEDGE_CLARIFICATION_STALE", statusCode: 409 })
    await expect(ask("Empresa", { answer: { clarificationId: first.state.id, stepId: step.id, optionIds: [step.options[0]!.id], noneMatched: false, revise: false }, previous: null })).rejects.toBeInstanceOf(DomainError)
  })
})

/** O que a tela recebeu do fluxo: pedaços, retiradas e progresso, na ordem. */
function screen() {
  const events: (["text", string] | ["retract"] | ["status", string])[] = []
  const stream: ClarificationStream = { text: (chunk) => events.push(["text", chunk]), retract: () => events.push(["retract"]), status: (label) => events.push(["status", label]) }
  /** O que está na tela agora: o texto depois da última retirada. */
  const shown = () => {
    const last = events.map((event) => event[0]).lastIndexOf("retract")
    return events.slice(last + 1).flatMap((event) => (event[0] === "text" ? [event[1]] : [])).join("")
  }
  return { stream, events, shown, retracts: () => events.filter((event) => event[0] === "retract").length }
}

describe("esclarecimento pelas bases — resposta em fluxo no chat de texto", () => {
  const planAnswer = (call: ScriptedCall) => ({ decision: "ANSWER", questionFacts: [{ dimension: "Produto", value: "linha FWT" }], answerEvidence: [refOf(call.prompt, "Linha FWT", "Cobertura"), refOf(call.prompt, "Linha FWT", "Prazo")] })
  const goodAnswer = (call: ScriptedCall) => answerWith(call.prompt, [
    { text: "Só é possível com cobertura celular no novo endereço.", document: "Linha FWT", heading: "Cobertura" },
    { text: "O prazo é imediato depois da validação da cobertura.", document: "Linha FWT", heading: "Prazo" },
  ])

  it("a redação aparece em pedaços, já numerada, e o que apareceu é exatamente a resposta validada; a decisão nunca vai para a tela", async () => {
    const { ask, calls } = setup((call) => (call.stage === "PLANNER" ? planAnswer(call) : goodAnswer(call)))
    const tela = screen()
    const outcome = reply(await ask("Qual o prazo da mudança de endereço da linha FWT?", { stream: tela.stream }))
    expect(tela.shown()).toBe(outcome.content)
    expect(tela.events.filter((event) => event[0] === "text").length).toBeGreaterThan(5)
    expect(tela.retracts()).toBe(0)
    expect(tela.events[0]).toEqual(["status", ANSWER_DRAFTING_STATUS])
    // Só a redação vai em fluxo: o planejador decide inteiro, como sempre.
    expect(calls.map((call) => [call.stage, call.streamed])).toEqual([["PLANNER", false], ["ANSWER", true]])
    expect(outcome.trace.calls).toEqual(["PLANNER ANSWER", "ANSWER OK"])
  })

  it("marcador de seção não lida: o fluxo para, o que apareceu é RETIRADO antes da correção, e a correção também vai em fluxo", async () => {
    let answers = 0
    const { ask } = setup((call) => {
      if (call.stage === "PLANNER") return planAnswer(call)
      answers += 1
      return answers === 1 ? { answer: `Só com cobertura [${refOf(call.prompt, "Linha FWT", "Cobertura")}]. Prazo de 5 dias [K999]. Texto que nunca aparece.`, sources: [], limitations: null } : goodAnswer(call)
    })
    const tela = screen()
    const outcome = reply(await ask("Qual o prazo da mudança de endereço da linha FWT?", { stream: tela.stream }))
    const retractAt = tela.events.findIndex((event) => event[0] === "retract")
    const before = tela.events.slice(0, retractAt).flatMap((event) => (event[0] === "text" ? [event[1]] : [])).join("")
    // Até o marcador inválido (o espaço antes dele depende de onde o pedaço cortou) — nada do que vem depois.
    expect(before).toMatch(/^Só com cobertura \[1\]\. Prazo de 5 dias ?$/)
    expect(tela.retracts()).toBe(1)
    expect(tela.shown()).toBe(outcome.content)
    expect(outcome.trace.calls).toEqual(["PLANNER ANSWER", "ANSWER INVALID", "ANSWER(fix) OK"])
  })

  it("resposta recusada duas vezes: nada fica na tela e a pergunta nova segue pelo caminho de sempre (PASS)", async () => {
    const { ask } = setup((call) => (call.stage === "PLANNER" ? planAnswer(call) : { answer: `Texto [${refOf(call.prompt, "Linha FWT", "Prazo")}] e fonte inventada [K999].`, sources: ["K999"] }))
    const tela = screen()
    expect(await ask("Qual o prazo da mudança de endereço da linha FWT?", { stream: tela.stream })).toMatchObject({ kind: "PASS", reason: "ANSWER_FAILED" })
    expect(tela.shown()).toBe("")
    expect(tela.retracts()).toBe(2)
  })

  it("a chamada cai no meio da redação: o que apareceu é retirado e a pergunta nova segue pelo caminho de sempre", async () => {
    const { ask } = setup((call) => (call.stage === "PLANNER" ? planAnswer(call) : new FailAfterStreaming(JSON.stringify(goodAnswer(call)).slice(0, 90))))
    const tela = screen()
    expect(await ask("Qual o prazo da mudança de endereço da linha FWT?", { stream: tela.stream })).toMatchObject({ kind: "PASS", reason: "ANSWER_FAILED" })
    expect(tela.events.some((event) => event[0] === "text")).toBe(true)
    expect(tela.shown()).toBe("")
  })

  it("pergunta de esclarecimento (CLARIFY) não vai em fluxo: sai inteira, validada", async () => {
    const { ask, calls } = setup((call) => clarify("Tipo de cliente", "Qual cliente?", [{ label: "Empresa", evidence: [refOf(call.prompt, "titularidade — Empresa")] }, { label: "Residencial", evidence: [refOf(call.prompt, "— Residencial")] }]))
    const tela = screen()
    reply(await ask("Quais documentos preciso para troca de titularidade?", { stream: tela.stream }))
    expect(tela.events).toEqual([])
    expect(calls.every((call) => !call.streamed)).toBe(true)
  })
})

describe("esclarecimento pelas bases — falha passageira do provedor na redação: UMA nova tentativa", () => {
  const planAnswer = (call: ScriptedCall) => ({ decision: "ANSWER", questionFacts: [{ dimension: "Produto", value: "linha FWT" }], answerEvidence: [refOf(call.prompt, "Linha FWT", "Cobertura"), refOf(call.prompt, "Linha FWT", "Prazo")] })
  const goodAnswer = (call: ScriptedCall) => answerWith(call.prompt, [
    { text: "Só é possível com cobertura celular no novo endereço.", document: "Linha FWT", heading: "Cobertura" },
    { text: "O prazo é imediato depois da validação da cobertura.", document: "Linha FWT", heading: "Prazo" },
  ])
  /** A 1ª redação falha com `failure`; as seguintes respondem bem. */
  const failingFirst = (failure: Error) => {
    let answers = 0
    return (call: ScriptedCall) => {
      if (call.stage === "PLANNER") return planAnswer(call)
      answers += 1
      return answers === 1 ? failure : goodAnswer(call)
    }
  }
  const QUESTION = "Qual o prazo da mudança de endereço da linha FWT?"

  it("erro do servidor do provedor (policy ou caminho legado): tenta de novo uma vez e a resposta sai, com a tentativa no rastro", async () => {
    for (const failure of [new AiProviderError("PROVIDER_ERROR"), new DomainError("O modelo de IA não retornou uma resposta válida.", "AGENT_EXECUTION_FAILED", 502, { status: 500, category: "PROVIDER_ERROR" }), new AiProviderError("NETWORK"), new AiProviderError("MODEL_UNAVAILABLE")]) {
      const { ask, calls } = setup(failingFirst(failure))
      const outcome = reply(await ask(QUESTION))
      expect(outcome.state.status).toBe("ANSWERED")
      expect(calls.filter((call) => call.stage === "ANSWER")).toHaveLength(2)
      expect(outcome.trace.calls).toEqual(["PLANNER ANSWER", `ANSWER RETRY(${(failure as AiProviderError).category ?? "PROVIDER_ERROR"})`, "ANSWER OK"])
    }
  })

  it("estouro de tempo, limite de uso ou erro que não é do provedor: nenhuma nova tentativa (o caminho de sempre responde)", async () => {
    for (const failure of [new AiProviderError("TIMEOUT"), new AiProviderError("RATE_LIMIT"), new AiProviderError("INVALID_REQUEST"), new Error("defeito")]) {
      const { ask, calls } = setup(failingFirst(failure))
      expect(await ask(QUESTION)).toMatchObject({ kind: "PASS", reason: "ANSWER_FAILED" })
      expect(calls.filter((call) => call.stage === "ANSWER")).toHaveLength(1)
    }
  })

  it("uma só por mensagem: a nova tentativa falhando também, o caminho de sempre responde", async () => {
    const { ask, calls } = setup((call) => (call.stage === "PLANNER" ? planAnswer(call) : new AiProviderError("PROVIDER_ERROR")))
    expect(await ask(QUESTION)).toMatchObject({ kind: "PASS", reason: "ANSWER_FAILED" })
    expect(calls.filter((call) => call.stage === "ANSWER")).toHaveLength(2)
  })

  it("em fluxo: o que aparece na tela é só a resposta validada da nova tentativa", async () => {
    const { ask } = setup(failingFirst(new AiProviderError("PROVIDER_ERROR")))
    const tela = screen()
    const outcome = reply(await ask(QUESTION, { stream: tela.stream }))
    expect(tela.shown()).toBe(outcome.content)
    expect(tela.retracts()).toBe(0)
  })
})
