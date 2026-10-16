import type { Database } from "../../../infrastructure/database/pool.js"
import { buildSystemPromptWithTrace } from "../../agents/application/build-system-prompt.js"
import type { KnowledgeTrace } from "../../knowledge/application/retrieve-knowledge.js"
import type { FunctionDeclaration } from "../infrastructure/gemini-function-calling-client.js"
import { toolNameForAgent } from "../domain/orchestrator-schema.js"
import { describeSpecialty, resolveAgentSpecialty, SPECIALTY_KIND_LABELS, type AgentSpecialtyRow } from "../../agents/domain/agent-specialty.js"
import { agentBusinessDomainColumns, agentBusinessDomainJoin } from "../../business-domains/application/business-domain-lookup.js"
import { resolveEffectiveStructuredOutput, type StructuredOutputDefinition } from "../domain/structured-output-definition.js"


export type ResolvedOrchestrator = {
  /** Organização do Orquestrador (do registro) — a mesma dos especialistas que ele aciona. */
  organizationId: string
  orchestratorId: string
  orchestratorName: string
  orchestratorAgentId: string
  systemPrompt: string
  /** V1.7.1 — tipo de especialidade e domínio de negócio (FK) de cada especialista: base do roteamento declarativo por domínio. */
  specialists: { agentId: string; toolName: string; specialtyKind?: string | null; businessDomainId?: string | null }[]
  tools: FunctionDeclaration[]
  // Instrução de como formatar um resultado estruturado ao final da resposta — null = orquestrador
  // não configurado pra isso, resposta continua 100% texto livre. Com `structuredOutput` (definição
  // nova) este texto é o contrato GERADO da definição; sem ela, é o texto legado escrito à mão
  // (dual-read, ver structured-output-definition.ts). Ver run-orchestrated-reply.ts.
  outputInstructions: string | null
  /** Definição única do resultado estruturado — presente só quando persistida (fonte da
   * verdade nova): o JSON devolvido pelo modelo é validado contra ela. Null no legado (texto
   * livre sem validação, comportamento preservado até a revisão) e sem resultado estruturado. */
  structuredOutput: StructuredOutputDefinition | null
  /** Rastro de KB do próprio agente orquestrador (normalmente sem bases — quem consulta KB são
   * os especialistas) — anexado à telemetria das fases de roteamento/síntese. */
  knowledge?: KnowledgeTrace
  /** "Nas respostas finais, o Orquestrador pode selecionar e recomendar materiais encontrados
   * pelos especialistas?" (`assistant_orchestrators.recommend_support_materials`, padrão false).
   * Não muda roteamento, escolha de especialistas nem síntese — acontece ao lado da agregação
   * de conhecimento (ver run-orchestrated-reply.ts). */
  recommendSupportMaterials: boolean
}

export type OrchestratorInvocationContext = "INTERACTIVE" | "WORKFLOW"

type OrchestratorRow = {
  organization_id: string
  id: string
  name: string
  orchestrator_agent_id: string
  objective: string
  description: string
  context_prompt: string
  output_instructions: string | null
  output_schema: unknown
  structured_output: unknown
  recommend_support_materials: boolean
}

/** Prefixo legível da tool: "Tipo: Especialista de domínio. Domínio: Cadastro e Titularidade. " —
 * vazio para agente sem especialidade (legado), para não inventar classificação. */
export function describeSpecialistForRouting(row: AgentSpecialtyRow): string {
  const specialty = resolveAgentSpecialty(row)
  if (!specialty.kind) return ""
  const subject = specialty.kind === "DOMAIN" ? `Domínio: ${describeSpecialty(specialty)}. ` : specialty.kind === "CROSS_CUTTING" && specialty.capability ? `Competência: ${specialty.capability}. ` : ""
  return `Tipo: ${SPECIALTY_KIND_LABELS[specialty.kind]}. ${subject}`
}

/** Monta o `ResolvedOrchestrator` (prompt completo, tools dos especialistas) a partir de uma
 * linha de `assistant_orchestrators` já carregada — compartilhado pelos dois pontos de entrada
 * (`resolveOrchestratorForSubject` e `resolveOrchestratorById`), nenhuma lógica duplicada entre
 * eles além do próprio WHERE de cada um. */
async function buildResolvedOrchestrator(db: Database, orchestrator: OrchestratorRow, query: string | undefined, invocationContext: OrchestratorInvocationContext): Promise<ResolvedOrchestrator> {
  // Metadata legível de roteamento (Parte K do catálogo de domínios): o coordenador recebe, por
  // especialista, o TIPO de especialidade e o NOME do domínio de negócio (nunca id/código) —
  // só o necessário para escolher; a tabela do catálogo nunca entra no prompt.
  const specialistRows = await db.query<{ agent_id: string; tool_name: string; name: string; objective: string; description: string } & AgentSpecialtyRow>(
    `select s.agent_id, s.tool_name, a.name, a.objective, a.description,
            a.specialty, a.specialty_kind, a.domain, a.capability, a.consolidated_input, ${agentBusinessDomainColumns("bd")}
     from assistant_orchestrator_specialists s
     join agents a on a.id = s.agent_id
     ${agentBusinessDomainJoin("a", "bd")}
     where s.orchestrator_id = $1 and a.active`,
    [orchestrator.id],
  )

  const { systemPrompt, knowledge } = await buildSystemPromptWithTrace(
    db,
    orchestrator.orchestrator_agent_id,
    { organization_id: orchestrator.organization_id, name: orchestrator.name, objective: orchestrator.objective, description: orchestrator.description, context_prompt: orchestrator.context_prompt },
    { query, collaboratorConversation: invocationContext === "INTERACTIVE" },
  )

  const specialists = specialistRows.rows.map((row) => {
    const specialty = resolveAgentSpecialty(row)
    return { agentId: row.agent_id, toolName: row.tool_name, specialtyKind: specialty.kind, businessDomainId: specialty.kind === "DOMAIN" ? (row.business_domain_id ?? null) : null }
  })
  const tools: FunctionDeclaration[] = specialistRows.rows.map((row) => ({
    name: row.tool_name,
    description: `${describeSpecialistForRouting(row)}${row.objective} ${row.description}`.trim(),
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A pergunta ou pedido do colaborador, no idioma dele, com o contexto necessário pra esse especialista responder." },
        // Opcional de propósito — o padrão (7 dias) já cobre a maioria das perguntas ("como
        // estou indo?"); só precisa ser preenchido quando o colaborador pedir um período
        // explícito mais longo, pra não forçar o modelo a sempre decidir um número.
        periodDays: {
          type: "integer",
          description:
            "Quantos dias atrás olhar pros indicadores, só quando o colaborador pedir um período específico (ex.: \"último mês\" ~30, \"últimos 3 meses\" ~90, \"últimos 6 meses\" ~180). Omita este campo para usar o padrão de 7 dias. Máximo aceito: 180.",
        },
      },
      required: ["query"],
    },
  }))

  // Sem isso, o modelo (sobretudo no caminho de voz, onde não há reforço nenhum vindo do nosso
  // backend — é o Gemini Live decidindo sozinho com só a lista de tools e o prompt) tende a
  // responder "não tenho acesso a isso aqui" em vez de acionar o especialista certo, mesmo
  // tendo a tool disponível — confirmado ao vivo em 2026-09-11 (pedido de tabela de indicadores
  // respondido sem nenhuma tool acionada). O prompt do agente sozinho não deixa claro que ele
  // TEM esse acesso via function calling.
  const routingInstruction =
    tools.length > 0
      ? `\n\nVocê tem acesso a especialistas através de tools — cada um listado acima como uma função que você pode chamar. Sempre que o pedido do colaborador for algo que um desses especialistas resolve (indicadores, feedbacks, processos, RH, etc.), você DEVE acionar a tool correspondente antes de responder — nunca diga que não tem acesso aos dados ou que não consegue trazer uma informação sem antes tentar a tool relevante. Se mais de um especialista for relevante, acione todos os necessários e sintetize as respostas numa única mensagem coerente.`
      : ""

  // Dual-read do resultado estruturado: definição nova (contrato gerado + validação) ou legado
  // (texto livre intacto, sem validação) — nunca duas implementações do marcador.
  const structured = resolveEffectiveStructuredOutput(orchestrator)
  return {
    organizationId: orchestrator.organization_id,
    orchestratorId: orchestrator.id,
    orchestratorName: orchestrator.name,
    orchestratorAgentId: orchestrator.orchestrator_agent_id,
    systemPrompt: systemPrompt + routingInstruction,
    specialists,
    tools,
    outputInstructions: structured.llmInstructions,
    structuredOutput: structured.source === "DEFINITION" ? structured.definition : null,
    knowledge,
    recommendSupportMaterials: orchestrator.recommend_support_materials === true,
  }
}

/**
 * Acha o orquestrador ativo pro time do operador — prefere um orquestrador específico do time
 * dele; sem isso, cai pro orquestrador ALL_TEAMS mais recente. Mesma lógica de "TEAM antes de
 * ALL_TEAMS" que faz sentido pro resto do produto, só que aqui resolve pra exatamente UM
 * orquestrador (não uma lista, como nos workflows) — é ele quem vai atender esse operador.
 * Usado pelo caminho interativo (chat/voz), onde não há como o operador escolher qual
 * orquestrador quer — é sempre "o" orquestrador do escopo dele.
 *
 * `invocationContext` filtra por `invocation_mode` — um orquestrador pode ser restrito a só o
 * chat/voz interativo ou só o node de workflow; "BOTH" (padrão de todo orquestrador já
 * cadastrado) sempre bate nos dois.
 */
export async function resolveOrchestratorForSubject(
  db: Database,
  organizationId: string,
  subjectId: string,
  invocationContext: OrchestratorInvocationContext,
  query?: string,
): Promise<ResolvedOrchestrator | null> {
  const person = await db.query<{ team_id: string | null }>(`select team_id from people where id = $1 and organization_id = $2`, [
    subjectId,
    organizationId,
  ])
  return resolveOrchestratorForTeam(db, organizationId, person.rows[0]?.team_id ?? null, invocationContext, query)
}

/**
 * O Orquestrador de um GRUPO: o do próprio Grupo (escopo TEAM) ou, sem ele, o de "Todos os grupos" — a mesma regra de quem
 * conversa (acima) e da consulta de processo de quem lidera vários Grupos (`listInteractiveOrchestratorScopes` + `orchestratorForTeam`).
 */
export async function resolveOrchestratorForTeam(
  db: Database,
  organizationId: string,
  teamId: string | null,
  invocationContext: OrchestratorInvocationContext,
  query?: string,
): Promise<ResolvedOrchestrator | null> {
  const orchestratorRow = await db.query<OrchestratorRow>(
    `select o.organization_id, o.id, o.name, o.orchestrator_agent_id, a.objective, a.description, a.context_prompt, o.output_instructions, o.output_schema, o.structured_output, o.recommend_support_materials
     from assistant_orchestrators o
     join agents a on a.id = o.orchestrator_agent_id
     where o.organization_id = $1 and o.active and o.invocation_mode in ('BOTH', $3)
       and (o.scope_type = 'ALL_TEAMS' or (o.scope_type = 'TEAM' and o.team_id = $2))
     order by (o.scope_type = 'TEAM') desc, o.created_at desc
     limit 1`,
    [organizationId, teamId, invocationContext],
  )
  const orchestrator = orchestratorRow.rows[0]
  if (!orchestrator) return null
  return buildResolvedOrchestrator(db, orchestrator, query, invocationContext)
}

/** Orquestradores do chat/voz ativos da organização com o escopo de cada um — na ORDEM de preferência de `resolveOrchestratorForTeam`. */
export type InteractiveOrchestratorScope = { id: string; name: string; scopeType: "ALL_TEAMS" | "TEAM"; teamId: string | null }

export async function listInteractiveOrchestratorScopes(db: Database, organizationId: string): Promise<InteractiveOrchestratorScope[]> {
  const result = await db.query<{ id: string; name: string; scope_type: "ALL_TEAMS" | "TEAM"; team_id: string | null }>(
    `select o.id, o.name, o.scope_type, o.team_id
       from assistant_orchestrators o
      where o.organization_id = $1 and o.active and o.invocation_mode in ('BOTH', 'INTERACTIVE') and o.scope_type in ('ALL_TEAMS', 'TEAM')
      order by (o.scope_type = 'TEAM') desc, o.created_at desc`,
    [organizationId],
  )
  return result.rows.map((row) => ({ id: row.id, name: row.name, scopeType: row.scope_type, teamId: row.team_id }))
}

/** Puro: o Orquestrador que `resolveOrchestratorForTeam` escolheria para o Grupo (lista já na ordem de preferência). */
export function orchestratorForTeam(scopes: readonly InteractiveOrchestratorScope[], teamId: string | null): InteractiveOrchestratorScope | null {
  return scopes.find((scope) => scope.scopeType === "TEAM" && teamId !== null && scope.teamId === teamId) ?? scopes.find((scope) => scope.scopeType === "ALL_TEAMS") ?? null
}

/**
 * Resolve um orquestrador específico, por id — usado pelo node Orchestrator do Workflow, que
 * referencia explicitamente qual orquestrador publicado quer executar (não há "o" orquestrador
 * do escopo aqui: pode haver vários — Monitoria Geral, Retenção, Qualidade... — e o Workflow
 * escolhe qual usar em cada ponto do grafo). Ainda respeita `active`/`invocation_mode`: um
 * orquestrador desativado ou restrito a `INTERACTIVE` não roda por um Workflow mesmo que o
 * node aponte pra ele.
 */
export async function resolveOrchestratorById(
  db: Database,
  organizationId: string,
  orchestratorId: string,
  invocationContext: OrchestratorInvocationContext,
  query?: string,
): Promise<ResolvedOrchestrator | null> {
  const orchestratorRow = await db.query<OrchestratorRow>(
    `select o.organization_id, o.id, o.name, o.orchestrator_agent_id, a.objective, a.description, a.context_prompt, o.output_instructions, o.output_schema, o.structured_output, o.recommend_support_materials
     from assistant_orchestrators o
     join agents a on a.id = o.orchestrator_agent_id
     where o.id = $1 and o.organization_id = $2 and o.active and o.invocation_mode in ('BOTH', $3)`,
    [orchestratorId, organizationId, invocationContext],
  )
  const orchestrator = orchestratorRow.rows[0]
  if (!orchestrator) return null
  return buildResolvedOrchestrator(db, orchestrator, query, invocationContext)
}

export function findSpecialistByToolName(orchestrator: ResolvedOrchestrator, toolName: string): string | null {
  return orchestrator.specialists.find((specialist) => specialist.toolName === toolName)?.agentId ?? null
}

export { toolNameForAgent }
