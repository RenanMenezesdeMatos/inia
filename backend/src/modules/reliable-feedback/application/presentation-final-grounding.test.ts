import { describe, expect, it } from "vitest"
import { emittedItems, nodeOutputOf, type ReliableFeedbackArtifactV1 } from "../domain/reliable-feedback-artifact.js"
import { resolvePresentation } from "../domain/feedback-presentation.js"
import { deterministicNarrative } from "../domain/supervisor-narrative.js"
import { evidenceByPhase, feedbackViewOf, feedbackViewParts, headingOf } from "../domain/feedback-view.js"
import { suggestedResponseViolations, SUGGESTED_RESPONSE_VERSION, type SuggestedResponseScope } from "../domain/suggested-response.js"
import { typedNumbersIn, unsupportedTypedNumbers } from "../domain/typed-number-grounding.js"
import { replayV173, V173_FIXTURE } from "../testing/replay-v173.js"

/**
 * LAPIDAÇÃO FINAL DO FEEDBACK V2 — grounding numérico por PAPEL (o bug do "protocolo 7"), degradação só do exemplo, cabeçalho
 * estruturado, consolidação de apresentação recapitulação × protocolo e evidências por fase. Tudo sobre o golden REAL (replay
 * sem modelo dos insumos do SMOKE-V173) ou contratos puros.
 */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const LABEL = "Atendimento de 28/09/2026 · Contestação de cobrança"
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
const scope = (overrides: Partial<SuggestedResponseScope> = {}): SuggestedResponseScope => ({
  version: SUGGESTED_RESPONSE_VERSION, allowed: true, notAllowedReason: null, stepTitle: "Forneci protocolo",
  ruleTexts: ["Antes de finalizar: … - [ ] Forneci protocolo?", "7. Registrar protocolo."],
  exampleTexts: [], evidenceTexts: ["A análise leva até 7 dias úteis, e o resultado chega pra você por SMS neste mesmo número."], knowledgeRuleRefs: [], ...overrides,
})
const PROTOCOL_7 = "Antes de encerrar, anote seu número de protocolo, que é 7."

describe("§23–§30 — grounding numérico por papel semântico", () => {
  it("§29) prazo '7 dias úteis' + lista '7. Registrar protocolo' NUNCA sustentam 'seu protocolo é 7'", () => {
    expect(typedNumbersIn(PROTOCOL_7)).toEqual([{ role: "PROTOCOL", value: "7", raw: "7" }])
    expect(typedNumbersIn("A análise leva até 7 dias úteis")).toEqual([{ role: "DEADLINE", value: "7", raw: "7" }])
    expect(typedNumbersIn("7. Registrar protocolo.")).toEqual([{ role: "LIST_ORDINAL", value: "7", raw: "7" }])
    expect(suggestedResponseViolations(PROTOCOL_7, scope())).toContain("UNSUPPORTED_NUMBER")
  })

  it("§30 A–D) números de outro papel nunca viram protocolo/quantidade", () => {
    // A) R$ 14,90 não vira protocolo 1490.
    expect(unsupportedTypedNumbers("Seu protocolo é 1490.", ["Registrei a contestação dos R$ 14,90."])).toEqual([{ role: "PROTOCOL", value: "1490", raw: "1490" }])
    // B) prazo de 5 dias não vira protocolo 5.
    expect(unsupportedTypedNumbers("O seu protocolo é 5.", ["O prazo é de 5 dias úteis."])).toHaveLength(1)
    // C) item "3. Cancelar serviço" não valida a quantidade 3.
    expect(unsupportedTypedNumbers("Você cancelou 3 serviços.", ["3. Cancelar serviço."])).toHaveLength(1)
    // D) telefone do cliente não vira protocolo.
    expect(unsupportedTypedNumbers("Seu protocolo é 11987654321.", ["Meu telefone é (11) 98765-4321."])).toHaveLength(1)
  })

  it("§30 E/F) protocolo verdadeiro da chamada ou de fonte sistêmica tipada pode ser usado", () => {
    // E) o protocolo dito na chamada (em blocos) sustenta o mesmo protocolo no exemplo.
    expect(suggestedResponseViolations("Antes de encerrar: o seu protocolo é 2026 0929 1234, pode anotar?", scope({ evidenceTexts: ["Anota aí: o protocolo é 2026 0929 1234."] }))).not.toContain("UNSUPPORTED_NUMBER")
    // F) sem fala, mas com o protocolo registrado vindo de fonte estruturada (fato de SISTEMA tipado).
    expect(suggestedResponseViolations("Antes de encerrar: o seu protocolo é 202609291234, pode anotar?", scope({ systemFacts: [{ role: "PROTOCOL", value: "202609291234", raw: "202609291234" }] }))).not.toContain("UNSUPPORTED_NUMBER")
    expect(suggestedResponseViolations("Antes de encerrar: o seu protocolo é 202609291234, pode anotar?", scope())).toContain("UNSUPPORTED_NUMBER")
  })

  it("§28) protocolo do EXEMPLO da base nunca é o protocolo desta chamada", () => {
    expect(suggestedResponseViolations("Antes de encerrar: o seu protocolo é 202609130184.", scope({ exampleTexts: ["O protocolo é 202609130184."] }))).toContain("EXAMPLE_CONTENT_AS_FACT")
  })
})

describe("§31 / §47 F — degradação SÓ do exemplo (golden real)", () => {
  it("redator com exemplo 'protocolo é 7' + narrativa válida → tudo publicado MENOS o exemplo; ponto continua READY, sem QA", async () => {
    const raw = clone(V173_FIXTURE.writerRawOutput) as { items: { slot: string; suggestedResponse?: string }[] }
    raw.items = raw.items.map((entry) => (entry.slot === "ITEM_1" ? { ...entry, suggestedResponse: PROTOCOL_7 } : entry))
    const { artifact } = await replayV173({ writer: { writeMonitoring: async () => ({ rawOutput: raw }), writeNarrative: async (brief) => ({ draft: deterministicNarrative(brief), error: null, provenance: null }) } })
    const protocol = artifact.items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    expect(protocol).toMatchObject({ wordingSource: "WRITER", decision: { disposition: "READY" } })
    expect(protocol.writerFieldValidation!.find((entry) => entry.field === "suggestedResponse")).toEqual({ field: "suggestedResponse", codes: expect.arrayContaining(["UNSUPPORTED_NUMBER"]), action: "DROPPED" })
    expect(protocol.writerFieldValidation!.filter((entry) => entry.field !== "suggestedResponse").every((entry) => entry.action === "KEPT")).toBe(true)
    expect(artifact.findings).toMatchObject({ heldForQa: 0, blocked: 0 })
    const output = nodeOutputOf("rec", artifact, [])
    expect(output.text).not.toMatch(/protocolo[^.\n]*\b7\b/)
    expect(output.presentation?.narrativeResolution?.violations.narrative ?? []).toEqual([])
  })

  it("artefato GRAVADO antes da correção (exemplo 'que é 7' no texto proposto) → a emissão tira SÓ o exemplo", async () => {
    const { artifact } = await replayV173()
    const stored = clone(artifact) as ReliableFeedbackArtifactV1
    const protocol = stored.items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    protocol.proposedWording = { ...protocol.proposedWording!, suggestedResponse: PROTOCOL_7 }
    const emitted = emittedItems(stored, []).find((item) => item.index === protocol.index)!
    expect(emitted.suggestedResponse).toBeNull()
    expect(emitted.wording.suggestedResponse).toBeUndefined()
    expect(emitted.wording.observed).toBe(protocol.proposedWording.observed)
  })
})

describe("§16–§22, §47 A–E — apresentação: cabeçalho, consolidação, opcionais e evidências por fase", () => {
  const view = async () => {
    const items = emittedItems((await replayV173()).artifact, [])
    return { items, view: feedbackViewOf(items, resolvePresentation(null, items, CONTEXT), { label: LABEL })! }
  }

  it("§3/§5/§6) título = assunto real; data vira subtítulo; rótulo sem 'Atendimento de' (ex.: indicador) fica inteiro", () => {
    expect(headingOf(LABEL)).toEqual({ title: "Contestação de cobrança", subtitle: "Atendimento de 28/09/2026" })
    expect(headingOf("Atendimento de 30/09/2026 · Suporte técnico")).toEqual({ title: "Suporte técnico", subtitle: "Atendimento de 30/09/2026" })
    expect(headingOf("TMA · Fechamento setembro")).toEqual({ title: "TMA · Fechamento setembro", subtitle: null })
    expect(headingOf("Feedback de atendimento")).toEqual({ title: "Feedback de atendimento", subtitle: null })
  })

  it("A/B) recapitulação só incompleta pelo protocolo → UM bloco; itens e observações continuam separados", async () => {
    const { view: detail } = await view()
    expect(detail.developments.map((entry) => entry.title)).toEqual(["Encerramento da chamada"])
    expect(detail.developments[0]!.consolidates).toEqual(["Protocolo", "Recapitulação obrigatória"])
    const { artifact, store } = await replayV173()
    expect(artifact.items.filter((item) => item.section === "OPPORTUNITY").map((item) => item.process?.behavior?.code).sort()).toEqual(["PROVIDE_PROTOCOL", "RECAPITULATE_INTERACTION"])
    expect(store.observations.map((entry) => entry.canonicalBehavior)).toEqual(expect.arrayContaining(["PROVIDE_PROTOCOL", "RECAPITULATE_INTERACTION"]))
  })

  it("C) vários itens ausentes (não só o outro ajuste) → a recapitulação continua como item próprio", async () => {
    const { artifact } = await replayV173()
    const recap = artifact.items.find((item) => item.process?.behavior?.code === "RECAPITULATE_INTERACTION")!
    recap.process!.completeness = { ...recap.process!.completeness!, absent: ["protocolo", "prazo", "canal de retorno"] }
    const items = emittedItems(artifact, [])
    const detail = feedbackViewOf(items, resolvePresentation(null, items, CONTEXT), { label: LABEL })!
    expect(detail.developments.map((entry) => entry.title).sort()).toEqual(["Protocolo", "Recapitulação obrigatória"])
    expect(detail.developments.every((entry) => !entry.consolidates)).toBe(true)
  })

  it("D/E) 'Por que importa' e exemplo são opcionais: vazios não geram rótulo nem espaço", async () => {
    const { items, view: detail } = await view()
    const bare = { ...detail, developments: detail.developments.map((entry) => ({ ...entry, whyItMatters: [], suggestedResponse: null })) }
    const markdown = feedbackViewParts(bare, items).map((part) => part.markdown).join("\n\n")
    expect(markdown).not.toContain("Por que importa")
    expect(markdown).not.toContain("Exemplo de condução")
    // Estrutura enxuta: nada de "O que precisa ser ajustado" dentro do próprio ajuste.
    const block = markdown.split("### Encerramento da chamada")[1]!.split("\n## ")[0]!
    expect(block).not.toContain("**O que precisa ser ajustado**")
    expect(block).toContain("**Como melhorar:**")
  })

  it("§21) 'Ver evidências' agrupado por fase (cada comportamento continua individual, com a fala)", async () => {
    const { view: detail } = await view()
    const groups = evidenceByPhase(detail.maintain!.evidence)
    expect(groups.map((group) => group.label)).toEqual(["Investigação", "Tratativa", "Encerramento"])
    expect(groups.flatMap((group) => group.entries)).toHaveLength(detail.maintain!.evidence.length)
    expect(groups[0]!.entries.every((entry) => entry.quotes.length > 0)).toBe(true)
  })
})
