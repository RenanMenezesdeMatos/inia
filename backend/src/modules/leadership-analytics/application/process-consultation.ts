import { z } from "zod"
import { orchestratorForTeam, type InteractiveOrchestratorScope } from "../../assistant/application/resolve-orchestrator.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { universeAllowsPerson, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { OPERATING_UNIVERSES } from "../../operating-universe/domain/operating-universe.js"
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

/**
 * Um Grupo com operadores na estrutura de quem lidera. `universes` (só com a exigência de universo ativa): universos dos operadores
 * do Grupo que quem lidera alcança — o Orquestrador do Grupo precisa ser de um deles (`orchestratorForTeam`).
 */
export type StructureGroup = { teamId: string; name: string; universes?: string[] }

export type GroupResolution = { kind: "OK"; teamIds: string[] } | { kind: "AMBIGUOUS"; candidates: string[] } | { kind: "NOT_FOUND"; message: string }

/** O que a sessão de liderança sabe para a consulta de processo: os Grupos da estrutura e como achar os de uma estrutura citada. */
export type ProcessScope = {
  groups: StructureGroup[]
  groupsOfStructure: (name: string) => GroupResolution
  /**
   * Universos de atuação dos Orquestradores que a consulta pode usar (lista e resolução por id), da abrangência de quem lidera: o
   * universo do cadastro, ou todos com `operating_universes.all`. Null/ausente = sem filtro (organização sem a exigência ativa).
   */
  orchestratorUniverses?: readonly string[] | null
}

/** `teamIds` = Grupos consultados (vazio = a estrutura inteira de quem lidera): os públicos dos alinhamentos e comunicados da resposta. */
export type ProcessConsultation = { orchestrator: InteractiveOrchestratorScope; groupNames: string[]; teamIds: string[]; question: string }

/**
 * Resposta do Orquestrador do Grupo (`null` = indisponível agora, ex.: desativado entre a montagem e a chamada). `clarification` = quem
 * respondeu foi o ESCLARECIMENTO pelas bases do Grupo (pergunta com opções, resposta com fontes ou o que falta): o texto vai para a
 * tela exatamente como está, depois da resposta da liderança — o modelo da liderança não o reescreve.
 */
export type ProcessConsultationAnswer = { text: string; trace: Record<string, unknown>; clarification?: boolean } | null

/** Nota ao modelo da liderança quando a consulta foi respondida pelo esclarecimento (o texto dele é anexado à resposta pelo sistema). */
export const PROCESS_CLARIFICATION_NOTE =
  "as bases desse Grupo responderam pelo esclarecimento. O texto abaixo aparece para quem pergunta EXATAMENTE como está, logo depois da sua resposta, com o formulário de escolha ou as fontes numeradas: não o repita, não o resuma, não liste as opções e não responda o procedimento por conta própria. Escreva só o que a resposta precisa além dele (o que as outras ferramentas trouxeram); sem mais nada, uma frase curta de introdução basta"

/**
 * Onde um esclarecimento pelas bases foi feito pela consulta de processo — gravado junto do estado (`tool_calls`, entrada
 * `knowledge_clarification`): o Orquestrador do Grupo cujas bases foram consultadas. A escolha no formulário continua nele, e só
 * enquanto ele estiver ao alcance de quem lidera (`reachableProcessOrchestrators`).
 */
export const processClarificationScopeSchema = z.object({
  kind: z.literal("LEADERSHIP_PROCESS"),
  orchestratorId: z.string().min(1).max(64),
  orchestratorName: z.string().max(200),
  groupNames: z.array(z.string().max(200)).max(50),
})
export type ProcessClarificationScope = z.infer<typeof processClarificationScopeSchema>

export function parseProcessClarificationScope(value: unknown): ProcessClarificationScope | null {
  const parsed = processClarificationScopeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type ProcessToolset = {
  declarations: FunctionDeclaration[]
  handles: (name: string) => boolean
  execute: (name: string, args: Record<string, unknown>) => Promise<LeadershipToolResult>
  /** O que o código decidiu neste turno (`PROCESS_GROUP_RULE_V1`): a resposta é a pergunta do Grupo, ou Grupos ficaram de fora. */
  outcome?: () => ProcessTurnOutcome
}

/**
 * Grupos dos operadores da estrutura que a pessoa lidera (ou, só com acesso ampliado, de todos os operadores visíveis). Só operadores
 * que o universo de atuação de quem lidera alcança contam (`universeAllowsPerson`): um Grupo só de outro universo não aparece.
 */
export function structureGroupsOf(scope: ViewerScope, own: ResolvedStructure | null): StructureGroup[] {
  const members = own ? own.resolved.members : [...scope.nodes.values()].filter((node) => node.role === "OPERATOR" && universeAllowsPerson(scope, node))
  const enforced = scope.universe?.enforced === true
  const byId = new Map<string, { name: string; universes: Set<string> }>()
  for (const member of members) {
    if (!member.teamId) continue
    const entry = byId.get(member.teamId) ?? { name: member.teamName ?? member.teamId, universes: new Set<string>() }
    if (member.operatingUniverse) entry.universes.add(member.operatingUniverse)
    byId.set(member.teamId, entry)
  }
  return [...byId]
    .map(([teamId, entry]) => ({ teamId, name: entry.name, ...(enforced ? { universes: [...entry.universes].sort() } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

/**
 * Universos dos Orquestradores que quem lidera pode consultar — o MESMO critério de recurso do chat (`loadUniverseAccess`), lido da
 * sessão já carregada: sem a exigência, null (sem filtro); com ela, todos com a permissão em algum escopo, senão o do cadastro (pendente
 * = nenhum).
 */
export function processOrchestratorUniverses(scope: ViewerScope): readonly string[] | null {
  const rule = scope.universe
  if (!rule?.enforced) return null
  // `operating_universes.all` em algum escopo (Grupo, Subgrupo, organização ou "Minha estrutura") = `canAnywhere` de `loadUniverseAccess`.
  const allAnywhere = rule.cross.organizationWide || rule.cross.teamIds.length > 0 || rule.cross.subteamIds.length > 0 || rule.crossInStructure
  if (allAnywhere) return [...OPERATING_UNIVERSES]
  // Quem lidera equipes de outro universo (supervisor com B2C e B2B — decisão do usuário, 16/11) consulta também os Orquestradores dos
  // universos dos operadores da PRÓPRIA estrutura; universo que ela não lidera nem tem pelo cadastro continua fora.
  const led = [...scope.nodes.values()].filter((node) => node.role === "OPERATOR" && node.active && scope.structureIds?.has(node.id) && node.operatingUniverse).map((node) => node.operatingUniverse!)
  return [...new Set([...(rule.own ? [rule.own] : []), ...led])].sort()
}

export function processScopeOf(scope: ViewerScope, own: ResolvedStructure | null): ProcessScope {
  return {
    groups: structureGroupsOf(scope, own),
    groupsOfStructure: (name) => {
      const outcome = resolveStructureReference(scope, { name })
      if (outcome.kind !== "OK") return outcome
      return { kind: "OK", teamIds: [...new Set(outcome.value.resolved.members.flatMap((member) => (member.teamId ? [member.teamId] : [])))] }
    },
    orchestratorUniverses: processOrchestratorUniverses(scope),
  }
}

/**
 * REGRA DO GRUPO NA CONSULTA DE PROCESSO (`PROCESS_GROUP_RULE_V1`, 17/11/2026 — "a IA não pode chutar"; bateria paga mostrou o modelo
 * escolhendo 2 de 5 Grupos sozinho e respondendo como se fosse tudo). Decidido pelo CÓDIGO, não pelo modelo:
 *   1. O Grupo (ou a estrutura) só vale se a PESSOA o disse na conversa (`askerTexts`): Grupo escolhido pelo modelo sem a pessoa ter
 *      dito é ignorado.
 *   2. Sem Grupo e com Grupos de bases diferentes: nada é consultado e a RESPOSTA é a pergunta do Grupo, montada aqui com TODOS os Grupos
 *      (`groupChoiceText`) — o texto do modelo é descartado.
 *   3. Grupo pedido que passou do limite de consultas: o sistema diz qual ficou de fora (`skippedGroupsNote`).
 */
export const PROCESS_GROUP_RULE_VERSION = "PROCESS_GROUP_RULE_V1"

export type ProcessTurnOutcome = { groupChoice: string[] | null; skippedGroups: string[]; consultedGroups: string[] }

/** Palavras do nome do Grupo que o distinguem dos outros Grupos da estrutura ("B2C · Faturamento" → "faturamento"). */
function distinctiveTokens(name: string, others: readonly string[]): string[] {
  const otherWords = new Set(others.flatMap((other) => normalizeForMatch(other).split(" ")))
  const own = normalizeForMatch(name).split(" ").filter((word) => word.length > 1)
  const distinctive = own.filter((word) => !otherWords.has(word))
  return distinctive.length > 0 ? distinctive : own
}

/** A pessoa citou este Grupo em alguma fala da conversa (palavras que o distinguem, como início de palavra). */
export function groupNamedByAsker(groupName: string, allGroupNames: readonly string[], askerTexts: readonly string[]): boolean {
  const tokens = distinctiveTokens(groupName, allGroupNames.filter((name) => name !== groupName))
  // O nome inteiro (sem o que vem entre parênteses) como expressão também vale: "Grupo A" em "troca no Grupo A?".
  const core = normalizeForMatch(groupName.replace(/\([^)]*\)/g, " "))
  return askerTexts.some((text) => {
    const normalized = normalizeForMatch(text)
    if (core && ` ${normalized} `.includes(` ${core} `)) return true
    const words = normalized.split(" ")
    return tokens.every((token) => words.some((word) => word.startsWith(token)))
  })
}

/** A pessoa citou a estrutura ("a equipe da Ana"): todas as palavras dela aparecem numa fala. */
function structureNamedByAsker(reference: string, askerTexts: readonly string[]): boolean {
  return askerTexts.some((text) => matchesAllTokens(text, reference))
}

/** A resposta quando o Grupo é necessário e a pessoa não disse: montada pelo sistema, com TODOS os Grupos da estrutura. */
export function groupChoiceText(groupNames: readonly string[]): string {
  const list = groupNames.length > 1 ? `${groupNames.slice(0, -1).join(", ")} ou ${groupNames.at(-1)}` : (groupNames[0] ?? "")
  return `Cada Grupo da sua estrutura tem o próprio procedimento para isso, então não vou responder sem saber qual. De qual Grupo é a sua dúvida: ${list}?`
}

/** Grupos pedidos que ficaram fora desta resposta pelo limite de consultas. */
export function skippedGroupsNote(skipped: readonly string[]): string {
  return `\n\nNão consultei ${skipped.length > 1 ? "os Grupos" : "o Grupo"} ${skipped.join(", ")} nesta resposta (limite de ${MAX_PROCESS_CONSULTATIONS_PER_TURN} Grupos por pergunta). Pergunte por ${skipped.length > 1 ? "eles" : "ele"} em seguida para eu trazer o procedimento.`
}

/** Consultas de processo por resposta (cada uma é um Orquestrador inteiro). */
export const MAX_PROCESS_CONSULTATIONS_PER_TURN = 2

/**
 * A ferramenta, ou `null` quando nenhum Grupo da estrutura tem Orquestrador do chat (nem há um de "Todos os grupos"): sem quem
 * responda processos, a ferramenta não é oferecida.
 */
export function buildProcessConsultationToolset(input: { scope: ProcessScope; orchestrators: InteractiveOrchestratorScope[]; consult: (consultation: ProcessConsultation) => Promise<ProcessConsultationAnswer>; /** Falas da PESSOA nesta conversa (as mais recentes) — onde o Grupo precisa ter sido dito. Ausente = sem conferência (testes antigos). */ askerTexts?: readonly string[] }): ProcessToolset | null {
  const { groups } = input.scope
  const universesOf = new Map(groups.map((group) => [group.teamId, group.universes ?? null]))
  const orchestratorOf = (teamId: string | null) => orchestratorForTeam(input.orchestrators, teamId, teamId === null ? null : (universesOf.get(teamId) ?? null))
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

  // Cada consulta roda um Orquestrador inteiro (roteamento + especialistas + síntese): no máximo
  // MAX_PROCESS_CONSULTATIONS_PER_TURN por resposta (o toolset nasce a cada turno — achado AI-01 da auditoria de 17/10/2026).
  let consultations = 0
  const turn: ProcessTurnOutcome = { groupChoice: null, skippedGroups: [], consultedGroups: [] }
  const askerTexts = input.askerTexts ?? null
  const allGroupNames = groups.map((group) => group.name)
  const execute = async (_name: string, args: Record<string, unknown>): Promise<LeadershipToolResult> => {
    const question = typeof args.pergunta === "string" ? args.pergunta.trim() : ""
    if (!question) return issue("INVALID", "Informe a dúvida de processo em `pergunta`.", [])
    // Regra 1: Grupo/estrutura só valem se a pessoa os disse (o modelo não escolhe por ela).
    if (askerTexts && typeof args.grupo === "string" && args.grupo.trim()) {
      const named = groups.filter((group) => matchesAllTokens(group.name, args.grupo as string) || normalizeForMatch(group.name) === normalizeForMatch(args.grupo as string))
      if (!named.some((group) => groupNamedByAsker(group.name, allGroupNames, askerTexts))) args = { ...args, grupo: undefined }
    }
    if (askerTexts && typeof args.estrutura === "string" && args.estrutura.trim() && !structureNamedByAsker(args.estrutura, askerTexts)) args = { ...args, estrutura: undefined }
    if (consultations >= MAX_PROCESS_CONSULTATIONS_PER_TURN) {
      if (typeof args.grupo === "string" && args.grupo.trim()) turn.skippedGroups.push(args.grupo.trim())
      return issue("INVALID", `Limite de ${MAX_PROCESS_CONSULTATIONS_PER_TURN} consultas de processo por pergunta atingido; responda com o que já foi consultado e ofereça consultar o restante numa próxima pergunta.`, [])
    }
    consultations += 1
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
    if (configured.length > 1 && askerTexts) {
      // Regra 2: sem Grupo dito e com bases diferentes, a resposta é a pergunta do Grupo (montada pelo sistema; nada consultado).
      consultations -= 1
      turn.groupChoice = allGroupNames
      return { ...issue("AMBIGUOUS", `GRUPO NECESSÁRIO: os Grupos da estrutura têm procedimentos diferentes e a pessoa não disse qual. O sistema vai perguntar de qual Grupo é a dúvida; não escreva nenhum procedimento nem escolha Grupo.`, allGroupNames), trace: { groups: [], groupChoice: allGroupNames, rule: PROCESS_GROUP_RULE_VERSION } }
    }
    if (configured.length > 1) {
      // Grupos com bases diferentes e nenhuma pista de qual é a dúvida: pergunta de volta (ou o modelo consulta cada Grupo).
      const options = targets.map((target) => `${target.group?.name ?? "Sem Grupo"} (${target.orchestrator?.name ?? "sem Orquestrador"})`)
      return issue("AMBIGUOUS", `Os Grupos da estrutura têm bases diferentes: ${options.join("; ")}. Pergunte de qual Grupo é a dúvida ou consulte cada Grupo em separado (parâmetro grupo).`, targets.flatMap((target) => (target.group ? [target.group.name] : [])))
    }
    const orchestrator = configured[0]!
    const groupNames = targets.filter((target) => target.orchestrator?.id === orchestrator.id).flatMap((target) => (target.group ? [target.group.name] : []))
    const teamIds = targets.filter((target) => target.orchestrator?.id === orchestrator.id).flatMap((target) => (target.group ? [target.group.teamId] : []))
    // Falha na consulta (especialista, provedor de IA) vira um aviso para a resposta — nunca derruba a resposta inteira do líder.
    let answer: ProcessConsultationAnswer
    try {
      answer = await input.consult({ orchestrator, groupNames, teamIds, question })
    } catch (error) {
      console.error(JSON.stringify({ event: "leadership_process_consultation_failed", orchestratorId: orchestrator.id, message: (error as Error).message }))
      return { ...issue("NOT_FOUND", `A consulta ao Orquestrador "${orchestrator.name}" falhou agora; o procedimento não pôde ser trazido.`, []), trace: { groups: groupNames, orchestratorId: orchestrator.id, orchestratorName: orchestrator.name, failed: true } }
    }
    if (!answer) return issue("NOT_FOUND", `O Orquestrador "${orchestrator.name}" não está disponível agora.`, [])
    const where = groupNames.length > 0 ? `Grupo ${groupNames.join(", ")}` : "todos os Grupos"
    turn.consultedGroups.push(...(groupNames.length > 0 ? groupNames : [orchestrator.name]))
    const note = answer.clarification ? PROCESS_CLARIFICATION_NOTE : "conhecimento das bases desse Grupo. Use como fonte do procedimento; não é dado da equipe. Use SOMENTE o que está neste texto para o procedimento: não acrescente etapas, sistemas, prazos, causas nem consequências que não estejam aqui. Também na orientação à gestão: não diga para que serve uma etapa, o que ela evita ou garante, nem o que acontece se não for feita, a menos que este texto diga"
    return {
      text: [`[Consulta de processo — Orquestrador "${orchestrator.name}" (${where}): ${note}]`, answer.text].join("\n"),
      card: null,
      trace: { groups: groupNames, orchestratorId: orchestrator.id, orchestratorName: orchestrator.name, ...answer.trace },
    }
  }

  return { declarations: [declaration], handles: (name) => name === PROCESS_TOOL, execute, outcome: () => turn }
}

/**
 * Orquestradores que a consulta de processo de quem lidera alcança — a mesma regra da ferramenta: o de cada Grupo da estrutura (ou,
 * sem Orquestrador próprio, o de "Todos os grupos"); estrutura sem Grupos = o de "Todos os grupos".
 */
export function reachableProcessOrchestrators(scope: ProcessScope, orchestrators: InteractiveOrchestratorScope[]): InteractiveOrchestratorScope[] {
  return distinctOrchestrators(scope.groups.length > 0 ? scope.groups.map((group) => orchestratorForTeam(orchestrators, group.teamId, group.universes ?? null)) : [orchestratorForTeam(orchestrators, null)])
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
