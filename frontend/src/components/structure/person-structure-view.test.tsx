/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { ManagementMetrics, PersonOrganizationStructure, StructureChainEntry, StructurePerson, StructurePersonCapabilities } from "@/schemas/org-structure/person-structure.schema"

import { FLOW_ARRIVAL_DURATION_MS, FLOW_TRAVEL_DURATION_MS } from "@/components/flow/flow-travel-signal"

import { GO_TO_ME_STEP_MS, LeadershipChainList, PersonStructureView, SEARCH_MIN_REPORTS } from "./person-structure-view"
import { NODE_WIDTH } from "./organization-layout"
import { SPAN_TOOLTIP } from "./structure-person-card"

const service = vi.hoisted(() => ({ fetchPersonOrganizationStructure: vi.fn() }))
vi.mock("@/services/org-structure/person-structure-service", () => service)

/** O jsdom não carrega imagens; o Avatar do Radix só troca o fallback pela foto depois do `load`.
 * Este stub dispara `load` para qualquer URL e `error` para as que contêm "broken". */
class FakeImage extends EventTarget {
  private source = ""
  complete = false
  naturalWidth = 0
  set src(value: string) {
    this.source = value
    setTimeout(() => {
      const broken = value.includes("broken")
      this.complete = true
      this.naturalWidth = broken ? 0 : 128
      this.dispatchEvent(new Event(broken ? "error" : "load"))
    }, 0)
  }
  get src() {
    return this.source
  }
}

beforeAll(() => {
  installJsdomStubs()
  window.Image = FakeImage as unknown as typeof Image
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Ancestral real do viewer: navegável (política de navegação ascendente), nunca com ficha. */
const ANCESTOR: StructurePersonCapabilities = { canViewProfile: false, canViewStructure: true, hasReports: true }
/** Pessoa fora da subárvore e que não é ancestral (colega, Supervisor de outra Coordenação): só dados. */
const NONE: StructurePersonCapabilities = { canViewProfile: false, canViewStructure: false, hasReports: true }
const LEAF: StructurePersonCapabilities = { canViewProfile: true, canViewStructure: true, hasReports: false }
const LEADER: StructurePersonCapabilities = { canViewProfile: false, canViewStructure: true, hasReports: true }

/** Métricas gerenciais como o backend manda (denominador, percentuais e buckets já decididos). */
function metrics(partial: Partial<ManagementMetrics> = {}): ManagementMetrics {
  return {
    structuralPopulation: 30,
    statusDistribution: [
      { bucket: "EM_PRODUCAO", count: 26, percent: 86.7 },
      { bucket: "FERIAS", count: 2, percent: 6.7 },
      { bucket: "INSS", count: 1, percent: 3.3 },
      { bucket: "MATERNIDADE", count: 1, percent: 3.3 },
      { bucket: "PATERNIDADE", count: 0, percent: 0 },
    ],
    directSpan: 30,
    operatorReach: 30,
    roleCounts: [{ role: "OPERATOR", count: 30 }],
    layerMetrics: [],
    groupBenchmark: { groupId: "g", groupName: "Atendimento B2B", peerRole: "SUPERVISOR", peerCount: 18, averageDirectSpan: 25.4 },
    privacy: { sensitiveBreakdownSuppressed: false, minimumPopulation: 5 },
    confidence: { statusFreshness: "FRESH", unconfirmed: 0 },
    ...partial,
  }
}
const COORDINATOR_METRICS = metrics({
  structuralPopulation: 130,
  statusDistribution: [
    { bucket: "EM_PRODUCAO", count: 121, percent: 93.1 },
    { bucket: "FERIAS", count: 4, percent: 3.1 },
    { bucket: "INSS", count: 2, percent: 1.5 },
    { bucket: "MATERNIDADE", count: 2, percent: 1.5 },
    { bucket: "PATERNIDADE", count: 1, percent: 0.8 },
  ],
  directSpan: 5,
  operatorReach: 125,
  roleCounts: [{ role: "SUPERVISOR", count: 5 }, { role: "OPERATOR", count: 125 }],
  layerMetrics: [{ managerRole: "SUPERVISOR", reportRole: "OPERATOR", managers: 5, reports: 125, average: 25 }],
  groupBenchmark: { groupId: "g", groupName: "Atendimento B2B", peerRole: "COORDINATOR", peerCount: 4, averageDirectSpan: 24.6 },
})
const MANAGER_METRICS = metrics({
  structuralPopulation: 511,
  statusDistribution: [
    { bucket: "EM_PRODUCAO", count: 480, percent: 93.9 },
    { bucket: "FERIAS", count: 20, percent: 3.9 },
    { bucket: "INSS", count: 5, percent: 1 },
    { bucket: "MATERNIDADE", count: 3, percent: 0.6 },
    { bucket: "PATERNIDADE", count: 1, percent: 0.2 },
    { bucket: "OTHER", count: 2, percent: 0.4 },
  ],
  directSpan: 4,
  operatorReach: 487,
  roleCounts: [{ role: "COORDINATOR", count: 4 }, { role: "SUPERVISOR", count: 20 }, { role: "OPERATOR", count: 487 }],
  layerMetrics: [
    { managerRole: "COORDINATOR", reportRole: "SUPERVISOR", managers: 4, reports: 20, average: 5 },
    { managerRole: "SUPERVISOR", reportRole: "OPERATOR", managers: 20, reports: 487, average: 24.4 },
  ],
  groupBenchmark: null,
})

function person(id: string, name: string, role: string, roleLabel: string, capabilities: StructurePersonCapabilities, extra: Partial<StructurePerson> = {}): StructurePerson {
  return { personId: id, name, role, roleLabel, jobTitle: null, avatarUrl: null, email: `${id}@empresa.com`, group: { id: "g", name: "Retenção" }, subgroup: { id: "s", name: "Voz" }, operationalCapital: null, directReportCount: capabilities.hasReports ? 3 : 0, capabilities, ...extra }
}
function entry(level: number, base: StructurePerson): StructureChainEntry {
  return { ...base, level }
}
/** Cadeia real do viewer (topo → viewer), como o backend manda. */
const pathOf = (...people: Array<{ personId: string; name: string; roleLabel: string }>) => people.map(({ personId, name, roleLabel }) => ({ personId, name, roleLabel }))

const SUPERVISOR = person("sup", "Vanessa Lopes", "SUPERVISOR", "Supervisor", ANCESTOR, { jobTitle: "Supervisora — Retenção", directReportCount: null })
const COORDINATOR = person("coord", "Patrícia Coordenadora", "COORDINATOR", "Coordenador", ANCESTOR, { directReportCount: null })
const MANAGER = person("mgr", "Roberto Alves", "MANAGER", "Gerente", ANCESTOR, { directReportCount: null })
const SENIOR = person("sr", "Eduarda Sênior", "SENIOR_MANAGER", "Gerente Sênior", ANCESTOR, { group: undefined, subgroup: undefined, operationalCapital: undefined, directReportCount: null })
const DIRECTOR = person("dir", "João Diretor", "DIRECTOR", "Diretor", ANCESTOR, { jobTitle: "Diretor de Operações", group: undefined, subgroup: undefined, operationalCapital: undefined, directReportCount: null })

/** Operadora vendo a própria estrutura: cadeia inteira acima, nenhum subordinado. */
const OPERATOR_OWN: PersonOrganizationStructure = {
  subject: { ...person("me", "Luana Brenda", "OPERATOR", "Operador", { canViewProfile: false, canViewStructure: true, hasReports: false }, { jobTitle: "Operadora de Atendimento", operationalCapital: { code: "FORTALEZA", name: "Fortaleza", stateCode: "CE", label: "Fortaleza / CE" } }), isViewer: true },
  breadcrumb: [{ personId: "me", name: "Luana Brenda", roleLabel: "Operador", isViewer: true }],
  organizationalContext: { group: { id: "g", name: "Retenção" }, subgroup: { id: "s", name: "Voz" }, directManagerStatus: "PRESENT", team: { label: "Equipe de Vanessa Lopes", leader: entry(1, SUPERVISOR), memberCount: 25, memberCountKind: "DIRECT_OPERATORS", memberCountLabel: "Operadores da equipe" } },
  managementChain: [entry(1, SUPERVISOR), entry(2, COORDINATOR), entry(3, MANAGER), entry(4, SENIOR), entry(5, DIRECTOR)],
  directReports: [],
  viewerOrganizationPath: pathOf(DIRECTOR, SENIOR, MANAGER, COORDINATOR, SUPERVISOR, { personId: "me", name: "Luana Brenda", roleLabel: "Operador" }),
  sourceMetadata: null,
}

function operators(count: number): StructurePerson[] {
  return Array.from({ length: count }, (_, index) => person(`op${index + 1}`, `Operador ${String(index + 1).padStart(2, "0")} Silva`, "OPERATOR", "Operador", LEAF, { jobTitle: index === 0 ? "Operadora de Atendimento" : null, email: `op${index + 1}@empresa.com`, avatarUrl: index === 0 ? "/fotos/op1.png" : index === 1 ? "/fotos/broken.png" : null }))
}

/** Coordenadora vendo a estrutura de uma Supervisora dela: trilha real, N operadores como folhas. */
function supervisorFocal(reportCount: number): PersonOrganizationStructure {
  return {
    subject: { ...SUPERVISOR, capabilities: LEADER, directReportCount: reportCount, isViewer: false, managementMetrics: metrics({ structuralPopulation: reportCount, directSpan: reportCount, operatorReach: reportCount, statusDistribution: [{ bucket: "EM_PRODUCAO", count: Math.max(reportCount - 2, 0), percent: 0 }, { bucket: "FERIAS", count: Math.min(reportCount, 1), percent: 0 }, { bucket: "INSS", count: Math.min(Math.max(reportCount - 1, 0), 1), percent: 0 }, { bucket: "MATERNIDADE", count: 0, percent: 0 }, { bucket: "PATERNIDADE", count: 0, percent: 0 }] }) },
    breadcrumb: [
      { personId: "coord", name: "Patrícia Coordenadora", roleLabel: "Coordenador", isViewer: true },
      { personId: "sup", name: "Vanessa Lopes", roleLabel: "Supervisor", isViewer: false },
    ],
    organizationalContext: { group: { id: "g", name: "Retenção" }, subgroup: { id: "s", name: "Voz" }, directManagerStatus: "PRESENT", team: { label: "Estrutura de Patrícia Coordenadora", leader: entry(1, { ...COORDINATOR, capabilities: LEADER, directReportCount: 5 }), memberCount: 125, memberCountKind: "OPERATORS_BELOW", memberCountLabel: "Operadores na estrutura" } },
    managementChain: [entry(1, { ...COORDINATOR, capabilities: LEADER, directReportCount: 5 }), entry(2, MANAGER), entry(3, SENIOR), entry(4, DIRECTOR)],
    directReports: operators(reportCount).map((operator) => ({ ...operator, managementMetrics: null })),
    viewerOrganizationPath: pathOf(DIRECTOR, SENIOR, MANAGER, COORDINATOR),
    sourceMetadata: null,
  }
}

/** Gerente vendo a própria estrutura: uma Coordenadora que lidera (Abrir estrutura) e um operador direto (folha). */
const MANAGER_OWN: PersonOrganizationStructure = {
  subject: { ...MANAGER, capabilities: LEADER, directReportCount: 2, isViewer: true, managementMetrics: MANAGER_METRICS },
  breadcrumb: [{ personId: "mgr", name: "Roberto Alves", roleLabel: "Gerente", isViewer: true }],
  organizationalContext: { group: { id: "g", name: "Retenção" }, subgroup: null, directManagerStatus: "PRESENT", team: { label: "Estrutura de Eduarda Sênior", leader: entry(1, SENIOR), memberCount: 500, memberCountKind: "OPERATORS_BELOW", memberCountLabel: "Operadores na estrutura" } },
  managementChain: [entry(1, SENIOR), entry(2, DIRECTOR)],
  directReports: [person("coord", "Patrícia Coordenadora", "COORDINATOR", "Coordenador", LEADER, { directReportCount: 5, managementMetrics: COORDINATOR_METRICS }), person("op9", "Bruna Direta", "OPERATOR", "Operador", LEAF, { managementMetrics: null })],
  viewerOrganizationPath: pathOf(DIRECTOR, SENIOR, MANAGER),
  sourceMetadata: null,
}

function renderView(data: PersonOrganizationStructure, props: Partial<Parameters<typeof PersonStructureView>[0]> = {}) {
  service.fetchPersonOrganizationStructure.mockResolvedValue(data)
  const onNavigate = vi.fn()
  const utils = renderWithQuery(<PersonStructureView personId={data.subject.personId} rootPersonId={props.rootPersonId ?? "me"} onNavigate={onNavigate} profileHref={(id) => `/supervisor/operators/${id}?tab=indicators`} {...props} />)
  return { ...utils, onNavigate }
}

/**
 * O React Flow real roda no jsdom: renderiza os nodes com `transform: translate(x, y)` (o layout
 * puro) mas não mede nada — os nodes ficam `visibility: hidden` (por isso as consultas são por
 * atributo, não por role) e as edges só nascem após a medição (cobertas em organization-layout.test.ts).
 */
const flowNodes = () => Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node"))
/** O card (compacto ou expandido) de uma pessoa, pelo botão do cabeçalho. */
function cardOf(name: string): HTMLElement {
  // O aria-label pode ter sufixos ("(selecionada)", "Este caminho leva até você.").
  const header = document.querySelector<HTMLElement>(`[aria-label^="Ver detalhes de ${name}"], [aria-label="Abrir estrutura de ${name}"]`)
  if (!header) throw new Error(`card de ${name} não encontrado`)
  return header.closest<HTMLElement>('[data-slot="structure-person-card"]')!
}
function nodeOf(name: string): { x: number; y: number; width: number; variant: string } {
  const wrapper = cardOf(name).closest<HTMLElement>(".react-flow__node")!
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(wrapper.style.transform)!
  return { x: Number(match[1]), y: Number(match[2]), width: Number.parseFloat(wrapper.style.width), variant: wrapper.querySelector<HTMLElement>("[data-testid^=org-node-]")!.dataset.testid!.replace("org-node-", "") }
}
const headerButton = (name: string) => cardOf(name).querySelector<HTMLButtonElement>("button")!
const expandedCards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="structure-person-card"][data-state="expanded"]'))
const detailsOf = (name: string) => within(cardOf(name)).getByTestId("structure-person-details")
/** Ação dentro do card expandido (o React Flow deixa os nodes `visibility: hidden` no jsdom, então `getByRole` não os enxerga). */
const actionIn = (details: HTMLElement, text: string) => Array.from(details.querySelectorAll<HTMLElement>("button, a")).find((element) => element.textContent?.includes(text)) ?? null
const afterFlow = () => new Promise((resolve) => setTimeout(resolve, 30))

describe("Organograma (React Flow read-only) — gestor imediato, focal e subordinados como nodes", () => {
  it("Operadora: gestor imediato acima da focal (um nível só), focal expandida com os dados dentro, sem subordinados; nada de carrossel, rail ou painel", async () => {
    renderView(OPERATOR_OWN)
    expect(await screen.findByRole("heading", { name: "Minha estrutura" })).toBeInTheDocument()
    await afterFlow()
    expect(flowNodes()).toHaveLength(2)
    const manager = nodeOf("Vanessa Lopes")
    const focal = nodeOf("Luana Brenda")
    expect(manager.variant).toBe("manager")
    expect(focal.variant).toBe("root")
    expect(manager.y).toBeLessThan(focal.y)
    expect(manager.x + manager.width / 2).toBeCloseTo(focal.x + focal.width / 2) // ambos centralizados
    // A focal é um CARD de largura controlada (400px), nunca a largura do canvas.
    expect(focal.width).toBe(NODE_WIDTH.focal)
    expect(cardOf("Luana Brenda")).toHaveClass("w-[25rem]")
    expect(cardOf("Luana Brenda")).not.toHaveClass("w-full")
    expect(cardOf("Luana Brenda")).toHaveAttribute("data-state", "expanded")
    expect(cardOf("Luana Brenda")).not.toHaveTextContent("Estrutura focal")
    expect(cardOf("Luana Brenda")).toHaveTextContent("Você")
    const details = detailsOf("Luana Brenda")
    expect(within(details).getByText("E-mail").nextElementSibling).toHaveTextContent("me@empresa.com")
    expect(within(details).getByText("Capital operacional").nextElementSibling).toHaveTextContent("Fortaleza / CE")
    expect(within(details).queryByText("Cidade")).not.toBeInTheDocument()
    expect(within(details).getByText("Grupo").nextElementSibling).toHaveTextContent("Retenção")
    expect(within(details).getByText("Subgrupo").nextElementSibling).toHaveTextContent("Voz")
    expect(within(details).getByText("Gestor direto").nextElementSibling).toHaveTextContent("Vanessa Lopes")
    expect(actionIn(details, "Abrir estrutura")).toBeNull()
    expect(actionIn(details, "Ver perfil")).toBeNull()
    expect(expandedCards()).toHaveLength(1)
    // Só UM nível acima no canvas: a Coordenadora fica na cadeia secundária.
    expect(document.querySelector('[aria-label="Abrir estrutura de Patrícia Coordenadora"]')).toBeNull()
    expect(screen.getByRole("button", { name: /Ver cadeia de liderança/ })).toHaveTextContent("5 níveis acima")
    for (const gone of ["direct-reports-rail", "person-inspector"]) expect(screen.queryByTestId(gone)).not.toBeInTheDocument()
    // O canvas nunca pode colapsar a 0px (o React Flow é absoluto dentro dele): altura responsiva por classe + mínimo inline.
    expect(screen.getByTestId("structure-canvas")).toHaveClass("h-[32rem]")
    expect(screen.getByTestId("structure-canvas")).toHaveStyle({ minHeight: "32rem" })
    expect(document.querySelector('[data-slot="carousel"]')).toBeNull()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Read-only: nada arrasta, nada conecta; handles existem só para ancorar as edges, invisíveis.
    for (const node of flowNodes()) expect(node.className).not.toContain("draggable")
    for (const handle of document.querySelectorAll(".react-flow__handle")) expect(handle.className).toContain("opacity-0")
  })

  it("clicar no gestor imediato = subir um nível: chama onNavigate com o id dele, sem expandir antes (aria-label 'Abrir estrutura de …')", async () => {
    const { onNavigate } = renderView(OPERATOR_OWN)
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    const manager = document.querySelector<HTMLButtonElement>('[aria-label="Abrir estrutura de Vanessa Lopes"]')!
    expect(manager).toBeEnabled()
    expect(manager).toHaveAttribute("title", "Subir um nível")
    fireEvent.click(manager)
    expect(onNavigate).toHaveBeenCalledWith("sup")
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(1)
  })

  it("gestor imediato que o backend NÃO autoriza (canViewStructure=false) fica visível mas não clicável", async () => {
    renderView({ ...OPERATOR_OWN, managementChain: [entry(1, { ...SUPERVISOR, capabilities: NONE })] })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(document.querySelector('[aria-label="Abrir estrutura de Vanessa Lopes"]')).toBeNull()
    const manager = document.querySelector<HTMLButtonElement>('[data-variant="manager"] button')!
    expect(manager).toHaveAttribute("aria-label", "Vanessa Lopes, Supervisora — Retenção")
    expect(manager).toBeDisabled()
  })

  it("cadeia de liderança (secundária): do topo à focal; 'Abrir' em cada ancestral real (navegável), nunca em quem não é", () => {
    const onOpenStructure = vi.fn()
    renderWithQuery(<LeadershipChainList chain={OPERATOR_OWN.managementChain} subject={OPERATOR_OWN.subject} viewerId="me" onOpenStructure={onOpenStructure} />)
    const chain = document.querySelector<HTMLElement>('ol[aria-label="Cadeia de liderança completa"]')!
    expect(Array.from(chain.querySelectorAll(":scope > li")).map((item) => item.textContent)).toEqual([
      expect.stringContaining("João Diretor"),
      expect.stringContaining("Eduarda Sênior"),
      expect.stringContaining("Roberto Alves"),
      expect.stringContaining("Patrícia Coordenadora"),
      expect.stringContaining("Vanessa Lopes"),
      expect.stringContaining("Luana Brenda"),
    ])
    expect(within(chain).getAllByRole("button", { name: /^Abrir estrutura de/ })).toHaveLength(5)
    fireEvent.click(within(chain).getByRole("button", { name: "Abrir estrutura de João Diretor" }))
    expect(onOpenStructure).toHaveBeenCalledWith("dir")
    cleanup()
    const other = { ...OPERATOR_OWN, managementChain: [entry(1, { ...SUPERVISOR, capabilities: NONE })] }
    renderWithQuery(<LeadershipChainList chain={other.managementChain} subject={other.subject} viewerId="me" onOpenStructure={onOpenStructure} />)
    expect(screen.queryAllByRole("button", { name: /^Abrir estrutura de/ })).toHaveLength(0)
  })

  it("Grupo/Subgrupo ausentes (acima da subárvore) não viram 'Não informado'; papel técnico só quando agrega ao cargo; topo da cadeia sem gestor", async () => {
    const above: PersonOrganizationStructure = { ...MANAGER_OWN, subject: { ...DIRECTOR, jobTitle: "Head de Operações", capabilities: LEADER, directReportCount: 1, isViewer: true }, breadcrumb: [{ personId: "dir", name: "João Diretor", roleLabel: "Diretor", isViewer: true }], managementChain: [], organizationalContext: { ...MANAGER_OWN.organizationalContext, directManagerStatus: "NOT_INFORMED", team: null }, directReports: [person("sr", "Eduarda Sênior", "SENIOR_MANAGER", "Gerente Sênior", LEADER, { jobTitle: "Gerente Sênior — Retenção", directReportCount: 4 })] }
    renderView(above, { rootPersonId: "dir" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(flowNodes()).toHaveLength(2)
    expect(document.querySelector('[data-testid="org-node-manager"]')).toBeNull()
    expect(nodeOf("João Diretor").y).toBe(0)
    const details = detailsOf("João Diretor")
    expect(within(details).queryByText("Grupo")).not.toBeInTheDocument()
    expect(within(details).queryByText("Capital operacional")).not.toBeInTheDocument()
    expect(within(details).getByText("Papel").nextElementSibling).toHaveTextContent("Diretor")
    expect(within(details).getByText("Gestor direto").nextElementSibling).toHaveTextContent("Não informado")
    fireEvent.click(headerButton("Eduarda Sênior"))
    expect(within(detailsOf("Eduarda Sênior")).queryByText("Papel")).not.toBeInTheDocument()
  })

  it("a roda/trackpad sobre o canvas dá ZOOM (nunca pan — regressão do canvas vazio): a escala muda, a translação da árvore não é empurrada para fora", async () => {
    renderView(OPERATOR_OWN)
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    const pane = document.querySelector<HTMLElement>(".react-flow__pane")!
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")!
    const scaleOf = () => Number(/scale\(([\d.]+)\)/.exec(viewport.style.transform)?.[1] ?? "1")
    const before = scaleOf()
    const wheel = new WheelEvent("wheel", { deltaY: 400, bubbles: true, cancelable: true })
    pane.dispatchEvent(wheel)
    await afterFlow()
    expect(wheel.defaultPrevented).toBe(true) // a roda é do canvas: zoom, não rolagem da página
    expect(scaleOf()).toBeLessThan(before)
    expect(scaleOf()).toBeGreaterThanOrEqual(0.55)
  })

  it("aba inicialmente INATIVA (o ProfileWorkspace só monta a aba ativa): ao ativar 'Minha estrutura' o organograma nasce com os nodes no DOM", async () => {
    service.fetchPersonOrganizationStructure.mockResolvedValue(OPERATOR_OWN)
    function Harness() {
      const [tab, setTab] = useState<"indicators" | "structure">("indicators")
      return (
        <div>
          <button type="button" onClick={() => setTab("structure")}>
            Minha estrutura (aba)
          </button>
          {tab === "structure" ? <PersonStructureView personId="me" rootPersonId="me" onNavigate={() => {}} profileHref={(id) => `/e/${id}`} /> : <p>Indicadores</p>}
        </div>
      )
    }
    renderWithQuery(<Harness />)
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Minha estrutura (aba)" }))
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(document.querySelectorAll(".react-flow__node").length).toBeGreaterThanOrEqual(1)
    expect(nodeOf("Luana Brenda").variant).toBe("root")
    expect(nodeOf("Vanessa Lopes").variant).toBe("manager")
  })

  it("403 continua 'Sem acesso a esta estrutura'", async () => {
    service.fetchPersonOrganizationStructure.mockRejectedValue(new ApiError("Você não tem acesso a esta estrutura.", 403, "STRUCTURE_ACCESS_DENIED"))
    renderWithQuery(<PersonStructureView personId="other" rootPersonId="me" onNavigate={() => {}} profileHref={() => "#"} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem acesso a esta estrutura")
  })
})

describe("Organograma — subordinados como nodes, seleção, Abrir estrutura e trilha", () => {
  it("Gerente: subordinados abaixo da focal, centralizados; clicar num filho expande só ele no lugar (focal continua focal e compacta), clicar noutro transfere; zero request", async () => {
    const { onNavigate } = renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(flowNodes()).toHaveLength(4)
    const focal = nodeOf("Roberto Alves")
    const a = nodeOf("Patrícia Coordenadora")
    const b = nodeOf("Bruna Direta")
    expect(a.variant).toBe("node")
    expect(a.y).toBe(b.y)
    expect(a.y).toBeGreaterThan(focal.y)
    expect(a.x).toBeLessThan(b.x)
    expect((a.x + b.x + b.width) / 2).toBeCloseTo(focal.x + focal.width / 2) // linha centralizada na focal
    expect(a.width).toBe(NODE_WIDTH.report)
    expect(cardOf("Patrícia Coordenadora")).toHaveTextContent("5 diretos · 121 em produção")
    expect(headerButton("Patrícia Coordenadora")).toHaveAttribute("aria-label", "Ver detalhes de Patrícia Coordenadora")

    fireEvent.click(headerButton("Patrícia Coordenadora"))
    expect(cardOf("Patrícia Coordenadora")).toHaveAttribute("data-state", "expanded")
    expect(cardOf("Patrícia Coordenadora")).toHaveClass("w-[18.75rem]") // largura praticamente fixa: cresce para baixo
    expect(cardOf("Roberto Alves")).toHaveAttribute("data-state", "compact")
    expect(cardOf("Roberto Alves")).toHaveAttribute("data-focal", "true")
    expect(nodeOf("Roberto Alves").variant).toBe("root")
    expect(expandedCards()).toHaveLength(1)
    expect(within(detailsOf("Patrícia Coordenadora")).getByText("Gestor direto").nextElementSibling).toHaveTextContent("Roberto Alves")

    fireEvent.click(headerButton("Bruna Direta"))
    expect(cardOf("Bruna Direta")).toHaveAttribute("data-state", "expanded")
    expect(cardOf("Patrícia Coordenadora")).toHaveAttribute("data-state", "compact")
    expect(expandedCards()).toHaveLength(1)
    expect(actionIn(detailsOf("Bruna Direta"), "Ver perfil")).toHaveAttribute("href", "/supervisor/operators/op9?tab=indicators")
    expect(actionIn(detailsOf("Bruna Direta"), "Abrir estrutura")).toBeNull()
    expect(screen.getByRole("heading", { name: "Minha estrutura" })).toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(1)
  })

  it("'Abrir estrutura' só com hasReports + canViewStructure (Coordenadora subordinada), sem 'Ver perfil'; a própria focal não tem o botão", async () => {
    const { onNavigate } = renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(actionIn(detailsOf("Roberto Alves"), "Abrir estrutura")).toBeNull()
    fireEvent.click(headerButton("Patrícia Coordenadora"))
    const details = detailsOf("Patrícia Coordenadora")
    expect(actionIn(details, "Ver perfil")).toBeNull()
    fireEvent.click(actionIn(details, "Abrir estrutura")!)
    expect(onNavigate).toHaveBeenCalledWith("coord")
  })

  it("após abrir outra estrutura (ou Back/Forward/refresh): 1 request nova, a aberta vira a focal expandida com o gestor dela acima; a trilha reflete o caminho real", async () => {
    const { rerender, onNavigate } = renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    fireEvent.click(headerButton("Bruna Direta"))
    expect(cardOf("Bruna Direta")).toHaveAttribute("data-state", "expanded")

    const focal = supervisorFocal(3)
    focal.breadcrumb = [{ personId: "mgr", name: "Roberto Alves", roleLabel: "Gerente", isViewer: true }, { personId: "coord", name: "Patrícia Coordenadora", roleLabel: "Coordenador", isViewer: false }, { personId: "sup", name: "Vanessa Lopes", roleLabel: "Supervisor", isViewer: false }]
    service.fetchPersonOrganizationStructure.mockResolvedValue(focal)
    rerender(<PersonStructureView personId="sup" rootPersonId="mgr" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
    expect(await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })).toBeInTheDocument()
    await afterFlow()
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(2)
    expect(flowNodes()).toHaveLength(5)
    expect(nodeOf("Vanessa Lopes").variant).toBe("root")
    expect(cardOf("Vanessa Lopes")).toHaveAttribute("data-state", "expanded")
    expect(nodeOf("Patrícia Coordenadora").variant).toBe("manager")
    expect(nodeOf("Patrícia Coordenadora").y).toBeLessThan(nodeOf("Vanessa Lopes").y)
    expect(expandedCards()).toHaveLength(1)
    const trail = screen.getByRole("navigation", { name: "Trilha da estrutura" })
    expect(trail).toHaveTextContent("Minha estruturaPatrícia CoordenadoraVanessa Lopes")
    fireEvent.click(within(trail).getByRole("button", { name: "Patrícia Coordenadora" }))
    expect(onNavigate).toHaveBeenLastCalledWith("coord")
    fireEvent.click(within(trail).getByRole("button", { name: "Minha estrutura" }))
    expect(onNavigate).toHaveBeenLastCalledWith(null)

    // Back do navegador (URL volta ao Gerente): focal e selecionada voltam a ser ele.
    service.fetchPersonOrganizationStructure.mockResolvedValue(MANAGER_OWN)
    rerender(<PersonStructureView personId="mgr" rootPersonId="mgr" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
    expect(await screen.findByRole("heading", { name: "Minha estrutura" })).toBeInTheDocument()
    await afterFlow()
    expect(cardOf("Roberto Alves")).toHaveAttribute("data-state", "expanded")
    expect(nodeOf("Roberto Alves").variant).toBe("root")
  })

  it("subir pelo gestor: a nova focal é o ancestral, o viewer aparece entre os subordinados (com 'Você' e 'Abrir estrutura' para voltar) e a trilha acumula 'Minha estrutura › gestor'", async () => {
    const { rerender, onNavigate } = renderView(OPERATOR_OWN)
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    fireEvent.click(document.querySelector<HTMLButtonElement>('[aria-label="Abrir estrutura de Vanessa Lopes"]')!)
    expect(onNavigate).toHaveBeenCalledWith("sup")
    const up: PersonOrganizationStructure = {
      subject: { ...SUPERVISOR, directReportCount: 2, isViewer: false },
      breadcrumb: [{ personId: "me", name: "Luana Brenda", roleLabel: "Operador", isViewer: true }, { personId: "sup", name: "Vanessa Lopes", roleLabel: "Supervisor", isViewer: false }],
      organizationalContext: { group: { id: "g", name: "Retenção" }, subgroup: { id: "s", name: "Voz" }, directManagerStatus: "PRESENT", team: null },
      managementChain: [entry(1, COORDINATOR), entry(2, MANAGER)],
      directReports: [{ ...OPERATOR_OWN.subject, capabilities: { canViewProfile: false, canViewStructure: true, hasReports: false } }, person("colega", "Marina Colega", "OPERATOR", "Operador", { canViewProfile: false, canViewStructure: false, hasReports: false })],
      viewerOrganizationPath: pathOf(DIRECTOR, SENIOR, MANAGER, COORDINATOR, SUPERVISOR, { personId: "me", name: "Luana Brenda", roleLabel: "Operador" }),
      sourceMetadata: null,
    }
    service.fetchPersonOrganizationStructure.mockResolvedValue(up)
    rerender(<PersonStructureView personId="sup" rootPersonId="me" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
    expect(await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })).toBeInTheDocument()
    await afterFlow()
    expect(nodeOf("Vanessa Lopes").variant).toBe("root")
    expect(nodeOf("Patrícia Coordenadora").variant).toBe("manager") // um nível só: Roberto fica na cadeia secundária
    expect(document.querySelector('[aria-label="Abrir estrutura de Roberto Alves"]')).toBeNull()
    expect(nodeOf("Luana Brenda").variant).toBe("node")
    expect(cardOf("Luana Brenda")).toHaveTextContent("Você")
    expect(screen.getByRole("navigation", { name: "Trilha da estrutura" })).toHaveTextContent("Minha estruturaVanessa Lopes")
    // A colega aparece com os dados profissionais, sem ficha nem estrutura.
    fireEvent.click(headerButton("Marina Colega"))
    expect(within(detailsOf("Marina Colega")).getByText("E-mail").nextElementSibling).toHaveTextContent("colega@empresa.com")
    expect(actionIn(detailsOf("Marina Colega"), "Abrir estrutura")).toBeNull()
    expect(actionIn(detailsOf("Marina Colega"), "Ver perfil")).toBeNull()
    // Subir de novo: o gestor da Supervisora.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[aria-label="Abrir estrutura de Patrícia Coordenadora"]')!)
    expect(onNavigate).toHaveBeenLastCalledWith("coord")
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(2)
  })

  it("muitos subordinados: nodes em várias linhas balanceadas (nunca uma fileira), busca seleciona e centraliza a pessoa sem remover os outros nodes — sem nova request", async () => {
    renderView(supervisorFocal(SEARCH_MIN_REPORTS + 3), { rootPersonId: "coord" })
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    expect(flowNodes()).toHaveLength(SEARCH_MIN_REPORTS + 3 + 2)
    const ys = new Set(Array.from({ length: SEARCH_MIN_REPORTS + 3 }, (_, index) => nodeOf(`Operador ${String(index + 1).padStart(2, "0")} Silva`).y))
    expect(ys.size).toBe(3) // 12 filhos → 3 linhas (4+4+4)
    const search = screen.getByRole("searchbox", { name: "Buscar nesta estrutura" })
    fireEvent.change(search, { target: { value: "op11@" } })
    expect(cardOf("Operador 11 Silva")).toHaveAttribute("data-state", "expanded")
    expect(expandedCards()).toHaveLength(1)
    expect(flowNodes()).toHaveLength(SEARCH_MIN_REPORTS + 3 + 2) // ninguém some
    expect(screen.getByText(/1 pessoa encontrada · Operador 11 Silva/)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: "operadora de atendimento" } })
    expect(cardOf("Operador 01 Silva")).toHaveAttribute("data-state", "expanded")
    fireEvent.change(search, { target: { value: "zzz" } })
    expect(screen.getByText(/Ninguém nesta estrutura corresponde/)).toBeInTheDocument()
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(1)
    cleanup()
    renderView(supervisorFocal(3), { rootPersonId: "coord" })
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  })

  it("Avatar do Design System em todo node: foto quando avatarUrl existe (AvatarImage), iniciais só sem foto ou quando a imagem falha", async () => {
    renderView(supervisorFocal(3), { rootPersonId: "coord" })
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    await waitFor(() => expect(cardOf("Operador 01 Silva").querySelector('img[data-slot="avatar-image"]')).toHaveAttribute("src", "/fotos/op1.png"))
    expect(within(cardOf("Operador 01 Silva")).queryByText("O0")).not.toBeInTheDocument()
    await waitFor(() => expect(within(cardOf("Operador 02 Silva")).getByText("O0")).toBeInTheDocument())
    expect(cardOf("Operador 02 Silva").querySelector("img")).toBeNull()
    expect(within(cardOf("Operador 03 Silva")).getByText("O0")).toBeInTheDocument()
    expect(document.querySelectorAll('.react-flow__node [data-slot="avatar"]')).toHaveLength(5)
  })

  it("'Você' marca a pessoa logada mesmo quando a focal é outra; nunca expõe performance", async () => {
    const focal = supervisorFocal(2)
    focal.directReports[0] = { ...focal.directReports[0]!, personId: "coord" }
    const { container } = renderView(focal, { rootPersonId: "coord" })
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    expect(cardOf("Operador 01 Silva")).toHaveTextContent("Você")
    expect(cardOf("Vanessa Lopes")).not.toHaveTextContent("Você")
    // Nenhum card expõe performance nem a situação funcional INDIVIDUAL de alguém; o resumo agregado da estrutura (cabeçalho) é outra coisa.
    for (const forbidden of ["PRV", "Quartil", "Atingimento", "Férias", "INSS", "%"]) expect(screen.getByTestId("structure-canvas")).not.toHaveTextContent(forbidden)
    expect(container).not.toHaveTextContent("PRV")
  })
})

/** Seção ativa do card expandido (a Tabs do Design System marca `data-state="active"` no trigger). */
const activeSection = (name: string) => cardOf(name).querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]')?.dataset.section ?? null
const sectionTriggers = (name: string) => Array.from(cardOf(name).querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]'))
const trigger = (name: string, section: string) => cardOf(name).querySelector<HTMLButtonElement>(`[data-slot="tabs-trigger"][data-section="${section}"]`)!
/** Troca de seção pelo teclado (foco ativa a aba no Radix Tabs) — um mousedown subiria até o pane do React Flow (d3-zoom) no jsdom. */
const openSection = (name: string, section: string) => fireEvent.focus(trigger(name, section))
const canvas = () => screen.getByTestId("structure-canvas")

describe("Card expandido de líder — header fixo e seções (Colaborador · Estrutura · Reporta-se à)", () => {
  it("header fixo (avatar, nome, cargo, área, 'N diretos') não muda ao trocar de seção; a seção inicial é Dados do colaborador; trocar de seção = zero request", async () => {
    renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    const card = cardOf("Roberto Alves")
    const header = () => card.querySelector<HTMLElement>('[aria-label^="Ver detalhes de Roberto Alves"]')!.parentElement!.textContent
    expect(card.querySelector('[data-slot="avatar"]')).not.toBeNull()
    expect(header()).toContain("Roberto Alves")
    expect(header()).toContain("Gerente")
    expect(header()).toContain("Retenção")
    expect(header()).toContain("2 diretos")
    expect(card).not.toHaveTextContent("2 pessoas")
    const before = header()
    expect(activeSection("Roberto Alves")).toBe("person")
    expect(sectionTriggers("Roberto Alves").map((element) => element.dataset.section)).toEqual(["person", "structure", "reportsTo"])
    // Focal (400px): rótulos visíveis, com ícone.
    expect(trigger("Roberto Alves", "structure")).toHaveTextContent("Estrutura")
    expect(trigger("Roberto Alves", "structure")).toHaveAttribute("aria-label", "Dados da estrutura")
    expect(trigger("Roberto Alves", "structure").querySelector("span.sr-only")).toBeNull()

    openSection("Roberto Alves", "structure")
    expect(activeSection("Roberto Alves")).toBe("structure")
    expect(within(card).getByTestId("section-structure")).toBeInTheDocument()
    openSection("Roberto Alves", "reportsTo")
    expect(activeSection("Roberto Alves")).toBe("reportsTo")
    expect(header()).toBe(before)
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(1)
  })

  it("Dados da estrutura (Gerente): cargos da estrutura, quantidade + porcentagem por situação com o total, span, abrangência, médias por camada — sem gráfico, sem avaliação", async () => {
    renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    openSection("Roberto Alves", "structure")
    const section = within(cardOf("Roberto Alves")).getByTestId("section-structure")
    expect(within(section).getByTestId("structural-population")).toHaveTextContent("511 pessoas")
    expect(section).toHaveTextContent("4 Coordenadores · 20 Supervisores · 487 Operadores")
    const row = (bucket: string) => section.querySelector<HTMLElement>(`[data-bucket="${bucket}"]`)!.textContent
    expect(row("EM_PRODUCAO")).toBe("Em produção48093,9%")
    expect(row("FERIAS")).toBe("Férias203,9%")
    expect(row("INSS")).toBe("INSS51,0%")
    expect(row("MATERNIDADE")).toBe("Maternidade30,6%")
    expect(row("PATERNIDADE")).toBe("Paternidade10,2%")
    expect(row("OTHER")).toBe("Outras situações20,4%")
    // Os buckets explicam o total.
    expect(Array.from(section.querySelectorAll("[data-bucket] dd:first-of-type")).reduce((sum, cell) => sum + Number(cell.textContent), 0)).toBe(511)
    expect(within(section).getByTestId("metric-span")).toHaveTextContent("Span de controle4 diretos")
    expect(within(section).getByTestId("metric-reach")).toHaveTextContent("Abrangência operacional487 operadores")
    const layers = within(section).getAllByTestId("metric-layer")
    expect(layers[0]).toHaveTextContent("Média da estrutura5,0 supervisões / coordenação")
    expect(layers[1]).toHaveTextContent("Média da estrutura24,4 operadores / supervisão")
    expect(within(section).queryByTestId("metric-benchmark")).not.toBeInTheDocument()
    expect(within(section).queryByTestId("privacy-note")).not.toBeInTheDocument()
    expect(within(section).queryByTestId("unconfirmed-note")).not.toBeInTheDocument()
    for (const forbidden of ["ideal", "bom", "ruim", "alto", "baixo", "PRV", "Quartil"]) expect(section.textContent!.toLowerCase()).not.toContain(forbidden.toLowerCase())
    expect(section.querySelector("svg.recharts-surface, canvas")).toBeNull()
  })

  it("Dados da estrutura (Coordenadora subordinada, card de 300px): abas viram ÍCONES com Tooltip e nome acessível; referência do Grupo com população; sem overflow horizontal", async () => {
    renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    fireEvent.click(headerButton("Patrícia Coordenadora"))
    const card = cardOf("Patrícia Coordenadora")
    expect(card).toHaveClass("w-[18.75rem]")
    for (const [section, label] of [["person", "Dados do colaborador"], ["structure", "Dados da estrutura"], ["reportsTo", "Reporta-se à"]] as const) {
      const element = trigger("Patrícia Coordenadora", section)
      expect(element).toHaveAttribute("aria-label", label)
      expect(element.querySelector("span.sr-only")).toHaveTextContent(label)
      expect(element.querySelector("svg")).not.toBeNull()
    }
    openSection("Patrícia Coordenadora", "structure")
    const section = within(card).getByTestId("section-structure")
    expect(within(section).getByTestId("structural-population")).toHaveTextContent("130 pessoas")
    expect(section).toHaveTextContent("5 Supervisores · 125 Operadores")
    expect(section.querySelector('[data-bucket="EM_PRODUCAO"]')).toHaveTextContent("Em produção12193,1%")
    expect(within(section).getByTestId("metric-span")).toHaveTextContent("5 diretos")
    expect(within(section).getByTestId("metric-reach")).toHaveTextContent("125 operadores")
    expect(within(section).getByTestId("metric-layer")).toHaveTextContent("25,0 operadores / supervisão")
    expect(within(section).getByTestId("metric-benchmark")).toHaveTextContent("Referência do Grupo24,6 diretos / coordenação4 coordenações em Atendimento B2B")
    // Tooltips de conceito (ícone ?) — nunca escondem os valores principais.
    for (const concept of ["Sobre span de controle", "Sobre abrangência operacional", "Sobre média da estrutura", "Sobre referência do grupo"]) expect(section.querySelector(`button[aria-label="${concept}"]`)).not.toBeNull()
    // Nada dentro do node pode forçar rolagem horizontal: só larguras fixas e truncamento.
    expect(card.className).not.toContain("overflow-x")
    expect(section.querySelector(".whitespace-nowrap:not(.sr-only)")).toBeNull()
  })

  it("Reporta-se à: gestor imediato com foto, cargo e 'Abrir estrutura'; clicar navega (mesma animação de subida); no topo, estado 'Topo da estrutura organizacional'", async () => {
    const { onNavigate } = renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    openSection("Roberto Alves", "reportsTo")
    const section = within(cardOf("Roberto Alves")).getByTestId("section-reports-to")
    expect(within(section).getByTestId("reports-to")).toHaveTextContent("Eduarda Sênior")
    expect(within(section).getByTestId("reports-to")).toHaveTextContent("Gerente Sênior")
    expect(section.querySelector('[data-slot="avatar"]')).not.toBeNull()
    fireEvent.click(actionIn(section, "Abrir estrutura")!)
    expect(onNavigate).toHaveBeenCalledWith("sr")
    // A viagem sobe pela edge gestor → focal, em sentido reverso — junto com a navegação, sem esperar.
    expect(canvas()).toHaveAttribute("data-travel-edge", "e-sr-mgr")
    expect(canvas()).toHaveAttribute("data-travel-direction", "reverse")
    cleanup()

    const top: PersonOrganizationStructure = { ...MANAGER_OWN, subject: { ...DIRECTOR, capabilities: LEADER, directReportCount: 1, isViewer: true, managementMetrics: MANAGER_METRICS }, breadcrumb: [{ personId: "dir", name: "João Diretor", roleLabel: "Diretor", isViewer: true }], managementChain: [], organizationalContext: { ...MANAGER_OWN.organizationalContext, directManagerStatus: "NOT_INFORMED", team: null }, directReports: [person("sr", "Eduarda Sênior", "SENIOR_MANAGER", "Gerente Sênior", LEADER, { directReportCount: 4, managementMetrics: COORDINATOR_METRICS })] }
    renderView(top, { rootPersonId: "dir" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    openSection("João Diretor", "reportsTo")
    expect(within(cardOf("João Diretor")).getByTestId("reports-to-top")).toHaveTextContent("Topo da estrutura organizacional")
    // Num subordinado, "Reporta-se à" é a própria focal: abrir só seleciona a focal (zero request).
    fireEvent.click(headerButton("Eduarda Sênior"))
    openSection("Eduarda Sênior", "reportsTo")
    fireEvent.click(actionIn(within(cardOf("Eduarda Sênior")).getByTestId("section-reports-to"), "Abrir estrutura")!)
    expect(cardOf("João Diretor")).toHaveAttribute("data-state", "expanded")
    expect(canvas()).toHaveAttribute("data-travel-edge", "e-dir-sr")
    expect(canvas()).toHaveAttribute("data-travel-direction", "reverse")
    expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(2) // uma por renderização desta prova — nenhuma pela seção
  })

  it("Operador viewer: sem aba Dados da estrutura, sem contagens de situação, sem span/benchmark — só o dado estrutural comum 'N diretos'; a navegação continua livre", async () => {
    renderView({ ...OPERATOR_OWN, directReports: [], subject: { ...OPERATOR_OWN.subject, managementMetrics: null } })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(sectionTriggers("Luana Brenda").map((element) => element.dataset.section)).toEqual(["person", "reportsTo"])
    cleanup()
    // Operadora subindo até a Supervisora: a Supervisora (focal) e a colega Supervisora de outra árvore vêm SEM métricas.
    const up: PersonOrganizationStructure = {
      subject: { ...SUPERVISOR, directReportCount: 25, isViewer: false, capabilities: LEADER, managementMetrics: null },
      breadcrumb: [{ personId: "me", name: "Luana Brenda", roleLabel: "Operador", isViewer: true }, { personId: "sup", name: "Vanessa Lopes", roleLabel: "Supervisor", isViewer: false }],
      organizationalContext: { group: { id: "g", name: "Retenção" }, subgroup: { id: "s", name: "Voz" }, directManagerStatus: "PRESENT", team: null },
      managementChain: [entry(1, COORDINATOR)],
      directReports: [{ ...OPERATOR_OWN.subject, capabilities: { canViewProfile: false, canViewStructure: true, hasReports: false }, managementMetrics: null }, person("lider", "Zélia Supervisora", "SUPERVISOR", "Supervisor", LEADER, { directReportCount: 12, managementMetrics: null })],
      viewerOrganizationPath: pathOf(DIRECTOR, SENIOR, MANAGER, COORDINATOR, SUPERVISOR, { personId: "me", name: "Luana Brenda", roleLabel: "Operador" }),
      sourceMetadata: null,
    }
    const { onNavigate } = renderView(up, { rootPersonId: "me" })
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    expect(cardOf("Vanessa Lopes")).toHaveTextContent("25 diretos")
    expect(sectionTriggers("Vanessa Lopes").map((element) => element.dataset.section)).toEqual(["person", "reportsTo"])
    expect(cardOf("Zélia Supervisora")).toHaveTextContent("12 diretos")
    expect(cardOf("Zélia Supervisora")).not.toHaveTextContent("em produção")
    expect(screen.queryByTestId("structure-compact-summary")).not.toBeInTheDocument()
    for (const forbidden of ["Em produção", "Férias", "INSS", "Referência do Grupo", "Span", "%"]) expect(canvas()).not.toHaveTextContent(forbidden)
    fireEvent.click(headerButton("Zélia Supervisora"))
    expect(within(detailsOf("Zélia Supervisora")).queryByTestId("section-structure")).not.toBeInTheDocument()
    fireEvent.click(actionIn(detailsOf("Zélia Supervisora"), "Abrir estrutura")!)
    expect(onNavigate).toHaveBeenCalledWith("lider")
  })

  it("Gestor viewer, card compacto de líder: 'N diretos · N em produção'; a affordance 'N diretos' abre o card DIRETO em Dados da estrutura (Tooltip do span)", async () => {
    renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(within(cardOf("Patrícia Coordenadora")).getByTestId("structure-compact-summary")).toHaveTextContent("5 diretos · 121 em produção")
    expect(within(cardOf("Bruna Direta")).queryByTestId("structure-compact-summary")).not.toBeInTheDocument()
    // Compacto: o header não repete "5 diretos" (a linha de resumo já diz); a linha é a affordance de estrutura.
    expect(cardOf("Patrícia Coordenadora").querySelector('[aria-label="5 diretos — abrir dados da estrutura"]')).toBeNull()
    fireEvent.click(within(cardOf("Patrícia Coordenadora")).getByTestId("structure-compact-summary"))
    expect(cardOf("Patrícia Coordenadora")).toHaveAttribute("data-state", "expanded")
    expect(activeSection("Patrícia Coordenadora")).toBe("structure")
    // Expandido: "5 diretos" volta ao header, como trigger do Tooltip do span (Radix marca data-state), e também abre a seção.
    const chip = cardOf("Patrícia Coordenadora").querySelector<HTMLButtonElement>('[aria-label="5 diretos — abrir dados da estrutura"]')!
    expect(chip).toHaveAttribute("data-state")
    expect(SPAN_TOOLTIP).toContain("reportam diretamente")
    fireEvent.click(headerButton("Bruna Direta"))
    expect(cardOf("Patrícia Coordenadora")).toHaveAttribute("data-state", "compact")
    expect(within(cardOf("Patrícia Coordenadora")).getByTestId("structure-compact-summary")).toHaveTextContent("5 diretos · 121 em produção")
  })

  it("privacidade dos agregados pequenos: 'Afastamentos' somados + aviso; fonte atrasada: 'Não confirmado' em vez de 'Em produção' + aviso", async () => {
    const small = metrics({ structuralPopulation: 2, directSpan: 2, operatorReach: 2, statusDistribution: [{ bucket: "EM_PRODUCAO", count: 1, percent: 50 }, { bucket: "FERIAS", count: 0, percent: 0 }, { bucket: "SENSITIVE_LEAVE", count: 1, percent: 50 }], privacy: { sensitiveBreakdownSuppressed: true, minimumPopulation: 5 }, groupBenchmark: null })
    const stale = metrics({ statusDistribution: [{ bucket: "EM_PRODUCAO", count: 0, percent: 0 }, { bucket: "FERIAS", count: 2, percent: 6.7 }, { bucket: "INSS", count: 1, percent: 3.3 }, { bucket: "MATERNIDADE", count: 1, percent: 3.3 }, { bucket: "PATERNIDADE", count: 0, percent: 0 }, { bucket: "UNCONFIRMED", count: 26, percent: 86.7 }], confidence: { statusFreshness: "STALE", unconfirmed: 26 } })
    const data: PersonOrganizationStructure = { ...MANAGER_OWN, subject: { ...MANAGER_OWN.subject, managementMetrics: stale }, directReports: [person("coord", "Patrícia Coordenadora", "COORDINATOR", "Coordenador", LEADER, { directReportCount: 2, managementMetrics: small })] }
    renderView(data, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    openSection("Roberto Alves", "structure")
    const staleSection = within(cardOf("Roberto Alves")).getByTestId("section-structure")
    expect(staleSection.querySelector('[data-bucket="UNCONFIRMED"]')).toHaveTextContent("Não confirmado2686,7%")
    expect(staleSection.querySelector('[data-bucket="EM_PRODUCAO"]')).toHaveTextContent("Em produção00,0%")
    expect(within(staleSection).getByTestId("unconfirmed-note")).toHaveTextContent("26 situações não confirmadas")
    fireEvent.click(headerButton("Patrícia Coordenadora"))
    openSection("Patrícia Coordenadora", "structure")
    const smallSection = within(cardOf("Patrícia Coordenadora")).getByTestId("section-structure")
    expect(smallSection.querySelector('[data-bucket="SENSITIVE_LEAVE"]')).toHaveTextContent("Afastamento (motivo protegido)150,0%")
    expect(smallSection.querySelector('[data-bucket="MATERNIDADE"]')).toBeNull()
    expect(smallSection).not.toHaveTextContent("INSS")
    expect(within(smallSection).getByTestId("privacy-note")).toHaveTextContent("Detalhamento de afastamentos indisponível para estruturas pequenas (menos de 5 operadores)")
  })

  it("afastamento de líder ao lado dos tipos dos operadores: só como motivo protegido, com o aviso (4ª auditoria, C14)", async () => {
    const withLeaderLeave = metrics({ statusDistribution: [{ bucket: "EM_PRODUCAO", count: 25, percent: 83.3 }, { bucket: "FERIAS", count: 0, percent: 0 }, { bucket: "INSS", count: 2, percent: 6.7 }, { bucket: "MATERNIDADE", count: 2, percent: 6.7 }, { bucket: "PATERNIDADE", count: 0, percent: 0 }, { bucket: "SENSITIVE_LEAVE", count: 1, percent: 3.3 }] })
    renderView({ ...MANAGER_OWN, subject: { ...MANAGER_OWN.subject, managementMetrics: withLeaderLeave } }, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    openSection("Roberto Alves", "structure")
    const section = within(cardOf("Roberto Alves")).getByTestId("section-structure")
    expect(section.querySelector('[data-bucket="MATERNIDADE"]')).toHaveTextContent("Maternidade26,7%")
    expect(section.querySelector('[data-bucket="SENSITIVE_LEAVE"]')).toHaveTextContent("Afastamento (motivo protegido)13,3%")
    expect(within(section).getByTestId("privacy-note")).toHaveTextContent("afastamentos de líderes ficam somados, sem o motivo")
  })
})

describe("Animação de navegação — sinal na edge, viewport e chegada (fluxo de estado, não pixels)", () => {
  it("selecionar um filho: viagem focal → filho na edge direta (forward) pela duração da viagem, depois chegada no filho; zero request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderView(MANAGER_OWN, { rootPersonId: "mgr" })
      await screen.findByRole("heading", { name: "Minha estrutura" })
      await afterFlow()
      fireEvent.click(headerButton("Bruna Direta"))
      expect(canvas()).toHaveAttribute("data-travel-edge", "e-mgr-op9")
      expect(canvas()).toHaveAttribute("data-travel-direction", "forward")
      expect(canvas()).not.toHaveAttribute("data-arrival")
      expect(cardOf("Bruna Direta")).toHaveAttribute("data-state", "expanded")
      await act(() => vi.advanceTimersByTimeAsync(FLOW_TRAVEL_DURATION_MS + 10))
      expect(canvas()).not.toHaveAttribute("data-travel-edge")
      expect(canvas()).toHaveAttribute("data-arrival", "op9")
      expect(cardOf("Bruna Direta")).toHaveAttribute("data-arrived", "true")
      expect(cardOf("Bruna Direta")).toHaveClass("inia-flow-arrival")
      await act(() => vi.advanceTimersByTimeAsync(FLOW_ARRIVAL_DURATION_MS + 10))
      expect(canvas()).not.toHaveAttribute("data-arrival")
      expect(cardOf("Bruna Direta")).not.toHaveClass("inia-flow-arrival")
      expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("subir pelo gestor: viagem REVERSA pela edge gestor → focal, junto com a navegação; 'Abrir estrutura' num filho líder: viagem forward + navegação", async () => {
    const { onNavigate } = renderView(MANAGER_OWN, { rootPersonId: "mgr" })
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    fireEvent.click(document.querySelector<HTMLButtonElement>('[aria-label="Abrir estrutura de Eduarda Sênior"]')!)
    expect(onNavigate).toHaveBeenCalledWith("sr")
    expect(canvas()).toHaveAttribute("data-travel-edge", "e-sr-mgr")
    expect(canvas()).toHaveAttribute("data-travel-direction", "reverse")
    fireEvent.click(headerButton("Patrícia Coordenadora"))
    fireEvent.click(actionIn(detailsOf("Patrícia Coordenadora"), "Abrir estrutura")!)
    expect(onNavigate).toHaveBeenLastCalledWith("coord")
    expect(canvas()).toHaveAttribute("data-travel-edge", "e-mgr-coord")
    expect(canvas()).toHaveAttribute("data-travel-direction", "forward")
  })

  it("busca: a câmera conduz até a pessoa — com o sinal na edge direta focal → pessoa quando ela existe; sem edge (a própria focal) só centralização + chegada; com prefers-reduced-motion não há viagem, a chegada é imediata", async () => {
    renderView(supervisorFocal(SEARCH_MIN_REPORTS + 3), { rootPersonId: "coord" })
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar nesta estrutura" }), { target: { value: "op11@" } })
    expect(cardOf("Operador 11 Silva")).toHaveAttribute("data-state", "expanded")
    await waitFor(() => expect(canvas()).toHaveAttribute("data-travel-edge", "e-sup-op11"))
    expect(canvas()).toHaveAttribute("data-travel-direction", "forward")
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar nesta estrutura" }), { target: { value: "Vanessa" } })
    await waitFor(() => expect(canvas()).toHaveAttribute("data-arrival", "sup"))
    expect(canvas()).not.toHaveAttribute("data-travel-edge")
    cleanup()

    const original = window.matchMedia
    window.matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList
    try {
      renderView(MANAGER_OWN, { rootPersonId: "mgr" })
      await screen.findByRole("heading", { name: "Minha estrutura" })
      await afterFlow()
      fireEvent.click(headerButton("Bruna Direta"))
      expect(canvas()).not.toHaveAttribute("data-travel-edge")
      expect(canvas()).toHaveAttribute("data-arrival", "op9")
      expect(cardOf("Bruna Direta")).toHaveAttribute("data-state", "expanded")
    } finally {
      window.matchMedia = original
    }
  })
})

/** Operadora Luana olhando para cima: Diretor focal (com dois Sêniores) e, um nível abaixo, a Sênior focal (com dois Gerentes). */
const OPERATOR_PATH = pathOf(DIRECTOR, SENIOR, MANAGER, COORDINATOR, SUPERVISOR, { personId: "me", name: "Luana Brenda", roleLabel: "Operador" })
const OTHER_SENIOR = person("sr2", "Otávio Outro Sênior", "SENIOR_MANAGER", "Gerente Sênior", LEADER, { directReportCount: 4 })
const DIRECTOR_FOCAL: PersonOrganizationStructure = {
  subject: { ...DIRECTOR, capabilities: LEADER, directReportCount: 2, isViewer: false, managementMetrics: null },
  breadcrumb: [{ personId: "me", name: "Luana Brenda", roleLabel: "Operador", isViewer: true }, { personId: "dir", name: "João Diretor", roleLabel: "Diretor", isViewer: false }],
  organizationalContext: { group: null, subgroup: null, directManagerStatus: "NOT_INFORMED", team: null },
  managementChain: [],
  directReports: [{ ...SENIOR, capabilities: LEADER, directReportCount: 4, managementMetrics: null }, OTHER_SENIOR],
  viewerOrganizationPath: OPERATOR_PATH,
  sourceMetadata: null,
}
const SENIOR_FOCAL: PersonOrganizationStructure = {
  subject: { ...SENIOR, capabilities: LEADER, directReportCount: 2, isViewer: false, managementMetrics: null },
  breadcrumb: [{ personId: "me", name: "Luana Brenda", roleLabel: "Operador", isViewer: true }, { personId: "sr", name: "Eduarda Sênior", roleLabel: "Gerente Sênior", isViewer: false }],
  organizationalContext: { group: null, subgroup: null, directManagerStatus: "PRESENT", team: null },
  managementChain: [entry(1, DIRECTOR)],
  directReports: [{ ...MANAGER, capabilities: LEADER, directReportCount: 2, managementMetrics: null }, person("mgr2", "Olga Outra Gerente", "MANAGER", "Gerente", LEADER, { directReportCount: 3 })],
  viewerOrganizationPath: OPERATOR_PATH,
  sourceMetadata: null,
}
const viewerPathOf = () => ({ edge: canvas().getAttribute("data-viewer-path-edge"), next: canvas().getAttribute("data-viewer-path-next"), motion: canvas().getAttribute("data-viewer-path-motion") })

describe("Caminho do viewer — orientação PERSISTENTE ('este caminho leva até você')", () => {
  it("Diretor focal + viewer operadora: a Sênior da cadeia é o próximo trecho — destaque persistente (ring, badge, texto acessível) e edge Diretor → Sênior animada; NUNCA some com o tempo, com seleção, com troca de aba", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderView(DIRECTOR_FOCAL)
      await screen.findByRole("heading", { name: "Estrutura de João Diretor" })
      await afterFlow()
      expect(viewerPathOf()).toEqual({ edge: "e-dir-sr", next: "sr", motion: "animated" })
      const senior = cardOf("Eduarda Sênior")
      expect(senior).toHaveAttribute("data-viewer-path", "next")
      expect(senior).toHaveClass("ring-2")
      expect(within(senior).getByTestId("viewer-path-badge")).toHaveTextContent("Sua estrutura")
      expect(headerButton("Eduarda Sênior")).toHaveAttribute("aria-label", "Ver detalhes de Eduarda Sênior. Gerente Sênior. Este caminho leva até você.")
      // O outro Sênior não é caminho: nada de destaque — só UM trecho por estrutura.
      expect(cardOf("Otávio Outro Sênior")).not.toHaveAttribute("data-viewer-path")
      expect(within(cardOf("Otávio Outro Sênior")).queryByTestId("viewer-path-badge")).not.toBeInTheDocument()
      // Segundos depois: continua (nenhum timer desliga o caminho).
      await act(() => vi.advanceTimersByTimeAsync(5000))
      expect(viewerPathOf()).toEqual({ edge: "e-dir-sr", next: "sr", motion: "animated" })
      expect(cardOf("Eduarda Sênior")).toHaveAttribute("data-viewer-path", "next")
      // Selecionar outro card, trocar de aba, viajar: o caminho não muda.
      fireEvent.click(headerButton("Otávio Outro Sênior"))
      openSection("Otávio Outro Sênior", "reportsTo")
      await act(() => vi.advanceTimersByTimeAsync(FLOW_TRAVEL_DURATION_MS + FLOW_ARRIVAL_DURATION_MS + 100))
      expect(viewerPathOf()).toEqual({ edge: "e-dir-sr", next: "sr", motion: "animated" })
      // Viagem SOBRE a edge do caminho (selecionar a própria Sênior): durante a viagem as duas semânticas coexistem; depois ela volta a ser só caminho.
      fireEvent.click(headerButton("Eduarda Sênior"))
      expect(canvas()).toHaveAttribute("data-travel-edge", "e-dir-sr")
      await act(() => vi.advanceTimersByTimeAsync(FLOW_TRAVEL_DURATION_MS + 100))
      expect(canvas()).not.toHaveAttribute("data-travel-edge")
      expect(viewerPathOf().edge).toBe("e-dir-sr")
      expect(service.fetchPersonOrganizationStructure).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("troca de focal Diretor → Sênior: o trecho antigo vai embora com o grafo antigo e o novo (Sênior → Gerente) entra já ativo; viewer como subordinado direto = próximo trecho + 'Você'; viewer focal = nenhum trecho", async () => {
    const { rerender, onNavigate } = renderView(DIRECTOR_FOCAL)
    await screen.findByRole("heading", { name: "Estrutura de João Diretor" })
    await afterFlow()
    service.fetchPersonOrganizationStructure.mockResolvedValue(SENIOR_FOCAL)
    rerender(<PersonStructureView personId="sr" rootPersonId="me" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
    await screen.findByRole("heading", { name: "Estrutura de Eduarda Sênior" })
    await afterFlow()
    expect(viewerPathOf()).toEqual({ edge: "e-sr-mgr", next: "mgr", motion: "animated" })
    expect(cardOf("Roberto Alves")).toHaveAttribute("data-viewer-path", "next")
    expect(cardOf("Olga Outra Gerente")).not.toHaveAttribute("data-viewer-path")
    // A focal e o gestor acima estão NO caminho (metadata), sem o destaque de "próximo".
    expect(cardOf("Eduarda Sênior")).toHaveAttribute("data-viewer-path", "on")
    expect(cardOf("João Diretor")).toHaveAttribute("data-viewer-path", "on")

    // Supervisora focal: a própria viewer é o próximo trecho.
    const supervisor: PersonOrganizationStructure = {
      subject: { ...SUPERVISOR, capabilities: LEADER, directReportCount: 2, isViewer: false, managementMetrics: null },
      breadcrumb: [{ personId: "me", name: "Luana Brenda", roleLabel: "Operador", isViewer: true }, { personId: "sup", name: "Vanessa Lopes", roleLabel: "Supervisor", isViewer: false }],
      organizationalContext: { group: null, subgroup: null, directManagerStatus: "PRESENT", team: null },
      managementChain: [entry(1, COORDINATOR)],
      directReports: [{ ...OPERATOR_OWN.subject, capabilities: { canViewProfile: false, canViewStructure: true, hasReports: false }, managementMetrics: null }, person("colega", "Marina Colega", "OPERATOR", "Operador", { canViewProfile: false, canViewStructure: false, hasReports: false })],
      viewerOrganizationPath: OPERATOR_PATH,
      sourceMetadata: null,
    }
    service.fetchPersonOrganizationStructure.mockResolvedValue(supervisor)
    rerender(<PersonStructureView personId="sup" rootPersonId="me" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    expect(viewerPathOf()).toEqual({ edge: "e-sup-me", next: "me", motion: "animated" })
    expect(cardOf("Luana Brenda")).toHaveAttribute("data-viewer-path", "next")
    expect(cardOf("Luana Brenda")).toHaveTextContent("Você")
    expect(within(cardOf("Luana Brenda")).queryByTestId("viewer-path-badge")).not.toBeInTheDocument() // "Você" já diz tudo
    expect(cardOf("Marina Colega")).not.toHaveAttribute("data-viewer-path")

    // Viewer focal: nenhum trecho, só "Você".
    service.fetchPersonOrganizationStructure.mockResolvedValue(OPERATOR_OWN)
    rerender(<PersonStructureView personId="me" rootPersonId="me" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
    await screen.findByRole("heading", { name: "Minha estrutura" })
    await afterFlow()
    expect(viewerPathOf()).toEqual({ edge: null, next: null, motion: null })
    expect(cardOf("Luana Brenda")).toHaveTextContent("Você")
    expect(screen.queryByRole("button", { name: /Ir até mim/ })).not.toBeInTheDocument()
  })

  it("outra árvore (focal não é ancestral do viewer): nenhum trecho, nenhum card destacado, sem 'Ir até mim'; com prefers-reduced-motion o caminho continua (estático), não some", async () => {
    renderView(supervisorFocal(3), { rootPersonId: "coord" }) // viewer = Coordenadora; Vanessa está ABAIXO dela, não acima
    await screen.findByRole("heading", { name: "Estrutura de Vanessa Lopes" })
    await afterFlow()
    expect(viewerPathOf()).toEqual({ edge: null, next: null, motion: null })
    expect(document.querySelector('[data-viewer-path="next"]')).toBeNull()
    expect(screen.queryByRole("button", { name: /Ir até mim/ })).not.toBeInTheDocument()
    cleanup()

    const original = window.matchMedia
    window.matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList
    try {
      renderView(DIRECTOR_FOCAL)
      await screen.findByRole("heading", { name: "Estrutura de João Diretor" })
      await afterFlow()
      expect(viewerPathOf()).toEqual({ edge: "e-dir-sr", next: "sr", motion: "static" })
      expect(cardOf("Eduarda Sênior")).toHaveAttribute("data-viewer-path", "next")
      expect(headerButton("Eduarda Sênior").getAttribute("aria-label")).toContain("Este caminho leva até você.")
      expect(screen.getByRole("button", { name: /Ir até mim/ })).toBeEnabled()
    } finally {
      window.matchMedia = original
    }
  })

  it("'Ir até mim' (focal ancestral do viewer): viaja pelo trecho e navega um nível por vez, sem pular níveis; nova estrutura → próximo trecho; termina quando o viewer vira a focal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { rerender, onNavigate } = renderView(DIRECTOR_FOCAL)
      await screen.findByRole("heading", { name: "Estrutura de João Diretor" })
      await afterFlow()
      fireEvent.click(screen.getByRole("button", { name: /Ir até mim/ }))
      // Dois efeitos encadeados (view pede a viagem → canvas inicia): cada um precisa de um flush.
      await act(() => vi.advanceTimersByTimeAsync(20))
      await act(() => vi.advanceTimersByTimeAsync(20))
      expect(canvas()).toHaveAttribute("data-travel-edge", "e-dir-sr")
      expect(canvas()).toHaveAttribute("data-travel-direction", "forward")
      expect(onNavigate).not.toHaveBeenCalled()
      await act(() => vi.advanceTimersByTimeAsync(GO_TO_ME_STEP_MS + 20))
      expect(onNavigate).toHaveBeenCalledTimes(1)
      expect(onNavigate).toHaveBeenLastCalledWith("sr")
      // A estrutura da Sênior chega: o passo seguinte é o Gerente — nunca direto ao viewer.
      service.fetchPersonOrganizationStructure.mockResolvedValue(SENIOR_FOCAL)
      rerender(<PersonStructureView personId="sr" rootPersonId="me" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
      await screen.findByRole("heading", { name: "Estrutura de Eduarda Sênior" })
      await afterFlow()
      expect(viewerPathOf().edge).toBe("e-sr-mgr")
      await act(() => vi.advanceTimersByTimeAsync(GO_TO_ME_STEP_MS + 20))
      expect(onNavigate).toHaveBeenLastCalledWith("mgr")
      expect(onNavigate).toHaveBeenCalledTimes(2)
      // Chegou ao viewer: sem trecho, sem novos passos, botão some.
      service.fetchPersonOrganizationStructure.mockResolvedValue(OPERATOR_OWN)
      rerender(<PersonStructureView personId="me" rootPersonId="me" onNavigate={onNavigate} profileHref={(id) => `/e/${id}`} />)
      await screen.findByRole("heading", { name: "Minha estrutura" })
      await act(() => vi.advanceTimersByTimeAsync(GO_TO_ME_STEP_MS + 20))
      expect(onNavigate).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole("button", { name: /Ir até mim/ })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
