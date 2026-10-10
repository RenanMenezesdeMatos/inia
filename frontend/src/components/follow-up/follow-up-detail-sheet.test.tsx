/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FollowUpItem } from "@/schemas/analytics/analytics.schema"

import { FollowUpDetailSheet } from "./follow-up-detail-sheet"

afterEach(cleanup)

const LONG_ANALYSIS = [
  "## Visão geral",
  "",
  "**8 colaboradores analisados**, 3 pontos de atenção, 2 evoluções.",
  "",
  "### Padrões recorrentes",
  "- Encerramento sem protocolo em 5 chamadas",
  "- Prazo de estorno informado errado (\"em 24h na conta\")",
  "",
  "| Colaborador | PRV | Situação |",
  "|---|---|---|",
  "| Mariana Alves | 83% | Q4 recorrente |",
  "| Rafael Cardoso | 87% | Em queda |",
  "",
  "> hipótese: a mudança de meta de TMA em julho pressionou o fechamento das chamadas.",
  "",
  "Referência: https://intranet.exemplo.com/procedimentos/faturamento/estorno/prazos/versao-2026-09/um-caminho-muito-longo-sem-espacos",
].join("\n")

function alertItem(overrides: Partial<FollowUpItem> = {}): FollowUpItem {
  return {
    id: "alert-1",
    kind: "ALERT",
    category: "WORKFLOW_OUTPUT",
    title: "Resumo mensal ao Supervisor",
    summary: LONG_ANALYSIS,
    detail: null,
    severity: "MEDIUM",
    operator: { personId: "op-1", name: "Mariana Alves" },
    caseId: null,
    createdAt: "2026-09-16T12:00:00.000Z",
    acknowledgedAt: null,
    feedback: null,
    ...overrides,
  }
}

describe("FollowUpDetailSheet — conteúdo integral de um item do Acompanhamento", () => {
  it("renderiza a análise inteira (título, negrito, listas, tabela, citação, link) pelo RichContent — nunca Markdown cru nem clamp", () => {
    render(<FollowUpDetailSheet item={alertItem()} categoryLabel={() => "Resultado de workflow"} onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent("Resumo mensal ao Supervisor")
    expect(dialog).toHaveTextContent("Resultado de workflow")
    expect(dialog).toHaveTextContent("Mariana Alves")
    expect(screen.getByText("8 colaboradores analisados").tagName).toBe("STRONG")
    expect(dialog.querySelectorAll("ul > li")).toHaveLength(2)
    expect(dialog.querySelector("table")).not.toBeNull()
    expect(dialog.querySelectorAll("tbody tr")).toHaveLength(2)
    expect(dialog.querySelector("blockquote")).toHaveTextContent("hipótese")
    expect(screen.getByRole("link", { name: /intranet\.exemplo\.com/ })).toHaveAttribute("target", "_blank")
    expect(dialog.textContent).not.toContain("**")
    expect(dialog.textContent).not.toContain("## ")
    // O corpo é rolável dentro do Sheet — a página não cresce nem rola horizontalmente.
    expect(dialog.querySelector(".overflow-y-auto")).not.toBeNull()
    expect(dialog.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto")
  })

  it("feedback publicado mostra as 4 partes integrais e o estado de ciência (sem confirmar no lugar do colaborador)", () => {
    const item = alertItem({
      id: "fb-1",
      kind: "FEEDBACK",
      category: "MONITORING",
      title: "MONITORIA_QUALIDADE",
      summary: "Comportamento observado curto",
      acknowledgedAt: null,
      feedback: { evidenceFound: "Operador: \"o estorno cai em 24h na conta\"", observedBehavior: "Informou prazo **divergente** do procedimento.", relatedProcedure: "Procedimento de Estorno — seção 3", recommendation: "Confirmar o prazo oficial antes de informar.\n\n- Consultar a seção 3\n- Registrar protocolo", supportMaterials: [] },
    })
    render(<FollowUpDetailSheet item={item} categoryLabel={() => "Monitoria"} onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole("dialog")
    for (const heading of ["Evidência encontrada", "Comportamento observado", "Procedimento relacionado", "Recomendação"]) expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    // Evidência é citação literal: preservada como texto, nunca interpretada como Markdown.
    expect(dialog.querySelector("blockquote")).toHaveTextContent('Operador: "o estorno cai em 24h na conta"')
    expect(screen.getByText("divergente").tagName).toBe("STRONG")
    expect(dialog.querySelectorAll("ul > li")).toHaveLength(2)
    expect(dialog).toHaveTextContent("Aguardando ciência do colaborador")
    expect(screen.queryByRole("button", { name: /Confirmar ciência/ })).toBeNull()
    // Sem materiais recomendados: nenhuma seção vazia.
    expect(screen.queryByRole("region", { name: /Materia(l|is) de apoio/ })).toBeNull()
  })

  it("feedback de atendimento: o título é o assunto e a data do atendimento aparece à parte (o mesmo cabeçalho do Acompanhamento)", () => {
    const item = alertItem({ id: "fb-2", kind: "FEEDBACK", category: "MONITORING", title: "Contas em atraso", subtitle: "Atendimento de 29/09/2026", summary: "Card", acknowledgedAt: null, feedback: { evidenceFound: "x", observedBehavior: "x", relatedProcedure: "x", recommendation: "x", supportMaterials: [] } })
    render(<FollowUpDetailSheet item={item} categoryLabel={() => "Monitoria"} onOpenChange={vi.fn()} />)
    expect(screen.getByRole("heading", { name: "Contas em atraso" })).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveTextContent("Atendimento de 29/09/2026")
  })

  it("feedback com material de apoio: o gestor vê título real, motivo e o link para a página real do material; indisponível vira aviso neutro sem título", () => {
    const item = alertItem({
      id: "fb-2",
      kind: "FEEDBACK",
      category: "MONITORING",
      title: "MONITORIA_QUALIDADE",
      summary: "Sondagem superficial",
      acknowledgedAt: "2026-09-16T10:00:00.000Z",
      feedback: {
        evidenceFound: "Cliente: quero cancelar. Operador: então vou abrir o protocolo.",
        observedBehavior: "Apresentou a solução sem aprofundar a necessidade.",
        relatedProcedure: "Técnicas de sondagem em retenção",
        recommendation: "Aprofunde a sondagem antes da oferta. Para aprofundar esse ponto, consulte o material recomendado abaixo.",
        supportMaterials: [
          { materialId: "11111111-1111-4111-8111-111111111111", available: true, title: "Técnicas de sondagem em retenção", reason: "Este material apresenta exemplos práticos de perguntas de sondagem para retenção por preço." },
          { materialId: "22222222-2222-4222-8222-222222222222", available: false },
        ],
      },
    })
    render(<FollowUpDetailSheet item={item} categoryLabel={() => "Monitoria"} onOpenChange={vi.fn()} />)
    expect(screen.getByRole("region", { name: "Materiais de apoio recomendados" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Materiais de apoio recomendados" })).toHaveTextContent("Técnicas de sondagem em retenção")
    expect(screen.getByText(/exemplos práticos de perguntas de sondagem/)).toBeInTheDocument()
    const cta = screen.getByRole("link", { name: "Acessar material: Técnicas de sondagem em retenção (abre em nova aba)" })
    expect(cta).toHaveTextContent("Acessar material")
    expect(cta).toHaveAttribute("href", "/materiais/11111111-1111-4111-8111-111111111111")
    expect(cta).toHaveAttribute("target", "_blank")
    expect(screen.getByText("Um material de apoio recomendado não está mais disponível.")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Acessar material/ })).toHaveLength(1)
  })

  it("fechado quando não há item", () => {
    render(<FollowUpDetailSheet item={null} categoryLabel={() => ""} onOpenChange={vi.fn()} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
