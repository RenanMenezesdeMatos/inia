import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { WIKI_HOME, WIKI_PAGES, WIKI_SECTIONS, findWikiSection, wikiBreadcrumbs, wikiNeighbors } from "./wiki-nav"
import { GLOSSARY } from "./glossary-data"

const APP_WIKI_DIR = path.resolve(__dirname, "../../app/wiki")

/** "/wiki/workflows/nodes" → app/wiki/workflows/nodes/page.tsx */
function pageFileFor(href: string): string {
  const relative = href.replace(/^\/wiki\/?/, "")
  return path.join(APP_WIKI_DIR, relative, "page.tsx")
}

describe("Sitemap da Wiki (wiki-nav.ts) — rotas", () => {
  it("toda página do sitemap tem um page.tsx real em app/wiki", () => {
    for (const page of WIKI_PAGES) {
      expect(existsSync(pageFileFor(page.href)), `${page.href} → ${pageFileFor(page.href)}`).toBe(true)
    }
  })

  it("hrefs são únicos, começam com /wiki e não terminam com barra", () => {
    const hrefs = WIKI_PAGES.map((page) => page.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const href of hrefs) {
      expect(href.startsWith("/wiki")).toBe(true)
      expect(href === "/wiki" || !href.endsWith("/")).toBe(true)
    }
  })

  it("as 13 grandes áreas existem, numeradas em ordem, cada uma com pelo menos uma página", () => {
    expect(WIKI_SECTIONS.map((section) => section.number)).toEqual(Array.from({ length: 13 }, (_, index) => String(index + 1).padStart(2, "0")))
    for (const section of WIKI_SECTIONS) {
      expect(section.pages.length, section.title).toBeGreaterThan(0)
      expect(section.description.length).toBeGreaterThan(20)
    }
  })

  it("a Home deixa visíveis as áreas pedidas: Indicadores, Equipe, Acompanhamento, Workflows, Agents, Orchestrators, Bases, QA Lab, Segurança, Casos práticos", () => {
    const hrefs = new Set(WIKI_PAGES.map((page) => page.href))
    for (const href of [
      "/wiki/indicadores",
      "/wiki/estrutura/equipe",
      "/wiki/acompanhamento",
      "/wiki/workflows",
      "/wiki/agents",
      "/wiki/orchestrators",
      "/wiki/bases-conhecimento",
      "/wiki/qa-lab",
      "/wiki/seguranca",
      "/wiki/casos-praticos",
    ]) {
      expect(hrefs.has(href), href).toBe(true)
    }
  })

  it("o Workflow Engine continua profundamente documentado: nodes, triggers, conditions, ranking, fan-out/fan-in, revisão humana, outputs, erros e modelos", () => {
    const workflows = WIKI_SECTIONS.find((section) => section.id === "workflows")!
    const hrefs = workflows.pages.map((page) => page.href)
    for (const suffix of ["criacao", "triggers", "nodes", "conditions", "ranking", "fan-out-fan-in", "human-review", "outputs", "erros-limitacoes"]) {
      expect(hrefs).toContain(`/wiki/workflows/${suffix}`)
    }
    expect(WIKI_PAGES.map((page) => page.href)).toContain("/wiki/casos-praticos/workflows")
  })
})

describe("Sitemap da Wiki — navegação derivada", () => {
  it("breadcrumbs: página raiz da seção não repete a seção; subpágina mostra Wiki › Seção › Página", () => {
    expect(wikiBreadcrumbs("/wiki/workflows").map((crumb) => crumb.label)).toEqual([WIKI_HOME.shortTitle, "Workflow Engine"])
    const nodes = wikiBreadcrumbs("/wiki/workflows/nodes")
    expect(nodes.map((crumb) => crumb.label)).toEqual([WIKI_HOME.shortTitle, "Workflow Engine", "Nodes"])
    expect(nodes[1]?.href).toBe("/wiki/workflows")
    expect(nodes[2]?.href).toBeNull()
  })

  it("anterior/próximo seguem a ordem de leitura e param nas pontas", () => {
    const first = WIKI_SECTIONS[0]!.pages[0]!
    expect(wikiNeighbors(first.href).previous).toBeNull()
    const last = WIKI_SECTIONS.at(-1)!.pages.at(-1)!
    expect(wikiNeighbors(last.href).next).toBeNull()
    expect(wikiNeighbors("/wiki/workflows").next?.href).toBe("/wiki/workflows/criacao")
    expect(wikiNeighbors("/wiki/desconhecida")).toEqual({ previous: null, next: null })
  })

  it("findWikiSection resolve a seção de qualquer página", () => {
    expect(findWikiSection("/wiki/glossario")?.id).toBe("glossario")
    expect(findWikiSection("/wiki")).toBeUndefined()
  })
})

describe("Glossário — termos obrigatórios e links", () => {
  const terms = new Set(GLOSSARY.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]).map((term) => term.toLowerCase()))

  it("cobre os termos mínimos pedidos para a Wiki", () => {
    for (const required of [
      "abrangência", "alvo da avaliação", "população", "grupo", "subgrupo", "indicador", "meta", "atingimento", "prv", "quartil oficial", "quartil operacional",
      "medição operacional", "fechamento", "agent", "orchestrator", "knowledge base", "retrieval", "workflow", "trigger", "node", "condition", "fan-out", "fan-in",
      "human review", "output", "surface", "acompanhamento", "ciência", "pendência", "qa run", "snapshot", "sem dados",
    ]) {
      expect(terms.has(required), required).toBe(true)
    }
  })

  it("todo termo aponta para uma página real do sitemap", () => {
    const hrefs = new Set(WIKI_PAGES.map((page) => page.href))
    for (const entry of GLOSSARY) {
      const [pathname] = entry.href.split("#")
      expect(hrefs.has(pathname!), `${entry.term} → ${entry.href}`).toBe(true)
    }
  })

  it("termos são únicos", () => {
    const names = GLOSSARY.map((entry) => entry.term)
    expect(new Set(names).size).toBe(names.length)
  })
})
