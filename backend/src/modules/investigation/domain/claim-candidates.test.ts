import { describe, expect, it } from "vitest"
import { buildClaimCandidates, candidateAllowedPolarities, candidatePolarityOf, claimCandidateSchemaFor, renderClaimCandidates } from "./claim-candidates.js"
import { checkClaimTextAgainstCandidate, gateSynthesis, parseSynthesisFields } from "./evidence-gating.js"
import { patternSupportOf } from "./interaction-semantic-frame.js"
import type { LedgerEntry } from "./evidence-ledger.js"

const entry = (ref: string, tool: string): LedgerEntry => ({ ref, sequence: Number(ref.slice(1)), round: 1, tool, capability: "x", keyArgs: "", summary: "s", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 8, periodLabel: null, preflight: false })

type P = { handle: string; kind: string; level: string; scope?: string; cap?: string; matched: number }
const semanticFact = (patterns: P[], findings: { handle: string; ref: string; kind: string }[] = [], analyzed = 8, universe = 20): LedgerEntry => ({
  ...entry("F3", "analyze_interactions"),
  signals: {
    interactionAnalysis: {
      analyzedTranscriptCount: analyzed,
      recordedUniverseCount: universe,
      universeRelationship: "PARTIAL_COVERAGE",
      findings: patterns.length,
      verifiedExcerpts: 10,
      patterns: patterns.map((item, index) => ({ ref: `P${index + 1}`, handle: item.handle, kind: item.kind as never, supportLevel: item.level as never, ...(item.scope ? { supportScope: item.scope as never } : {}), ...(item.cap ? { maximumClaimScope: item.cap as never } : {}), matchedTranscriptCount: item.matched, analyzedTranscriptCount: analyzed })),
      findingRefs: findings.map((item) => ({ ref: item.ref, handle: item.handle, kind: item.kind as never })),
    },
  },
})

const ledger = [entry("F1", "get_indicator_snapshot"), semanticFact(
  [
    { handle: "SP1", kind: "STRENGTH", level: "RECURRENT_IN_SAMPLE", scope: "PERIOD", cap: "PERIOD_PATTERN", matched: 5 },
    { handle: "SP2", kind: "RISK", level: "REPEATED_IN_SAMPLE", scope: "SAMPLE", cap: "INTERACTION_SPECIFIC", matched: 2 },
    { handle: "SP3", kind: "INTERACTION_FRICTION", level: "REPEATED_IN_SAMPLE", scope: "SAMPLE", cap: "INTERACTION_SPECIFIC", matched: 2 },
  ],
  [{ handle: "SF1", ref: "I4/F1", kind: "STRENGTH" }],
)]
const candidates = buildClaimCandidates(ledger)
const byRef = (ref: string) => candidates.find((item) => item.ref === ref)!
const gate = (claims: unknown[]) => gateSynthesis(parseSynthesisFields({ behavioralClaims: claims }), { ledger, knowledgeAvailable: false, interactionUniverse: 20 }).map((item) => `${item.kind}:${item.reason.split(":")[0]}`)
const claim = (candidateRef: string, text: string, extra: Record<string, unknown> = {}) => ({ text, evidenceRefs: [], candidateRef, ...extra })

describe("V1.4.4 — CLAIM CANDIDATES (§2–§10): a aplicação projeta; o modelo seleciona e redige", () => {
  it("§2/§3/§5 cada pattern/finding aceito vira um candidato com polaridade e teto DERIVADOS — o modelo não escolhe nenhum dos dois", () => {
    expect(candidates.map((item) => `${item.ref}:${item.support.ref}:${item.kind}:${item.polarity}:${item.maximumClaimScope}`)).toEqual([
      "CC1:SP1:STRENGTH:POSITIVE:PERIOD_PATTERN",
      "CC2:SP2:RISK:NEGATIVE:INTERACTION_SPECIFIC",
      "CC3:SP3:INTERACTION_FRICTION:NEUTRAL:INTERACTION_SPECIFIC",
      "CC4:SF1:STRENGTH:POSITIVE:INTERACTION_SPECIFIC",
    ])
    // §3: atrito da interação nunca vira risco do operador; força nunca vira risco.
    expect(candidatePolarityOf("INTERACTION_FRICTION")).toBe("NEUTRAL")
    expect(candidatePolarityOf("STRENGTH")).toBe("POSITIVE")
    expect(candidatePolarityOf("UNRESOLVED_NEED")).toBe("NEGATIVE")
    expect(candidateAllowedPolarities("STRENGTH")).toEqual(["POSITIVE", "NEUTRAL"])
    // §23 provenance preservada: candidato → fato do ledger (e interação, quando é finding).
    expect(byRef("CC1").provenance).toEqual({ factRef: "F3", interactionRef: null })
    expect(byRef("CC4").provenance).toEqual({ factRef: "F3", interactionRef: "I4" })
    // §13 significado seguro determinístico.
    expect(byRef("CC1").safeMeaning).toContain("comportamento positivo observado")
    expect(byRef("CC1").safeMeaning).toContain("no período analisado")
    expect(byRef("CC3").safeMeaning).toContain("SEM atribuição ao colaborador")
  })

  it("§8/§10 o contexto do modelo lista os candidatos e o schema só aceita os que existem", () => {
    const block = renderClaimCandidates(candidates)
    expect(block).toContain("CC1 · suporte SP1")
    expect(block).toContain("polaridade POSITIVE · escopo máximo PERIOD_PATTERN")
    expect(block).toContain("não redecida nenhum deles")
    const schema = claimCandidateSchemaFor(candidates)
    expect(schema.safeParse({ candidateRef: "CC2", text: "x" }).success).toBe(true)
    for (const bad of ["CC9", "SP1", "F3/P1", "P1", ""]) expect(schema.safeParse({ candidateRef: bad, text: "x" }).success).toBe(false)
    expect(renderClaimCandidates([])).toContain("nenhum")
  })

  it("§34/§35 texto contra candidato: força descrita como falha e risco descrito como ponto forte são erros de REDAÇÃO (TEXT_POLARITY_MISMATCH)", () => {
    expect(gate([claim("CC1", "No período analisado você informou o protocolo com clareza")])).toEqual([])
    expect(gate([claim("CC1", "Há falha recorrente ao informar o protocolo")])).toEqual(["CLAIM_BINDING:TEXT_POLARITY_MISMATCH"])
    expect(gate([claim("CC2", "Nas interações analisadas houve interrupção da fala do cliente")])).toEqual([])
    expect(gate([claim("CC2", "É um ponto forte do seu atendimento")])).toEqual(["CLAIM_BINDING:TEXT_POLARITY_MISMATCH"])
    // §4/§6: se o modelo ainda declarar polaridade/escopo (contrato legado), a declaração é confrontada com o candidato —
    // pedir escopo maior ou polaridade incompatível é rejeitado, nunca aceito em silêncio.
    expect(gate([claim("CC2", "Nas interações analisadas houve interrupção", { scope: "EMPLOYEE_PATTERN" })])).toEqual(["CLAIM_BINDING:CLAIM_SCOPE_EXCEEDED"])
    expect(gate([claim("CC2", "Nas interações analisadas houve interrupção", { polarity: "POSITIVE" })])).toEqual(["CLAIM_BINDING:CLAIM_POLARITY_MISMATCH"])
    expect(gate([claim("CC2", "Nas interações analisadas houve interrupção", { scope: "INTERACTION_SPECIFIC", polarity: "NEGATIVE" })])).toEqual([])
  })

  it("§36 atrito da interação: o texto não pode atribuir culpa ao operador", () => {
    expect(gate([claim("CC3", "Nas interações analisadas ocorreram falas sobrepostas")])).toEqual([])
    expect(gate([claim("CC3", "O operador causou as falas sobrepostas")])).toEqual(["CLAIM_BINDING:TEXT_POLARITY_MISMATCH"])
  })

  it("§37 escopo: o texto não generaliza além do teto do candidato", () => {
    expect(gate([claim("CC1", "Nas interações analisadas no período você informou o protocolo com clareza")])).toEqual([])
    expect(gate([claim("CC1", "O colaborador costuma informar o protocolo com clareza")])).toEqual(["CLAIM_BINDING:TEXT_SCOPE_MISMATCH"])
    // §29: atributo permanente continua bloqueado em qualquer escopo.
    expect(gate([claim("CC1", "O colaborador é organizado por natureza")])).toEqual(["CLAIM_BINDING:PERMANENT_TRAIT_LANGUAGE"])
  })

  it("§19/§20/§21 temporal: o candidato carrega o que esta execução autoriza; relação fora disso é rejeitada", () => {
    // Sem comparação temporal no ledger: nenhuma relação é autorizada.
    expect(byRef("CC1").temporal.conclusion).toBe("NOT_COMPARED")
    expect(byRef("CC1").temporal.allowedRelations).toEqual(["NONE"])
    expect(byRef("CC1").temporal.safeMeaning).toContain("não foram comparados")
    expect(checkClaimTextAgainstCandidate({ text: "você passou a informar o protocolo", evidenceRefs: [], temporalRelation: "CHANGE" }, byRef("CC1"))).toContain("TEMPORAL_RELATION_NOT_AUTHORIZED")
    expect(checkClaimTextAgainstCandidate({ text: "no período analisado você informou o protocolo", evidenceRefs: [] }, byRef("CC1"))).toBeNull()
  })

  it("§26 o mesmo candidato não pode ser afirmado duas vezes; §41 deixar candidatos de fora não é erro", () => {
    expect(gate([claim("CC1", "No período analisado você informou o protocolo com clareza"), claim("CC1", "Você registrou o protocolo nas interações analisadas")])).toEqual(["CLAIM_BINDING:DUPLICATE_CANDIDATE_SELECTION"])
    // Seleção parcial (2 de 4 candidatos) passa inteira: materialidade continua decisão da síntese.
    expect(gate([claim("CC1", "No período analisado você informou o protocolo com clareza"), claim("CC2", "Nas interações analisadas houve interrupção da fala do cliente")])).toEqual([])
    expect(gate([])).toEqual([])
    // candidateRef inexistente é rejeitado com a lista do que existe (sem reparo).
    expect(gate([claim("CC9", "qualquer coisa")])).toEqual(["CLAIM_BINDING:CLAIM_CANDIDATE_UNKNOWN"])
  })

  it("§28 cobertura total: universo pequeno continua PERIOD; universo grande com amostra absoluta não é barrado só por coverage = 100 %", () => {
    // Universo pequeno lido por inteiro: fato exaustivo da janela (teto PERIOD).
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 6, recordedUniverseCount: 6, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ scope: "RECORDED_UNIVERSE", maximumClaimScope: "PERIOD_PATTERN" })
    // Universo grande lido por inteiro (amostra absolutamente suficiente, recorrente, multi-bloco): EMPLOYEE possível.
    expect(patternSupportOf({ matchedTranscriptCount: 22, analyzedTranscriptCount: 40, recordedUniverseCount: 40, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED", scope: "EMPLOYEE_PATTERN", maximumClaimScope: "EMPLOYEE_PATTERN" })
    // …mas as demais condições continuam valendo: um só bloco não é recorrência longitudinal.
    expect(patternSupportOf({ matchedTranscriptCount: 22, analyzedTranscriptCount: 40, recordedUniverseCount: 40, bucketsMatched: 1, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "RECORDED_UNIVERSE", maximumClaimScope: "PERIOD_PATTERN" })
  })
})
