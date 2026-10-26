/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { feedbackViewSchema, type FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"
import larissa from "./__fixtures__/larissa-feedback-view.json"
import { FeedbackNarrativeView } from "./feedback-narrative-view"

afterEach(cleanup)

/** View model REAL do golden SMOKE-V173 (Larissa), gerado pelo backend (feedbackViewOf) — o contrato é o schema. */
const LARISSA = feedbackViewSchema.parse(larissa)
const clone = (): FeedbackView => JSON.parse(JSON.stringify(LARISSA)) as FeedbackView
const TECHNICAL = /READY|HOLD_FOR_QA|BLOCKED|VERIFIED|NEEDS_REVIEW|checkpoint|CP-|BEHAVIOR|RECAPITULATE|PROVIDE_PROTOCOL|analyticsStatus|sourceLineage|Ponto forte|Ponto de desenvolvimento/

const openDetails = () => fireEvent.click(screen.getByRole("button", { name: /Entenda este feedback/ }))
const openSection = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const openMaterials = () => fireEvent.click(screen.getByRole("button", { name: /^Materiais utilizados/ }))

describe("Feedback por Flag V2 — narrativa + detalhes (UI)", () => {
  it("a narrativa é a estrela: aparece inteira; os detalhes começam FECHADOS (progressive disclosure)", () => {
    const { container } = render(<FeedbackNarrativeView view={LARISSA} />)
    expect(screen.getByText(/^Larissa, você conduziu bem a investigação do caso e a tratativa/)).toBeInTheDocument()
    expect(screen.getByText("O principal ajuste está no encerramento: o protocolo não foi informado ao cliente, nem mesmo na recapitulação.")).toBeInTheDocument()
    // Rótulo de checklist nunca vira orientação na narrativa (conta ajustada/valor a pagar não se aplicavam).
    expect(container.textContent).not.toMatch(/conta ajustada|valor a pagar/i)
    const trigger = screen.getByRole("button", { name: /Entenda este feedback/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("O que precisa ser ajustado")).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(TECHNICAL)
  })

  it("abrir, navegar pelas seções e fechar (aria-expanded/aria-controls do Radix; teclado)", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    const trigger = screen.getByRole("button", { name: /Entenda este feedback/ })
    trigger.focus()
    expect(trigger).toHaveFocus()
    openDetails()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(trigger).toHaveAttribute("aria-controls")
    const adjust = screen.getByRole("button", { name: "O que precisa ser ajustado" })
    expect(adjust).toHaveAttribute("aria-expanded", "false")
    openSection(/^O que precisa ser ajustado$/)
    expect(adjust).toHaveAttribute("aria-expanded", "true")
    // Recapitulação incompleta SÓ pelo protocolo + protocolo não informado → um bloco (apresentação), com o assunto.
    expect(screen.getByRole("button", { name: "Encerramento da chamada" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Recapitulação obrigatória" })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  it("detalhe de um ajuste (§11/§12): o que aconteceu → na chamada → o processo orienta → como melhorar; nada de 'O que precisa ser ajustado' dentro dele", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    openSection(/^Encerramento da chamada$/)
    const region = screen.getByRole("region", { name: "Encerramento da chamada" })
    expect(within(region).getByText("Reúne: Protocolo · Recapitulação obrigatória")).toBeInTheDocument()
    expect(within(region).getByText("O protocolo não foi informado ao cliente e, por isso, também ficou de fora da recapitulação final.")).toBeInTheDocument()
    const labels = within(region).getAllByText(/^(O que aconteceu|Na chamada|O processo orienta|Por que importa|Como melhorar|O que precisa ser ajustado|Como aplicar)$/).map((node) => node.textContent)
    expect(labels).toEqual(["O que aconteceu", "Na chamada", "O processo orienta", "Por que importa", "Como melhorar"])
    // Ausência: a conclusão da chamada inteira primeiro; o momento em que caberia é a própria recapitulação.
    const statement = within(region).getByText("Não foi identificado o número do protocolo sendo informado ao cliente durante esta chamada.")
    const context = within(region).getByText("Momento em que caberia:")
    expect(statement.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(region).getByText(/^Recapitulando, Tiago: cancelei a renovação do Música Plus/)).toBeInTheDocument()
    expect(within(region).getByText(/Forneci protocolo\?/)).toBeInTheDocument()
    expect(within(region).getByText(/Antes de encerrar, informar:/)).toBeInTheDocument()
    const link = within(region).getAllByRole("link", { name: /Abrir processo: Procedimento Operacional — Contestação de Contas Móvel \(abre em nova aba\)/ })[0]!
    expect(link).toHaveAttribute("href", "/materiais/c8f2c818-72db-48dc-8d7d-d8a9fe861c65")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(within(region).getByText(/Inclua também o número do protocolo na recapitulação final\.$/)).toBeInTheDocument()
    // Exemplo OFICIAL da base só rotulado como exemplo do procedimento; nenhum exemplo gerado com dado inventado.
    expect(within(region).getAllByText("Exemplo do procedimento").length).toBeGreaterThan(0)
    expect(within(region).queryByText(/Sugestão de como dizer/)).not.toBeInTheDocument()
    expect(region.textContent).not.toMatch(/que é 7|protocolo é 7/)
  })

  it("o que manter: resumo natural; evidências só sob demanda (falas reais)", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    openDetails()
    openSection(/^O que manter$/)
    expect(screen.getByText(/^Na investigação do caso, você validou o titular da linha/)).toBeInTheDocument()
    expect(screen.queryByText("Entendi. E essa fatura de setembro, você já pagou?")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Ver evidências/ }))
    expect(screen.getByText("Entendi. E essa fatura de setembro, você já pagou?")).toBeInTheDocument()
  })

  it("E/F) cards lado a lado: 'Entenda este feedback' tem só 'O que precisa ser ajustado' e 'O que manter'; Materiais utilizados é outro card; um aberto por vez", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    // Fechado por padrão: o card abre a lista embaixo, com as seções do documento e o link.
    const toggle = screen.getByRole("button", { name: /^Materiais utilizados/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("region", { name: "Materiais utilizados" })).not.toBeInTheDocument()
    openMaterials()
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const materials = screen.getByRole("region", { name: "Materiais utilizados" })
    expect(within(materials).getByText("Procedimento Operacional — Contestação de Contas Móvel")).toBeInTheDocument()
    expect(within(materials).getByText("Recapitulação obrigatória · Checklist do operador · Serviços digitais não reconhecidos")).toBeInTheDocument()
    expect(within(materials).getByRole("link", { name: /Abrir material: Procedimento Operacional/ })).toHaveAttribute("href", "/materiais/c8f2c818-72db-48dc-8d7d-d8a9fe861c65")
    // Abrir outro card fecha o anterior.
    openDetails()
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("region", { name: "Materiais utilizados" })).not.toBeInTheDocument()
    const triggers = screen.getAllByRole("button").filter((button) => button.getAttribute("data-slot") === "accordion-trigger").map((button) => button.textContent)
    expect(triggers).toEqual(["O que precisa ser ajustado", "O que manter"])
    // Clicar de novo no card aberto fecha.
    openDetails()
    expect(screen.queryByRole("region", { name: "Entenda este feedback" })).not.toBeInTheDocument()
  })

  it("G) material sem acesso: estado claro e nenhum link quebrado", () => {
    const closed = clone()
    closed.materials = closed.materials.map((material) => ({ ...material, href: null, accessible: false }))
    closed.developments = closed.developments.map((detail) => ({ ...detail, sources: detail.sources.map((source) => ({ ...source, href: null, accessible: false })) }))
    render(<FeedbackNarrativeView view={closed} />)
    openMaterials()
    expect(within(screen.getByRole("region", { name: "Materiais utilizados" })).getByText("Material indisponível para este perfil")).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("zero ajustes → sem 'O que precisa ser ajustado'; muitos ajustes → todos listados, um por accordion", () => {
    const none = clone()
    none.developments = []
    const { unmount } = render(<FeedbackNarrativeView view={none} />)
    openDetails()
    expect(screen.queryByRole("button", { name: "O que precisa ser ajustado" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "O que manter" })).toBeInTheDocument()
    unmount()
    const many = clone()
    const base = LARISSA.developments[0]!
    many.developments = ["Validação do titular", "Verificação do pagamento", "Prazo da análise", "Protocolo", "Recapitulação obrigatória"].map((title, index) => ({ ...base, key: `k${index}`, title }))
    render(<FeedbackNarrativeView view={many} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    for (const title of ["Validação do titular", "Verificação do pagamento", "Prazo da análise", "Protocolo", "Recapitulação obrigatória"]) expect(screen.getByRole("button", { name: title })).toBeInTheDocument()
  })

  it("PRODUCT_IN_FEEDBACK_V1: o ponto, a fala, a regra (\"Vale para\") e a fala do argumentário mostram de que produto são", () => {
    const withProduct = clone()
    const detail = withProduct.developments[0]!
    detail.product = "IP Dedicado"
    detail.suggestedResponseProduct = "IP Dedicado"
    detail.guidance.rules = [{ ...detail.guidance.rules[0]!, appliesTo: ["IP Dedicado"] }]
    if (detail.call.kind === "QUOTES") detail.call.quotes = detail.call.quotes.map((quote) => ({ ...quote, product: "IP Dedicado" }))
    if (detail.call.kind === "ABSENCE" && detail.call.context) detail.call.context = { ...detail.call.context, product: "IP Dedicado" }
    render(<FeedbackNarrativeView view={withProduct} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    openSection(/^Encerramento da chamada$/)
    const region = screen.getByRole("region", { name: "Encerramento da chamada" })
    expect(within(region).getByText("Pedido de", { exact: false })).toBeInTheDocument()
    expect(within(region).getByText("Vale para IP Dedicado")).toBeInTheDocument()
    expect(within(region).getAllByText("IP Dedicado").length).toBeGreaterThan(0)
    // Feedback antigo (sem produto) não mostra selo nenhum.
    const { container } = render(<FeedbackNarrativeView view={clone()} />)
    expect(container.querySelector('[data-slot="product-tag"]')).toBeNull()
  })

  it("citação e regra longas quebram linha (nada de overflow horizontal)", () => {
    const long = clone()
    long.developments[0]!.guidance.rules = [{ text: `Antes de encerrar, informar: ${"item-muito-longo-sem-espaco".repeat(20)}`, section: null }]
    render(<FeedbackNarrativeView view={long} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    openSection(/^Encerramento da chamada$/)
    const rule = screen.getByText(/item-muito-longo-sem-espaco/)
    expect(rule.className).toMatch(/break-words/)
  })

  it("E) os blocos de apoio são cards IRMÃOS: mesmo card, mesmo ícone e título, e uma linha curta do que cada um traz", () => {
    const { container } = render(<FeedbackNarrativeView view={LARISSA} />)
    const tiles = [...container.querySelectorAll('[data-slot="feedback-tile"]')]
    expect(tiles).toHaveLength(2)
    expect(tiles[0]!.className).toBe(tiles[1]!.className)
    const titleOf = (tile: Element) => tile.querySelector('[data-slot="feedback-tile-title"]')!
    expect(titleOf(tiles[0]!).textContent).toBe("Entenda este feedback")
    expect(titleOf(tiles[1]!).textContent).toBe("Materiais utilizados")
    expect(titleOf(tiles[0]!).className).toBe(titleOf(tiles[1]!).className)
    expect(tiles[0]!.querySelector('[aria-hidden] svg')?.parentElement?.className).toBe(tiles[1]!.querySelector('[aria-hidden] svg')?.parentElement?.className)
    expect(tiles[0]!.textContent).toMatch(/\d+ pontos? para ajustar · o que manter$/)
    expect(tiles[1]!.textContent).toMatch(/\d+ documentos?$/)
  })

  it("I) títulos semânticos: blocos h4, seções h5, cada ajuste h6 — nenhum h1/h2/h3 dentro do feedback (o item já é o h3)", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    const article = screen.getByRole("article", { name: "Feedback" })
    const levels = within(article).getAllByRole("heading").map((heading) => [heading.tagName, heading.querySelector('[data-slot="feedback-tile-title"]')?.textContent ?? heading.textContent])
    expect(levels).toEqual([["H4", "Entenda este feedback"], ["H4", "Materiais utilizados"], ["H5", "O que precisa ser ajustado"], ["H6", "Encerramento da chamada"], ["H5", "O que manter"]])
  })

  it("§21) 'Ver evidências' agrupado por fase (Investigação → Tratativa → Encerramento), cada ponto com a fala", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    openDetails()
    openSection(/^O que manter$/)
    fireEvent.click(screen.getByRole("button", { name: /Ver evidências/ }))
    const phases = screen.getAllByText(/^(Investigação|Tratativa|Encerramento)$/).map((node) => node.textContent)
    expect(phases).toEqual(["Investigação", "Tratativa", "Encerramento"])
    expect(screen.getByText("Entendi. E essa fatura de setembro, você já pagou?")).toBeInTheDocument()
  })

  it("§13/§14) 'Por que importa' e exemplo são opcionais: sem conteúdo, nem rótulo nem espaço", () => {
    const bare = clone()
    bare.developments = bare.developments.map((detail) => ({ ...detail, whyItMatters: [], suggestedResponse: null, guidance: { ...detail.guidance, examples: [] } }))
    render(<FeedbackNarrativeView view={bare} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    openSection(/^Encerramento da chamada$/)
    const region = screen.getByRole("region", { name: "Encerramento da chamada" })
    expect(within(region).queryByText("Por que importa")).not.toBeInTheDocument()
    expect(within(region).queryByText(/Exemplo do procedimento|Sugestão de como dizer/)).not.toBeInTheDocument()
  })

  it("ARGUMENT_REQUIREMENT_V1) regra de argumentário mostra se é obrigatória ou opcional; reconhecimento de item 'pode' é opcional", () => {
    const view = clone()
    view.developments = view.developments.map((detail, index) => (index === 0 ? { ...detail, guidance: { ...detail.guidance, rules: [
      { text: "Oferecer primeiro a migração para o plano de menor valor.", section: "Argumentário: Retenção", label: "Argumentário “Retenção”", requirement: "REQUIRED" as const },
      { text: "Mencionar o bônus de fidelidade.", section: "Argumentário: Retenção", label: "Argumentário “Retenção”", requirement: "OPTIONAL" as const },
      { text: "Apresentar a oferta antes do cancelamento.", section: "Oferta", label: "Seção “Oferta”" },
    ] } } : detail))
    view.maintain = { ...view.maintain!, evidence: view.maintain!.evidence.map((entry, index) => (index === 0 ? { ...entry, optional: true } : entry)) }
    expect(feedbackViewSchema.parse(view).developments[0]!.guidance.rules.map((rule) => rule.requirement)).toEqual(["REQUIRED", "OPTIONAL", undefined])
    render(<FeedbackNarrativeView view={view} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    openSection(/^Encerramento da chamada$/)
    const region = screen.getByRole("region", { name: "Encerramento da chamada" })
    const ruleOf = (text: string) => within(region).getByText(text).closest("blockquote")!
    expect(within(ruleOf("Oferecer primeiro a migração para o plano de menor valor.")).getByText("Obrigatório")).toBeInTheDocument()
    expect(within(ruleOf("Mencionar o bônus de fidelidade.")).getByText("Opcional")).toBeInTheDocument()
    expect(within(ruleOf("Apresentar a oferta antes do cancelamento.")).queryByText(/Obrigatório|Opcional/)).not.toBeInTheDocument()
    openSection(/^O que manter$/)
    fireEvent.click(screen.getByRole("button", { name: /Ver evidências/ }))
    const first = screen.getByText(view.maintain!.evidence[0]!.title).closest("li")!
    expect(within(first).getByText("Opcional")).toBeInTheDocument()
    expect(screen.getAllByText("Opcional")).toHaveLength(2)
  })

  it("INDICATOR_SUBJECTS_V1) indicador: 'Seus assuntos no período' com duração, variação, motivo de não comparar e analisadas — em lista", () => {
    const view: FeedbackView = {
      ...clone(),
      kind: "INDICATOR",
      subjects: {
        title: "Seus assuntos no período",
        note: "Duração média registrada das suas chamadas gravadas em cada assunto — aproximação pela duração registrada das chamadas, não o valor oficial do indicador. Um assunto só é comparado quando tem chamadas suficientes nos dois períodos.",
        periods: { previous: "01/08 a 31/08", current: "01/09 a 30/09" },
        rows: [
          { label: "Contestação de cobrança", previous: "8 min 54 s · 10 chamadas", current: "10 min 29 s · 11 chamadas", change: "+1 min 35 s (+17,8%)", trend: "WORSE", reading: "Piorou", focus: true, analyzed: "4 de 11 chamadas" },
          { label: "Internet móvel sem conexão", previous: null, current: "10 min 50 s · 2 chamadas", change: null, trend: "NOT_COMPARED", reading: "Sem chamadas em 01/08 a 31/08", focus: false, analyzed: null },
        ],
        hidden: 3,
      },
    }
    expect(feedbackViewSchema.parse(view).subjects?.rows).toHaveLength(2)
    render(<FeedbackNarrativeView view={view} />)
    openDetails()
    openSection(/Seus assuntos no período/)
    const list = screen.getByRole("list", { name: "Assuntos" })
    const contestacao = within(list).getByText("Contestação de cobrança").closest("li")!
    expect(within(contestacao).getByText("Piorou")).toBeInTheDocument()
    expect(within(contestacao).getByText("+1 min 35 s (+17,8%)")).toBeInTheDocument()
    expect(within(contestacao).getByText("4 de 11 chamadas")).toBeInTheDocument()
    expect(within(contestacao).getByText("Assunto investigado nas chamadas")).toBeInTheDocument()
    const internet = within(list).getByText("Internet móvel sem conexão").closest("li")!
    expect(within(internet).getByText("Sem chamadas em 01/08 a 31/08")).toBeInTheDocument()
    expect(within(internet).queryByText("Variação")).not.toBeInTheDocument()
    expect(screen.getByText("E mais 3 assuntos com menos chamadas.")).toBeInTheDocument()
    expect(screen.getByText(/não o valor oficial do indicador/)).toBeInTheDocument()
  })
})

describe("Base de boas práticas no feedback (BEST_PRACTICE_FEEDBACK_V1)", () => {
  const PRACTICES = {
    title: "Oportunidades inspiradas em boas práticas",
    note: "Não é cumprimento de processo: são comportamentos opcionais observados com mais frequência entre operadores com melhores resultados, em chamadas comparáveis. É associação, não garantia de resultado.",
    items: [{ patternId: "p-1", name: "Retomar resumindo o que foi verificado", indicatorName: "TMA", context: "Fatura", association: "Nas chamadas comparáveis de Fatura analisadas (01/09/2026 a 30/09/2026), o comportamento apareceu em 89% … e em 6% no grupo de referência.", strength: "Moderada", you: "Nas suas chamadas analisadas, o comportamento apareceu em 1 de 4 em que a situação existiu.", howTo: "Ao voltar de uma verificação, diga o que conferiu e o que vai fazer agora.", suggestedPhrasing: "Conferi a sua fatura e encontrei o motivo da diferença.", notApplicableWhen: null }],
  }

  it("bloco PRÓPRIO, fechado e separado de 'Entenda este feedback'; a fala sugerida é marcada como exemplo", () => {
    const view = feedbackViewSchema.parse({ ...clone(), bestPractices: PRACTICES })
    render(<FeedbackNarrativeView view={view} />)
    const trigger = screen.getByRole("button", { name: /Oportunidades inspiradas em boas práticas/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(trigger)
    // Cartão da prática: o que é e a força, como fazer, o que dá para dizer (exemplo) e o que as chamadas da pessoa mostram.
    expect(screen.getByRole("heading", { level: 5, name: "Retomar resumindo o que foi verificado" })).toBeInTheDocument()
    expect(screen.getByText("Evidência moderada")).toBeInTheDocument()
    expect(screen.getByText("Como fazer")).toBeInTheDocument()
    expect(screen.getByText("Você pode dizer")).toBeInTheDocument()
    expect(screen.getByText("“Conferi a sua fatura e encontrei o motivo da diferença.”")).toBeInTheDocument()
    expect(screen.getByText("Exemplo para experimentar — não é fala de uma chamada.")).toBeInTheDocument()
    expect(screen.getByText(/o comportamento apareceu em 1 de 4 em que a situação existiu/)).toBeInTheDocument()
    // Os números ficam em "Por que esta sugestão", sob demanda.
    expect(screen.queryByText(/Nas chamadas comparáveis de Fatura/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Por que esta sugestão/ }))
    expect(screen.getByText(/Nas chamadas comparáveis de Fatura/)).toBeInTheDocument()
    // O processo continua nos detalhes do feedback; as boas práticas não entram lá (abrir os detalhes fecha o card das práticas).
    openDetails()
    expect(screen.queryByText("Retomar resumindo o que foi verificado")).not.toBeInTheDocument()
  })

  it("execução diferenciada: o como fazer sem o detalhe técnico, e o que vai além da etapa obrigatória à parte", () => {
    const item = { ...PRACTICES.items[0], howTo: "Pergunte se ficou claro. (O diferencial é o que vai além da etapa obrigatória: oferecer explicar de outro jeito.)", guidance: "Pergunte se ficou claro.", differential: "oferecer explicar de outro jeito.", youKind: "NOT_ANALYZED", you: "Suas chamadas não estavam nesta análise: não há evidência sobre como você faz isso hoje." }
    render(<FeedbackNarrativeView view={feedbackViewSchema.parse({ ...clone(), bestPractices: { ...PRACTICES, items: [item] } })} />)
    fireEvent.click(screen.getByRole("button", { name: /Oportunidades inspiradas em boas práticas/ }))
    expect(screen.getByText("Pergunte se ficou claro.")).toBeInTheDocument()
    // O detalhe técnico ("vai além da etapa obrigatória") não fica no cartão: só em "Por que esta sugestão".
    expect(screen.queryByText(/Vai além da etapa obrigatória/)).not.toBeInTheDocument()
    expect(screen.queryByText(/O diferencial é/)).not.toBeInTheDocument()
    // Sem chamadas dela na análise: nada de "Nas suas chamadas" no cartão; o aviso fica em "Por que esta sugestão".
    expect(screen.queryByText("Nas suas chamadas:")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Por que esta sugestão/ }))
    expect(screen.getByText("Vai além da etapa obrigatória: oferecer explicar de outro jeito.")).toBeInTheDocument()
    expect(screen.getByText(/Suas chamadas não estavam nesta análise/)).toBeInTheDocument()
  })

  it("a origem da prática e a nota da seção ficam na view, mas não no bloco", () => {
    const source = { text: "Dos operadores com melhor TMA do seu subgrupo (Célula A), em chamadas de Segunda via." }
    const view = feedbackViewSchema.parse({ ...clone(), bestPractices: { ...PRACTICES, items: [{ ...PRACTICES.items[0], source }] } })
    render(<FeedbackNarrativeView view={view} />)
    fireEvent.click(screen.getByRole("button", { name: /Oportunidades inspiradas em boas práticas/ }))
    fireEvent.click(screen.getByRole("button", { name: /Por que esta sugestão/ }))
    expect(screen.queryByText(source.text)).not.toBeInTheDocument()
    expect(screen.queryByText(/Não é cumprimento de processo/)).not.toBeInTheDocument()
    expect(screen.getByText(/São opcionais — não são regras do processo/)).toBeInTheDocument()
  })

  it("BEST_PRACTICE_SELECTION_V2: a prática vista só num produto mostra 'Vale para'; a geral, nada", () => {
    const view = feedbackViewSchema.parse({ ...clone(), bestPractices: { ...PRACTICES, items: [{ ...PRACTICES.items[0], product: "Banda Larga" }, { ...PRACTICES.items[0], patternId: "p-geral", name: "Prática geral" }] } })
    render(<FeedbackNarrativeView view={view} />)
    fireEvent.click(screen.getByRole("button", { name: /Oportunidades inspiradas em boas práticas/ }))
    expect(screen.getAllByText("Vale para Banda Larga")).toHaveLength(1)
  })

  it("BEST_PRACTICE_HOW_IT_HELPS_V1: o cartão mostra como a prática ajuda no indicador, quando aprovado na revisão", () => {
    const howItHelps = "O cliente não precisa anotar o protocolo na linha, e esse tempo sai da chamada."
    const view = feedbackViewSchema.parse({ ...clone(), bestPractices: { ...PRACTICES, items: [{ ...PRACTICES.items[0], howItHelps }, { ...PRACTICES.items[0], patternId: "p-sem", name: "Sem texto" }] } })
    render(<FeedbackNarrativeView view={view} />)
    fireEvent.click(screen.getByRole("button", { name: /Oportunidades inspiradas em boas práticas/ }))
    const shown = document.querySelectorAll('[data-slot="practice-how-it-helps"]')
    expect(shown).toHaveLength(1)
    expect(shown[0]!.textContent).toBe(`Como ajuda em ${PRACTICES.items[0]!.indicatorName}: ${howItHelps}`)
  })

  it("sem boas práticas (feedback antigo ou nenhum padrão disponível) não há bloco", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    expect(screen.queryByRole("button", { name: /Oportunidades inspiradas em boas práticas/ })).not.toBeInTheDocument()
  })
})
