import { describe, expect, it } from "vitest"
import { identifyingNameVariants, OPERATOR_PLACEHOLDER, projectPeerTranscript, sourceHashOf, verifyProjectedQuote } from "./peer-privacy-projection.js"

const LUANA = { personId: "p-luana", fullName: "Luana Brenda" }
const ICARO = { personId: "p-icaro", fullName: "Icaro Elias" }
const LUZIA = { personId: "p-luzia", fullName: "Luzia Ingrid da Silva Nobre" }
const TARGET = { personId: "p-mariana", fullName: "Mariana Alves" }

const project = (transcript: string, peer = LUANA, extra: Partial<Parameters<typeof projectPeerTranscript>[0]> = {}) => projectPeerTranscript({ sourceInteractionId: "int-1", transcript, peer, target: TARGET, knownOperators: [LUANA, ICARO, LUZIA, { personId: "p-mc", fullName: "Mariana Costa" }], ...extra })

describe("projeção de privacidade da transcrição de um PAR", () => {
  it("redige o par em apresentação, vocativo, 'com a', nome completo e primeiro nome — mantendo o resto byte a byte", () => {
    const raw = "Operador: Conecta, Luana falando, bom dia.\nCliente: Bom dia. Obrigado, Luana.\nOperador: Falei com a Luana Brenda ontem.\nCliente: A LUANA me ajudou; a luana brenda também."
    const result = project(raw)
    expect(result.projected).toBe(`Operador: Conecta, ${OPERATOR_PLACEHOLDER} falando, bom dia.\nCliente: Bom dia. Obrigado, ${OPERATOR_PLACEHOLDER}.\nOperador: Falei com a ${OPERATOR_PLACEHOLDER} ontem.\nCliente: A ${OPERATOR_PLACEHOLDER} me ajudou; a ${OPERATOR_PLACEHOLDER} também.`)
    expect(result.projected).not.toMatch(/luana/i)
    expect(result.sourceHash).toBe(sourceHashOf(raw))
    expect(result.redactions.find((item) => item.kind === "PEER_NAME")?.count).toBe(5)
    expect(result.forbiddenTerms).toEqual(expect.arrayContaining(["Luana Brenda", "Luana"]))
  })

  it("acentos e variações conhecidas: 'Ícaro' e 'Icaro' saem; nome composto sai por partes fortes; sobrenome isolado de cliente NÃO sai", () => {
    expect(project("Operador: Aqui é o Ícaro. Cliente: Valeu, Icaro!", ICARO).projected).toBe(`Operador: Aqui é o ${OPERATOR_PLACEHOLDER}. Cliente: Valeu, ${OPERATOR_PLACEHOLDER}!`)
    const luzia = project("Operador: Meu nome é Luzia Ingrid da Silva Nobre. Cliente: Sou o José da Silva, cliente antigo. Obrigado, Luzia Ingrid.", LUZIA)
    expect(luzia.projected).toBe(`Operador: Meu nome é ${OPERATOR_PLACEHOLDER}. Cliente: Sou o José da Silva, cliente antigo. Obrigado, ${OPERATOR_PLACEHOLDER}.`)
    expect(luzia.projected).toContain("José da Silva")
  })

  it("nome que também é palavra comum só sai em apresentação/vocativo (nunca a palavra solta)", () => {
    const rosa = { personId: "p-rosa", fullName: "Rosa Martins" }
    const result = project("Operador: Aqui é a Rosa, bom dia. Cliente: A cor rosa do aparelho. Obrigado, Rosa. Falei com a Rosa Martins.", rosa)
    expect(result.projected).toBe(`Operador: Aqui é a ${OPERATOR_PLACEHOLDER}, bom dia. Cliente: A cor rosa do aparelho. Obrigado, ${OPERATOR_PLACEHOLDER}. Falei com a ${OPERATOR_PLACEHOLDER}.`)
  })

  it("homônimos e alvo: outro operador conhecido sai pelo nome completo; o primeiro nome do ALVO nunca é redigido; o par não é confundido com o alvo", () => {
    const result = project("Operador: Vou transferir para a Mariana Costa. Cliente: A Mariana Alves me atendeu semana passada. Obrigado, Luana.", LUANA)
    expect(result.projected).toBe(`Operador: Vou transferir para a ${OPERATOR_PLACEHOLDER}. Cliente: A Mariana Alves me atendeu semana passada. Obrigado, ${OPERATOR_PLACEHOLDER}.`)
    // Par homônimo do alvo pelo primeiro nome: o PAR "Mariana Costa" é redigido inteiro, o alvo continua visível.
    const homonym = project("Operador: Aqui é a Mariana, da Conecta. Cliente: Obrigado, Mariana. A Mariana Alves já tinha me ligado.", { personId: "p-mc", fullName: "Mariana Costa" })
    expect(homonym.projected).toBe(`Operador: Aqui é a ${OPERATOR_PLACEHOLDER}, da Conecta. Cliente: Obrigado, ${OPERATOR_PLACEHOLDER}. A Mariana Alves já tinha me ligado.`)
  })

  it("PII evidente por padrão determinístico: telefone, e-mail, CPF, protocolo (lote, massa e 'protocolo N')", () => {
    const result = project("Cliente: meu telefone é (86) 94760-7385 e o e-mail ana.souza@example.com, CPF 123.456.789-09. Operador: o protocolo é 202606123456; referência DEMO-202606-M001; protocolo 987654321 registrado.")
    expect(result.projected).toBe("Cliente: meu telefone é [TELEFONE] e o e-mail [EMAIL], CPF [CPF]. Operador: o protocolo é [PROTOCOLO]; referência [PROTOCOLO]; protocolo [PROTOCOLO] registrado.")
    expect(result.redactions.map((item) => item.kind).sort()).toEqual(["CPF", "EMAIL", "PHONE", "PROTOCOL"])
    expect(project("Operador: são 20 gigas por 89,90 reais em 2026.").projected).toBe("Operador: são 20 gigas por 89,90 reais em 2026.")
  })

  it("verbatim privacy-safe: citação da projeção aceita; inexistente rejeitada; citação que reintroduz o nome do par rejeitada; ponte de auditoria pelo hash", () => {
    const raw = "Operador: Conecta, Luana falando, bom dia. Cliente: Quero a segunda via."
    const projection = project(raw)
    expect(verifyProjectedQuote(projection, "Conecta, [OPERADOR] falando, bom dia.")).toEqual({ ok: true, reason: "LITERAL" })
    expect(verifyProjectedQuote(projection, "quero a SEGUNDA via")).toEqual({ ok: true, reason: "LITERAL" })
    expect(verifyProjectedQuote(projection, "Conecta, Luana falando, bom dia.")).toEqual({ ok: false, reason: "REIDENTIFICATION" })
    expect(verifyProjectedQuote(projection, "Obrigado, Luana Brenda")).toEqual({ ok: false, reason: "REIDENTIFICATION" })
    expect(verifyProjectedQuote(projection, "Quero a terceira via.")).toEqual({ ok: false, reason: "NOT_IN_PROJECTION" })
    expect(projection.sourceHash).toBe(sourceHashOf(raw))
    expect(projection.projected).not.toBe(raw)
  })

  it("variantes identificáveis: completo, primeiro+segundo, primeiro+último; partículas ignoradas", () => {
    expect(identifyingNameVariants("Luzia Ingrid da Silva Nobre")).toEqual({ strong: ["Luzia Ingrid da Silva Nobre", "Luzia Ingrid", "Luzia Nobre"], first: "Luzia", commonWordFirst: false })
    expect(identifyingNameVariants("Rosa Martins")).toEqual({ strong: ["Rosa Martins"], first: "Rosa", commonWordFirst: true })
  })
})
