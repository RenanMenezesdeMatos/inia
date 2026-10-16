import { describe, expect, it } from "vitest"
import { buildDemoMass, stubIndicatorDefinitions } from "./build-demo-mass.js"
import { DEMO_INTERACTIONS_FROM, DEMO_INTERACTIONS_UNTIL, DEMO_STRUCTURE } from "./demo-constants.js"
import { CANONICAL_INTERACTION_OWNERS, IMPERFECT_FLAG_INTERACTIONS } from "./demo-identities.js"
import { interactionSubjectOf, interactionWindow, pickInteractionDays, type InteractionRow } from "./interaction-generator.js"
import { createRandom } from "./random.js"
import { DIAGNOSTIC_SUBGROUP, subteamKey, type DemoPerson } from "./structure-generator.js"
import { CANONICAL_TRANSCRIPTS } from "./transcripts/canonical-transcripts.js"
import { SCENARIO_BY_KEY } from "./transcripts/scenario-library.js"
import { LENGTH_TURN_RANGE } from "./transcripts/transcript-types.js"

const mass = buildDemoMass(stubIndicatorDefinitions())
const operators = mass.structure.people.filter((person) => person.role === "OPERATOR")
const operator = (ordinal: number) => mass.structure.byKey.get(`operator:${String(ordinal).padStart(4, "0")}`)!
/** Amostra de 1 em 10 operadores (200 × 10 = 2.000 chamadas) — suficiente pra estatística sem gerar 20 mil na suíte. */
const sample = operators.filter((_, index) => index % 10 === 0)
const sampleRows: InteractionRow[] = sample.flatMap((person) => mass.interactionsOf(person))
const RECALL_PATTERN = /já liguei|vez que eu ligo|protocolo aberto|tenho um protocolo|liguei .* e a atendente|liguei semana passada|ligo pelo mesmo motivo/i

describe("interações demo — volume, datas e formato", () => {
  it("cada operador tem exatamente 10 interações, em 10 dias úteis distintos dentro da própria janela", () => {
    for (const person of sample) {
      const rows = mass.interactionsOf(person)
      expect(rows).toHaveLength(DEMO_STRUCTURE.interactionsPerOperator)
      const days = rows.map((row) => row.startedAt.slice(0, 10))
      expect(new Set(days).size).toBe(rows.length)
      const { from, until } = interactionWindow(person)
      for (const day of days) {
        expect(day >= from && day <= until).toBe(true)
        expect(day >= person.hiredAt).toBe(true)
        const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
        expect(weekday === 0 || weekday === 6).toBe(false)
      }
      for (const row of rows) expect(new Date(row.endedAt).getTime()).toBeGreaterThan(new Date(row.startedAt).getTime())
      expect(new Set(rows.map((row) => row.externalId)).size).toBe(rows.length)
    }
    expect(pickInteractionDays(createRandom(1), DEMO_INTERACTIONS_FROM, DEMO_INTERACTIONS_UNTIL, 10)).toHaveLength(10)
  })

  it("distribui curtas/médias/longas com turnos nas faixas pedidas e uma minoria em texto sem rótulos", () => {
    const buckets: Record<string, number> = {}
    let plain = 0
    for (const row of sampleRows.filter((candidate) => !candidate.meta.canonical)) {
      buckets[row.meta.length] = (buckets[row.meta.length] ?? 0) + 1
      const range = LENGTH_TURN_RANGE[row.meta.length]
      expect(row.meta.turns).toBeGreaterThanOrEqual(range.min - 6)
      expect(row.meta.turns).toBeLessThanOrEqual(range.max + 40)
      if (row.meta.plan?.plainFormat) {
        plain += 1
        expect(row.transcript.content).not.toMatch(/^(Operador|Cliente):/m)
      } else {
        for (const line of row.transcript.content.split("\n")) expect(line).toMatch(/^(Operador|Cliente): \S/)
      }
    }
    const total = sampleRows.length
    expect(buckets.CURTA! / total).toBeGreaterThan(0.3)
    expect(buckets.MEDIA! / total).toBeGreaterThan(0.25)
    expect(buckets.LONGA! / total).toBeGreaterThan(0.08)
    expect(plain / total).toBeGreaterThan(0.005)
    expect(plain / total).toBeLessThan(0.06)
    expect(sampleRows.some((row) => row.meta.turns >= 100)).toBe(true)
  })

  it("é reproduzível: gerar de novo produz as mesmas transcrições", () => {
    const again = buildDemoMass(stubIndicatorDefinitions())
    const person = operator(42)
    expect(again.interactionsOf(person).map((row) => row.transcript.content)).toEqual(mass.interactionsOf(person).map((row) => row.transcript.content))
  })
})

describe("interações demo — flags coerentes com a transcrição", () => {
  it("entre 40% e 60% das chamadas têm ao menos uma flag; o restante não tem nenhuma", () => {
    const flagged = sampleRows.filter((row) => Object.keys(row.flags).length > 0).length / sampleRows.length
    expect(flagged).toBeGreaterThanOrEqual(0.4)
    expect(flagged).toBeLessThanOrEqual(0.6)
    expect(sampleRows.some((row) => Object.keys(row.flags).length === 0)).toBe(true)
    expect(sampleRows.some((row) => Object.keys(row.flags).length >= 2)).toBe(true)
  })

  it("cada flag só aparece quando o tema aparece literalmente na conversa", () => {
    const imperfect = new Set(IMPERFECT_FLAG_INTERACTIONS.map((item) => item.externalId))
    for (const row of sampleRows.filter((candidate) => !imperfect.has(candidate.externalId))) {
      const text = row.transcript.content
      if (row.flags.cancelamento) expect(text).toMatch(/cancel/i)
      if (row.flags.contestacao) expect(text).toMatch(/contest/i)
      if (row.flags.transferencia) expect(text).toMatch(/transfer/i)
      if (row.flags.rechamada) expect(text).toMatch(RECALL_PATTERN)
      if (row.flags.detrator) expect(text).toMatch(/Anatel|Procon|Reclame Aqui|meus direitos|Não resolveu nada|Não adianta|como isso termina|não ajudou/i)
      if (typeof row.flags.nota_ura === "number") expect(row.flags.nota_ura).toBeGreaterThanOrEqual(1)
      if (typeof row.flags.tempo_silencio === "number") expect(text).toMatch(/aguard|um momento|um instante/i)
    }
  })

  it("fixtures de flag imperfeita: FP marca rechamada sem menção; FN tem menção sem flag", () => {
    for (const fixture of IMPERFECT_FLAG_INTERACTIONS) {
      const row = mass.interactionsOf(operator(fixture.operatorOrdinal)).find((candidate) => candidate.externalId === fixture.externalId)!
      if (fixture.kind === "FALSE_POSITIVE") {
        expect(row.flags.rechamada).toBe(true)
        expect(row.transcript.content).not.toMatch(RECALL_PATTERN)
      } else {
        expect(row.flags.rechamada).toBeUndefined()
        expect(row.transcript.content).toMatch(RECALL_PATTERN)
      }
    }
  })

  it("as 10 canônicas existem, cada uma no operador documentado, com as flags e o tamanho combinados", () => {
    for (const [externalId, ordinal] of Object.entries(CANONICAL_INTERACTION_OWNERS)) {
      const canonical = CANONICAL_TRANSCRIPTS[externalId]!
      const row = mass.interactionsOf(operator(ordinal)).find((candidate) => candidate.externalId === externalId)!
      expect(row).toBeDefined()
      expect(row.flags).toEqual(canonical.flags)
      const turns = row.transcript.content.split("\n").length
      const range = LENGTH_TURN_RANGE[canonical.length]
      expect(turns).toBeGreaterThanOrEqual(range.min)
      expect(turns).toBeLessThanOrEqual(range.max + 30)
      expect(row.transcript.content).not.toContain("{{OPERADOR}}")
      for (const line of row.transcript.content.split("\n")) expect(line).toMatch(/^(Operador|Cliente): \S/)
    }
    expect(Object.keys(CANONICAL_TRANSCRIPTS)).toHaveLength(10)
  })

  it("chamadas de operadores críticos têm mais falhas operacionais do que as de alta performance", () => {
    const failureRate = (persona: DemoPerson["persona"]) => {
      const rows = sample.filter((person) => person.persona === persona).flatMap((person) => mass.interactionsOf(person)).filter((row) => row.meta.plan)
      return rows.filter((row) => row.meta.plan!.failures.length > 0).length / rows.length
    }
    expect(failureRate("CRITICO")).toBeGreaterThan(failureRate("ALTA_PERFORMANCE") + 0.25)
    expect(sampleRows.some((row) => row.meta.plan?.inconclusive)).toBe(true)
  })
})

describe("interações demo — motivo genérico × submotivo específico", () => {
  const diagnosticSubteam = subteamKey(DIAGNOSTIC_SUBGROUP.teamKey, DIAGNOSTIC_SUBGROUP.name)
  const generated = sample.flatMap((person) => mass.interactionsOf(person).filter((row) => !row.meta.canonical).map((row) => ({ person, row })))

  it("chamada gerada: motivo = o genérico do cenário principal; submotivo = a frase específica (que começa por uma frase do cenário)", () => {
    const outside = generated.filter(({ person }) => person.subteamKey !== diagnosticSubteam)
    expect(outside.length).toBeGreaterThan(1000)
    for (const { row } of outside) {
      const scenario = SCENARIO_BY_KEY.get(row.meta.plan!.scenario)!
      expect(row.reason).toBe(scenario.motive)
      expect(row.subReason).not.toBeNull()
      expect(scenario.reasons.some((phrase) => row.subReason!.startsWith(phrase)), `${row.subReason} ∉ ${scenario.key}`).toBe(true)
    }
    // Poucos motivos genéricos, muitos submotivos — o formato de uma fonte de contact center.
    expect(new Set(outside.map(({ row }) => row.reason)).size).toBeLessThanOrEqual(10)
    expect(new Set(outside.map(({ row }) => row.subReason)).size).toBeGreaterThan(40)
  })

  it("Subgrupo Diagnóstico IA (população homologada das Tools) e transcrições canônicas ficam como antes: frase específica no motivo, sem submotivo", () => {
    const diagnosticPerson = operators.find((person) => person.subteamKey === diagnosticSubteam)!
    expect(interactionSubjectOf(diagnosticPerson, { reason: "Segunda via de fatura", motive: "Fatura" })).toEqual({ reason: "Segunda via de fatura", subReason: null })
    for (const row of mass.interactionsOf(diagnosticPerson).filter((item) => !item.meta.canonical)) {
      expect(row.subReason).toBeNull()
      expect(SCENARIO_BY_KEY.get(row.meta.plan!.scenario)!.reasons.some((phrase) => row.reason.startsWith(phrase))).toBe(true)
    }
    const canonicalRows = Object.entries(CANONICAL_INTERACTION_OWNERS).flatMap(([externalId, ordinal]) => mass.interactionsOf(operator(ordinal)).filter((row) => row.externalId === externalId))
    expect(canonicalRows.length).toBe(Object.keys(CANONICAL_INTERACTION_OWNERS).length)
    for (const row of canonicalRows) expect(row).toMatchObject({ reason: CANONICAL_TRANSCRIPTS[row.externalId]!.reason, subReason: null })
  })
})
