import { describe, expect, it } from "vitest"
import { projectPeerTranscript } from "./peer-privacy-projection.js"
import { accumulateVerification, emptyVerificationTelemetry, projectTranscript, renderTranscriptForModel, resolvePresentationOrdinal, verifyEvidenceUnit, verifyFinding, type ProjectedInteraction } from "./transcript-projection.js"

/** Fixture no formato REAL do lote (BUG_V2_1 do BENCHMARK_BLIND_V2): timestamp + falante por linha. */
const LOT = [
  "[00:00–00:07] OPERADOR: Você está no atendimento Conecta Demo. Sou Mariana Alves. Qual é a sua dúvida hoje?",
  "[00:07–00:15] CLIENTE: Estou contestando uma cobrança de serviço que apareceu de novo.",
  "[01:40–02:48] EVENTO: [Intervalo sem fala e sem música; consulta em andamento.]",
  "[02:48–02:54] CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.",
  "[02:54–03:02] OPERADOR: Continuo aqui. Desculpe por não ter atualizado você durante a consulta; já retomo a explicação.",
  "[03:02–03:10] CLIENTE: o sistema está lento",
  "[03:10–03:12] OPERADOR: vou aguardar",
  "[03:12–03:20] CLIENTE: Meu aplicativo não funciona.",
  "[03:20–03:30] OPERADOR: Você chegou a tentar resolver pelo aplicativo antes de ligar?",
  "[04:00–04:05] OPERADOR: Você chegou a tentar resolver pelo aplicativo antes de ligar?",
].join("\n")
const LEGACY = "Operador: Conecta, Icaro falando, bom dia!\nCliente: Deixa eu perguntar uma coisa fora do assunto: o aplicativo mostra o consumo em tempo real?\nOperador: Tem 3% de desconto pagando até o vencimento pelo Pix."

function interactions(): Map<string, ProjectedInteraction> {
  return new Map([
    ["I1", { interactionRef: "I1", interactionId: "id-1", projection: projectTranscript(LOT) }],
    ["I2", { interactionRef: "I2", interactionId: "id-2", projection: projectTranscript(LEGACY) }],
  ])
}

describe("TranscriptProjection — turnos determinísticos e formato model-facing", () => {
  it("§3/§4/§9 divide por linha, tira o timestamp (só auditoria), normaliza o falante e numera T1..Tn", () => {
    const projection = projectTranscript(LOT)
    expect(projection.turns).toHaveLength(10)
    expect(projection.turns[3]).toMatchObject({ handle: "T4", speaker: "CLIENTE", text: "Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.", audit: { timestamp: "02:48–02:54", lineIndex: 3 } })
    expect(projection.turns[2]).toMatchObject({ handle: "T3", speaker: "EVENTO", text: "[Intervalo sem fala e sem música; consulta em andamento.]" })
    const rendered = renderTranscriptForModel(projection)
    expect(rendered.split("\n")[3]).toBe("[T4] CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.")
    expect(rendered).not.toMatch(/\d\d:\d\d[–-]\d\d:\d\d/)
    // Determinística: mesma entrada → mesma projeção e mesmo hash.
    expect(projectTranscript(LOT)).toEqual(projection)
  })

  it("linha única com rótulos INLINE ('Operador: … Cliente: … Operador: …') vira um turno por rótulo; 'Protocolo:'/'Confirmando:' não são falantes", () => {
    const projection = projectTranscript("Operador: Vivo, bom dia. CPF? Cliente: Boa tarde. Minha internet parou. Protocolo: 123. Operador: Confirmando: já reiniciou o modem?")
    expect(projection.turns.map((turn) => `${turn.handle}|${turn.speaker}|${turn.text}`)).toEqual(["T1|OPERADOR|Vivo, bom dia. CPF?", "T2|CLIENTE|Boa tarde. Minha internet parou. Protocolo: 123.", "T3|OPERADOR|Confirmando: já reiniciou o modem?"])
    expect(projection.turns.every((turn) => turn.audit.lineIndex === 0)).toBe(true)
    const map = new Map([["I1", { interactionRef: "I1", interactionId: "id", projection }]])
    expect(verifyEvidenceUnit({ interactionRef: "I1", speaker: "CLIENTE", quote: "Minha internet parou." }, map).ok).toBe(true)
    expect(verifyEvidenceUnit({ interactionRef: "I1", speaker: "OPERADOR", quote: "Minha internet parou." }, map)).toEqual({ ok: false, reason: "WRONG_SPEAKER" })
    // A concatenação entre dois turnos inline também não é literal.
    expect(verifyEvidenceUnit({ interactionRef: "I1", quote: "CPF? Cliente: Boa tarde." }, map)).toEqual({ ok: false, reason: "NOT_LITERAL" })
  })

  it("formato legado (Operador:/Cliente: sem timestamp) e texto sem rótulo também viram turnos", () => {
    const legacy = projectTranscript(LEGACY)
    expect(legacy.turns.map((turn) => `${turn.handle}:${turn.speaker}`)).toEqual(["T1:OPERADOR", "T2:CLIENTE", "T3:OPERADOR"])
    const plain = projectTranscript("Cliente relatou o mesmo problema da chamada anterior.")
    expect(plain.turns).toEqual([{ handle: "T1", speaker: null, text: "Cliente relatou o mesmo problema da chamada anterior.", audit: { timestamp: null, lineIndex: 0 } }])
  })

  it("limite de tamanho corta por turno inteiro e registra quantos ficaram fora (o modelo não os viu)", () => {
    const projection = projectTranscript(LOT, { maxChars: 260 })
    expect(projection.turns.length).toBeLessThan(10)
    expect(projection.truncatedTurns).toBe(10 - projection.turns.length)
    expect(renderTranscriptForModel(projection)).toContain("turno(s) omitido(s)")
    // Citação de turno omitido não é literal para o modelo.
    const map = new Map([["I1", { interactionRef: "I1", interactionId: "id-1", projection }]])
    expect(verifyEvidenceUnit({ interactionRef: "I1", quote: "Meu aplicativo não funciona." }, map)).toEqual({ ok: false, reason: "NOT_LITERAL" })
  })
})

describe("Verificação literal por unidade (V1.3.3)", () => {
  it("§15 BUG_V2_1 — par CLIENTE + OPERADOR com timestamp entre as falas: cada trecho é literal no seu turno e o achado ALL sobrevive", () => {
    const result = verifyFinding(
      [
        { interactionRef: "I1", turnRef: "T4", speaker: "CLIENTE", quote: "Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído." },
        { interactionRef: "I1", turnRef: "T5", speaker: "OPERADOR", quote: "Continuo aqui. Desculpe por não ter atualizado você durante a consulta" },
      ],
      "ALL",
      interactions(),
    )
    expect(result.survives).toBe(true)
    expect(result.verified.map((item) => `${item.turnRef}/${item.speaker}`)).toEqual(["T4/CLIENTE", "T5/OPERADOR"])
    expect(result.rejected).toEqual([])
  })

  it("§17 concatenação de duas falas numa citação única NÃO é literal (nunca existiu assim na fonte)", () => {
    const joined = verifyEvidenceUnit({ interactionRef: "I1", quote: "o sistema está lento, vou aguardar" }, interactions())
    expect(joined).toEqual({ ok: false, reason: "NOT_LITERAL" })
    const pair = verifyEvidenceUnit({ interactionRef: "I1", quote: "CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído. OPERADOR: Continuo aqui. Desculpe por não ter atualizado você durante a consulta" }, interactions())
    expect(pair).toEqual({ ok: false, reason: "NOT_LITERAL" })
    // Com duas unidades, passa.
    expect(verifyFinding([{ interactionRef: "I1", turnRef: "T6", quote: "o sistema está lento" }, { interactionRef: "I1", turnRef: "T7", quote: "vou aguardar" }], "ALL", interactions()).survives).toBe(true)
  })

  it("§16 paráfrase é rejeitada (NOT_LITERAL) — nada de fuzzy", () => {
    expect(verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T8", speaker: "CLIENTE", quote: "Meu aplicativo nunca funcionou." }, interactions())).toEqual({ ok: false, reason: "NOT_LITERAL" })
    expect(verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T8", speaker: "CLIENTE", quote: "Meu aplicativo não funciona." }, interactions()).ok).toBe(true)
  })

  it("rótulo do falante e timestamp de auditoria do PRÓPRIO turno na frente da citação continuam literais; timestamp de outro turno não", () => {
    expect(verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T3", quote: "EVENTO: [Intervalo sem fala e sem música; consulta em andamento.]" }, interactions()).ok).toBe(true)
    expect(verifyEvidenceUnit({ interactionRef: "I1", quote: "[01:40–02:48] EVENTO: [Intervalo sem fala e sem música; consulta em andamento.]" }, interactions()).ok).toBe(true)
    expect(verifyEvidenceUnit({ interactionRef: "I1", quote: "[00:00–00:01] EVENTO: [Intervalo sem fala e sem música; consulta em andamento.]" }, interactions())).toEqual({ ok: false, reason: "NOT_LITERAL" })
  })

  it("§18 texto existe, falante errado → WRONG_SPEAKER", () => {
    expect(verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T8", speaker: "OPERADOR", quote: "Meu aplicativo não funciona." }, interactions())).toEqual({ ok: false, reason: "WRONG_SPEAKER" })
    // Sem turnRef, o falante declarado ainda é conferido contra o turno que contém o trecho.
    expect(verifyEvidenceUnit({ interactionRef: "I1", speaker: "OPERADOR", quote: "Meu aplicativo não funciona." }, interactions())).toEqual({ ok: false, reason: "WRONG_SPEAKER" })
  })

  it("§19 trecho existe em I2 mas o modelo cita I1 → WRONG_INTERACTION; interação desconhecida → WRONG_INTERACTION", () => {
    expect(verifyEvidenceUnit({ interactionRef: "I1", quote: "Tem 3% de desconto pagando até o vencimento pelo Pix." }, interactions())).toEqual({ ok: false, reason: "WRONG_INTERACTION" })
    expect(verifyEvidenceUnit({ interactionRef: "I2", turnRef: "T3", quote: "Tem 3% de desconto pagando até o vencimento pelo Pix." }, interactions()).ok).toBe(true)
    expect(verifyEvidenceUnit({ interactionRef: "I9", quote: "Tem 3% de desconto" }, interactions())).toEqual({ ok: false, reason: "WRONG_INTERACTION" })
  })

  it("§20 texto duplicado: turnRef desambigua; turnRef errado/inexistente com trecho literal em outro turno resolve pelo trecho e marca o mismatch; turnRef inexistente + trecho inexistente → WRONG_TURN", () => {
    const question = "Você chegou a tentar resolver pelo aplicativo antes de ligar?"
    const first = verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T9", quote: question }, interactions())
    const second = verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T10", quote: question }, interactions())
    expect(first.ok && first.evidence).toMatchObject({ turnRef: "T9", resolvedBy: "TURN_REF", turnRefMismatch: false })
    expect(second.ok && second.evidence).toMatchObject({ turnRef: "T10", resolvedBy: "TURN_REF", turnRefMismatch: false })
    // O locator estava errado, a evidência é real: resolve pelo trecho (primeiro turno que bate) e registra o mismatch.
    const wrongRef = verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T2", quote: question }, interactions())
    expect(wrongRef.ok && wrongRef.evidence).toMatchObject({ turnRef: "T9", resolvedBy: "QUOTE_SEARCH", turnRefMismatch: true })
    const missingRef = verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T99", quote: question }, interactions())
    expect(missingRef.ok && missingRef.evidence).toMatchObject({ turnRef: "T9", turnRefMismatch: true })
    expect(verifyEvidenceUnit({ interactionRef: "I1", turnRef: "T99", quote: "isto não existe em turno nenhum" }, interactions())).toEqual({ ok: false, reason: "WRONG_TURN" })
    // Sem turnRef (contrato antigo/replay): resolve pelo primeiro turno que bate, sem mismatch.
    const search = verifyEvidenceUnit({ interactionRef: "I1", quote: question }, interactions())
    expect(search.ok && search.evidence).toMatchObject({ turnRef: "T9", resolvedBy: "QUOTE_SEARCH", turnRefMismatch: false })
  })

  it("§21 pares: a citação é validada contra a PROJEÇÃO de privacidade; o nome real do par = REIDENTIFICATION", () => {
    const privacy = projectPeerTranscript({ sourceInteractionId: "peer-1", transcript: "Operador: Boa noite, meu nome é Denisy Feitoza.\nCliente: Oi, Denisy, preciso de ajuda.", peer: { personId: "p1", fullName: "Denisy Feitoza" } })
    expect(privacy.projected).toContain("[OPERADOR]")
    const map = new Map([["P1", { interactionRef: "P1", interactionId: "peer-1", projection: projectTranscript(privacy.projected), forbiddenTerms: privacy.forbiddenTerms }]])
    expect(verifyEvidenceUnit({ interactionRef: "P1", turnRef: "T1", quote: "meu nome é [OPERADOR]" }, map).ok).toBe(true)
    expect(verifyEvidenceUnit({ interactionRef: "P1", turnRef: "T1", quote: "meu nome é Denisy Feitoza" }, map)).toEqual({ ok: false, reason: "REIDENTIFICATION" })
    expect(verifyEvidenceUnit({ interactionRef: "P1", quote: "Denisy" }, map)).toEqual({ ok: false, reason: "REIDENTIFICATION" })
  })

  it("§22/§12 ALL: uma unidade inválida derruba o achado inteiro; ANY: sobrevive com ≥1; zero válidas nunca sobrevive", () => {
    const all = verifyFinding([{ interactionRef: "I1", turnRef: "T4", quote: "Alô, você continua aí?" }, { interactionRef: "I1", turnRef: "T5", quote: "Continuo aqui e nunca saí daqui" }], "ALL", interactions())
    expect(all).toMatchObject({ survives: false, verified: [], findingRejection: "MISSING_REQUIRED_EVIDENCE" })
    expect(all.rejected).toEqual([{ unit: expect.objectContaining({ turnRef: "T5" }), reason: "NOT_LITERAL" }])
    const any = verifyFinding([{ interactionRef: "I1", turnRef: "T4", quote: "Alô, você continua aí?" }, { interactionRef: "I1", turnRef: "T5", quote: "Continuo aqui e nunca saí daqui" }], "ANY", interactions())
    expect(any.survives).toBe(true)
    expect(any.verified).toHaveLength(1)
    expect(verifyFinding([{ interactionRef: "I1", quote: "isto não existe" }], "ANY", interactions())).toMatchObject({ survives: false, findingRejection: "MISSING_REQUIRED_EVIDENCE" })
  })

  it("§24 telemetria: candidatas × validadas × descartadas por motivo; unidades válidas de achado ALL perdido contam como MISSING_REQUIRED_EVIDENCE", () => {
    const telemetry = emptyVerificationTelemetry()
    accumulateVerification(telemetry, verifyFinding([{ interactionRef: "I1", turnRef: "T4", quote: "Alô, você continua aí?" }, { interactionRef: "I1", turnRef: "T5", quote: "Continuo aqui e nunca saí daqui" }], "ALL", interactions()), 2)
    accumulateVerification(telemetry, verifyFinding([{ interactionRef: "I1", turnRef: "T8", speaker: "OPERADOR", quote: "Meu aplicativo não funciona." }, { interactionRef: "I2", turnRef: "T3", quote: "Tem 3% de desconto" }], "ANY", interactions()), 2)
    expect(telemetry).toEqual({ candidateExcerptCount: 4, verifiedExcerptCount: 1, rejectedExcerptCount: 3, findingsBeforeVerification: 2, findingsAfterVerification: 1, rejectionReasons: { NOT_LITERAL: 1, WRONG_TURN: 0, WRONG_SPEAKER: 1, WRONG_INTERACTION: 0, REIDENTIFICATION: 0, MISSING_REQUIRED_EVIDENCE: 1 }, turnRefMismatchResolved: 0, ordinalResolvedCount: 0, ordinalResolutionRejectedCount: 0 })
    accumulateVerification(telemetry, verifyFinding([{ interactionRef: "I1", turnRef: "T2", quote: "Meu aplicativo não funciona." }], "ANY", interactions()), 1)
    expect(telemetry.turnRefMismatchResolved).toBe(1)
  })
})

describe("V1.3.4.2 — ordinal de apresentação × handle (§22–§30, §41–§43)", () => {
  // Apresentação: #1 → I4, #2 → I8, #3 → I6 (a ordem de inserção do mapa model-facing é a ordem de apresentação).
  const presented = (): Map<string, ProjectedInteraction> =>
    new Map([
      ["I4", { interactionRef: "I4", interactionId: "id-4", projection: projectTranscript(LEGACY) }],
      ["I8", { interactionRef: "I8", interactionId: "id-8", projection: projectTranscript("Operador: Bom dia, aqui é o suporte.\nCliente: Minha internet caiu.") }],
      ["I6", { interactionRef: "I6", interactionId: "id-6", projection: projectTranscript(LOT) }],
      ["I3", { interactionRef: "I3", interactionId: "id-3", projection: projectTranscript("Operador: Boa tarde.\nCliente: Quero a segunda via.") }],
    ])

  it("§24/§29 resolver determinístico: interactionOrdinal 3 → terceira interação apresentada (I6); a quote literal de I6 valida com referenceResolution PRESENTATION_ORDINAL; fora da apresentação → rejeitado", () => {
    expect(resolvePresentationOrdinal(3, presented())?.interactionRef).toBe("I6")
    expect(resolvePresentationOrdinal(1, presented())?.interactionRef).toBe("I4")
    expect(resolvePresentationOrdinal(5, presented())).toBeNull()
    expect(resolvePresentationOrdinal(0, presented())).toBeNull()
    const verdict = verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 3, turnRef: "T4", speaker: "CLIENTE", quote: "Alô, você continua aí?" }, presented())
    expect(verdict.ok && verdict.evidence).toMatchObject({ interactionRef: "I6", interactionId: "id-6", turnRef: "T4", referenceResolution: "PRESENTATION_ORDINAL" })
    expect(verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 9, quote: "Alô, você continua aí?" }, presented())).toEqual({ ok: false, reason: "WRONG_INTERACTION", ordinalRejected: true })
  })

  it("§25/§29/§42 I3 continua I3: handle explícito nunca é reinterpretado como ordinal — quote de I6 citada como I3 = WRONG_INTERACTION (mesmo com ordinal junto); handle errado continua falhando", () => {
    expect(verifyEvidenceUnit({ interactionRef: "I3", turnRef: "T4", quote: "Alô, você continua aí?" }, presented())).toEqual({ ok: false, reason: "WRONG_INTERACTION" })
    expect(verifyEvidenceUnit({ interactionRef: "I3", interactionOrdinal: 3, turnRef: "T4", quote: "Alô, você continua aí?" }, presented())).toEqual({ ok: false, reason: "WRONG_INTERACTION" })
    const own = verifyEvidenceUnit({ interactionRef: "I3", turnRef: "T2", speaker: "CLIENTE", quote: "Quero a segunda via." }, presented())
    expect(own.ok && own.evidence).toMatchObject({ interactionRef: "I3", referenceResolution: "HANDLE" })
    expect(verifyEvidenceUnit({ interactionRef: "I99", quote: "Alô, você continua aí?" }, presented())).toEqual({ ok: false, reason: "WRONG_INTERACTION" })
  })

  it("§26/§27/§30 ordinal traduz a referência, não corrige a evidência: quote não literal na interação apresentada → NOT_LITERAL (sem busca global); falante errado → WRONG_SPEAKER; ordinal não é usado quando o quote existe noutra interação", () => {
    expect(verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 1, quote: "Alô, você continua aí?" }, presented())).toEqual({ ok: false, reason: "WRONG_INTERACTION" }) // literal em I6, não em #1 (I4)
    expect(verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 3, quote: "o cliente reclamou do silêncio" }, presented())).toEqual({ ok: false, reason: "NOT_LITERAL" })
    expect(verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 3, turnRef: "T4", speaker: "OPERADOR", quote: "Alô, você continua aí?" }, presented())).toEqual({ ok: false, reason: "WRONG_SPEAKER" })
  })

  it("§28 telemetria: ordinalResolvedCount × ordinalResolutionRejectedCount contados por código", () => {
    const telemetry = emptyVerificationTelemetry()
    accumulateVerification(telemetry, verifyFinding([{ interactionRef: "", interactionOrdinal: 3, turnRef: "T4", quote: "Alô, você continua aí?" }, { interactionRef: "", interactionOrdinal: 7, quote: "x y z" }, { interactionRef: "I4", turnRef: "T3", quote: "Tem 3% de desconto" }], "ANY", presented()), 3)
    expect(telemetry).toMatchObject({ verifiedExcerptCount: 2, rejectedExcerptCount: 1, ordinalResolvedCount: 1, ordinalResolutionRejectedCount: 1, rejectionReasons: expect.objectContaining({ WRONG_INTERACTION: 1 }) })
  })

  it("§43 privacidade: ordinal de par resolve só para a projeção permitida; reidentificação continua rejeitada", () => {
    const privacy = projectPeerTranscript({ sourceInteractionId: "peer-1", transcript: "Operador: Boa noite, meu nome é Denisy Feitoza.\nCliente: Oi, Denisy, preciso de ajuda.", peer: { personId: "p1", fullName: "Denisy Feitoza" } })
    const map = new Map([["P1", { interactionRef: "P1", interactionId: "peer-1", projection: projectTranscript(privacy.projected), forbiddenTerms: privacy.forbiddenTerms }]])
    const ok = verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 1, turnRef: "T1", quote: "meu nome é [OPERADOR]" }, map)
    expect(ok.ok && ok.evidence).toMatchObject({ interactionRef: "P1", referenceResolution: "PRESENTATION_ORDINAL" })
    expect(verifyEvidenceUnit({ interactionRef: "", interactionOrdinal: 1, turnRef: "T1", quote: "meu nome é Denisy Feitoza" }, map)).toEqual({ ok: false, reason: "REIDENTIFICATION" })
  })
})
