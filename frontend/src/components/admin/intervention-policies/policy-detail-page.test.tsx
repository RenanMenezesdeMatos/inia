/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import { policyDefinitionSchema, type PolicyDefinition } from "@/schemas/admin/intervention-policy.schema"
import * as service from "@/services/admin/intervention-policy-service"

import { PolicyDetailPage } from "./policy-detail-page"
import { CAPABILITIES, CATALOG, EMPTY_DEFINITION, OBSERVE_TYPE, policyWithDraft } from "./testing/fixtures"

vi.mock("@/services/admin/intervention-policy-service", async () => (await import("./testing/fixtures")).createServiceMock())
vi.mock("@/services/admin/indicator-rule-service", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchIndicatorsWithRules: vi.fn().mockResolvedValue([]) }))
vi.mock("@/queries/auth/use-current-user", async () => {
  const { CAPABILITIES: capabilities } = await import("./testing/fixtures")
  return { useCurrentUserQuery: () => ({ data: { access: { capabilities } } }) }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/intervention-policies/p1",
  useSearchParams: () => new URLSearchParams(),
}))

const mocked = vi.mocked(service)
void CAPABILITIES

beforeAll(installJsdomStubs)
beforeEach(() => {
  mocked.fetchCapabilityCatalog.mockResolvedValue(CATALOG)
  mocked.fetchInterventionTypes.mockResolvedValue([OBSERVE_TYPE])
  mocked.fetchCompetencies.mockResolvedValue([])
  mocked.fetchPolicyEvaluations.mockResolvedValue([])
  mocked.searchSimulationPeople.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function openEditor(definition: PolicyDefinition = EMPTY_DEFINITION) {
  mocked.fetchPolicy.mockResolvedValue(policyWithDraft(definition))
  renderWithQuery(<PolicyDetailPage policyId="p1" />)
  const addRule = await screen.findByRole("button", { name: /Adicionar regra/ })
  // A regra nova só nasce depois que tipos e catálogo de capacidades chegaram (a ação padrão depende deles).
  await waitFor(() => expect(addRule).toBeEnabled())
  return addRule
}

describe("O que a política faz e onde ela roda", () => {
  const RULES: PolicyDefinition = {
    ...EMPTY_DEFINITION,
    rules: [
      { key: "B", name: "Fora da meta nos últimos 30 dias", priority: 2, justification: "Observar antes de agir.", when: { operator: "ALL", items: [{ kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true }] }, actions: [{ typeKey: "OBSERVAR", effect: "RECOMMEND", dueInDays: null, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] },
      { key: "A", name: "Pior quartil em 3 fechamentos", priority: 1, justification: "Recorrência no pior quartil.", when: { operator: "ALL", items: [{ kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true }] }, actions: [{ typeKey: "OBSERVAR", effect: "OPEN", dueInDays: null, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] },
    ],
  }

  it("descreve cada regra em texto, na ordem de prioridade, com o que a INIA faz e para quem; avisa que política sem Workflow não roda", async () => {
    mocked.fetchPolicy.mockResolvedValue(policyWithDraft({ ...RULES, indicatorCode: "TMA" }, { workflows: { items: [], outOfScope: 0, running: false } }))
    renderWithQuery(<PolicyDetailPage policyId="p1" />)
    const summary = within(await screen.findByTestId("policy-summary"))
    expect(summary.getByText(/Rascunho: nada disto vale até publicar\./)).toBeInTheDocument()
    // O assunto é o NOME do indicador no catálogo, nunca o código.
    await waitFor(() => expect(summary.getByText(/Assunto: Tempo médio de atendimento\./)).toBeInTheDocument())
    // Cada regra: o nome e a frase inteira — "Quando ‹condições›, a INIA ‹faz o quê, para quem›".
    const items = await waitFor(() => {
      const found = summary.getAllByRole("listitem")
      expect(found[0]).toHaveTextContent("Quando está em produção hoje, a INIA abre “Observação” para o supervisor.")
      return found
    })
    expect(items[0]).toHaveTextContent("Pior quartil em 3 fechamentos")
    expect(items[1]).toHaveTextContent("Fora da meta nos últimos 30 dias")
    expect(items[1]).toHaveTextContent("Quando está em produção hoje, a INIA sugere “Observação” ao supervisor, que aceita ou descarta.")
    expect(summary.getByText("Se mais de uma regra for atendida, vale só a primeira desta lista.")).toBeInTheDocument()
    const where = within(summary.getByTestId("policy-workflows"))
    expect(where.getByText(/Esta política ainda não roda: nenhum Workflow passa por ela\./)).toBeInTheDocument()
    expect(where.getByRole("link", { name: "Abrir Workflows" })).toHaveAttribute("href", "/admin/workflows")
  })

  it("lista os Workflows que passam pela política com o estado de cada um; os de fora do escopo só são contados", async () => {
    mocked.fetchPolicy.mockResolvedValue(
      policyWithDraft(RULES, {
        workflows: { items: [{ id: "w1", name: "Acompanhamento mensal de TMA", active: true, published: true, inDraft: true }, { id: "w2", name: "Piloto", active: false, published: false, inDraft: true }], outOfScope: 2, running: true },
      }),
    )
    renderWithQuery(<PolicyDetailPage policyId="p1" />)
    const where = within(await screen.findByTestId("policy-workflows"))
    expect(where.queryByText(/não roda|não está rodando/)).toBeNull()
    const rows = where.getAllByRole("listitem")
    expect(rows[0]).toHaveTextContent("Acompanhamento mensal de TMA")
    expect(rows[0]).toHaveTextContent("Publicado e ligado")
    expect(within(rows[0]!).getByRole("link", { name: "Acompanhamento mensal de TMA" })).toHaveAttribute("href", "/admin/workflows/w1")
    expect(rows[1]).toHaveTextContent("Só no rascunho do editor")
    expect(where.getByText("Mais 2 Workflow(s) fora do seu escopo de gestão.")).toBeInTheDocument()
  })
})

describe("Editor da política de acompanhamento", () => {
  it("Adicionar regra cria a regra com condição e ação padrão válidas; Salvar rascunho envia INTERVENTION_POLICY_V1 com prioridades únicas", async () => {
    const addRule = await openEditor()
    fireEvent.click(addRule)
    fireEvent.click(addRule)
    expect(screen.getAllByTestId(/^policy-rule-\d+$/)).toHaveLength(2)

    // Mover a primeira regra para baixo renumera TODAS as prioridades na ordem da lista.
    fireEvent.click(screen.getByRole("button", { name: "Mover Regra 1 para baixo" }))
    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }))

    await waitFor(() => expect(mocked.savePolicyDraft).toHaveBeenCalledTimes(1))
    const [policyId, definition] = mocked.savePolicyDraft.mock.calls[0]!
    expect(policyId).toBe("p1")
    expect(definition.schemaVersion).toBe("INTERVENTION_POLICY_V1")
    expect(definition.rules.map((rule) => rule.key)).toEqual(["REGRA_2", "REGRA_1"])
    const priorities = definition.rules.map((rule) => rule.priority)
    expect(priorities).toEqual([1, 2])
    expect(new Set(priorities).size).toBe(priorities.length)
    for (const rule of definition.rules) {
      expect(rule.when.operator).toBe("ALL")
      expect(rule.when.items).toHaveLength(1)
      expect(rule.when.items[0]).toMatchObject({ kind: "INDICATOR", criterion: { historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } } } })
      expect(rule.actions).toEqual([{ typeKey: "OBSERVAR", effect: "RECOMMEND", dueInDays: null, onActive: "KEEP", cooldownDays: 30 }])
      expect(rule.inconclusiveActions).toEqual([])
      expect(rule.justification.trim().length).toBeGreaterThan(0)
    }
    // O formato bate com o contrato do frontend (o backend valida de novo).
    expect(policyDefinitionSchema.safeParse(definition).success).toBe(true)
  })

  it("Publicar: 422 com details.issues lista as pendências do backend junto do formulário (e na regra a que pertencem), sem toast duplicado", async () => {
    const definition: PolicyDefinition = {
      ...EMPTY_DEFINITION,
      rules: [{ key: "TREINAR_TMA", name: "Treinar TMA", priority: 1, justification: "Diagnóstico sustentado de TMA.", when: { operator: "ALL", items: [{ kind: "SUPPORTED_DIAGNOSIS", indicatorCode: null, competencyKeys: [], withinDays: 60, expectation: "EXISTS" }] }, actions: [{ typeKey: "TREINAR", effect: "OPEN", dueInDays: null, onActive: "KEEP", cooldownDays: 30 }], inconclusiveActions: [] }],
    }
    mocked.publishPolicy.mockRejectedValue(
      new AdminApiError("O tipo TREINAR não existe ou ainda não tem versão publicada.", "INTERVENTION_POLICY_INVALID_FOR_PUBLISH", {
        issues: [
          { path: "rules.0.actions.0", code: "POLICY_ACTION_TYPE_UNPUBLISHED", message: "O tipo TREINAR não existe ou ainda não tem versão publicada." },
          { path: "indicatorCode", code: "POLICY_INDICATOR_NOT_FOUND", message: "O indicador TMA não existe nesta organização." },
        ],
      }),
    )
    await openEditor(definition)

    fireEvent.click(screen.getByRole("button", { name: /Publicar…/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Publicar versão" }))

    await waitFor(() => expect(mocked.publishPolicy).toHaveBeenCalledWith("p1", null))
    const panel = await screen.findByTestId("config-issues")
    expect(panel).toHaveTextContent("A versão não foi publicada")
    expect(panel).toHaveTextContent("O tipo TREINAR não existe ou ainda não tem versão publicada.")
    expect(panel).toHaveTextContent("O indicador TMA não existe nesta organização.")
    expect(within(screen.getByTestId("policy-rule-0")).getByText("O tipo TREINAR não existe ou ainda não tem versão publicada.")).toBeInTheDocument()
    // Sem alteração local não salva nada antes de publicar; o código de pendência é tratado pela tela (sem toast).
    expect(mocked.savePolicyDraft).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("versão publicada sem rascunho fica só leitura até 'Editar (novo rascunho)'", async () => {
    const published = { id: "pv1", version: 1, status: "PUBLISHED" as const, definition: EMPTY_DEFINITION, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: "2026-09-01T10:00:00.000Z", effectiveFrom: "2026-09-01T10:00:00.000Z" }
    mocked.fetchPolicy.mockResolvedValue(policyWithDraft(EMPTY_DEFINITION, { draft: null, inForce: published, versions: [published] }))
    renderWithQuery(<PolicyDetailPage policyId="p1" />)
    expect(await screen.findByText("Versão publicada v1 — só leitura")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Adicionar regra/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Editar \(novo rascunho\)/ }))
    expect(await screen.findByRole("button", { name: /Adicionar regra/ })).toBeInTheDocument()
    expect(screen.getByText("Novo rascunho (ainda não salvo)")).toBeInTheDocument()
  })

  it("condição de flag de atendimento: flag do catálogo, valor, janela e recorrência por seletores; o rascunho salva o contrato", async () => {
    const definition: PolicyDefinition = {
      ...EMPTY_DEFINITION,
      rules: [{ key: "RECHAMADA", name: "Rechamada recorrente", priority: 1, justification: "Rechamada recorrente nos últimos 30 dias.", when: { operator: "ALL", items: [{ kind: "INTERACTION_FLAG", channel: "VOICE", flagName: "rechamada", match: { type: "BOOLEAN", value: true }, withinDays: 30, measure: "COUNT", comparator: "GTE", threshold: 3, minimumInteractions: 1 }] }, actions: [{ typeKey: "OBSERVAR", effect: "RECOMMEND", dueInDays: null, onActive: "KEEP", cooldownDays: 30 }], inconclusiveActions: [] }],
    }
    await openEditor(definition)
    const rule = screen.getByTestId("policy-rule-0")
    expect(within(rule).getByText("rechamada — Cliente voltou a ligar")).toBeInTheDocument()
    expect(within(rule).getByText("Sim (a flag disparou)")).toBeInTheDocument()
    fireEvent.change(within(rule).getByLabelText("Número de atendimentos"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }))
    await waitFor(() => expect(mocked.savePolicyDraft).toHaveBeenCalledTimes(1))
    const saved = mocked.savePolicyDraft.mock.calls[0]![1]
    expect(saved.rules[0]!.when.items[0]).toEqual({ kind: "INTERACTION_FLAG", channel: "VOICE", flagName: "rechamada", match: { type: "BOOLEAN", value: true }, withinDays: 30, measure: "COUNT", comparator: "GTE", threshold: 2, minimumInteractions: 1 })
    expect(policyDefinitionSchema.safeParse(saved).success).toBe(true)
  })
})
