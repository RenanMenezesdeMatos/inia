import { orchestratorForTeam, type InteractiveOrchestratorScope } from "../../assistant/application/resolve-orchestrator.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { matchesAllTokens, normalizeForMatch } from "../domain/analytic-rules.js"
import type { LeadershipToolResult } from "./leadership-toolset.js"
import { resolveStructureReference, type ResolvedStructure } from "./references.js"

/**
 * CONSULTA DE PROCESSO POR GRUPO — quem lidera pode ter equipes em Grupos diferentes, e cada Grupo configura o SEU Orquestrador
 * (especialistas, bases, limites de atuação, materiais). Os números da estrutura não dependem disso (ferramentas da liderança);
 * processos e conhecimento, sim: esta ferramenta leva a dúvida ao Orquestrador do Grupo certo — o do próprio Grupo ou, sem ele, o
 * de "Todos os grupos" (`orchestratorForTeam`, a mesma regra do chat de quem atende). O Grupo vem do parâmetro, de uma estrutura
 * citada (liderado, Grupo ou Subgrupo, sempre contra o escopo da sessão) ou é implícito quando todos os Grupos da estrutura caem
 * no mesmo Orquestrador; Grupos com Orquestradores diferentes e nenhuma pista = pergunta de volta, nunca um palpite.
 * O Grupo do cadastro de quem lidera não decide nada aqui.
 */
export const PROCESS_TOOL = "leadership_process"

/** Um Grupo com operadores na estrutura de quem lidera. */
export type StructureGroup = { teamId: string; name: string }

export type GroupResolution = { kind: "OK"; teamIds: string[] } | { kind: "AMBIGUOUS"; candidates: string[] } | { kind: "NOT_FOUND"; message: string }

/** O que a sessão de liderança sabe para a consulta de processo: os Grupos da estrutura e como achar os de uma estrutura citada. */
export type ProcessScope = { groups: StructureGroup[]; groupsOfStructure: (name: string) => GroupResolution }

export type ProcessConsultation = { orchestrator: InteractiveOrchestratorScope; groupNames: string[]; question: string }

/** Resposta do Orquestrador do Grupo (`null` = indisponível agora, ex.: desativado entre a montagem e a chamada). */
export type ProcessConsultationAnswer = { text: string; trace: Record<string, unknown> } | null

export type ProcessToolset = {
  declarations: FunctionDeclaration[]
  handles: (name: string) => boolean
  execute: (name: string, args: Record<string, unknown>) => Promise<LeadershipToolResult>
}

/** Grupos dos operadores da estrutura que a pessoa lidera (ou, só com acesso ampliado, de todos os operadores visíveis). */
export function structureGroupsOf(scope: ViewerScope, own: ResolvedStructure | null): StructureGroup[] {
  const members = own ? own.resolved.members : [...scope.nodes.values()].filter((node) => node.role === "OPERATOR")
  const byId = new Map<string, string>()
  for (const member of members) if (member.teamId) byId.set(member.teamId, member.teamName ?? member.teamId)
  return [...byId].map(([teamId, name]) => ({ teamId, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

export function processScopeOf(scope: ViewerScope, own: ResolvedStructure | null): ProcessScope {
  return {
    groups: structureGroupsOf(scope, own),
    groupsOfStructure: (name) => {
      const outcome = resolveStructureReference(scope, { name })
      if (outcome.kind !== "OK") return outcome
      return { kind: "OK", teamIds: [...new Set(outcome.value.resolved.members.flatMap((member) => (member.teamId ? [member.teamId] : [])))] }
    },
  }
}

/**
 * A ferramenta, ou `null` quando nenhum Grupo da estrutura tem Orquestrador do chat (nem há um de "Todos os grupos"): sem quem
 * responda processos, a ferramenta não é oferecida.
 */
export function buildProcessConsultationToolset(input: { scope: ProcessScope; orchestrators: InteractiveOrchestratorScope[]; consult: (consultation: ProcessConsultation) => Promise<ProcessConsultationAnswer> }): ProcessToolset | null {
  const { groups } = input.scope
  const orchestratorOf = (teamId: string | null) => orchestratorForTeam(input.orchestrators, teamId)
  const fallback = orchestratorOf(null)
  const reachable = groups.length > 0 ? groups.filter((group) => orchestratorOf(group.teamId) !== null) : []
  if (reachable.length === 0 && !fallback) return null
  const distinct = distinctOrchestrators(groups.length > 0 ? groups.map((group) => orchestratorOf(group.teamId)) : [fallback])
  // Diz ao modelo se o Grupo importa: bases diferentes = passe o Grupo; uma base só = não passe (evita consultar a mesma base duas vezes).
  const mapping =
    distinct.length > 1
      ? ` Grupos com bases diferentes: ${groups.map((group) => `${group.name} → ${orchestratorOf(group.teamId)?.name ?? "sem Orquestrador"}`).join("; ")}.`
      : groups.length > 1
        ? ` Todos os Grupos da estrutura usam a mesma base (${distinct[0]?.name ?? ""}): não passe grupo nem consulte um Grupo de cada vez.`
        : ""
  const declaration: FunctionDeclaration = {
    name: PROCESS_TOOL,
    description:
      "Processos, procedimentos, políticas e o conhecimento das bases para ORIENTAR a equipe — \"como funciona X\", \"qual o procedimento de Y\", \"o que a base diz sobre Z\", \"como orientar a equipe em W\". Responde o Orquestrador do Grupo da equipe (especialistas e bases DAQUELE Grupo). Não traz números: para resultados, pessoas e diagnósticos use as outras ferramentas." +
      mapping,
    parameters: {
      type: "object",
      properties: {
        pergunta: { type: "string", description: "A dúvida completa e autossuficiente, com o contexto da conversa (indicador, motivo, equipe)." },
        ...(groups.length > 1 ? { grupo: { type: "string", description: "O Grupo da dúvida, quando a pessoa disser ou o contexto indicar.", enum: groups.map((group) => group.name) } } : {}),
        estrutura: { type: "string", description: "Liderado, Grupo ou Subgrupo citado (\"a equipe da Ana\") — o sistema descobre o Grupo." },
      },
      required: ["pergunta"],
    },
  }

  const execute = async (_name: string, args: Record<string, unknown>): Promise<LeadershipToolResult> => {
    const question = typeof args.pergunta === "string" ? args.pergunta.trim() : ""
    if (!question) return issue("INVALID", "Informe a dúvida de processo em `pergunta`.", [])
    // Grupos da dúvida: o citado, os de uma estrutura citada, ou todos os da estrutura.
    let chosen = groups
    if (typeof args.grupo === "string" && args.grupo.trim()) {
      const name = args.grupo.trim()
      const exact = groups.filter((group) => normalizeForMatch(group.name) === normalizeForMatch(name))
      const matches = exact.length > 0 ? exact : groups.filter((group) => matchesAllTokens(group.name, name))
      if (matches.length === 0) return issue("NOT_FOUND", `O Grupo "${name}" não está na estrutura que você lidera. Grupos: ${groups.map((group) => group.name).join(", ") || "nenhum"}.`, [])
      if (matches.length > 1) return issue("AMBIGUOUS", `Há mais de um Grupo com esse nome: ${matches.map((group) => group.name).join("; ")}.`, matches.map((group) => group.name))
      chosen = matches
    } else if (typeof args.estrutura === "string" && args.estrutura.trim()) {
      const outcome = input.scope.groupsOfStructure(args.estrutura.trim())
      if (outcome.kind === "AMBIGUOUS") return issue("AMBIGUOUS", `Há mais de uma estrutura com esse nome: ${outcome.candidates.join("; ")}.`, outcome.candidates)
      if (outcome.kind === "NOT_FOUND") return issue("NOT_FOUND", outcome.message, [])
      chosen = groups.filter((group) => outcome.teamIds.includes(group.teamId))
    }
    const targets = chosen.length > 0 ? chosen.map((group) => ({ group, orchestrator: orchestratorOf(group.teamId) })) : [{ group: null, orchestrator: fallback }]
    const configured = distinctOrchestrators(targets.map((target) => target.orchestrator))
    if (configured.length === 0) return issue("NOT_FOUND", `Nenhum Orquestrador de processos está configurado para ${chosen.map((group) => group.name).join(", ") || "esta estrutura"}.`, [])
    if (configured.length > 1) {
      // Grupos com bases diferentes e nenhuma pista de qual é a dúvida: pergunta de volta (ou o modelo consulta cada Grupo).
      const options = targets.map((target) => `${target.group?.name ?? "Sem Grupo"} (${target.orchestrator?.name ?? "sem Orquestrador"})`)
      return issue("AMBIGUOUS", `Os Grupos da estrutura têm bases diferentes: ${options.join("; ")}. Pergunte de qual Grupo é a dúvida ou consulte cada Grupo em separado (parâmetro grupo).`, targets.flatMap((target) => (target.group ? [target.group.name] : [])))
    }
    const orchestrator = configured[0]!
    const groupNames = targets.filter((target) => target.orchestrator?.id === orchestrator.id).flatMap((target) => (target.group ? [target.group.name] : []))
    // Falha na consulta (especialista, provedor de IA) vira um aviso para a resposta — nunca derruba a resposta inteira do líder.
    let answer: ProcessConsultationAnswer
    try {
      answer = await input.consult({ orchestrator, groupNames, question })
    } catch (error) {
      console.error(JSON.stringify({ event: "leadership_process_consultation_failed", orchestratorId: orchestrator.id, message: (error as Error).message }))
      return { ...issue("NOT_FOUND", `A consulta ao Orquestrador "${orchestrator.name}" falhou agora; o procedimento não pôde ser trazido.`, []), trace: { groups: groupNames, orchestratorId: orchestrator.id, orchestratorName: orchestrator.name, failed: true } }
    }
    if (!answer) return issue("NOT_FOUND", `O Orquestrador "${orchestrator.name}" não está disponível agora.`, [])
    const where = groupNames.length > 0 ? `Grupo ${groupNames.join(", ")}` : "todos os Grupos"
    return {
      text: [`[Consulta de processo — Orquestrador "${orchestrator.name}" (${where}): conhecimento das bases desse Grupo. Use como fonte do procedimento; não é dado da equipe]`, answer.text].join("\n"),
      card: null,
      trace: { groups: groupNames, orchestratorId: orchestrator.id, orchestratorName: orchestrator.name, ...answer.trace },
    }
  }

  return { declarations: [declaration], handles: (name) => name === PROCESS_TOOL, execute }
}

/** Duas listas de ferramentas diretas como uma só (a primeira que conhece o nome executa). */
export function combineToolsets<T extends ProcessToolset>(...toolsets: T[]): ProcessToolset {
  return {
    declarations: toolsets.flatMap((toolset) => toolset.declarations),
    handles: (name) => toolsets.some((toolset) => toolset.handles(name)),
    execute: (name, args) => (toolsets.find((toolset) => toolset.handles(name)) ?? toolsets[0]!).execute(name, args),
  }
}

function distinctOrchestrators(list: (InteractiveOrchestratorScope | null)[]): InteractiveOrchestratorScope[] {
  const byId = new Map<string, InteractiveOrchestratorScope>()
  for (const orchestrator of list) if (orchestrator) byId.set(orchestrator.id, orchestrator)
  return [...byId.values()]
}

function issue(kind: "AMBIGUOUS" | "NOT_FOUND" | "INVALID", message: string, candidates: string[]): LeadershipToolResult {
  const hint = kind === "AMBIGUOUS" ? " Pergunte ao usuário qual, sem escolher por conta própria." : kind === "NOT_FOUND" ? " Diga isso ao usuário." : ""
  return { text: `${message}${hint}`, card: null, issue: { kind, message, candidates } }
}
