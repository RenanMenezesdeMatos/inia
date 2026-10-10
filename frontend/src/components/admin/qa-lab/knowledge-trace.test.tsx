/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeTracePanel } from "./knowledge-trace"
import type { QaKnowledgeTrace } from "@/schemas/admin/qa-lab.schema"

afterEach(cleanup)

const BUDGET = { maxChunks: 8, maxTotalChars: 9000, minRelativeScore: 0.2 }

describe("QA Lab — painel de bases de conhecimento por request", () => {
  it("RETRIEVAL: mostra autorizadas × consultadas, trechos e a economia versus injetar tudo", () => {
    const trace: QaKnowledgeTrace = {
      mode: "RETRIEVAL",
      authorizedDocuments: [
        { id: "a", title: "Procedimento Operacional Segunda Via de Conta", chars: 6816 },
        { id: "b", title: "Procedimento Operacional Negociação de Débito", chars: 9044 },
      ],
      retrieved: [{ documentId: "a", documentTitle: "Procedimento Operacional Segunda Via de Conta", heading: "2 Regra geral", excerpt: "A segunda via deve ser baixada pelo cliente.", score: 34.98 }],
      injectedChars: 1200,
      estimatedTokens: 343,
      authorizedChars: 15860,
      budget: BUDGET,
    }
    render(<KnowledgeTracePanel trace={trace} />)
    expect(screen.getByText("Retrieval — só os trechos pertinentes entraram")).toBeInTheDocument()
    expect(screen.getByText(/1\.200 caracteres · ≈343 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/15\.860 caracteres \(−14\.660\)/)).toBeInTheDocument()
    expect(screen.getByText("2 Regra geral", { exact: false })).toBeInTheDocument()
    // A base não consultada continua listada como autorizada (o agente PODIA usá-la).
    expect(screen.getByText("Procedimento Operacional Negociação de Débito")).toBeInTheDocument()
  })

  it("NONE: só informa que não há base associada, sem números", () => {
    const trace: QaKnowledgeTrace = { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: BUDGET }
    render(<KnowledgeTracePanel trace={trace} />)
    expect(screen.getByText("Sem base de conhecimento associada")).toBeInTheDocument()
    expect(screen.queryByText("Bases autorizadas")).not.toBeInTheDocument()
  })

  it("NO_MATCH: havia bases, nada foi injetado", () => {
    const trace: QaKnowledgeTrace = { mode: "NO_MATCH", authorizedDocuments: [{ id: "a", title: "Política de Jornada", chars: 28000 }], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 28000, budget: BUDGET }
    render(<KnowledgeTracePanel trace={trace} />)
    expect(screen.getByText("Nenhum trecho pertinente — nada foi injetado")).toBeInTheDocument()
    expect(screen.queryByText("Trechos efetivamente recuperados")).not.toBeInTheDocument()
  })
})
