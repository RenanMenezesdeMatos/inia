/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { ComponentType } from "react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { WIKI_PAGES } from "@/components/wiki/wiki-nav"
import { AUDITED_KNOWLEDGE_BASES, DOMAIN_ORCHESTRATORS, KNOWLEDGE_USE_CASES, SPECIALIST_AGENTS, WORKFLOW_TEMPLATES } from "@/components/wiki/ai-catalog-data"
import { OPERATION_WORKFLOWS } from "@/components/wiki/wiki-data"
import { GLOSSARY } from "@/components/wiki/glossary-data"

import WikiHomePage from "./page"
import IntroductionPage from "./introducao/page"
import RolesPage from "./introducao/papeis/page"
import HowItConnectsPage from "./introducao/como-as-pecas-se-conectam/page"
import StructurePage from "./estrutura/page"
import TeamPage from "./estrutura/equipe/page"
import MyStructurePage from "./estrutura/minha-estrutura/page"
import LeadershipPage from "./estrutura/lideranca/page"
import ReportsWikiPage from "./estrutura/reports/page"
import BestPracticesWikiPage from "./estrutura/boas-praticas/page"
import IndicatorsPage from "./indicadores/page"
import AnalyticsPage from "./indicadores/analytics/page"
import MedicaoOperacionalPage from "./indicadores/medicao-operacional/page"
import ConfiguracaoIndicadoresPage from "./indicadores/configuracao/page"
import FollowUpPage from "./acompanhamento/page"
import PendingPage from "./pendencias/page"
import NotificationsPage from "./notificacoes/page"
import WorkflowEngineOverviewPage from "./workflows/page"
import CreateWorkflowPage from "./workflows/criacao/page"
import TriggersPage from "./workflows/triggers/page"
import ManualExecutionPage from "./workflows/execucao-manual/page"
import NodesPage from "./workflows/nodes/page"
import ConditionsPage from "./workflows/conditions/page"
import RankingPage from "./workflows/ranking/page"
import FanOutFanInPage from "./workflows/fan-out-fan-in/page"
import HumanReviewPage from "./workflows/human-review/page"
import OutputsPage from "./workflows/outputs/page"
import ErrorsLimitationsPage from "./workflows/erros-limitacoes/page"
import AgentsPage from "./agents/page"
import BusinessDomainsWikiPage from "./agents/dominios-negocio/page"
import InvestigationToolsWikiPage from "./agents/ferramentas-investigacao/page"
import OrchestratorsPage from "./orchestrators/page"
import KnowledgeBasesPage from "./bases-conhecimento/page"
import QaLabPage from "./qa-lab/page"
import AdministrationPage from "./administracao/page"
import AiModelsPage from "./administracao/ia-modelos/page"
import InterventionPoliciesWikiPage from "./administracao/politicas-de-acompanhamento/page"
import DataHubPage from "./central-de-dados/page"
import DataHubConnectorsPage from "./central-de-dados/conectores/page"
import DataHubGuidesPage from "./central-de-dados/guias/page"
import SecurityPage from "./seguranca/page"
import PracticalCasesPage from "./casos-praticos/page"
import WorkflowModelsPage from "./casos-praticos/workflows/page"
import GlossaryPage from "./glossario/page"

// jsdom não implementa IntersectionObserver — só usado pelo destaque de seção ativa do índice.
beforeAll(() => {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- stub deliberadamente incompleto, só o necessário pro componente montar.
  global.IntersectionObserver = IntersectionObserverStub
})

// O shell (sidebar/breadcrumbs) usa usePathname — as páginas em si não; o mock só protege
// contra o app router ausente caso alguma primitiva passe a usá-lo.
vi.mock("next/navigation", () => ({
  usePathname: () => "/wiki",
  permanentRedirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  },
}))

afterEach(() => cleanup())

/** Registro href → componente: precisa cobrir TODO o sitemap (o teste abaixo cobra). */
const PAGES: Record<string, ComponentType> = {
  "/wiki": WikiHomePage,
  "/wiki/introducao": IntroductionPage,
  "/wiki/introducao/papeis": RolesPage,
  "/wiki/introducao/como-as-pecas-se-conectam": HowItConnectsPage,
  "/wiki/estrutura": StructurePage,
  "/wiki/estrutura/equipe": TeamPage,
  "/wiki/estrutura/minha-estrutura": MyStructurePage,
  "/wiki/estrutura/lideranca": LeadershipPage,
  "/wiki/estrutura/reports": ReportsWikiPage,
  "/wiki/estrutura/boas-praticas": BestPracticesWikiPage,
  "/wiki/indicadores": IndicatorsPage,
  "/wiki/indicadores/analytics": AnalyticsPage,
  "/wiki/indicadores/medicao-operacional": MedicaoOperacionalPage,
  "/wiki/indicadores/configuracao": ConfiguracaoIndicadoresPage,
  "/wiki/acompanhamento": FollowUpPage,
  "/wiki/pendencias": PendingPage,
  "/wiki/notificacoes": NotificationsPage,
  "/wiki/workflows": WorkflowEngineOverviewPage,
  "/wiki/workflows/criacao": CreateWorkflowPage,
  "/wiki/workflows/triggers": TriggersPage,
  "/wiki/workflows/execucao-manual": ManualExecutionPage,
  "/wiki/workflows/nodes": NodesPage,
  "/wiki/workflows/conditions": ConditionsPage,
  "/wiki/workflows/ranking": RankingPage,
  "/wiki/workflows/fan-out-fan-in": FanOutFanInPage,
  "/wiki/workflows/human-review": HumanReviewPage,
  "/wiki/workflows/outputs": OutputsPage,
  "/wiki/workflows/erros-limitacoes": ErrorsLimitationsPage,
  "/wiki/agents": AgentsPage,
  "/wiki/agents/dominios-negocio": BusinessDomainsWikiPage,
  "/wiki/agents/ferramentas-investigacao": InvestigationToolsWikiPage,
  "/wiki/orchestrators": OrchestratorsPage,
  "/wiki/bases-conhecimento": KnowledgeBasesPage,
  "/wiki/qa-lab": QaLabPage,
  "/wiki/administracao": AdministrationPage,
  "/wiki/administracao/ia-modelos": AiModelsPage,
  "/wiki/administracao/politicas-de-acompanhamento": InterventionPoliciesWikiPage,
  "/wiki/central-de-dados": DataHubPage,
  "/wiki/central-de-dados/conectores": DataHubConnectorsPage,
  "/wiki/central-de-dados/guias": DataHubGuidesPage,
  "/wiki/seguranca": SecurityPage,
  "/wiki/casos-praticos": PracticalCasesPage,
  "/wiki/casos-praticos/workflows": WorkflowModelsPage,
  "/wiki/glossario": GlossaryPage,
}

const rendered = new Map<string, HTMLElement>()
const orphanTableParts = new Map<string, number>()

function renderPage(href: string): HTMLElement {
  const cached = rendered.get(href)
  if (cached) return cached
  const Page = PAGES[href]
  if (!Page) throw new Error(`Página não registrada no teste: ${href}`)
  const { container } = render(<Page />)
  // Parte de tabela fora de <table> (ex.: TableHeader direto no WikiTable) = erro de hidratação no navegador. Conferido no DOM
  // montado: ao reprocessar o HTML (abaixo), o parser descarta essas tags e o defeito sumiria do snapshot.
  orphanTableParts.set(href, Array.from(container.querySelectorAll("thead, tbody, tfoot, tr, th, td")).filter((element) => !element.closest("table")).length)
  // Guarda o HTML montado (RTL limpa o DOM entre testes) — o que interessa aqui é estático.
  const snapshot = document.createElement("div")
  snapshot.innerHTML = container.innerHTML
  rendered.set(href, snapshot)
  return snapshot
}

describe("Wiki INIA — todas as páginas do sitemap renderizam", () => {
  it("o registro de teste cobre exatamente o sitemap", () => {
    expect(Object.keys(PAGES).sort()).toEqual(WIKI_PAGES.map((page) => page.href).sort())
  })

  for (const page of WIKI_PAGES) {
    it(`${page.href} renderiza um h1 e não precisa de dado remoto`, () => {
      const root = renderPage(page.href)
      expect(root.querySelector("h1")?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    })
  }

  it("toda tabela é uma <table> de verdade: nenhum thead/tbody/tr/td fora dela (o navegador acusava erro de hidratação)", () => {
    const pagesWithOrphans = WIKI_PAGES.map((page) => {
      renderPage(page.href)
      return [page.href, orphanTableParts.get(page.href) ?? 0] as const
    }).filter(([, orphans]) => orphans > 0)
    expect(pagesWithOrphans).toEqual([])
  })

  it("a Home deixa de parecer 'Wiki do Workflow Engine' e apresenta a INIA como produto", () => {
    const root = renderPage("/wiki")
    expect(root.querySelector("h1")?.textContent).toMatch(/INIA/)
    const text = root.textContent ?? ""
    for (const area of ["INDICADORES", "EQUIPE", "ACOMPANHAMENTO", "WORKFLOWS", "AGENTS", "ORCHESTRATORS", "BASES DE CONHECIMENTO", "QA LAB", "SEGURANÇA", "CENTRAL DE DADOS", "CASOS PRÁTICOS"]) {
      expect(text.toUpperCase(), area).toContain(area)
    }
    expect(root.querySelector('a[href="/wiki/workflows"]')).not.toBeNull()
    expect(root.querySelector('a[href="/wiki/agents"]')).not.toBeNull()
  })
})

describe("Wiki INIA — índice de cada página tem âncora real", () => {
  for (const page of WIKI_PAGES.filter((entry) => entry.href !== "/wiki")) {
    it(`${page.href}: toda entrada do índice 'Nesta página' aponta para um id existente`, () => {
      const root = renderPage(page.href)
      const tocLinks = Array.from(root.querySelectorAll('nav[aria-label="Índice da Wiki"] a[href^="#"]'))
      expect(tocLinks.length, "índice vazio").toBeGreaterThan(0)
      for (const link of tocLinks) {
        const id = link.getAttribute("href")!.slice(1)
        expect(root.querySelector(`#${CSS.escape(id)}`), `#${id} em ${page.href}`).not.toBeNull()
      }
    })
  }
})

describe("Wiki INIA — links internos (nenhum quebrado)", () => {
  const known = new Set(WIKI_PAGES.map((page) => page.href))

  it("toda página aponta para pelo menos uma outra página da Wiki (links cruzados)", () => {
    for (const page of WIKI_PAGES.filter((entry) => entry.href !== "/wiki")) {
      const root = renderPage(page.href)
      const others = Array.from(root.querySelectorAll('a[href^="/wiki"]')).map((a) => a.getAttribute("href")!.split("#")[0]).filter((href) => href !== page.href)
      expect(others.length, `${page.href} sem links cruzados`).toBeGreaterThan(0)
    }
  })

  it("todo link /wiki/... de toda página aponta para uma rota do sitemap e, quando tem âncora, para um id que existe na página-alvo", () => {
    for (const page of WIKI_PAGES) {
      const root = renderPage(page.href)
      for (const anchor of Array.from(root.querySelectorAll('a[href^="/wiki"]'))) {
        const href = anchor.getAttribute("href")!
        const [pathname, hash] = href.split("#")
        expect(known.has(pathname!), `${page.href} → ${href}`).toBe(true)
        if (hash) {
          const target = renderPage(pathname!)
          expect(target.querySelector(`#${CSS.escape(hash)}`), `${page.href} → ${href} (âncora inexistente)`).not.toBeNull()
        }
      }
    }
  })

  it("links do glossário apontam para âncoras existentes", () => {
    for (const entry of GLOSSARY) {
      const [pathname, hash] = entry.href.split("#")
      const target = renderPage(pathname!)
      if (hash) expect(target.querySelector(`#${CSS.escape(hash)}`), `${entry.term} → ${entry.href}`).not.toBeNull()
    }
  })

  it("as rotas antigas continuam existindo, como redirecionamento permanente para a nova arquitetura", () => {
    const legacy = readFileSync(path.resolve(__dirname, "ia-conhecimento/page.tsx"), "utf-8")
    expect(legacy).toMatch(/permanentRedirect\("\/wiki\/agents"\)/)
    const legacyIndicators = readFileSync(path.resolve(__dirname, "indicadores-equipe/page.tsx"), "utf-8")
    expect(legacyIndicators).toMatch(/permanentRedirect\("\/wiki\/indicadores"\)/)
  })
})

describe("Wiki INIA — catálogo de IA (fonte única, nunca lista digitada)", () => {
  it("a página de Agents lista todos os Agents do catálogo; a de Orchestrators, todos os Orquestradores", () => {
    const agents = renderPage("/wiki/agents").textContent ?? ""
    for (const agent of SPECIALIST_AGENTS) expect(agents, agent.name).toContain(agent.name)
    const orchestrators = renderPage("/wiki/orchestrators").textContent ?? ""
    for (const orchestrator of DOMAIN_ORCHESTRATORS) expect(orchestrators, orchestrator.name).toContain(orchestrator.name)
  })

  it("a página de Bases lista todas as bases auditadas", () => {
    const text = renderPage("/wiki/bases-conhecimento").textContent ?? ""
    for (const kb of AUDITED_KNOWLEDGE_BASES) expect(text, kb.title).toContain(kb.title)
  })

  it("Modelos de Workflow renderiza os 20 modelos e os 10 Workflows reais", () => {
    const text = renderPage("/wiki/casos-praticos/workflows").textContent ?? ""
    expect(WORKFLOW_TEMPLATES).toHaveLength(20)
    expect(OPERATION_WORKFLOWS).toHaveLength(10)
    for (const template of WORKFLOW_TEMPLATES) expect(text).toContain(template.name.replace(/^Modelo · \d+ · /, ""))
    for (const workflow of OPERATION_WORKFLOWS) expect(text).toContain(workflow.name)
  })

  it("toda base autorizada a um Agent ou Orquestrador existe na auditoria (nunca uma base inventada)", () => {
    const knownTitles = new Set(AUDITED_KNOWLEDGE_BASES.map((kb) => kb.title))
    for (const agent of SPECIALIST_AGENTS) for (const title of agent.knowledgeBases) expect(knownTitles.has(title), `${agent.name}: ${title}`).toBe(true)
    for (const orchestrator of DOMAIN_ORCHESTRATORS) for (const title of orchestrator.knowledgeBases) expect(knownTitles.has(title), `${orchestrator.name}: ${title}`).toBe(true)
  })

  it("todo especialista citado por um Orquestrador é um Agent do catálogo", () => {
    const agentNames = new Set(SPECIALIST_AGENTS.map((agent) => agent.name))
    for (const orchestrator of DOMAIN_ORCHESTRATORS) for (const specialist of orchestrator.specialists) expect(agentNames.has(specialist), `${orchestrator.name}: ${specialist}`).toBe(true)
  })

  it("nenhum Agent de chamada/processo tem base de RH; bases de RH só entram no Especialista de Disponibilidade", () => {
    const hrTitles = new Set(AUDITED_KNOWLEDGE_BASES.filter((kb) => kb.domain === "RH").map((kb) => kb.title))
    for (const agent of SPECIALIST_AGENTS) {
      const hr = agent.knowledgeBases.filter((title) => hrTitles.has(title))
      if (agent.id === "disponibilidade") expect(hr).toEqual(["POLÍTICA DE JORNADA HORAS EXTRAS FALTAS E BANCO DE HORAS"])
      else expect(hr, agent.name).toEqual([])
    }
  })

  it("nenhum Agent concentra mais de um domínio de processo (sem 'super agente')", () => {
    const domainOf = new Map(AUDITED_KNOWLEDGE_BASES.map((kb) => [kb.title, kb.domain]))
    for (const agent of SPECIALIST_AGENTS) {
      const domains = new Set(agent.knowledgeBases.map((title) => domainOf.get(title)))
      expect(domains.size, agent.name).toBeLessThanOrEqual(1)
    }
  })

  it("cada base operacional tem um caso de uso documentado com Agent e Orquestrador", () => {
    const covered = new Set(KNOWLEDGE_USE_CASES.map((useCase) => useCase.knowledgeBase))
    for (const kb of AUDITED_KNOWLEDGE_BASES.filter((entry) => entry.operational)) expect(covered.has(kb.title), kb.title).toBe(true)
    for (const useCase of KNOWLEDGE_USE_CASES) expect(useCase.examples.length).toBeGreaterThan(0)
  })

  it("cada domínio operacional com base tem um Orquestrador correspondente", () => {
    const domainsWithBases = new Set(AUDITED_KNOWLEDGE_BASES.filter((kb) => kb.operational).map((kb) => kb.domain))
    const orchestratorDomains = new Set(DOMAIN_ORCHESTRATORS.map((orchestrator) => orchestrator.domain))
    for (const domain of domainsWithBases) expect(orchestratorDomains.has(domain), domain).toBe(true)
  })

  it("são exatamente 20 modelos numerados de 1 a 20, todos com os campos obrigatórios e diagrama Gatilho → … → Fim", () => {
    expect(WORKFLOW_TEMPLATES.map((template) => template.number)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
    for (const template of WORKFLOW_TEMPLATES) {
      for (const field of ["problem", "objective", "trigger", "subject", "population", "structure", "condition", "ranking", "agent", "orchestrator", "knowledgeBase", "humanReview", "output", "surface", "requiredData", "expectedBehavior", "limitations"] as const) {
        expect(template[field].length, `${template.id}.${field}`).toBeGreaterThan(0)
      }
      expect(template.nodes.length).toBeGreaterThan(2)
      expect(template.deliveries.length, `${template.id}.deliveries`).toBeGreaterThan(0)
      expect(template.diagram[0]!.kind).toBe("trigger")
      expect(template.diagram[template.diagram.length - 1]!.kind).toBe("end")
    }
  })

  it("template × instância: nome de Grupo demo (B2C ·/B2B ·), pessoa demo ou id demo só aparece dentro de um exemplo marcado como demonstrativo — nunca na definição conceitual do template", () => {
    const DEMO_LITERALS = [/B2[BC] ·/, /\bde00[0-9a-f]{4}\b/i, /Daniela Duarte|Mariana Alves|Larissa|Thiago Moreira|João Lacerda|Sueli|Patrícia Castro/]
    for (const template of WORKFLOW_TEMPLATES) {
      const conceptual = [template.structure, template.name, template.problem, template.objective, template.population, template.subject].join(" ")
      for (const literal of DEMO_LITERALS) expect(conceptual, `${template.id}: definição conceitual acoplada à instância demo`).not.toMatch(literal)
    }
    for (const page of WIKI_PAGES) {
      const root = renderPage(page.href)
      for (const example of Array.from(root.querySelectorAll("[data-demo-example]"))) example.remove()
      const text = root.textContent ?? ""
      expect(text, `${page.href}: Grupo demo citado fora de um exemplo demonstrativo`).not.toMatch(/B2[BC] ·/)
      expect(text, `${page.href}: id demo`).not.toMatch(/\bde00[0-9a-f]{4}\b/i)
      // Reidrata o snapshot (o cache é compartilhado entre os testes).
      rendered.delete(page.href)
    }
  })

  it("a Wiki não expõe dados sensíveis: sem UUID, sem senha demo, sem e-mail de login demo", () => {
    for (const page of WIKI_PAGES) {
      const text = renderPage(page.href).textContent ?? ""
      expect(text, `${page.href}: UUID`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(text, `${page.href}: e-mail demo`).not.toMatch(/@inia\.local/)
      expect(text.toLowerCase(), `${page.href}: senha`).not.toMatch(/senha:\s*\S/)
    }
  })
})

describe("Wiki INIA — fronteira de autenticação", () => {
  const WIKI_LAYOUT_PATH = path.resolve(__dirname, "layout.tsx")
  const ADMIN_LAYOUT_PATH = path.resolve(__dirname, "../(app)/admin/layout.tsx")
  const APP_LAYOUT_PATH = path.resolve(__dirname, "../(app)/layout.tsx")

  it("a rota /wiki não importa nenhum mecanismo de sessão", () => {
    const layoutSource = readFileSync(WIKI_LAYOUT_PATH, "utf-8")
    expect(layoutSource).not.toMatch(/^import .*(getCurrentUserFromCookies|fetchCurrentUser|AuthenticatedAppShell)/m)
    expect(layoutSource).not.toMatch(/<AuthenticatedAppShell/)
  })

  it("o layout de admin continua exigindo sessão e papel ADMIN (regressão)", () => {
    const layoutSource = readFileSync(ADMIN_LAYOUT_PATH, "utf-8")
    expect(layoutSource).toMatch(/getCurrentUserFromCookies/)
    expect(layoutSource).toMatch(/redirect\(.*auth\/login.*\)/)
  })

  it("o grupo (app) continua com sua própria guarda de sessão (regressão)", () => {
    expect(readFileSync(APP_LAYOUT_PATH, "utf-8")).toMatch(/AuthenticatedAppShell/)
  })

  it("o proxy nunca exige sessão em /wiki (só aplica a CSP), e continua protegendo as rotas de sempre", async () => {
    const { NextRequest } = await import("next/server")
    const { proxy } = await import("@/proxy")
    const visit = (pathname: string) => proxy(new NextRequest(new URL(pathname, "http://localhost:3000")))
    for (const wikiPath of ["/wiki", "/wiki/seguranca"]) {
      const response = visit(wikiPath)
      expect(response.headers.get("location")).toBeNull()
      expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[^']+'/)
    }
    for (const protectedPrefix of ["/admin", "/operator", "/supervisor", "/diagnostics"]) {
      expect(visit(`${protectedPrefix}/qualquer`).headers.get("location")).toBe("http://localhost:3000/auth/login")
    }
  })
})
