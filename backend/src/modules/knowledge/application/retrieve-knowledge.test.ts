import { describe, expect, it } from "vitest"
import { fakeKnowledgeDb as fakeDb } from "../testing/fake-knowledge-db.js"
import { ASKER_QUESTION_RETRIEVAL_VERSION, clearKnowledgeSnapshotCache, retrieveKnowledgeForAgent } from "./retrieve-knowledge.js"

function bigDocument(id: string, title: string, topic: string, sections: number): { id: string; title: string; content: string } {
  const body = Array.from({ length: sections }, (_, index) =>
    [`## ${index + 1}. ${topic} — seção ${index + 1}`, `Regras detalhadas sobre ${topic}, parte ${index + 1}. `.repeat(20)].join("\n"),
  ).join("\n\n")
  return { id, title, content: `# ${title}\n\n${body}` }
}

describe("retrieveKnowledgeForAgent", () => {
  it("NONE quando o agente não tem base autorizada", async () => {
    const result = await retrieveKnowledgeForAgent(fakeDb({}), "agent-sem-kb", "qualquer pergunta")
    expect(result.trace.mode).toBe("NONE")
    expect(result.promptBlock).toBe("")
    expect(result.trace.injectedChars).toBe(0)
  })

  it("isolamento: só enxerga as bases vinculadas AO agente, nunca as de outro agente", async () => {
    const db = fakeDb({
      "agent-faturamento": [bigDocument("kb-fat", "Faturamento", "faturamento e cobrança", 12)],
      "agent-rh": [bigDocument("kb-rh", "Política de Férias", "férias e banco de horas", 12)],
    })
    const result = await retrieveKnowledgeForAgent(db, "agent-faturamento", "cliente quer saber sobre férias e banco de horas")
    expect(result.trace.authorizedDocuments.map((document) => document.id)).toEqual(["kb-fat"])
    expect(result.trace.retrieved.every((excerpt) => excerpt.documentId === "kb-fat")).toBe(true)
    expect(result.promptBlock).not.toContain("Política de Férias")
  })

  it("FULL quando as bases cabem inteiras no orçamento", async () => {
    const db = fakeDb({ agent: [{ id: "kb", title: "Checklist", content: "## Encerramento\nConfirmar se o cliente tem outra dúvida." }] })
    const result = await retrieveKnowledgeForAgent(db, "agent", "qualquer coisa")
    expect(result.trace.mode).toBe("FULL")
    expect(result.promptBlock).toContain("### Checklist")
    expect(result.promptBlock).toContain("[Seção: Encerramento]")
  })

  it("RETRIEVAL: bases grandes entram só pelos trechos pertinentes, com telemetria de economia", async () => {
    const db = fakeDb({
      agent: [
        bigDocument("kb-fat", "Faturamento", "emissão de fatura", 10),
        bigDocument("kb-cont", "Contestação", "contestação de cobrança", 10),
        bigDocument("kb-parc", "Parcelamento", "parcelamento de débitos", 10),
      ],
    })
    const result = await retrieveKnowledgeForAgent(db, "agent", "o cliente quer contestar uma cobrança")
    expect(result.trace.mode).toBe("RETRIEVAL")
    expect(result.trace.retrieved.length).toBeGreaterThan(0)
    expect(result.trace.retrieved.every((excerpt) => excerpt.documentId === "kb-cont")).toBe(true)
    expect(result.trace.injectedChars).toBeLessThan(result.trace.authorizedChars / 3)
    expect(result.trace.injectedChars).toBeLessThanOrEqual(result.trace.budget.maxTotalChars)
    expect(result.promptBlock).toContain("### Contestação")
    expect(result.promptBlock).not.toContain("### Parcelamento")
  })

  it("NO_MATCH quando nenhuma seção tem relação com a consulta — nunca injeta um documento 'aleatório'", async () => {
    const db = fakeDb({ agent: [bigDocument("kb-fat", "Faturamento", "emissão de fatura", 10)] })
    const result = await retrieveKnowledgeForAgent(db, "agent", "zzzz qqqq")
    expect(result.trace.mode).toBe("NO_MATCH")
    expect(result.promptBlock).toBe("")
    expect(result.trace.authorizedDocuments).toHaveLength(1)
  })

  describe("bases em cache por versão", () => {
    const base = () => [bigDocument("kb-fat", "Faturamento", "emissão de fatura", 10), bigDocument("kb-cont", "Contestação", "contestação de cobrança", 10)]

    it("mesmas versões: o texto não volta do banco e o resultado é idêntico ao montado do zero", async () => {
      clearKnowledgeSnapshotCache()
      const db = fakeDb({ agent: base() })
      const first = await retrieveKnowledgeForAgent(db, "agent", "o cliente quer contestar uma cobrança")
      const contentQueries = () => db.queries.filter((sql) => sql.includes("from knowledge_versions where id = any")).length
      expect(contentQueries()).toBe(1)
      const second = await retrieveKnowledgeForAgent(db, "agent", "o cliente quer contestar uma cobrança")
      const other = await retrieveKnowledgeForAgent(db, "agent", "como emitir a segunda via da fatura")
      expect(contentQueries()).toBe(1)
      expect(second).toEqual(first)
      clearKnowledgeSnapshotCache()
      expect(await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", "como emitir a segunda via da fatura")).toEqual(other)
    })

    it("versão nova publicada: a busca seguinte já usa o texto novo", async () => {
      clearKnowledgeSnapshotCache()
      const before = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", "prazo de estorno")
      expect(before.trace.mode).toBe("NO_MATCH")
      const updated = [...base(), { id: "kb-estorno", title: "Estorno", content: "## Prazo de estorno\nO estorno do valor cobrado indevidamente sai em até 2 faturas, com protocolo do pedido de estorno." }]
      const after = await retrieveKnowledgeForAgent(fakeDb({ agent: updated }), "agent", "prazo de estorno")
      expect(after.trace.authorizedDocuments.map((document) => document.id)).toContain("kb-estorno")
      expect(after.promptBlock).toContain("Prazo de estorno")
    })
  })

  describe("conversa: a pergunta da pessoa complementa a busca do roteamento (ASKER_QUESTION_RETRIEVAL_V1)", () => {
    // Reprodução do achado de 22/10/2026 em base fictícia: as seções "Passo k do procedimento" casam com tudo o que o roteamento
    // acrescentou ("Passo a passo e procedimentos") e ocupam o orçamento; a seção que a pessoa pediu fica de fora só por isso.
    const contestacao = {
      id: "kb-cont",
      title: "Contestação de Contas",
      content: [
        "# Contestação de Contas",
        ...Array.from({ length: 9 }, (_, index) => `## 28.${index + 1} Passo ${index + 1} do procedimento\nRegistre a contestação da fatura no sistema e siga o passo do procedimento ${index + 1}.`),
        "## 31. Registro obrigatório na contestação da fatura\nAo registrar a contestação da fatura, informe a conta, a linha, o valor, a data e o motivo apontado.",
      ].join("\n\n"),
    }
    const base = () => [contestacao, bigDocument("kb-ferias", "Política de Férias", "férias e banco de horas", 10)]
    const ROUTING = "Como registrar a contestação da fatura de um cliente? Passo a passo e procedimentos."
    const PERSON = "Como faço para registrar a contestação da fatura de um cliente?"
    const headings = (result: { trace: { retrieved: { heading: string }[] } }) => result.trace.retrieved.map((excerpt) => excerpt.heading)

    it("sem a pergunta da pessoa, nada muda (mesmo resultado de sempre, sem rastro novo)", async () => {
      const routingOnly = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING)
      expect(headings(routingOnly)).not.toContain("31. Registro obrigatório na contestação da fatura")
      expect(await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING, undefined, null, { askerQuestion: null })).toEqual(routingOnly)
      expect(routingOnly.trace.askerQuestion).toBeUndefined()
    })

    it("com a pergunta da pessoa: tudo o que o roteamento trazia continua e a seção pedida volta, registrada como acréscimo", async () => {
      const routingOnly = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING)
      const result = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING, undefined, null, { askerQuestion: PERSON })
      expect(headings(result)).toEqual(expect.arrayContaining(headings(routingOnly)))
      expect(headings(result)).toContain("31. Registro obrigatório na contestação da fatura")
      expect(result.promptBlock).toContain("informe a conta, a linha, o valor")
      expect(result.trace.askerQuestion).toEqual({ version: ASKER_QUESTION_RETRIEVAL_VERSION, outcome: "COMPLEMENTED", added: [expect.objectContaining({ documentId: "kb-cont", heading: "31. Registro obrigatório na contestação da fatura" })], otherDocuments: 0, overLimit: 0 })
      expect(result.trace.injectedChars).toBeLessThanOrEqual(result.trace.budget.maxTotalChars)
    })

    it("cortesia na pergunta da pessoa não muda nada: o resultado é o mesmo da pergunta sem ela", async () => {
      const plain = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING, undefined, null, { askerQuestion: PERSON })
      const polite = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING, undefined, null, { askerQuestion: `Olá, tudo bem? Por favor, me ajuda: ${PERSON}` })
      expect(polite).toEqual(plain)
    })

    it("pergunta com dois assuntos, um por especialista: cada busca fica no assunto que o roteamento lhe deu", async () => {
      const BOTH = "Como faço para registrar a contestação da fatura de um cliente e quantos dias de férias e banco de horas eu tenho?"
      const contestacaoCall = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING, undefined, null, { askerQuestion: BOTH })
      expect(headings(contestacaoCall)).toContain("31. Registro obrigatório na contestação da fatura")
      expect(contestacaoCall.trace.retrieved.every((excerpt) => excerpt.documentId === "kb-cont")).toBe(true)
      const FERIAS = "Quantos dias de férias e banco de horas o colaborador tem?"
      const feriasCall = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", FERIAS, undefined, null, { askerQuestion: BOTH })
      expect(feriasCall.trace.retrieved.length).toBeGreaterThan(0)
      expect(feriasCall.trace.retrieved.every((excerpt) => excerpt.documentId === "kb-ferias")).toBe(true)
      expect(feriasCall.trace.retrieved).toEqual((await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", FERIAS)).trace.retrieved)
    })

    it("pergunta que depende da conversa (\"e qual o prazo?\") não abre busca própria: resultado do roteamento, rastro TOO_SHORT", async () => {
      const routingOnly = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING)
      const result = await retrieveKnowledgeForAgent(fakeDb({ agent: base() }), "agent", ROUTING, undefined, null, { askerQuestion: "e qual o prazo?" })
      expect(result.trace.retrieved).toEqual(routingOnly.trace.retrieved)
      expect(result.trace.askerQuestion).toMatchObject({ outcome: "TOO_SHORT", added: [] })
    })
  })
})
