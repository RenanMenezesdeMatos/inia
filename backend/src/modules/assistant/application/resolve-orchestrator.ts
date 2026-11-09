import type { Database } from "../../../infrastructure/database/pool.js"
import { buildSystemPromptWithTrace } from "../../agents/application/build-system-prompt.js"
import type { KnowledgeTrace } from "../../knowledge/application/retrieve-knowledge.js"
import type { FunctionDeclaration } from "../infrastructure/gemini-function-calling-client.js"
import { toolNameForAgent } from "../domain/orchestrator-schema.js"
import { describeSpecialty, resolveAgentSpecialty, SPECIALTY_KIND_LABELS, type AgentSpecialtyRow } from "../../agents/domain/agent-specialty.js"
import { resolveEffectiveStructuredOutput, type StructuredOutputDefinition } from "../domain/structured-output-definition.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ApplicationInvariantError } from "../../../shared/domain/execution-failure.js"
import { scopesAreCompatible, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { withAgentSnapshots } from "../../agents/application/agent-runtime-context.js"
import { resolveAgentVersionForRun } from "../../agents/application/agent-versions.js"
import { assertExecutionAuthorized, executionDenialFor, recordExecutionDenial } from "../../agents/application/agent-execution-authorization.js"
import type { AgentRuntimeSnapshot } from "../../agents/domain/agent-config.js"


export type ResolvedOrchestrator = {
  /** Organização do Orquestrador (do registro) — a mesma dos especialistas que ele aciona. */
  organizationId: string
  orchestratorId: string
  orchestratorName: string
  orchestratorAgentId: string
  /** Versão do Orquestrador usada (PEN-076): a fixada pelo Workflow ou, no chat/voz, a vigente. Null só em dados de teste. */
  orchestratorVersionId?: string | null
  orchestratorVersionNumber?: number | null
  /** Versão do agente orquestrador usada (PEN-002). */
  orchestratorAgentVersionId?: string | null
  /** Versões dos agentes desta resolução (orquestrador + especialistas) — a execução roda dentro delas (agent-runtime-context.ts). */
  agentSnapshots?: AgentRuntimeSnapshot[]
  /** Alcance do Orquestrador em execução — contra ele a versão vigente de cada especialista é autorizada, também na hora da chamada. */
  consumerScope?: { scopeType: string; teamId: string | null; subteamId: string | null }
  systemPrompt: string
  /** V1.7.1 — tipo de especialidade e domínio de negócio (FK) de cada especialista: base do roteamento declarativo por domínio. */
  specialists: { agentId: string; agentVersionId?: string | null; toolName: string; specialtyKind?: string | null; businessDomainId?: string | null }[]
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
  scope_type: string
  team_id: string | null
  subteam_id: string | null
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
/**
 * Versões em jogo (PEN-076 com a revisão aprovada da PEN-002/PEN-076 de 03/11/2026). A CONFIGURAÇÃO do Orquestrador é versionada:
 * o Workflow usa a versão fixada na etapa (ou a de origem da migração numa versão do Workflow publicada antes do versionamento);
 * chat e voz, a vigente. Os AGENTES — orquestrador e especialistas — rodam sempre na versão vigente deles, resolvida agora e
 * registrada com a resposta. Especialista inativo, nunca publicado ou cuja versão vigente não é autorizada para o alcance do
 * Orquestrador não vira ferramenta (o último fica registrado na auditoria, sem nada para o colaborador).
 */
type OrchestratorVersionPin = {
  versionId: string | null
  legacyPin: boolean
  /** Alcance do Workflow que fixa a versão: a versão fixada só roda se servir a ele (mesma regra da publicação). */
  workflowScope: ScopedTarget
}

type OrchestratorVersionConfig = {
  scopeType?: string
  teamId?: string | null
  subteamId?: string | null
  specialists?: { agentId: string; toolName: string }[]
  outputInstructions?: string | null
  outputSchema?: unknown
  structuredOutput?: unknown
  recommendSupportMaterials?: boolean
}

async function loadOrchestratorVersion(db: Database, orchestratorId: string, pin: OrchestratorVersionPin | null): Promise<{ id: string; number: number; config: OrchestratorVersionConfig } | null> {
  const row = pin?.versionId
    ? (await db.query<{ id: string; number: number; config: OrchestratorVersionConfig }>(`select id, version_number "number", config from assistant_orchestrator_versions where id = $1 and orchestrator_id = $2`, [pin.versionId, orchestratorId])).rows[0]
    : pin?.legacyPin
      ? (await db.query<{ id: string; number: number; config: OrchestratorVersionConfig }>(`select id, version_number "number", config from assistant_orchestrator_versions where orchestrator_id = $1 order by (origin = 'MIGRATION') desc, version_number asc limit 1`, [orchestratorId])).rows[0]
      : (await db.query<{ id: string; number: number; config: OrchestratorVersionConfig }>(`select v.id, v.version_number "number", v.config from assistant_orchestrators o join assistant_orchestrator_versions v on v.id = o.current_version_id where o.id = $1`, [orchestratorId])).rows[0]
  return row ?? null
}

/** Versão vigente de um especialista, ou null quando ele não pode atender (inexistente, nunca publicado, inativo). */
async function specialistSnapshot(db: Database, organizationId: string, agentId: string): Promise<AgentRuntimeSnapshot | null> {
  try {
    const resolved = await resolveAgentVersionForRun(db, organizationId, agentId)
    if (!resolved.active) return null
    return { agentId: resolved.agentId, organizationId: resolved.organizationId, versionId: resolved.versionId, versionNumber: resolved.versionNumber, config: resolved.config }
  } catch (error) {
    if (error instanceof DomainError && (error.code === "AGENT_NOT_PUBLISHED" || error.code === "AGENT_VERSION_NOT_FOUND" || error.code === "AGENT_NOT_FOUND")) return null
    throw error
  }
}

async function buildResolvedOrchestrator(db: Database, orchestrator: OrchestratorRow, query: string | undefined, invocationContext: OrchestratorInvocationContext, pin: OrchestratorVersionPin | null = null): Promise<ResolvedOrchestrator> {
  const version = await loadOrchestratorVersion(db, orchestrator.id, pin)
  const pinned = pin !== null && version !== null
  // A versão fixada leva o alcance e os especialistas DELA para a execução, então precisa servir ao Grupo do Workflow, pela mesma
  // `scopesAreCompatible` da publicação (publish-validation/orchestrators.ts). Versão publicada antes dessa conferência, a de origem
  // da migração e o rascunho do QA Lab chegam aqui sem passar por ela. Falha antes de qualquer especialista, base ou IA, e é
  // terminal: a versão do Workflow é fixa, nada muda entre uma tentativa e outra. Nunca cai na versão atual nem segue sem os
  // especialistas. Versão sem alcance gravado usa o do Orquestrador de hoje, como na publicação.
  if (pinned && version.config.scopeType) {
    const versionScope = { scopeType: version.config.scopeType, teamId: version.config.teamId ?? null, subteamId: version.config.subteamId ?? null }
    if (!(await scopesAreCompatible(db, pin.workflowScope, versionScope))) {
      throw new ApplicationInvariantError(
        `A etapa usa a versão ${version.number} do Orquestrador "${orchestrator.name}", que não está disponível para o grupo deste workflow. Escolha a versão atual do Orquestrador na etapa e publique o workflow de novo.`,
        "WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN",
      )
    }
  }
  const listed: { agentId: string; toolName: string }[] = pinned
    ? (version.config.specialists ?? []).map((entry) => ({ agentId: entry.agentId, toolName: entry.toolName }))
    : (await db.query<{ agentId: string; toolName: string }>(`select agent_id "agentId", tool_name "toolName" from assistant_orchestrator_specialists where orchestrator_id = $1 order by agent_id`, [orchestrator.id])).rows
  // Alcance do Orquestrador em execução (o da versão fixada pelo Workflow, ou o atual): a versão vigente de cada especialista
  // precisa cobri-lo, com as bases autorizadas — a atualização automática nunca amplia acesso.
  const consumerScope = pinned && version.config.scopeType
    ? { scopeType: version.config.scopeType, teamId: version.config.teamId ?? null, subteamId: version.config.subteamId ?? null }
    : { scopeType: orchestrator.scope_type, teamId: orchestrator.team_id, subteamId: orchestrator.subteam_id }
  const resolvedSpecialists = (await Promise.all(listed.map(async (entry) => {
    const snapshot = await specialistSnapshot(db, orchestrator.organization_id, entry.agentId)
    if (!snapshot) return null
    const denial = await executionDenialFor(db, snapshot, consumerScope)
    if (denial) {
      await recordExecutionDenial(db, { organizationId: orchestrator.organization_id, agentId: entry.agentId, agentVersionId: snapshot.versionId, consumerKind: "ORCHESTRATOR", consumerId: orchestrator.id, reason: denial })
      return null
    }
    return { entry, snapshot }
  }))).filter((item): item is { entry: { agentId: string; toolName: string }; snapshot: AgentRuntimeSnapshot } => item !== null)
  // Metadata legível de roteamento (Parte K do catálogo de domínios): o coordenador recebe, por
  // especialista, o TIPO de especialidade e o NOME do domínio de negócio (nunca id/código) —
  // só o necessário para escolher; a tabela do catálogo nunca entra no prompt.
  const domainIds = [...new Set(resolvedSpecialists.map((item) => item.snapshot.config.businessDomainId).filter((id): id is string => Boolean(id)))]
  const domains = new Map(domainIds.length === 0 ? [] : (await db.query<{ id: string; code: string; name: string; active: boolean }>(`select id, code, name, active from business_domains where id = any($1::uuid[])`, [domainIds])).rows.map((row) => [row.id, row]))
  const specialistRows = resolvedSpecialists.map(({ entry, snapshot }) => {
    const domain = snapshot.config.businessDomainId ? domains.get(snapshot.config.businessDomainId) : undefined
    return {
      agent_id: entry.agentId,
      agent_version_id: snapshot.versionId,
      tool_name: entry.toolName,
      name: snapshot.config.name,
      objective: snapshot.config.objective,
      description: snapshot.config.description,
      specialty: snapshot.config.specialty,
      specialty_kind: snapshot.config.specialtyKind,
      domain: snapshot.config.domain,
      capability: snapshot.config.capability,
      consolidated_input: snapshot.config.consolidatedInput,
      business_domain_id: snapshot.config.businessDomainId,
      business_domain_code: domain?.code ?? null,
      business_domain_name: domain?.name ?? null,
      business_domain_active: domain?.active ?? null,
    }
  })

  // Agente orquestrador: a versão vigente. Inativo continua atendendo como hoje — o tratamento do agente orquestrador desativado é
  // a PEN-047, ainda aberta. Versão vigente não autorizada para o alcance do Orquestrador: nada roda (bloqueio com o motivo).
  const orchestratorAgent = await resolveAgentVersionForRun(db, orchestrator.organization_id, orchestrator.orchestrator_agent_id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "AGENT_NOT_PUBLISHED") return null
    throw error
  })
  const orchestratorAgentSnapshot: AgentRuntimeSnapshot | null = orchestratorAgent ? { agentId: orchestratorAgent.agentId, organizationId: orchestratorAgent.organizationId, versionId: orchestratorAgent.versionId, versionNumber: orchestratorAgent.versionNumber, config: orchestratorAgent.config } : null
  if (orchestratorAgentSnapshot) await assertExecutionAuthorized(db, orchestratorAgentSnapshot, consumerScope)
  const agentSnapshots: AgentRuntimeSnapshot[] = [...(orchestratorAgentSnapshot ? [orchestratorAgentSnapshot] : []), ...resolvedSpecialists.map(({ snapshot }) => snapshot)]

  const { systemPrompt, knowledge } = await withAgentSnapshots(agentSnapshots, () =>
    buildSystemPromptWithTrace(
      db,
      orchestrator.orchestrator_agent_id,
      {
        organization_id: orchestrator.organization_id,
        name: orchestrator.name,
        objective: orchestratorAgentSnapshot?.config.objective ?? orchestrator.objective,
        description: orchestratorAgentSnapshot?.config.description ?? orchestrator.description,
        context_prompt: orchestratorAgentSnapshot?.config.contextPrompt ?? orchestrator.context_prompt,
      },
      { query, collaboratorConversation: invocationContext === "INTERACTIVE" },
    ),
  )

  const specialists = specialistRows.map((row) => {
    const specialty = resolveAgentSpecialty(row)
    return { agentId: row.agent_id, agentVersionId: row.agent_version_id, toolName: row.tool_name, specialtyKind: specialty.kind, businessDomainId: specialty.kind === "DOMAIN" ? (row.business_domain_id ?? null) : null }
  })
  const tools: FunctionDeclaration[] = specialistRows.map((row) => ({
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
  // A versão fixada pelo Workflow também fixa o resultado estruturado e a recomendação de materiais dela.
  const output = pinned
    ? { output_instructions: version.config.outputInstructions ?? null, output_schema: version.config.outputSchema ?? null, structured_output: version.config.structuredOutput ?? null }
    : orchestrator
  const structured = resolveEffectiveStructuredOutput(output)
  return {
    organizationId: orchestrator.organization_id,
    orchestratorId: orchestrator.id,
    orchestratorName: orchestrator.name,
    orchestratorAgentId: orchestrator.orchestrator_agent_id,
    orchestratorVersionId: version?.id ?? null,
    orchestratorVersionNumber: version?.number ?? null,
    orchestratorAgentVersionId: orchestratorAgentSnapshot?.versionId ?? null,
    agentSnapshots,
    consumerScope,
    systemPrompt: systemPrompt + routingInstruction,
    specialists,
    tools,
    outputInstructions: structured.llmInstructions,
    structuredOutput: structured.source === "DEFINITION" ? structured.definition : null,
    knowledge,
    recommendSupportMaterials: (pinned ? version.config.recommendSupportMaterials : orchestrator.recommend_support_materials) === true,
  }
}

/**
 * Acha o orquestrador ativo de quem conversa — o do Subgrupo dele; sem isso, o do Grupo; sem
 * isso, o ALL_TEAMS mais recente. Resolve pra exatamente UM orquestrador (não uma lista, como nos
 * workflows) — é ele quem vai atender essa pessoa. Usado pelo caminho interativo (chat/voz), onde
 * não há como escolher qual orquestrador — é sempre "o" orquestrador do escopo dela. O Subgrupo
 * era ignorado: o cadastro aceitava orquestrador de Subgrupo, mas quem era do Subgrupo continuava
 * no do Grupo (validação funcional de 20/10/2026, D6).
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
  const person = await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1 and organization_id = $2`, [
    subjectId,
    organizationId,
  ])
  return resolveOrchestratorForPlacement(db, organizationId, { teamId: person.rows[0]?.team_id ?? null, subteamId: person.rows[0]?.subteam_id ?? null }, invocationContext, query)
}

/**
 * O Orquestrador de um GRUPO: o do próprio Grupo (escopo TEAM) ou, sem ele, o de "Todos os grupos" — a mesma regra da consulta
 * de processo de quem lidera vários Grupos (`listInteractiveOrchestratorScopes` + `orchestratorForTeam`), que escolhe por Grupo.
 */
export async function resolveOrchestratorForTeam(
  db: Database,
  organizationId: string,
  teamId: string | null,
  invocationContext: OrchestratorInvocationContext,
  query?: string,
): Promise<ResolvedOrchestrator | null> {
  return resolveOrchestratorForPlacement(db, organizationId, { teamId, subteamId: null }, invocationContext, query)
}

/** Preferência: Subgrupo > Grupo > Todos os grupos (o mais recente de cada nível). */
async function resolveOrchestratorForPlacement(
  db: Database,
  organizationId: string,
  placement: { teamId: string | null; subteamId: string | null },
  invocationContext: OrchestratorInvocationContext,
  query?: string,
): Promise<ResolvedOrchestrator | null> {
  const orchestratorRow = await db.query<OrchestratorRow>(
    `select o.organization_id, o.id, o.name, o.scope_type, o.team_id, o.subteam_id, o.orchestrator_agent_id, a.objective, a.description, a.context_prompt, o.output_instructions, o.output_schema, o.structured_output, o.recommend_support_materials
     from assistant_orchestrators o
     join agents a on a.id = o.orchestrator_agent_id
     where o.organization_id = $1 and o.active and o.invocation_mode in ('BOTH', $3)
       and (o.scope_type = 'ALL_TEAMS' or (o.scope_type = 'TEAM' and o.team_id = $2) or (o.scope_type = 'SUBTEAM' and o.subteam_id = $4))
     order by case o.scope_type when 'SUBTEAM' then 0 when 'TEAM' then 1 else 2 end, o.created_at desc
     limit 1`,
    [organizationId, placement.teamId, invocationContext, placement.subteamId],
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
  /** Workflow (PEN-076): a versão fixada na etapa; `legacyPin` = etapa publicada antes do versionamento; `workflowScope` = alcance
   * do Workflow, contra o qual a versão fixada é conferida. Ausente = vigente (chat e voz). */
  pin?: OrchestratorVersionPin,
): Promise<ResolvedOrchestrator | null> {
  const orchestratorRow = await db.query<OrchestratorRow>(
    `select o.organization_id, o.id, o.name, o.scope_type, o.team_id, o.subteam_id, o.orchestrator_agent_id, a.objective, a.description, a.context_prompt, o.output_instructions, o.output_schema, o.structured_output, o.recommend_support_materials
     from assistant_orchestrators o
     join agents a on a.id = o.orchestrator_agent_id
     where o.id = $1 and o.organization_id = $2 and o.active and o.invocation_mode in ('BOTH', $3)`,
    [orchestratorId, organizationId, invocationContext],
  )
  const orchestrator = orchestratorRow.rows[0]
  if (!orchestrator) return null
  return buildResolvedOrchestrator(db, orchestrator, query, invocationContext, pin ?? null)
}

export function findSpecialistByToolName(orchestrator: ResolvedOrchestrator, toolName: string): string | null {
  return orchestrator.specialists.find((specialist) => specialist.toolName === toolName)?.agentId ?? null
}

export { toolNameForAgent }
