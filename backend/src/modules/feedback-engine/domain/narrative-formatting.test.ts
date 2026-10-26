import { describe, expect, it } from "vitest"
import { inlineMarkdownOf, paragraphMarkdownOf, parseWriterDraft, plainInlineOf, repairInstructionsOf, usefulnessOf } from "./composition.js"
import { COMPOSITION_RESPONSE_SCHEMA, COMPOSITION_SYSTEM_PROMPT, VERIFICATION_SYSTEM_PROMPT } from "./composition-prompt.js"
import { toSpeakable } from "../../conversational-delivery/domain/surface-projection.js"
import { feedbackViewOf, isMarkdownTableBlock, officialTableMarkdownOf } from "./feedback-view.js"
import type { FeedbackBrief } from "./feedback-brief.js"

/**
 * `NARRATIVE_FORMATTING_V1` — zero IA. O texto do retorno no front com formatação que facilita a leitura (listas, negrito): o redator
 * decide (format por frase, **negrito**), o SISTEMA monta o markdown; nada além disso passa, e a voz continua sem marcas.
 */
describe("NARRATIVE_FORMATTING_V1 — listas e negrito montados pelo sistema", () => {
  it("frases seguidas com o mesmo format viram lista, separada do texto corrido; numerada só com NUMBERED", () => {
    const paragraph = paragraphMarkdownOf([
      { text: "Para a empresa que recebe as linhas, a lista é outra:" },
      { text: "comprovante do CNPJ;", format: "BULLET" },
      { text: "**termo de aceite**;", format: "BULLET" },
      { text: "formulário cadastral.", format: "BULLET" },
      { text: "Na próxima chamada, confirme primeiro qual empresa o cliente representa." },
    ])
    expect(paragraph).toBe("Para a empresa que recebe as linhas, a lista é outra:\n\n- comprovante do CNPJ;\n- **termo de aceite**;\n- formulário cadastral.\n\nNa próxima chamada, confirme primeiro qual empresa o cliente representa.")
    expect(paragraphMarkdownOf([{ text: "Primeiro, confirme a empresa.", format: "NUMBERED" }, { text: "Depois, leia a lista dela.", format: "NUMBERED" }])).toBe("1. Primeiro, confirme a empresa.\n2. Depois, leia a lista dela.")
  })

  it("lista de um item só não é lista (vira texto corrido)", () => {
    expect(paragraphMarkdownOf([{ text: "Você leu a lista da outra parte." }, { text: "Confirme a empresa antes.", format: "BULLET" }])).toBe("Você leu a lista da outra parte. Confirme a empresa antes.")
  })

  it("só **negrito** balanceado passa: título, link, código, tabela, marcador e negrito da frase inteira saem", () => {
    expect(inlineMarkdownOf("## Ajuste: veja [o manual](https://x) e `isso` | ok")).toBe("Ajuste: veja o manual e isso ok")
    expect(inlineMarkdownOf("- **Confirme** a empresa")).toBe("**Confirme** a empresa")
    expect(inlineMarkdownOf("Isto é **desbalanceado")).toBe("Isto é desbalanceado")
    expect(inlineMarkdownOf("**A frase inteira em negrito.**")).toBe("A frase inteira em negrito.")
    expect(inlineMarkdownOf("um *itálico* solto")).toBe("um itálico solto")
    // LITERAL_ASTERISK_V1: asterisco solto é conteúdo (código de serviço), nunca marca a tirar.
    expect(inlineMarkdownOf("emita pelo Portal Vagalume ou discando *7734# do celular cadastrado.")).toBe("emita pelo Portal Vagalume ou discando *7734# do celular cadastrado.")
    expect(inlineMarkdownOf("disque *144 ou *7734# e confirme **o protocolo**.")).toBe("disque *144 ou *7734# e confirme **o protocolo**.")
    expect(inlineMarkdownOf("o *passo* e o código *7734#")).toBe("o passo e o código *7734#")
    expect(plainInlineOf("Disque *7734# no **celular cadastrado**.")).toBe("Disque *7734# no celular cadastrado.")
    expect(plainInlineOf("Confirme **qual empresa** o cliente representa.")).toBe("Confirme qual empresa o cliente representa.")
  })

  it("o rascunho lê format (desconhecido = texto corrido) e o schema do redator o declara", () => {
    const parsed = parseWriterDraft(JSON.stringify({ sentences: [{ text: "a", stance: "CONTEXT", refs: [], paragraph: 1, format: "BULLET" }, { text: "b", stance: "CONTEXT", refs: [], paragraph: 1, format: "TABLE" }], card: { text: "c", refs: [] } }))
    expect(parsed.ok && parsed.draft.sentences.map((sentence) => sentence.format)).toEqual(["BULLET", undefined])
    expect(JSON.stringify(COMPOSITION_RESPONSE_SCHEMA)).toContain("\"NUMBERED\"")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("format BULLET")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("são só apresentação")
  })

  it("na voz as marcas não são pronunciadas", () => {
    expect(toSpeakable("A lista é outra:\n\n- **termo de aceite**;\n- formulário cadastral.")).not.toMatch(/[*-]{1,2}\s?\*|\*\*|^- /mu)
  })
})

describe("OFFICIAL_RESULT_TABLE_V1 — tabela do resultado oficial no texto do indicador", () => {
  const row = { indicator: "Tempo Médio de Atendimento", periodLabel: "setembro/2026", result: "452 s", target: "400 s", withinTarget: false, previousLabel: "agosto/2026", previous: "357 s" }
  it("um indicador: tabela vertical de 2 colunas, logo depois do primeiro parágrafo; a voz não a lê", () => {
    const table = officialTableMarkdownOf([row])!
    expect(table).toBe("| | Tempo Médio de Atendimento |\n|---|---|\n| Setembro/2026 (resultado oficial) | 452 s |\n| Meta | 400 s · fora da meta |\n| Agosto/2026 | 357 s |")
    expect(isMarkdownTableBlock(table)).toBe(true)
    const brief = { domain: "INDICATOR", label: "TMA", heading: { title: "TMA", subtitle: null }, context: [], officialLines: [], officialTable: [row], developments: [], strengths: [], limitations: [], materials: [], tone: "INFORMATIVE", suppressed: [], indicatorName: "TMA" } as unknown as FeedbackBrief
    const view = feedbackViewOf(brief, { card: "c", paragraphs: ["Em setembro, seu TMA foi de 452 segundos.", "Nas chamadas…"], sentences: [] })
    expect(view.narrative).toEqual(["Em setembro, seu TMA foi de 452 segundos.", table, "Nas chamadas…"])
    expect(feedbackViewOf({ ...brief, domain: "MONITORING" } as FeedbackBrief, { card: "c", paragraphs: ["a"], sentences: [] }).narrative).toEqual(["a"])
  })
  it("vários indicadores (fechamento): uma linha por indicador; barra vertical do valor nunca quebra a tabela", () => {
    const table = officialTableMarkdownOf([row, { ...row, indicator: "Nota | URA", result: "3,9 ★", target: null, withinTarget: null, previous: null, previousLabel: null }])!
    expect(table.split("\n")).toEqual([
      "| Indicador | Resultado oficial | Meta | Período anterior |",
      "|---|---|---|---|",
      "| Tempo Médio de Atendimento | 452 s (setembro/2026) | 400 s · fora da meta | 357 s (agosto/2026) |",
      "| Nota / URA | 3,9 ★ (setembro/2026) | — | — |",
    ])
    expect(officialTableMarkdownOf([])).toBeNull()
  })
})

describe("NARRATIVE_FORMATTING_V1 — a reescrita não desfaz a lista aprovada", () => {
  it("as frases aprovadas voltam ao redator com a marca de item de lista; o prompt pede lista para relação de itens da regra", () => {
    const decisions = [
      { id: "F1", text: "Para a empresa que recebe, a lista é:", stance: "CONTEXT" as const, refs: [], paragraph: 1, kept: true, finalText: "Para a empresa que recebe, a lista é:", reasons: [], verdict: null },
      { id: "F2", text: "termo de aceite;", stance: "GUIDANCE" as const, refs: ["A1"], paragraph: 1, kept: true, finalText: "termo de aceite;", reasons: [], verdict: null, format: "BULLET" as const },
      { id: "F3", text: "Frase recusada.", stance: "ADJUSTMENT" as const, refs: ["A1"], paragraph: 2, kept: false, finalText: null, reasons: ["UNSUPPORTED_ADDITION"], verdict: null },
    ]
    const brief = { domain: "MONITORING", developments: [], strengths: [], referencePractices: [] } as unknown as FeedbackBrief
    const usefulness = { primaryRef: null, primaryCovered: true, missingGuidance: [], missingRecognition: false, missingContext: false }
    const instructions = repairInstructionsOf(decisions, usefulness, brief).join("\n")
    expect(instructions).toContain("\"[item de lista] termo de aceite;\"")
    expect(instructions).toContain("o que era item de lista continua item de lista")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("escreva essa relação em lista")
  })
})

describe("LIST_CHECK_V1 e BOLD_LIMIT_V1 — as duas garantias, sem engessar o texto", () => {
  const brief = { domain: "MONITORING", developments: [], strengths: [], referencePractices: [] } as unknown as FeedbackBrief
  const verdict = { id: "F2", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null }
  it("o verificador aponta a relação de itens em texto corrido → lacuna de reescrita que pede a lista; sem apontamento, nada muda", () => {
    const kept = [{ id: "F2", stance: "GUIDANCE" as const, refs: [], verdict }]
    const flagged = usefulnessOf(brief, kept, { conveysPrimary: true, valueBeyondNarration: true, note: null, unlistedRelation: ["F2"] })
    expect(flagged.missingList).toEqual(["F2"])
    expect(usefulnessOf(brief, kept, { conveysPrimary: true, valueBeyondNarration: true, note: null }).missingList).toBeUndefined()
    const decisions = [{ id: "F2", text: "Recapitule o número, a etapa, a data e o protocolo.", stance: "GUIDANCE" as const, refs: [], paragraph: 1, kept: true, finalText: "Recapitule o número, a etapa, a data e o protocolo.", reasons: [], verdict }]
    expect(repairInstructionsOf(decisions, flagged, brief).join("\n")).toContain("escreva esses itens como lista (format BULLET")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("vazio é o normal")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("um texto corrido bem escrito, sem marca nenhuma, é um bom retorno")
  })
  it("negrito longo volta a texto; no texto corrido fica um destaque por parágrafo; itens de lista podem ter o seu", () => {
    expect(paragraphMarkdownOf([{ text: "Essa conduta precisa mudar: **não oriente o cliente a cancelar a linha na origem antes da conclusão**." }])).toBe("Essa conduta precisa mudar: não oriente o cliente a cancelar a linha na origem antes da conclusão.")
    expect(paragraphMarkdownOf([{ text: "Informe o prazo de **até 3 dias úteis**." }, { text: "O titular tem **até 1 dia útil** para responder." }])).toBe("Informe o prazo de **até 3 dias úteis**. O titular tem até 1 dia útil para responder.")
    expect(paragraphMarkdownOf([{ text: "A lista é:" }, { text: "**Termo de aceite**;", format: "BULLET" }, { text: "**Formulário cadastral**.", format: "BULLET" }])).toBe("A lista é:\n\n- **Termo de aceite**;\n- **Formulário cadastral**.")
  })
})

describe("SPOKEN_LISTS_V1 — a voz lê a lista como enumeração natural", () => {
  it("lista apresentada por \":\" vira uma frase; numerada vira primeiro/segundo/e por fim; sem abertura, frases soltas como antes", () => {
    expect(toSpeakable("Antes de finalizar, faça um resumo com os seguintes pontos:\n\n- Número a portar;\n- **Próxima etapa**;\n- Data da janela.")).toBe("Antes de finalizar, faça um resumo com os seguintes pontos: número a portar, próxima etapa e data da janela.")
    expect(toSpeakable("A lista é:\n\n- CNPJ atualizado.\n- Termo de aceite.")).toBe("A lista é: CNPJ atualizado e termo de aceite.")
    expect(toSpeakable("Faça assim:\n\n1. Confirme a empresa.\n2. Leia a lista dela.\n3. Envie o link.")).toBe("Faça assim: primeiro, confirme a empresa; segundo, leia a lista dela; e por fim, envie o link.")
    expect(toSpeakable("Sem abertura\n- Item um\n- Item dois")).toBe("Sem abertura. Item um. Item dois.")
  })
})
