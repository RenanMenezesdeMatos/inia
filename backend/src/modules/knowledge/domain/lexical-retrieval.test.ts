import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "./knowledge-chunking.js"
import { DEFAULT_RETRIEVAL_BUDGET, documentAnchors, rankChunks, selectWithinBudget, tokenize } from "./lexical-retrieval.js"
import { expandAcronyms } from "./query-acronyms.js"
import { ambiguousProcessesOf } from "../application/retrieve-knowledge.js"

const FATURAMENTO = {
  id: "doc-faturamento",
  title: "Procedimento Operacional — Faturamento",
  content: [
    "# Procedimento Operacional — Faturamento",
    "",
    "## 1. Objetivo",
    "Definir o processo de emissão e explicação da fatura mensal ao cliente.",
    "",
    "## 2. Emissão de segunda via",
    "O operador deve confirmar o e-mail cadastrado e enviar a segunda via da fatura pelo canal escolhido.",
  ].join("\n"),
}

const CONTESTACAO = {
  id: "doc-contestacao",
  title: "Procedimento Operacional — Contestação de Contas",
  content: [
    "# Procedimento Operacional — Contestação de Contas",
    "",
    "## 1. Objetivo",
    "Definir o processo para análise e registro de contestações de cobrança questionada pelo cliente.",
    "",
    "## 3. Etapas da contestação",
    "Etapa 1: validar o titular. Etapa 2: identificar a cobrança contestada na fatura. Etapa 3: registrar o protocolo de contestação e informar o prazo de análise.",
  ].join("\n"),
}

const PARCELAMENTO = {
  id: "doc-parcelamento",
  title: "Procedimento Operacional — Parcelamento de Débitos",
  content: [
    "# Procedimento Operacional — Parcelamento de Débitos",
    "",
    "## 1. Objetivo",
    "Definir as condições de parcelamento de débitos em atraso: entrada mínima, número máximo de parcelas e juros aplicáveis.",
    "",
    "## 2. Simulação",
    "O operador simula o parcelamento no sistema e apresenta as opções ao cliente.",
  ].join("\n"),
}

describe("tokenize", () => {
  it("normaliza acentos, remove stopwords e reduz ao radical", () => {
    expect(tokenize("A contestação da fatura foi contestada pelo cliente")).toEqual(["contes", "fatura", "contes"])
  })
})

describe("chunkKnowledgeDocument", () => {
  it("gera um trecho por seção, carregando o título da seção", () => {
    const chunks = chunkKnowledgeDocument(CONTESTACAO)
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["1. Objetivo", "3. Etapas da contestação"])
    expect(chunks[1]!.text).toContain("Etapa 3: registrar o protocolo")
    expect(chunks.every((chunk) => chunk.documentTitle === CONTESTACAO.title)).toBe(true)
  })

  it("subdivide seções maiores que o limite sem cortar parágrafo ao meio", () => {
    const longSection = Array.from({ length: 12 }, (_, index) => `Parágrafo ${index} com algum conteúdo relevante do procedimento.`).join("\n\n")
    const chunks = chunkKnowledgeDocument({ id: "d", title: "T", content: `## Seção longa\n${longSection}` }, { maxChunkChars: 200 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.text.length <= 200)).toBe(true)
    expect(chunks.every((chunk) => chunk.heading === "Seção longa")).toBe(true)
  })
})

describe("rankChunks + selectWithinBudget — precisão de retrieval", () => {
  const chunks = [FATURAMENTO, CONTESTACAO, PARCELAMENTO].flatMap((document) => chunkKnowledgeDocument(document))

  it("pergunta sobre contestação recupera as etapas de contestação, não o parcelamento", () => {
    const ranked = rankChunks("Cliente liga para contestar uma cobrança indevida na fatura e pede o protocolo da contestação", chunks)
    expect(ranked[0]!.documentId).toBe("doc-contestacao")
    expect(ranked[0]!.heading).toBe("3. Etapas da contestação")

    const selected = selectWithinBudget(ranked, { ...DEFAULT_RETRIEVAL_BUDGET, minRelativeScore: 0.35 })
    expect(selected.some((chunk) => chunk.documentId === "doc-contestacao")).toBe(true)
    expect(selected.some((chunk) => chunk.documentId === "doc-parcelamento")).toBe(false)
  })

  it("pergunta sobre parcelamento recupera parcelamento em primeiro lugar", () => {
    const ranked = rankChunks("quantas parcelas e qual entrada mínima para parcelar o débito em atraso", chunks)
    expect(ranked[0]!.documentId).toBe("doc-parcelamento")
  })

  it("consulta sem nenhum termo em comum não recupera nada", () => {
    expect(rankChunks("xyz qwerty", chunks)).toEqual([])
  })

  it("um único termo coincidente por acaso não basta — pergunta de RH não recupera seções de faturamento", () => {
    // "confirmar" aparece na seção de segunda via; sozinho não pode trazer a seção inteira.
    expect(rankChunks("quantos dias de férias tenho e como confirmar o banco de horas", chunks)).toEqual([])
  })

  it("respeita o orçamento de quantidade e de caracteres", () => {
    const ranked = rankChunks("processo de emissão e análise da fatura e das parcelas do débito", chunks)
    expect(ranked.length).toBeGreaterThan(2)
    const selected = selectWithinBudget(ranked, { maxChunks: 2, maxTotalChars: 10_000, minRelativeScore: 0 })
    expect(selected).toHaveLength(2)
    const tight = selectWithinBudget(ranked, { maxChunks: 10, maxTotalChars: 120, minRelativeScore: 0 })
    expect(tight.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeLessThanOrEqual(120)
  })
})

// ---------------------------------------------------------------------------------------------
// Busca em duas etapas (assunto no título, detalhe na seção) e siglas do glossário
// ---------------------------------------------------------------------------------------------

const TITULARIDADE = {
  id: "doc-titularidade",
  title: "Procedimento Operacional — Troca de Titularidade entre Empresas",
  content: [
    "# Procedimento Operacional — Troca de Titularidade entre Empresas",
    "",
    "## 3. Situações fora do processo",
    "A troca de titularidade não se aplica a pessoa física nem a mudança de endereço isolada.",
    "",
    "## 17. Documentos da empresa cedente",
    "Poderão ser solicitados: comprovante de inscrição do CNPJ, contrato social, ata de eleição.",
    "",
    "## 18. Documentos da empresa cessionária",
    "Poderão ser solicitados: contrato social, termo de aceite, formulário cadastral.",
    "",
    "## 50. Prazo operacional",
    "O operador deverá informar o prazo exibido na ferramenta.",
    "",
    "## 60. Titularidade e troca: frases",
    "Explique a troca de titularidade com calma e sem prometer resultado.",
  ].join("\n"),
}
const CHIP = {
  id: "doc-chip",
  title: "Troca de CHIP",
  content: ["# Troca de CHIP", "", "## 1. Quando trocar", "A troca do chip exige validação do titular da linha."].join("\n"),
}
const TWO_STAGE_CHUNKS = [...chunkKnowledgeDocument(TITULARIDADE), ...chunkKnowledgeDocument(CHIP), ...chunkKnowledgeDocument(FATURAMENTO), ...chunkKnowledgeDocument(CONTESTACAO)]
const headingsOf = (ranked: { heading: string }[]) => ranked.map((chunk) => chunk.heading)

describe("busca em duas etapas — assunto no título, detalhe na seção", () => {
  it("a seção que só tem o detalhe ('documentos') entra quando o título do documento é o assunto da pergunta", () => {
    const ranked = rankChunks("Quais os documentos necessários para troca de titularidade?", TWO_STAGE_CHUNKS)
    expect(headingsOf(ranked).slice(0, 2).sort()).toEqual(["17. Documentos da empresa cedente", "18. Documentos da empresa cessionária"])
    expect(ranked[0]!.anchored).toBe(true)
  })

  it("prazo da troca de titularidade traz a seção de prazo primeiro", () => {
    expect(headingsOf(rankChunks("Qual o prazo da troca de titularidade entre empresas?", TWO_STAGE_CHUNKS))[0]).toBe("50. Prazo operacional")
  })

  it("pergunta só com o assunto pontua pela pergunta inteira dentro do documento", () => {
    const ranked = rankChunks("troca de titularidade", TWO_STAGE_CHUNKS)
    expect(ranked[0]!.documentId).toBe("doc-titularidade")
    expect(ranked.every((chunk) => chunk.documentId !== "doc-faturamento")).toBe(true)
  })

  it("fora de documento ancorado a regra de 2 termos continua (1 palavra em comum não traz ruído)", () => {
    expect(rankChunks("Como resolver o problema de acesso ao sistema de ponto?", TWO_STAGE_CHUNKS)).toEqual([])
  })

  it("palavras de pergunta ('explicar', 'necessário', 'preciso') não decidem: 'Como explicar a fatura?' é sobre Faturamento", () => {
    const ranked = rankChunks("Como explicar a fatura?", TWO_STAGE_CHUNKS)
    expect(ranked[0]!.documentId).toBe("doc-faturamento")
  })

  it("palavras de todo título ('procedimento', 'operacional') nunca ancoram sozinhas", () => {
    const anchors = documentAnchors("procedimento operacional de documentos", TWO_STAGE_CHUNKS)
    expect(anchors.anchored).toEqual([])
  })

  it("'troca' sozinho empata dois processos (Titularidade × CHIP): ninguém é escolhido por palpite", () => {
    const anchors = documentAnchors("como faço a troca?", TWO_STAGE_CHUNKS)
    expect(ambiguousProcessesOf(anchors).map((process) => process.documentId).sort()).toEqual(["doc-chip", "doc-titularidade"])
    // Com o assunto completo não há dúvida.
    expect(ambiguousProcessesOf(documentAnchors("troca de titularidade", TWO_STAGE_CHUNKS))).toEqual([])
  })
})

describe("siglas do glossário", () => {
  const GLOSSARY = [{ acronym: "PJ", definition: "Pessoa jurídica" }, { acronym: "TT", definition: "Troca de Titularidade" }, { acronym: "ME", definition: "Mudança de Endereço" }]

  it("TT/PJ viram a definição na busca e a pergunta com sigla encontra a seção certa", () => {
    const expansion = expandAcronyms("Quais os documentos da TT de PJ para PJ?", GLOSSARY)
    expect(expansion.expansions.map((entry) => entry.acronym)).toEqual(["PJ", "TT"])
    expect(expansion.searchQuery).toContain("Troca de Titularidade")
    const ranked = rankChunks(expansion.searchQuery, TWO_STAGE_CHUNKS, { acronyms: new Set(GLOSSARY.map((entry) => entry.acronym)) })
    expect(headingsOf(ranked).slice(0, 2).sort()).toEqual(["17. Documentos da empresa cedente", "18. Documentos da empresa cessionária"])
  })

  it("só em MAIÚSCULAS e como palavra inteira: o pronome 'me' não vira Mudança de Endereço", () => {
    expect(expandAcronyms("me ajuda com a fatura", GLOSSARY).expansions).toEqual([])
    expect(expandAcronyms("Me ajuda com a fatura", GLOSSARY).expansions).toEqual([])
    expect(expandAcronyms("como faço ME?", GLOSSARY).expansions.map((entry) => entry.acronym)).toEqual(["ME"])
    expect(expandAcronyms("ATTENDIMENTO", GLOSSARY).expansions).toEqual([])
  })

  it("a sigla em maiúsculas vira termo próprio (não é descartada por ter 2 letras)", () => {
    expect(tokenize("Troca PJ para PJ", { acronyms: new Set(["PJ"]) })).toContain("#pj")
    expect(tokenize("Troca PJ para PJ")).not.toContain("#pj")
  })
})

describe("busca em duas etapas — regressões do chat (2026-09-29)", () => {
  const FAQ = {
    id: "doc-faq-auxilio",
    title: "FAQ Auxílio Creche e Auxílio Babá",
    content: [
      "# FAQ Auxílio Creche e Auxílio Babá",
      "",
      "## 1 O que é o auxílio-creche?",
      "Benefício de reembolso de mensalidade de creche para filhos de até 6 anos.",
      "",
      "## 2 O que é o auxílio-babá?",
      "Benefício de reembolso de despesas com babá, alternativo ao auxílio-creche.",
      "",
      "## 17 Quais despesas não são reembolsáveis?",
      "Material escolar, uniforme, transporte e alimentação não são reembolsados.",
      "",
      "## 24 Familiar pode ser reembolsado?",
      "Não há reembolso de pagamento feito a familiar, nem por recibo informal de reembolso.",
      "",
      "## 39 Como solicitar?",
      "Acesse o portal de RH, anexe o comprovante e envie a solicitação até o dia 10.",
    ].join("\n"),
  }
  const CHECKLIST = { id: "doc-checklist", title: "Checklist de Encerramento de Chamada", content: "# Checklist de Encerramento de Chamada\n\n## 1. Encerramento\nConfirme o protocolo e agradeça o contato." }
  const MOVEL = { id: "doc-movel", title: "Procedimento Operacional — Contestação de Contas Móvel", content: "# Procedimento Operacional — Contestação de Contas Móvel\n\n## 1. Objetivo\nTratar contestação de cobrança na conta móvel." }

  it("subtema do título ainda distingue a seção: 'reembolso do auxílio-babá' traz 'O que é o auxílio-babá?' e 'Como solicitar?'", () => {
    const ranked = rankChunks("Como solicitar reembolso do auxílio-babá?", chunkKnowledgeDocument(FAQ))
    expect(headingsOf(ranked).slice(0, 3)).toEqual(expect.arrayContaining(["2 O que é o auxílio-babá?", "39 Como solicitar?"]))
  })

  it("títulos que casam com palavras DIFERENTES da pergunta não viram dúvida de processo", () => {
    const chunks = [...chunkKnowledgeDocument(CHECKLIST), ...chunkKnowledgeDocument(MOVEL), ...chunkKnowledgeDocument(FATURAMENTO)]
    expect(ambiguousProcessesOf(documentAnchors("Qual a etapa e como abrir um chamado para linha móvel?", chunks))).toEqual([])
  })
})
