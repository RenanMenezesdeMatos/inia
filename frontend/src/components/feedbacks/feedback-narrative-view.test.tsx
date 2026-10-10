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

  it("E/F) 'Entenda este feedback' tem só 'O que precisa ser ajustado' e 'O que manter'; Materiais utilizados ficam FORA, sempre visíveis", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    // Sem abrir nada: a seção de materiais já está na tela, com as seções do documento e o link.
    const materials = screen.getByRole("region", { name: "Materiais utilizados" })
    expect(within(materials).getByText("Procedimento Operacional — Contestação de Contas Móvel")).toBeInTheDocument()
    expect(within(materials).getByText("Recapitulação obrigatória · Checklist do operador · Serviços digitais não reconhecidos")).toBeInTheDocument()
    expect(within(materials).getByRole("link", { name: /Abrir material: Procedimento Operacional/ })).toHaveAttribute("href", "/materiais/c8f2c818-72db-48dc-8d7d-d8a9fe861c65")
    openDetails()
    const triggers = screen.getAllByRole("button").filter((button) => button.getAttribute("data-slot") === "accordion-trigger").map((button) => button.textContent)
    expect(triggers).toEqual(["O que precisa ser ajustado", "O que manter"])
    expect(screen.queryByRole("button", { name: "Materiais utilizados" })).not.toBeInTheDocument()
  })

  it("G) material sem acesso: estado claro e nenhum link quebrado", () => {
    const closed = clone()
    closed.materials = closed.materials.map((material) => ({ ...material, href: null, accessible: false }))
    closed.developments = closed.developments.map((detail) => ({ ...detail, sources: detail.sources.map((source) => ({ ...source, href: null, accessible: false })) }))
    render(<FeedbackNarrativeView view={closed} />)
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

  it("E) 'Entenda este feedback' e 'Materiais utilizados' são componentes IRMÃOS: mesma caixa, mesmo cabeçalho (ícone, título, dica)", () => {
    const { container } = render(<FeedbackNarrativeView view={LARISSA} />)
    const panels = [...container.querySelectorAll('[data-slot="feedback-panel"]')]
    expect(panels).toHaveLength(2)
    // Mesma base visual (largura, borda, raio, fundo); o de detalhes só acrescenta o grupo do estado aberto/fechado.
    const base = (panel: Element) => panel.className.split(" ").filter((token) => !token.startsWith("group/")).join(" ")
    expect(base(panels[0]!)).toBe(base(panels[1]!))
    const headingOf = (panel: Element) => panel.querySelector("h4")!
    expect(headingOf(panels[0]!).textContent).toMatch(/^Entenda este feedback/)
    expect(headingOf(panels[1]!).textContent).toBe("Materiais utilizados")
    // Mesmo título (tamanho/peso) e mesmo ícone de cabeçalho.
    const titleClass = (panel: Element) => [...panel.querySelectorAll("span, h4")].find((node) => /^(Entenda este feedback|Materiais utilizados)$/.test(node.textContent ?? ""))!.className
    expect(titleClass(panels[0]!)).toBe(titleClass(panels[1]!))
    expect(panels[0]!.querySelector('[aria-hidden] svg')?.parentElement?.className).toBe(panels[1]!.querySelector('[aria-hidden] svg')?.parentElement?.className)
  })

  it("I) títulos semânticos: blocos h4, seções h5, cada ajuste h6 — nenhum h1/h2/h3 dentro do feedback (o item já é o h3)", () => {
    render(<FeedbackNarrativeView view={LARISSA} />)
    openDetails()
    openSection(/^O que precisa ser ajustado$/)
    const article = screen.getByRole("article", { name: "Feedback" })
    const levels = within(article).getAllByRole("heading").map((heading) => [heading.tagName, heading.textContent?.replace(/A fala.*$/, "")])
    expect(levels).toEqual([["H4", "Entenda este feedback"], ["H5", "O que precisa ser ajustado"], ["H6", "Encerramento da chamada"], ["H5", "O que manter"], ["H4", "Materiais utilizados"]])
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
