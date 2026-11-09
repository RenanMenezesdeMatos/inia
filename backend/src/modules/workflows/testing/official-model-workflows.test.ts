import { describe, expect, it, vi } from "vitest"

// V1.5.12: os modelos com gatilho por Flag/Indicador publicam feedback oficial pela camada de confiabilidade ("Gerar
// feedback"), que só publica com o módulo de QA de feedback LIGADO (a mesma flag das rotas de QA).
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, INIA_INTERACTION_FEEDBACK_PIPELINE: "ON" } }
})
import type { Database } from "../../../infrastructure/database/pool.js"
import { DEMO_RANDOM_SEED } from "../../../infrastructure/database/demo-mass/demo-constants.js"
import { createRandom } from "../../../infrastructure/database/demo-mass/random.js"
import { generateStructure } from "../../../infrastructure/database/demo-mass/structure-generator.js"
import { flowGraphSchema, isRecognitionRankingSelection, nodeBranches, resolveNodeContexts, type FlowGraph } from "../domain/graph-schema.js"
import { outputTargetRole } from "../domain/output-schema.js"
import { resolveStructureRecipient } from "../application/organizational-recipient.js"
import { inMemoryHierarchyReader, type InMemoryPerson } from "./in-memory-hierarchy-reader.js"
import { validateWorkflowForPublish } from "../application/validate-workflow-for-publish.js"
import { checkSpecialistAgainstPolicy, checkSpecialistAgainstRouting, describePolicyProblem, legacyPolicyFor, parseOrchestratorPolicy, resolveRoutingPolicy, type SpecialistCandidate } from "../../assistant/domain/orchestrator-policy.js"
import { domainRefFromCode } from "../../business-domains/domain/business-domain.js"
import { EXPECTED_CROSS_CUTTING, EXPECTED_ORCHESTRATOR_POLICIES, EXPECTED_ROUTING, EXPECTED_SPECIALTIES, EXPECTED_SPECIALTY_KINDS, loadOfficialAiCatalog } from "./official-ai-catalog.js"
import { legacySpecialtyFor, resolveAgentSpecialty } from "../../agents/domain/agent-specialty.js"
import { describeStructureRequirement, instanceSatisfiesRequirement, loadOfficialModelTemplates } from "./official-model-templates.js"
import { classifyBeneficiary, loadOfficialModelWorkflows, structuralReferences, type OfficialModelWorkflow } from "./official-model-workflows.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const MODELS = loadOfficialModelWorkflows()
const TEMPLATES = loadOfficialModelTemplates()
const AI = loadOfficialAiCatalog()
const AGENT_BY_ID = new Map(AI.agents.map((agent) => [agent.id, agent]))
const ORCHESTRATOR_BY_ID = new Map(AI.orchestrators.map((orchestrator) => [orchestrator.id, orchestrator]))

// Flags reais do catálogo (channel_flags) — só o tipo do valor importa pra validação.
const FLAG_VALUE_TYPES: Record<string, "BOOLEAN" | "NUMERIC"> = {
  "60c9cda8-63de-4443-b6b6-7f7c66e91931": "BOOLEAN", // rechamada
  "383e42c6-898c-4c35-b94c-6e40ff696ab5": "NUMERIC", // nota_ura
  "de009d6c-decd-4a03-87cb-fbc7052289b0": "BOOLEAN", // contestacao
}

/**
 * A estrutura da massa demo (1 Diretor → 4 Gerentes Sêniores → 16 Gerentes → 8 Coordenadores → 80
 * Supervisores → 2.000 Operadores, 10 Grupos B2B/B2C, 19 Subgrupos) REGENERADA em memória pelo
 * mesmo gerador determinístico do seed (`npm run db:seed:demo`) — é contra ela que o catálogo é
 * validado: toda referência estrutural dos modelos precisa existir nela (nunca um grupo/pessoa do
 * seed antigo) e todo destinatário de gestão precisa resolver pra exatamente uma pessoa.
 */
const DEMO = generateStructure(createRandom(DEMO_RANDOM_SEED).fork("structure"))
const DEMO_PEOPLE: InMemoryPerson[] = DEMO.people.map((person) => ({
  id: person.id,
  name: person.name,
  role: person.role,
  reportsToId: person.reportsToKey ? (DEMO.byKey.get(person.reportsToKey)?.id ?? null) : null,
  teamId: person.teamKey ? (DEMO.teamByKey.get(person.teamKey)?.id ?? null) : null,
  subteamId: person.subteamKey ? (DEMO.subteamByKey.get(person.subteamKey)?.id ?? null) : null,
}))
const DEMO_HIERARCHY = inMemoryHierarchyReader(DEMO_PEOPLE)
const DEMO_PERSON_IDS = new Set(DEMO_PEOPLE.map((person) => person.id))
const DEMO_TEAM_IDS = new Set(DEMO.teams.map((team) => team.id))
const DEMO_SUBTEAM_IDS = new Set(DEMO.subteams.map((subteam) => subteam.id))

/**
 * Banco falso que devolve as referências REAIS do catálogo de IA (fixture official-ai-catalog.json:
 * tipo/ativo do agente, modo de invocação do orquestrador) e um indicador com direção — o que se
 * testa aqui é a forma/contexto/topologia/referências dos 22 grafos contra a validação de
 * publicação INTEIRA (`validateWorkflowForPublish`, a mesma do botão Publicar), com a hierarquia
 * da massa demo pra resolver destinatários. O dry-run `POST /:id/validate` contra o banco real
 * confirma o mesmo resultado (ver relatório).
 */
function catalogDb(model: OfficialModelWorkflow): Database {
  async function query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    if (sql.includes("from agents where id = any")) {
      const ids = params[0] as string[]
      const rows = ids.flatMap((id) => {
        const agent = AGENT_BY_ID.get(id)
        return agent ? [{ id, name: agent.name, active: agent.active, agent_type: agent.agentType, specialty: agent.specialty, specialty_kind: agent.specialtyKind, domain: agent.domain, consolidated_input: agent.consolidatedInput }] : []
      })
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from assistant_orchestrators where id = any")) {
      const ids = params[0] as string[]
      const rows = ids.flatMap((id) => {
        const orchestrator = ORCHESTRATOR_BY_ID.get(id)
        return orchestrator ? [{ id, output_schema: null, scopeType: orchestrator.scopeType, teamId: null, subteamId: null, name: orchestrator.name, active: orchestrator.active, invocation_mode: orchestrator.invocationMode }] : []
      })
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from indicator_definitions") && sql.includes("code = any(")) {
      // Capacidades REAIS do catálogo (migration 055): ativo, medição operacional diária e
      // fechamento oficial — validate-indicator-capabilities.ts consulta todos os códigos de uma vez.
      const codes = params[1] as string[]
      const rows = codes.flatMap((code) => (OPERATIONAL_AGGREGATION[code] ? [{ code, name: code, active: true, daily_supported: true, official_closure_supported: true }] : []))
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from indicator_definitions")) {
      // Semântica operacional REAL do catálogo (migration 052): a agregação de cada Condition/
      // Ranking precisa ser compatível com ela — o mesmo que o dry-run contra o banco cobra.
      const code = String(params[0] ?? "")
      return { rows: [{ id: "ind", desired_direction: "HIGHER", operational_aggregation: OPERATIONAL_AGGREGATION[code] ?? "AVERAGE" }], rowCount: 1 }
    }
    if (sql.includes("from channel_flags")) {
      const flagId = model.trigger.kind === "channel_flag" ? model.trigger.channelFlagId : ""
      return { rows: [{ value_type: FLAG_VALUE_TYPES[flagId] ?? "NUMERIC" }], rowCount: 1 }
    }
    if (sql.includes("from workflow_variables")) return { rows: [], rowCount: 0 }
    if (sql.includes("from subteams")) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 0 }
  }
  return { query } as unknown as Database
}

function publishRow(model: OfficialModelWorkflow) {
  return { scopeType: model.scopeType, teamId: model.teamId, subteamId: model.subteamId, draftGraph: model.graph, triggerConfig: model.trigger, consolidatedStructure: model.consolidatedStructure }
}

/** `indicator_definitions.operational_aggregation` (migration 052) dos códigos que os modelos usam. */
const OPERATIONAL_AGGREGATION: Record<string, string> = {
  TMA: "WEIGHTED_AVERAGE",
  MONITORIA_QUALIDADE: "WEIGHTED_AVERAGE",
  NOTA_URA: "WEIGHTED_AVERAGE",
  ADERENCIA: "RATE",
}

/** Codes usados na massa demo (indicator-catalog.ts) — um modelo que aponta pra um código fora
 * daqui roda em cima de "sem dados" pra sempre (foi o caso de QUALIDADE, do seed antigo). */
const DEMO_INDICATOR_CODES = new Set([
  "MONITORIA_QUALIDADE", "TMA", "TMT", "NOTA_URA", "REINCIDENCIA_7D", "ADERENCIA", "TAXA_RETRABALHO", "TAXA_RETENCAO", "RECONTATO_CANCELAMENTO",
  "FCR", "TAXA_TRANSFERENCIA", "TEMPO_DIAGNOSTICO", "TEMPO_DISPONIVEL", "NPS", "SLA_24H", "QUALIDADE_ANALISE", "BACKLOG",
])

function indicatorCodesOf(graph: FlowGraph): string[] {
  const codes: string[] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === "indicatorCode" && typeof inner === "string") codes.push(inner)
      else visit(inner)
    }
  }
  visit(graph)
  return codes
}

function outgoing(graph: FlowGraph, nodeId: string, handle: string) {
  return graph.edges.find((edge) => edge.source === nodeId && edge.sourceHandle === handle)
}

describe("Catálogo oficial — 20 Workflows-modelo (22 instâncias) da INIA", () => {
  it("são exatamente 20 modelos conceituais em 22 instâncias, todos com nome 'Modelo · NN'", () => {
    expect(MODELS).toHaveLength(22)
    const concepts = new Set(MODELS.map((model) => model.key.replace(/[a-c]$/, "")))
    expect(concepts.size).toBe(20)
    expect(MODELS.filter((model) => model.key.startsWith("18")).map((model) => model.key)).toEqual(["18a", "18b", "18c"])
    for (const model of MODELS) expect(model.name).toMatch(/^Modelo · \d{2}[a-c]? · /)
  })

  describe.each(MODELS.map((model) => [model.key, model] as const))("Modelo %s", (_key, model) => {
    it("o grafo persistido passa no schema de domínio", () => {
      expect(() => flowGraphSchema.parse(model.graph)).not.toThrow()
    })

    it("passa 100% na validação de publicação (a mesma do botão Publicar) — DRAFT válido", async () => {
      await expect(validateWorkflowForPublish(catalogDb(model), ORG, model.id, publishRow(model), { hierarchy: DEMO_HIERARCHY })).resolves.toBeDefined()
    })

    it("é DRAFT no banco de referência e toda referência estrutural (Abrangência, Estrutura, Filtro) existe na massa demo — nenhum grupo/pessoa legado", () => {
      // O fixture é exportado só de rascunhos; a regra de produto é que os modelos NUNCA são publicados.
      for (const ref of structuralReferences(model)) {
        const exists = ref.kind === "TEAM" ? DEMO_TEAM_IDS.has(ref.id) : ref.kind === "SUBTEAM" ? DEMO_SUBTEAM_IDS.has(ref.id) : DEMO_PERSON_IDS.has(ref.id)
        expect(exists, `${model.key}: ${ref.where} referencia ${ref.kind} ${ref.id} que não existe na massa demo`).toBe(true)
      }
      for (const code of indicatorCodesOf(model.graph)) expect(DEMO_INDICATOR_CODES.has(code), `${model.key}: indicador ${code} não é medido na massa demo`).toBe(true)
    })

    it("todo destinatário de gestão fora do caminho individual resolve para EXATAMENTE uma pessoa da estrutura (nunca ambíguo, nunca 'membro qualquer')", async () => {
      const graph = flowGraphSchema.parse(model.graph)
      if (!model.consolidatedStructure) return
      const contexts = resolveNodeContexts(graph)
      for (const node of graph.nodes) {
        if (node.type !== "output" || (contexts.get(node.id) ?? "STRUCTURE") === "EMPLOYEE") continue
        const role = outputTargetRole(node.config.target)
        if (!role) continue
        const resolution = await resolveStructureRecipient(DEMO_HIERARCHY, model.consolidatedStructure, role)
        expect(resolution.status, `${model.key}: Output "${node.label}"`).toBe("RESOLVED")
        if (resolution.status === "RESOLVED") expect(resolution.person.role).toBe(role)
      }
    })

    it("toda saída de todo nó está conectada e toda aresta aponta para nós existentes (o motor falha em runtime numa saída sem aresta)", () => {
      const graph = flowGraphSchema.parse(model.graph)
      const ids = new Set(graph.nodes.map((node) => node.id))
      for (const edge of graph.edges) {
        expect(ids.has(edge.source), `aresta ${edge.id}: origem inexistente`).toBe(true)
        expect(ids.has(edge.target), `aresta ${edge.id}: destino inexistente`).toBe(true)
      }
      for (const node of graph.nodes) {
        for (const branch of nodeBranches(node)) {
          expect(outgoing(graph, node.id, branch.id), `nó "${node.label}" sem aresta na saída "${branch.label}"`).toBeDefined()
        }
      }
    })

    it("Output: 'O próprio operador' só em contexto EMPLOYEE; depois de 'Consolidar resultados' o destinatário é de gestão; superfícies só as que têm leitor real", () => {
      const graph = flowGraphSchema.parse(model.graph)
      const contexts = model.consolidatedStructure ? resolveNodeContexts(graph) : null
      for (const node of graph.nodes) {
        if (node.type !== "output") continue
        const context = contexts?.get(node.id) ?? "EMPLOYEE"
        if (node.config.target.type === "CURRENT_OPERATOR") expect(context, `Output "${node.label}"`).toBe("EMPLOYEE")
        if (context === "CONSOLIDATED_RESULT") expect(node.config.target.type, `Output "${node.label}" pós-Join`).not.toBe("CURRENT_OPERATOR")
        for (const surface of node.config.surfaces) expect(["FOLLOW_UP", "NOTIFICATION"], `Output "${node.label}" surface ${surface}`).toContain(surface)
        expect(node.config.source.startsWith("nodeOutputs.")).toBe(true)
      }
    })

    it("Revisão humana: as 3 decisões têm destino com significado (Escalar → Escalonar ao Gerente); num fan-out com Join, todas convergem no MESMO Join", () => {
      const graph = flowGraphSchema.parse(model.graph)
      const join = graph.nodes.find((node) => node.type === "consolidate_results")
      for (const node of graph.nodes) {
        if (node.type !== "human_review") continue
        expect(node.config.reviewTarget).toEqual({ type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" })
        const escalated = outgoing(graph, node.id, "escalated")!
        const escalateNode = graph.nodes.find((candidate) => candidate.id === escalated.target)
        expect(escalateNode?.type === "action" && escalateNode.config.actionType === "ESCALATE" && escalateNode.config.target.type === "ROLE_OF_OPERATOR" && escalateNode.config.target.role === "MANAGER").toBe(true)
        if (join) {
          // Aprovado → Output individual → Join; Reprovado → Join; Escalar → Escalonar (CONTINUE) → Join.
          const approvedTarget = graph.nodes.find((candidate) => candidate.id === outgoing(graph, node.id, "approved")!.target)
          expect(approvedTarget?.type).toBe("output")
          expect(outgoing(graph, approvedTarget!.id, "always")?.target).toBe(join.id)
          expect(outgoing(graph, node.id, "rejected")?.target).toBe(join.id)
          expect(escalateNode?.type === "action" && escalateNode.config.actionType === "ESCALATE" ? escalateNode.config.continuation : null).toBe("CONTINUE")
          expect(outgoing(graph, escalateNode!.id, "always")?.target).toBe(join.id)
        } else {
          expect(escalateNode?.type === "action" && escalateNode.config.actionType === "ESCALATE" ? escalateNode.config.continuation : null).toBe("END_BRANCH")
        }
      }
    })

    it("Agent direto quando o domínio é conhecido; Orquestrador só para roteamento real (multidomínio por Flag); síntese pós-Join é Agent SYNTHESIS", () => {
      const graph = flowGraphSchema.parse(model.graph)
      const contexts = model.consolidatedStructure ? resolveNodeContexts(graph) : null
      for (const node of graph.nodes) {
        if (node.type !== "orchestrator") continue
        // Evolução 2026-09-16: nenhum modelo usa mais Orquestrador pós-Join — quem sintetiza é o Agent.
        expect(contexts?.get(node.id) ?? "EMPLOYEE", `Orquestrador "${node.label}" pós-Join — use um Agent de síntese`).not.toBe("CONSOLIDATED_RESULT")
        expect(model.trigger.kind, `Orquestrador "${node.label}" fora do único uso legítimo (roteamento multidomínio por Flag)`).toBe("channel_flag")
      }
      for (const node of graph.nodes) {
        if (node.type !== "action" || node.config.actionType !== "CALL_AGENT") continue
        const agent = AGENT_BY_ID.get(node.config.agentId)
        const specialty = resolveAgentSpecialty({ specialty: agent?.specialty, specialty_kind: agent?.specialtyKind, domain: agent?.domain, consolidated_input: agent?.consolidatedInput })
        const isPostJoin = (contexts?.get(node.id) ?? "EMPLOYEE") === "CONSOLIDATED_RESULT"
        if (isPostJoin) {
          expect(specialty.kind, `Agent "${node.label}" pós-Join precisa ser SYNTHESIS`).toBe("SYNTHESIS")
          expect(node.config.instruction, `Agent "${node.label}" pós-Join sem missão`).toBeDefined()
          continue
        }
        expect(specialty.kind, `Agent de síntese "${node.label}" fora do pós-Join`).not.toBe("SYNTHESIS")
        if (model.trigger.kind === "schedule") expect(node.config.scheduledDataSource, `Agent "${node.label}" sem fonte de dados`).toBeDefined()
        if (node.config.outputContract === "PROCESS_AUDIT") expect(model.trigger.kind).toBe("channel_flag")
      }
    })
  })

  it("beneficiário DERIVADO de quem recebe Output (nunca do nome): OPERADOR tem Output ao operador; SUPERVISOR/LIDERANÇA têm entrega de gestão; MULTINÍVEL tem os dois", () => {
    for (const model of MODELS) {
      const outputs = model.graph.nodes.filter((node) => node.type === "output")
      const toOperator = outputs.some((node) => node.type === "output" && node.config.target.type === "CURRENT_OPERATOR")
      const toManagement = outputs.some((node) => node.type === "output" && node.config.target.type !== "CURRENT_OPERATOR")
      const beneficiary = classifyBeneficiary(model)
      if (beneficiary === "OPERADOR") expect(toOperator && !toManagement, model.key).toBe(true)
      if (beneficiary === "SUPERVISOR" || beneficiary === "LIDERANCA") expect(toManagement && !toOperator, model.key).toBe(true)
      if (beneficiary === "MULTINIVEL") expect(toOperator && toManagement, model.key).toBe(true)
    }
  })

  it("distribuição final por beneficiário — o catálogo demonstra desenvolvimento, reconhecimento, orientação, qualidade, gestão e liderança", () => {
    const byBeneficiary = new Map<string, string[]>()
    for (const model of MODELS) {
      const beneficiary = classifyBeneficiary(model)
      byBeneficiary.set(beneficiary, [...(byBeneficiary.get(beneficiary) ?? []), model.key])
    }
    expect(byBeneficiary.get("OPERADOR")).toEqual(["01", "02", "03", "06", "07", "08", "09", "10", "12", "18a", "18b", "18c"])
    expect(byBeneficiary.get("SUPERVISOR")).toEqual(["13", "16", "19"])
    expect(byBeneficiary.get("LIDERANCA")).toEqual(["17"])
    expect(byBeneficiary.get("MULTINIVEL")).toEqual(["04", "05", "11", "14", "15", "20"])
  })

  it("todo modelo multinível entrega ao operador DENTRO do caminho individual e à gestão DEPOIS do Join; conteúdo sensível (agente de performance/qualidade) passa por Revisão humana antes de chegar ao operador", () => {
    for (const model of MODELS) {
      const graph = flowGraphSchema.parse(model.graph)
      const contexts = model.consolidatedStructure ? resolveNodeContexts(graph) : null
      const hasReview = graph.nodes.some((node) => node.type === "human_review")
      const agentNames = graph.nodes.flatMap((node) => (node.type === "action" && node.config.actionType === "CALL_AGENT" ? [AGENT_BY_ID.get(node.config.agentId)?.name ?? ""] : []))
      const sensitive = agentNames.some((name) => /Performance|Qualidade|PRV|Faturamento|Retenção|Suporte|Experiência/.test(name)) || graph.nodes.some((node) => node.type === "orchestrator" && (contexts?.get(node.id) ?? "EMPLOYEE") === "EMPLOYEE")
      const toOperator = graph.nodes.some((node) => node.type === "output" && node.config.target.type === "CURRENT_OPERATOR")
      // Reconhecimento (Especialista de Reconhecimento) e orientação operacional (Eficiência/
      // Disponibilidade) são as únicas entregas diretas ao operador sem revisão — aprovadas pelo desenho.
      if (toOperator && sensitive) expect(hasReview, `${model.key}: entrega sensível ao operador sem Revisão humana`).toBe(true)
      if (classifyBeneficiary(model) !== "MULTINIVEL") continue
      for (const node of graph.nodes) {
        if (node.type !== "output") continue
        const context = contexts!.get(node.id)
        if (node.config.target.type === "CURRENT_OPERATOR") expect(context, `${model.key}: ${node.label}`).toBe("EMPLOYEE")
        else expect(context, `${model.key}: ${node.label}`).toBe("CONSOLIDATED_RESULT")
      }
    }
  })

  it("Orquestrador semanticamente correto: o multidomínio (08) usa o Orquestrador · Atendimento multidomínio (DOMAINS com 4 domínios); os 7 modelos pós-Join (04/05/11/14/16/17/20) usam o Especialista de Síntese Gerencial com a missão preservada", () => {
    const byName = (name: string) => AI.orchestrators.find((orchestrator) => orchestrator.name === name)!
    const model08 = MODELS.find((model) => model.key === "08")!
    expect(model08.graph.nodes.find((node) => node.type === "orchestrator")?.config.orchestratorId).toBe(byName("Orquestrador · Atendimento multidomínio").id)
    const multidomain = byName("Orquestrador · Atendimento multidomínio")
    const multidomainRouting = resolveRoutingPolicy({ routing_policy: multidomain.routingPolicy, routing_domains: multidomain.routingDomains })
    expect(multidomainRouting.kind === "DOMAINS" ? multidomainRouting.domains.map((domain) => domain.code) : null).toEqual(["FATURAMENTO", "RETENCAO", "SUPORTE", "CADASTRO"])
    const model17 = MODELS.find((model) => model.key === "17")!
    expect(model17.consolidatedStructure).toEqual({ kind: "TEAM", teamId: DEMO.teamByKey.get("b2c-retencao")!.id })
    const synthesisAgent = AI.agents.find((agent) => agent.name === "Especialista de Síntese Gerencial")!
    for (const key of ["04", "05", "11", "14", "16", "17", "20"]) {
      const model = MODELS.find((candidate) => candidate.key === key)!
      const node = model.graph.nodes.find((candidate) => candidate.id === "orq")!
      expect(node.type, key).toBe("action")
      const config = node.config as { actionType: string; agentId: string; instruction?: string }
      expect(config.actionType, key).toBe("CALL_AGENT")
      expect(config.agentId, key).toBe(synthesisAgent.id)
      expect(config.instruction?.length ?? 0, `${key}: missão`).toBeGreaterThan(40)
      expect(model.graph.nodes.some((candidate) => candidate.type === "orchestrator"), `${key}: Orquestrador pós-Join legado ainda presente`).toBe(false)
    }
    expect(MODELS.find((model) => model.key === "17")!.graph.nodes.find((node) => node.id === "orq")!.config).toMatchObject({ instruction: expect.stringContaining("retenção") })
    for (const model of MODELS) {
      const graph = flowGraphSchema.parse(model.graph)
      const contexts = model.consolidatedStructure ? resolveNodeContexts(graph) : null
      for (const node of graph.nodes) {
        if (node.type !== "orchestrator") continue
        const orchestrator = ORCHESTRATOR_BY_ID.get(node.config.orchestratorId)
        expect(orchestrator, `${model.key}: orquestrador ${node.config.orchestratorId} fora do catálogo`).toBeDefined()
        const policy = parseOrchestratorPolicy({ policy_kind: orchestrator!.policyKind, policy_domains: orchestrator!.policyDomains })
        expect(policy.kind, `${model.key}: ${orchestrator!.name} sem política persistida`).not.toBeNull()
        const isPostJoin = (contexts?.get(node.id) ?? "EMPLOYEE") === "CONSOLIDATED_RESULT"
        if (policy.kind === "MANAGERIAL") expect(isPostJoin, `${model.key}: Gerencial fora do pós-Join`).toBe(true)
        if (policy.kind === "MULTIDOMAIN") expect(model.trigger.kind, `${model.key}: multidomínio só por Flag (interação)`).toBe("channel_flag")
      }
    }
  })

  it("nenhum modelo usa 'Pessoa específica' (id fixo) como destinatário — modelos são reutilizáveis por estrutura", () => {
    for (const model of MODELS) {
      for (const node of model.graph.nodes) {
        if (node.type === "output") expect(node.config.target.type, `${model.key}: ${node.label}`).not.toBe("USER")
      }
    }
  })

  it("cobertura B2B e B2C: há modelos ancorados em estruturas dos dois segmentos e modelos genéricos (Todos os grupos)", () => {
    const segmentOf = (teamKey: string | null) => (teamKey ? DEMO.teamByKey.get(teamKey)?.spec.segment ?? null : null)
    const segments = new Set<string>()
    for (const model of MODELS) {
      for (const ref of structuralReferences(model)) {
        if (ref.kind === "TEAM") segments.add(DEMO.teams.find((team) => team.id === ref.id)!.spec.segment)
        if (ref.kind === "PERSON") {
          const person = DEMO.people.find((candidate) => candidate.id === ref.id)!
          const segment = segmentOf(person.teamKey)
          if (segment) segments.add(segment)
        }
      }
    }
    expect([...segments].sort()).toEqual(["B2B", "B2C"])
    expect(MODELS.filter((model) => model.scopeType === "ALL_TEAMS" && !model.consolidatedStructure).length).toBeGreaterThanOrEqual(8)
  })
})

describe("Catálogo oficial de IA — política explícita de especialistas (persistida, aplicada por código)", () => {
  const byName = (name: string) => AI.orchestrators.find((orchestrator) => orchestrator.name === name)!
  const agentName = (id: string) => AGENT_BY_ID.get(id)?.name ?? id
  /** Especialidade pela COLUNA LEGADA `specialty` (dual-write): código do domínio, tipo sem domínio ou null. */
  const specialtyOf = (id: string) => AGENT_BY_ID.get(id)?.specialty ?? null
  /** Candidato na forma que a regra de política consome (domínio como referência do catálogo, por código). */
  const candidateOf = (name: string, specialty: string | null): SpecialistCandidate => ({
    name,
    specialty:
      specialty === null ? { kind: null, domain: null } : specialty === "CROSS_CUTTING" || specialty === "PERFORMANCE" || specialty === "SYNTHESIS" ? { kind: specialty, domain: null } : { kind: "DOMAIN", domain: domainRefFromCode(specialty) },
  })

  it("todo Orquestrador oficial tem política persistida coerente e todo Especialista tem especialidade persistida — exatamente as esperadas pelo catálogo", () => {
    for (const [name, expected] of Object.entries(EXPECTED_ORCHESTRATOR_POLICIES)) {
      const orchestrator = byName(name)
      expect(orchestrator, name).toBeDefined()
      const policy = parseOrchestratorPolicy({ policy_kind: orchestrator.policyKind, policy_domains: orchestrator.policyDomains })
      expect({ kind: policy.kind, domains: policy.domains.map((domain) => domain.code) }, name).toEqual(expected)
      expect(describePolicyProblem(policy), name).toBeNull()
    }
    for (const [name, expected] of Object.entries(EXPECTED_SPECIALTIES)) {
      const agent = AI.agents.find((candidate) => candidate.name === name)
      expect(agent?.specialty, name).toBe(expected)
    }
    for (const orchestrator of AI.orchestrators) expect(EXPECTED_ORCHESTRATOR_POLICIES[orchestrator.name], `${orchestrator.name} fora do contrato do catálogo`).toBeDefined()
  })

  it("forma alvo (057): todo especialista oficial tem specialty_kind/domain/consolidated_input esperados e o legado `specialty` continua igual (dual-write); DOMAINS/OPEN espelham DOMAIN/MULTIDOMAIN/INTERACTIVE; TRANSVERSAL/MANAGERIAL seguem legado até a migração pós-JOIN", () => {
    for (const [name, expected] of Object.entries(EXPECTED_SPECIALTY_KINDS)) {
      const agent = AI.agents.find((candidate) => candidate.name === name)!
      expect(agent, name).toBeDefined()
      const specialty = resolveAgentSpecialty({ specialty: agent.specialty, specialty_kind: agent.specialtyKind, domain: agent.domain, capability: agent.capability, consolidated_input: agent.consolidatedInput })
      expect({ kind: specialty.kind, domain: specialty.domain?.code ?? null, consolidated: specialty.acceptsConsolidated }, name).toEqual(expected)
      expect(legacySpecialtyFor(specialty), `${name}: dual-write`).toBe(agent.specialty)
    }
    for (const [name, expected] of Object.entries(EXPECTED_ROUTING)) {
      const orchestrator = byName(name)
      const routing = resolveRoutingPolicy({ policy_kind: orchestrator.policyKind, policy_domains: orchestrator.policyDomains, routing_policy: orchestrator.routingPolicy, routing_domains: orchestrator.routingDomains })
      if (expected === null) {
        expect(orchestrator.routingPolicy, name).toBeNull()
        expect(routing.kind, name).toBe("LEGACY")
      } else {
        expect(routing.kind === "DOMAINS" ? { kind: routing.kind, domains: routing.domains.map((domain) => domain.code) } : routing, name).toEqual(expected)
        // dual-write: o legado equivalente continua persistido
        expect(legacyPolicyFor(routing, orchestrator.invocationMode).kind, `${name}: legado`).toBe(orchestrator.policyKind)
      }
    }
  })

  it("a taxonomia permite um Orquestrador de Reincidência (DOMAINS com vários domínios + transversal + diagnóstico listados) e um DOMAINS[CADASTRO] coordenando vários especialistas de cadastro — sem mudança estrutural", () => {
    const reincidencia = resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["CADASTRO", "FATURAMENTO", "RETENCAO", "SUPORTE"] })
    const candidates = [
      { name: "Agent · Troca de Titularidade", specialty: { kind: "DOMAIN" as const, domain: domainRefFromCode("CADASTRO") } },
      { name: "Agent · Qualidade/Atendimento", specialty: { kind: "CROSS_CUTTING" as const, domain: null } },
      { name: "Agent · Diagnóstico de Reincidência", specialty: { kind: "CROSS_CUTTING" as const, domain: null } },
      { name: "Agent · Faturamento", specialty: { kind: "DOMAIN" as const, domain: domainRefFromCode("FATURAMENTO") } },
    ]
    for (const candidate of candidates) expect(checkSpecialistAgainstRouting(reincidencia, candidate), candidate.name).toEqual({ allowed: true })
    expect(checkSpecialistAgainstRouting(reincidencia, { name: "Especialista de PRV", specialty: { kind: "PERFORMANCE", domain: null } }).allowed).toBe(false)
    expect(checkSpecialistAgainstRouting(reincidencia, { name: "Síntese", specialty: { kind: "SYNTHESIS", domain: null } }).allowed).toBe(false)
    const cadastro = resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["CADASTRO"] })
    for (const name of ["Agent · Troca de Titularidade", "Agent · Troca de Gestor", "Agent · Dados Cadastrais"]) {
      expect(checkSpecialistAgainstRouting(cadastro, { name, specialty: { kind: "DOMAIN", domain: domainRefFromCode("CADASTRO") } })).toEqual({ allowed: true })
    }
    expect(checkSpecialistAgainstRouting(cadastro, { name: "Agent · Faturamento", specialty: { kind: "DOMAIN", domain: domainRefFromCode("FATURAMENTO") } }).allowed).toBe(false)
    // 1 domínio ≡ antigo DOMAIN; vários ≡ antigo MULTIDOMAIN; OPEN ≡ chat/voz
    expect(legacyPolicyFor(cadastro, "WORKFLOW").kind).toBe("DOMAIN")
    expect(legacyPolicyFor(reincidencia, "WORKFLOW").kind).toBe("MULTIDOMAIN")
    expect(legacyPolicyFor({ kind: "OPEN" }, "INTERACTIVE").kind).toBe("INTERACTIVE")
  })

  it("nenhum Orquestrador oficial ativo fica sem política (a invariante da migration 054); só continuam ATIVOS os referenciados por um Workflow (multidomínio no 08; Gerencial por Workflows de QA fora do catálogo) — os de domínio/transversal sem referência foram DESATIVADOS, não apagados (fase 6)", () => {
    const referenced = new Set(MODELS.flatMap((model) => model.graph.nodes.flatMap((node) => (node.type === "orchestrator" ? [node.config.orchestratorId] : []))))
    const EXPECTED_ACTIVE = new Set(["Orquestrador · Atendimento multidomínio", "Orquestrador · Gerencial (consolidado)"])
    for (const orchestrator of AI.orchestrators) {
      expect(orchestrator.active, orchestrator.name).toBe(EXPECTED_ACTIVE.has(orchestrator.name))
      if (referenced.has(orchestrator.id)) expect(orchestrator.active, `${orchestrator.name} referenciado por um modelo precisa estar ativo`).toBe(true)
      const policy = parseOrchestratorPolicy({ policy_kind: orchestrator.policyKind, policy_domains: orchestrator.policyDomains })
      expect(policy.kind, `${orchestrator.name} sem policy_kind`).not.toBeNull()
      expect(describePolicyProblem(policy, { active: orchestrator.active, invocationMode: orchestrator.invocationMode }), orchestrator.name).toBeNull()
      expect(orchestrator.invocationMode, orchestrator.name).toBe("WORKFLOW")
      expect(policy.kind, orchestrator.name).not.toBe("INTERACTIVE")
    }
  })

  it.each(AI.orchestrators.map((orchestrator) => [orchestrator.name, orchestrator] as const))("%s: domínio, especialistas de domínio permitidos, transversais explicitamente autorizados e proibidos", (_name, orchestrator) => {
    const policy = parseOrchestratorPolicy({ policy_kind: orchestrator.policyKind, policy_domains: orchestrator.policyDomains })
    const coordinator = AGENT_BY_ID.get(orchestrator.coordinatorAgentId)
    expect(coordinator?.agentType).toBe("ORCHESTRATOR")
    // Ativo ou desativado (fase 6), a fronteira persistida continua coerente — reativar não exige reclassificar.
    expect(["WORKFLOW", "BOTH"]).toContain(orchestrator.invocationMode)
    // 1. Tudo que está vinculado passa pela regra de produção (a mesma do backend).
    for (const specialistId of orchestrator.specialistAgentIds) {
      const specialist = AGENT_BY_ID.get(specialistId)
      expect(specialist, `${orchestrator.name}: ${specialistId} fora do catálogo`).toBeDefined()
      expect(specialist!.active).toBe(true)
      expect(checkSpecialistAgainstPolicy(policy, candidateOf(specialist!.name, specialtyOf(specialistId))), `${orchestrator.name} × ${specialist!.name}`).toEqual({ allowed: true })
    }
    // 2. Especialistas de domínio: exatamente os domínios da política (um por domínio autorizado).
    const domains = new Set(orchestrator.specialistAgentIds.map(specialtyOf).filter((specialty): specialty is string => specialty !== null && specialty !== "CROSS_CUTTING" && specialty !== "PERFORMANCE" && specialty !== "SYNTHESIS"))
    if (policy.kind === "DOMAIN" || policy.kind === "MULTIDOMAIN") expect([...domains].sort()).toEqual(policy.domains.map((domain) => domain.code).sort())
    else expect(domains.size).toBe(0)
    if (policy.kind === "MANAGERIAL") expect(orchestrator.specialistAgentIds).toEqual([])
    // 3. Transversais: só os explicitamente autorizados pelo catálogo — nem mais, nem menos.
    const crossCutting = orchestrator.specialistAgentIds.filter((id) => specialtyOf(id) === "CROSS_CUTTING").map(agentName).sort()
    expect(crossCutting).toEqual([...EXPECTED_CROSS_CUTTING[orchestrator.name]!].sort())
    // 4. Proibidos: todo especialista de OUTRO domínio de processo e todo especialista de performance
    //    é recusado pela mesma regra — Faturamento nunca ganha Retenção "porque o agente existe".
    for (const agent of AI.agents) {
      const specialty = specialtyOf(agent.id)
      if (!specialty || specialty === "CROSS_CUTTING") continue
      const belongs = specialty !== "PERFORMANCE" && specialty !== "SYNTHESIS" && policy.domains.some((domain) => domain.code === specialty)
      const verdict = checkSpecialistAgainstPolicy(policy, candidateOf(agent.name, specialty))
      expect(verdict.allowed, `${orchestrator.name} × ${agent.name}`).toBe(policy.kind !== "MANAGERIAL" && belongs)
    }
  })

  it("proibições nomeadas: Faturamento ✗ Retenção; Retenção ✗ Faturamento; Suporte ✗ Retenção; Cadastro ✗ Faturamento; multidomínio ✓ todos os quatro; gerencial ✗ qualquer um", () => {
    const policyOf = (name: string) => parseOrchestratorPolicy({ policy_kind: byName(name).policyKind, policy_domains: byName(name).policyDomains })
    const retencao = candidateOf("Especialista de Retenção e Cancelamento", "RETENCAO")
    const faturamento = candidateOf("Especialista de Faturamento", "FATURAMENTO")
    expect(checkSpecialistAgainstPolicy(policyOf("Orquestrador · Faturamento"), retencao).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy(policyOf("Orquestrador · Retenção e Cancelamento"), faturamento).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy(policyOf("Orquestrador · Suporte Técnico"), retencao).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy(policyOf("Orquestrador · Cadastro e Titularidade"), faturamento).allowed).toBe(false)
    for (const specialist of [retencao, faturamento, candidateOf("Especialista de Suporte Técnico", "SUPORTE"), candidateOf("Especialista de Cadastro e Titularidade", "CADASTRO")]) {
      expect(checkSpecialistAgainstPolicy(policyOf("Orquestrador · Atendimento multidomínio"), specialist).allowed).toBe(true)
      expect(checkSpecialistAgainstPolicy(policyOf("Orquestrador · Gerencial (consolidado)"), specialist).allowed).toBe(false)
    }
  })

  it("todo Agent/Orquestrador referenciado pelos modelos existe no catálogo, está ativo e é compatível (especialista ≠ coordenador; orquestrador habilitado para Workflow)", () => {
    for (const model of MODELS) {
      for (const node of model.graph.nodes) {
        if (node.type === "action" && node.config.actionType === "CALL_AGENT") {
          const agent = AGENT_BY_ID.get(node.config.agentId)
          expect(agent, `${model.key}: agente ${node.config.agentId}`).toBeDefined()
          expect(agent!.active).toBe(true)
          expect(agent!.agentType).not.toBe("ORCHESTRATOR")
          expect(agent!.scopeType).toBe("ALL_TEAMS")
        }
        if (node.type === "orchestrator") {
          const orchestrator = ORCHESTRATOR_BY_ID.get(node.config.orchestratorId)
          expect(orchestrator, `${model.key}: orquestrador ${node.config.orchestratorId}`).toBeDefined()
          expect(orchestrator!.active).toBe(true)
          expect(["WORKFLOW", "BOTH"]).toContain(orchestrator!.invocationMode)
          expect(orchestrator!.scopeType).toBe("ALL_TEAMS")
        }
      }
    }
  })
})

describe("Template oficial × instância demo — o modelo conceitual nunca depende de UUID da massa demo", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const demoTeamNames = DEMO.teams.map((team) => team.name)
  const demoPeopleNames = DEMO.people.filter((person) => person.role !== "OPERATOR").map((person) => person.name)

  it("todo modelo tem um template com requisito estrutural, e o template não expõe id, prefixo demo, nome de Grupo demo nem pessoa demo", () => {
    expect(TEMPLATES.map((template) => template.key)).toEqual(MODELS.map((model) => model.key))
    const serialized = JSON.stringify(TEMPLATES)
    expect(serialized).not.toMatch(UUID)
    expect(serialized).not.toContain("de00")
    for (const name of demoTeamNames) expect(serialized, name).not.toContain(name)
    for (const name of demoPeopleNames) expect(serialized, name).not.toContain(name)
    for (const template of TEMPLATES) {
      const text = describeStructureRequirement(template.structureRequirement)
      expect(text).not.toMatch(UUID)
      expect(text).not.toMatch(/B2[BC] ·/)
    }
  })

  it("distribuição dos requisitos: genéricos em Todos os grupos; consolidados numa pessoa-âncora por cargo; de domínio num Grupo do domínio", () => {
    const kinds = new Map(TEMPLATES.map((template) => [template.key, template.structureRequirement]))
    expect([...kinds].filter(([, requirement]) => requirement.kind === "GENERIC").map(([key]) => key)).toEqual(["01", "02", "03", "06", "07", "08", "09", "10", "13", "19"])
    // O domínio do template é um CÓDIGO do catálogo + o nome de apresentação documentado (nunca um enum).
    expect(kinds.get("17")).toEqual({ kind: "GROUP", domain: "RETENCAO", domainName: "Retenção e Cancelamento" })
    expect(kinds.get("18a")).toEqual({ kind: "GROUP_SCOPE", domain: "FATURAMENTO", domainName: "Faturamento" })
    expect(kinds.get("18b")).toEqual({ kind: "GROUP_SCOPE", domain: "RETENCAO", domainName: "Retenção e Cancelamento" })
    expect(kinds.get("18c")).toEqual({ kind: "GROUP_SCOPE", domain: "SUPORTE", domainName: "Suporte Técnico" })
    expect(kinds.get("16")).toEqual({ kind: "PERSON_ANCHOR", role: "SUPERVISOR" })
    expect(kinds.get("20")).toEqual({ kind: "PERSON_ANCHOR", role: "MANAGER" })
    for (const key of ["04", "05", "11", "12", "14", "15"]) expect(kinds.get(key), key).toEqual({ kind: "PERSON_ANCHOR", role: "DIRECTOR" })
  })

  it("Modelos 11 e 12: o Especialista de Reconhecimento escreve no formato Reconhecimento, sobre um ranking de reconhecimento", () => {
    for (const key of ["11", "12"]) {
      const { graph } = MODELS.find((model) => model.key === key)!
      const agent = graph.nodes.find((node) => node.id === "agent")
      expect(agent?.type === "action" && agent.config.actionType === "CALL_AGENT" ? agent.config.outputContract : null, key).toBe("RECOGNITION")
      const selection = graph.nodes.find((node) => node.type === "select_employees")
      expect(selection?.type === "select_employees" && selection.config.ranking ? isRecognitionRankingSelection(selection.config.ranking.selection) : false, key).toBe(true)
    }
  })

  it.each(MODELS.map((model) => [model.key, model] as const))("Modelo %s: a instância demo satisfaz o requisito do template (binding resolvido na estrutura demo real)", (_key, model) => {
    const template = TEMPLATES.find((candidate) => candidate.key === model.key)!
    const groupDomainOf = (teamId: string) => DEMO.teams.find((team) => team.id === teamId)?.spec.domain ?? null
    expect(instanceSatisfiesRequirement(model, template.structureRequirement, groupDomainOf)).toEqual({ ok: true })
  })

  it("um binding errado é recusado: Grupo de outro domínio, estrutura de cargo diferente, genérico com Abrangência de Grupo", () => {
    const model17 = MODELS.find((model) => model.key === "17")!
    const faturamentoTeam = DEMO.teamByKey.get("b2c-faturamento")!.id
    const wrongDomain = instanceSatisfiesRequirement({ ...model17, teamId: faturamentoTeam, consolidatedStructure: { kind: "TEAM", teamId: faturamentoTeam } }, { kind: "GROUP", domain: "RETENCAO" }, (teamId) => DEMO.teams.find((team) => team.id === teamId)?.spec.domain ?? null)
    expect(wrongDomain).toMatchObject({ ok: false })
    const model20 = MODELS.find((model) => model.key === "20")!
    expect(instanceSatisfiesRequirement(model20, { kind: "PERSON_ANCHOR", role: "DIRECTOR" }, () => null)).toMatchObject({ ok: false })
    const model01 = MODELS.find((model) => model.key === "01")!
    expect(instanceSatisfiesRequirement({ ...model01, scopeType: "TEAM", teamId: faturamentoTeam }, { kind: "GENERIC" }, () => null)).toMatchObject({ ok: false })
  })
})
