import { describe, expect, it } from "vitest"
import { PLANNER_SYSTEM, SESSION_ANSWER_RULE } from "../domain/clarification-prompts.js"
import { refOf, TEST_ORCHESTRATOR_AGENT, TEST_ORG, TEST_PERSON, TEST_SPECIALIST_AGENT } from "../testing/clarification-fixtures.js"
import { fixtureClarificationService } from "../testing/clarification-service-fixture.js"
import type { ClarificationRequest } from "./knowledge-clarification-service.js"

/**
 * `PRODUCT_APPLICABILITY_V1` — o esclarecimento pelas bases numa CONVERSA SOBRE UM FEEDBACK em que a gravação não estabeleceu o produto:
 * o registro da análise entra como DADO para o planejador (só ele decide se a pergunta depende do produto) e a resposta apresenta o
 * cenário como o que a pessoa informou, nunca como o que a gravação mostrou. Sem esse contexto, nada muda. Bases fictícias de teste.
 */
const SESSION = "Feedback sobre: Mudança de endereço.\nProduto do atendimento (o que a análise da gravação estabeleceu):\n- O produto do pedido NÃO ficou estabelecido pela gravação."
const request = (text: string, extra: Partial<ClarificationRequest> = {}): ClarificationRequest => ({ organizationId: TEST_ORG, personId: TEST_PERSON, orchestratorAgentId: TEST_ORCHESTRATOR_AGENT, specialistAgentIds: [TEST_SPECIALIST_AGENT], text, answer: null, previous: null, recentTurns: [], ...extra })

describe("esclarecimento na sessão de feedback (produto não estabelecido)", () => {
  it("o planejador recebe o registro como contexto marcado (dado, não gravação) e as regras de não pedir identificador completo", async () => {
    const { service, calls } = fixtureClarificationService(() => ({ decision: "NOT_APPLICABLE", questionFacts: [] }))
    await service.handle(request("Por que recebi este feedback?", { sessionContext: SESSION }))
    expect(calls[0]!.user).toContain("CONTEXTO DA SESSÃO DE FEEDBACK")
    expect(calls[0]!.user).toContain("O produto do pedido NÃO ficou estabelecido pela gravação.")
    expect(calls[0]!.user).toContain("o que a pessoa disser aqui não é observação da gravação")
    expect(PLANNER_SYSTEM).toContain("Nunca peça número completo de conta, contrato, linha, protocolo ou documento")
    expect(PLANNER_SYSTEM).toContain("O que a pessoa responder vale para orientar ESTA conversa — nunca é o que a gravação mostrou.")
  })

  it("pergunta o produto e, com a escolha, responde pelas bases como o que a pessoa informou (regra da sessão na resposta)", async () => {
    const { service, calls } = fixtureClarificationService((call) =>
      call.stage === "PLANNER"
        ? call.user.includes("Pergunta de esclarecimento EM ABERTO") || call.user.includes("Etapas já feitas")
          ? { decision: "ANSWER", questionFacts: [], answerEvidence: [refOf(call.prompt, "— SIP", "Procedimento")] }
          : { decision: "CLARIFY", questionFacts: [], clarification: { dimension: "Produto", question: "Era de qual produto?", selectionMode: "SINGLE", options: [{ label: "SIP", evidence: [refOf(call.prompt, "— SIP")] }, { label: "Linha FWT", evidence: [refOf(call.prompt, "Linha FWT")] }] } }
        : { answer: `Como você me disse que era o SIP: a mudança mantém a numeração [${refOf(call.prompt, "— SIP", "Procedimento")}].`, sources: [refOf(call.prompt, "— SIP", "Procedimento")], limitations: null },
    )
    const asked = await service.handle(request("Como eu devia ter feito a mudança de endereço?", { sessionContext: SESSION }))
    if (asked.kind !== "REPLY") throw new Error("esperava a pergunta")
    const step = asked.state.steps[0]!
    const chosen = await service.handle(request("SIP", { sessionContext: SESSION, answer: { clarificationId: asked.state.id, stepId: step.id, optionIds: [step.options.find((option) => option.label === "SIP")!.id], noneMatched: false, revise: false }, previous: { state: asked.state, isLatestAssistantMessage: true } }))
    if (chosen.kind !== "REPLY") throw new Error("esperava a resposta")
    expect(chosen.state.status).toBe("ANSWERED")
    // A escolha é do FORMULÁRIO desta conversa (procedência gravada pelo roteador como CHAT_CONFIRMATION).
    expect(chosen.state.steps[0]!.answer).toMatchObject({ via: "FORM" })
    const answerCall = calls.find((call) => call.stage === "ANSWER")!
    expect(answerCall.system).toContain(SESSION_ANSWER_RULE)
  })

  it("sem contexto de sessão (chat de sempre), nem o bloco nem a regra da sessão aparecem", async () => {
    const { service, calls } = fixtureClarificationService((call) =>
      call.stage === "PLANNER"
        ? { decision: "ANSWER", questionFacts: [{ dimension: "Produto", value: "SIP" }], answerEvidence: [refOf(call.prompt, "— SIP", "Procedimento")] }
        : { answer: `A mudança mantém a numeração [${refOf(call.prompt, "— SIP", "Procedimento")}].`, sources: [refOf(call.prompt, "— SIP", "Procedimento")], limitations: null },
    )
    await service.handle(request("Como faço a mudança de endereço do SIP?"))
    expect(calls[0]!.user).not.toContain("CONTEXTO DA SESSÃO DE FEEDBACK")
    expect(calls.find((call) => call.stage === "ANSWER")!.system).not.toContain(SESSION_ANSWER_RULE)
  })
})
