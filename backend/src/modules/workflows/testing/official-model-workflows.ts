import { readFileSync } from "node:fs"
import type { FlowGraph } from "../domain/graph-schema.js"
import type { ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import { structureAnchorPersonId } from "../domain/structure-anchor-schema.js"
import type { TriggerConfig } from "../domain/trigger-config-schema.js"

/**
 * Os 20 Workflows-modelo oficiais da INIA (22 instâncias — o Modelo 18 tem uma por Base de
 * Conhecimento), EXATAMENTE como estão persistidos em `workflows.draft_graph` (rascunhos criados
 * pela UI/contrato do editor, nunca publicados). O JSON ao lado é uma exportação literal do banco
 * de referência (rodada de hardening dos Workflows-modelo, 2026-09-16) e é a fonte única que os
 * testes de catálogo — backend (validação de publicação completa) e frontend (validador do
 * editor) — consomem, pra nunca existir uma 2ª descrição dos modelos "só pra teste".
 *
 * Quando um modelo mudar no banco, reexporte o JSON (ver docs/dev/workflows-modelo.md) — o teste
 * de catálogo falhando é o sinal de que a Wiki e o catálogo precisam ser revistos juntos.
 */
export type OfficialModelWorkflow = {
  /** "01".."20", com "18a"/"18b"/"18c" para as instâncias por KB. */
  key: string
  id: string
  name: string
  trigger: TriggerConfig
  scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"
  teamId: string | null
  subteamId: string | null
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
  graph: FlowGraph
}

export function loadOfficialModelWorkflows(): OfficialModelWorkflow[] {
  const raw = readFileSync(new URL("./official-model-workflows.json", import.meta.url), "utf8")
  return JSON.parse(raw) as OfficialModelWorkflow[]
}

/**
 * Quem se beneficia do modelo, DERIVADO de quem RECEBE Output no grafo real (nunca declarado à mão,
 * nunca pelo nome): OPERADOR = só Outputs ao próprio operador (a Revisão humana do Supervisor é
 * salvaguarda, não beneficiário); SUPERVISOR = só Outputs de gestão no nível de Supervisor;
 * LIDERANCA = só Outputs de gestão a Gerente ou acima; MULTINIVEL = Output ao operador E Output de
 * gestão. Reaproveitado pelo teste de cobertura e documentado na Wiki.
 */
export type ModelBeneficiary = "OPERADOR" | "SUPERVISOR" | "LIDERANCA" | "MULTINIVEL"

type OutputNode = Extract<FlowGraph["nodes"][number], { type: "output" }>

function outputRoleLevel(node: OutputNode): "OPERATOR" | "SUPERVISOR" | "LEADERSHIP" | "PERSON" {
  const target = node.config.target
  if (target.type === "CURRENT_OPERATOR") return "OPERATOR"
  if (target.type === "SUPERVISOR_OF_OPERATOR") return "SUPERVISOR"
  if (target.type === "MANAGER_OF_OPERATOR") return "LEADERSHIP"
  if (target.type === "ROLE") return target.role === "SUPERVISOR" || target.role === "COORDINATOR" ? "SUPERVISOR" : "LEADERSHIP"
  return "PERSON"
}

export function classifyBeneficiary(model: OfficialModelWorkflow): ModelBeneficiary {
  const outputs = model.graph.nodes.filter((node): node is OutputNode => node.type === "output")
  const levels = new Set(outputs.map(outputRoleLevel))
  const toOperator = levels.has("OPERATOR")
  const toManagement = levels.has("SUPERVISOR") || levels.has("LEADERSHIP") || levels.has("PERSON")
  if (toOperator && toManagement) return "MULTINIVEL"
  if (toOperator) return "OPERADOR"
  if (levels.has("LEADERSHIP")) return "LIDERANCA"
  return "SUPERVISOR"
}

/** Todo id de Grupo/Subgrupo/pessoa que o modelo referencia fora do grafo (Abrangência + Estrutura)
 * — o que o teste de catálogo confere contra a estrutura demo regenerada em memória. */
export function structuralReferences(model: OfficialModelWorkflow): { kind: "TEAM" | "SUBTEAM" | "PERSON"; id: string; where: string }[] {
  const refs: { kind: "TEAM" | "SUBTEAM" | "PERSON"; id: string; where: string }[] = []
  if (model.teamId) refs.push({ kind: "TEAM", id: model.teamId, where: "Abrangência" })
  if (model.subteamId) refs.push({ kind: "SUBTEAM", id: model.subteamId, where: "Abrangência" })
  const structure = model.consolidatedStructure
  if (structure) {
    if (structure.kind === "TEAM") refs.push({ kind: "TEAM", id: structure.teamId, where: "Estrutura consolidada" })
    else if (structure.kind === "SUBTEAM") refs.push({ kind: "SUBTEAM", id: structure.subteamId, where: "Estrutura consolidada" })
    else refs.push({ kind: "PERSON", id: structureAnchorPersonId(structure)!, where: "Estrutura consolidada" })
  }
  const filter = model.populationFilter
  if (filter && filter.kind !== "ALL") {
    if (filter.kind === "EMPLOYEE") refs.push({ kind: "PERSON", id: filter.employeeId, where: "Filtro populacional" })
    else if (filter.kind === "TEAM") refs.push({ kind: "TEAM", id: filter.teamId, where: "Filtro populacional" })
    else if (filter.kind === "SUBTEAM") refs.push({ kind: "SUBTEAM", id: filter.subteamId, where: "Filtro populacional" })
    else refs.push({ kind: "PERSON", id: structureAnchorPersonId(filter)!, where: "Filtro populacional" })
  }
  return refs
}
