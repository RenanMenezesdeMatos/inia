import type { Permission } from "../../access/domain/permissions.js"

/**
 * ITENS EXCLUÍDOS. Excluir é lógico em todo objeto (migrations 175 e 177): o objeto sai das telas e da lógica, e esta lista é o único lugar onde ele continua visível e de onde volta.
 * Duas regras valem para todos os tipos:
 *  - quem vê e restaura é quem pode gerenciar aquele tipo de objeto na organização inteira: ter a consulta não dá poder sobre Workflow, IA ou governança;
 *  - restaurar nunca liga nada: o objeto volta desligado, pausado ou encerrado, e quem restaura o liga na tela dele, onde as validações de sempre acontecem.
 * `from`, `sql` e `restoreSet` são trechos fixos do código; valores do cliente só vão como parâmetro. Em toda consulta, `$1` é o id do item.
 */
export const DELETED_ITEM_TYPES = [
  "WORKFLOW",
  "WORKFLOW_VARIABLE",
  "AGENT",
  "ORCHESTRATOR",
  "KNOWLEDGE_DOCUMENT",
  "ARGUMENT_SCRIPT",
  "BUSINESS_DOMAIN",
  "CHANNEL_FLAG",
  "INDICATOR",
  "INDICATOR_RULE",
  "PRODUCT_NODE",
  "PRODUCT_CRITERION",
  "PROHIBITED_TOPIC",
  "GLOSSARY_TERM",
  "HOLIDAY",
  "INIA_SCENE",
  "AI_CONNECTION",
  "AI_MODEL",
  "AI_BUDGET",
  "DATA_SOURCE",
  "DATA_FEED",
  "REPORT",
] as const
export type DeletedItemType = (typeof DELETED_ITEM_TYPES)[number]

/** Consulta que devolve o que impede a restauração, em `label`. Sem linha, sem problema. */
export type DeletedItemCheck = {
  code: string
  sql: string
  message: (labels: readonly string[]) => string
}

export type DeletedItemDefinition = {
  type: DeletedItemType
  label: string
  /** Quem vê e restaura. Report é da pessoa que o criou: não existe permissão de gerir Report de outra pessoa. */
  access: { permissions: readonly Permission[] } | { ownerOnly: true }
  /** Tabela real, sem a visão que esconde os excluídos. É ela que a restauração altera. */
  table: string
  /** `<tabela real> t` e junções fixas. */
  from: string
  organizationSql: string
  nameSql: string
  /** Pessoa que excluiu. Report guarda a conta. */
  deletedByPersonSql: string
  deletedByColumn: "deleted_by_person_id" | "deleted_by_account_id"
  /** Itens que saíram junto com outro, no mesmo instante, aparecem só pelo principal. */
  listWhere?: string
  /** O que muda além de limpar a exclusão. */
  restoreSet: string
  /** Rodam antes de limpar a exclusão do item, porque comparam com o instante em que ele foi excluído. */
  restoreChildrenSql?: readonly string[]
  /**
   * Trava o objeto de que este depende antes de conferir. Sem apagar, a chave estrangeira não barra mais: sem a trava, o pai poderia ser excluído entre a conferência e a restauração.
   * Quem exclui o pai trava a própria linha antes de olhar o que depende dela.
   */
  lockParentsSql?: readonly string[]
  checks: readonly DeletedItemCheck[]
  notices: readonly string[]
}

const NAME_IN_USE = "DELETED_ITEM_NAME_IN_USE"
const PARENT_DELETED = "DELETED_ITEM_PARENT_DELETED"

/** Outro registro ativo já usa o nome ou código: a visão só mostra os não excluídos, então a conferência é exata. */
const inUse = (table: string, view: string, on: string, label: string, noun: string): DeletedItemCheck => ({
  code: NAME_IN_USE,
  sql: `select ${label} as label from ${table} r join ${view} o on ${on} where r.id = $1 limit 1`,
  message: ([value]) => `Já existe ${noun} "${value}". Renomeie ou exclua o atual antes de restaurar.`,
})

const parentDeleted = (sql: string, one: string, many: string): DeletedItemCheck => ({
  code: PARENT_DELETED,
  sql,
  message: (labels) => (labels.length === 1 ? `Restaure primeiro ${one} "${labels[0]}", que está entre os itens excluídos.` : `Restaure primeiro ${many} ${labels.map((label) => `"${label}"`).join(", ")}, que estão entre os itens excluídos.`),
})

const domainDeleted = (table: string) => parentDeleted(`select d.name as label from ${table} r join business_domains_all d on d.id = r.business_domain_id where r.id = $1 and d.deleted_at is not null`, "o domínio de negócio", "os domínios de negócio")

const owned = (table: string, overrides: Pick<DeletedItemDefinition, "type" | "label" | "access" | "nameSql" | "restoreSet" | "checks" | "notices"> & Partial<DeletedItemDefinition>): DeletedItemDefinition => ({
  table,
  from: `${table} t`,
  organizationSql: "t.organization_id",
  deletedByPersonSql: "t.deleted_by_person_id",
  deletedByColumn: "deleted_by_person_id",
  ...overrides,
})

const AUTHORITATIVE_TAKEN = "DELETED_ITEM_AUTHORITATIVE_IN_USE"

/** Rascunho e versão vigente do Workflow, os grafos que voltariam a valer. */
const WORKFLOW_GRAPHS = `with graphs as (
  select r.draft_graph graph from workflows_all r where r.id = $1
  union all
  select v.graph from workflows_all r join workflow_versions v on v.id = r.active_version_id where r.id = $1
)`
const workflowNodeCites = (table: string, key: string) =>
  `${WORKFLOW_GRAPHS} select distinct d.name as label from graphs g cross join lateral jsonb_array_elements(coalesce(g.graph->'nodes', '[]'::jsonb)) n join ${table} d on d.id::text = n->'config'->>'${key}' and d.deleted_at is not null`

const lockDomainOf = (table: string) => `select 1 from ${table} r join business_domains_all d on d.id = r.business_domain_id where r.id = $1 for share of d`

export const DELETED_ITEMS: readonly DeletedItemDefinition[] = [
  owned("workflows_all", {
    type: "WORKFLOW",
    label: "Workflow",
    access: { permissions: ["workflows.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    // Workflow excluído deixa de segurar o que usa. Voltar apontando para um Agent excluído faria cada execução falhar depois de ativar.
    checks: [
      parentDeleted(workflowNodeCites("agents_all", "agentId"), "o Agent", "os Agents"),
      parentDeleted(workflowNodeCites("assistant_orchestrators_all", "orchestratorId"), "o Orquestrador", "os Orquestradores"),
      parentDeleted(
        `select distinct i.name as label from workflows_all r join indicator_definitions_all i on i.organization_id = r.organization_id and i.deleted_at is not null
           left join workflow_versions v on v.id = r.active_version_id
          where r.id = $1
            and not exists (select 1 from indicator_definitions o where o.organization_id = i.organization_id and o.code = i.code)
            and exists (select 1 from jsonb_array_elements(jsonb_build_array(r.draft_graph, r.trigger_config, r.draft_trigger_config, v.graph)) doc where jsonb_path_exists(doc, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', i.code)))`,
        "o indicador", "os indicadores",
      ),
      parentDeleted(`select distinct f.flag_name as label from workflows_all r join channel_flags_all f on f.id::text in (r.trigger_config->>'channelFlagId', r.draft_trigger_config->>'channelFlagId') and f.deleted_at is not null where r.id = $1`, "a flag", "as flags"),
    ],
    notices: ["Volta pausado, com rascunho e versões como estavam. Para rodar de novo, ative na tela de Workflows.", "As execuções interrompidas pela exclusão continuam bloqueadas. Depois de ativar, dá para pedir nova tentativa em cada uma."],
  }),
  owned("workflow_variables_all", {
    type: "WORKFLOW_VARIABLE",
    label: "Variável de Workflow",
    access: { permissions: ["workflows.manage"] },
    from: "workflow_variables_all t join workflows_all parent on parent.id = t.workflow_id",
    organizationSql: "parent.organization_id",
    nameSql: "t.name || ' (' || parent.name || ')'",
    restoreSet: "",
    checks: [parentDeleted(`select w.name as label from workflow_variables_all r join workflows_all w on w.id = r.workflow_id where r.id = $1 and w.deleted_at is not null`, "o Workflow", "os Workflows")],
    lockParentsSql: [`select 1 from workflow_variables_all r join workflows_all w on w.id = r.workflow_id where r.id = $1 for share of w`],
    notices: ["Volta para a lista de variáveis do Workflow."],
  }),
  owned("agents_all", {
    type: "AGENT",
    label: "Agent",
    // Volta inativo, e a rota de Agent só deixa ver e mexer em inativo com as duas.
    access: { permissions: ["agents.manage", "agents.inactive.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    checks: [inUse("agents_all", "agents", "o.organization_id = r.organization_id and o.name = r.name", "o.name", "um Agent com o nome"), domainDeleted("agents_all")],
    lockParentsSql: [lockDomainOf("agents_all")],
    notices: ["Volta desativado, com versões, bases e histórico como estavam. Para usar de novo, ative na tela de Agents."],
  }),
  owned("assistant_orchestrators_all", {
    type: "ORCHESTRATOR",
    label: "Orquestrador",
    access: { permissions: ["agents.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    checks: [
      parentDeleted(
        `select a.name as label from assistant_orchestrators_all r join agents_all a on a.id = r.orchestrator_agent_id where r.id = $1 and a.deleted_at is not null
         union select a.name from assistant_orchestrator_specialists s join agents_all a on a.id = s.agent_id where s.orchestrator_id = $1 and a.deleted_at is not null`,
        "o Agent", "os Agents",
      ),
      parentDeleted(`select d.name as label from assistant_orchestrator_domains od join business_domains_all d on d.id = od.business_domain_id where od.orchestrator_id = $1 and d.deleted_at is not null`, "o domínio de negócio", "os domínios de negócio"),
    ],
    lockParentsSql: [
      `select 1 from assistant_orchestrators_all r join agents_all a on a.id = r.orchestrator_agent_id where r.id = $1 for share of a`,
      `select 1 from assistant_orchestrator_specialists s join agents_all a on a.id = s.agent_id where s.orchestrator_id = $1 for share of a`,
      `select 1 from assistant_orchestrator_domains od join business_domains_all d on d.id = od.business_domain_id where od.orchestrator_id = $1 for share of d`,
    ],
    notices: ["Volta desativado. Para atender de novo, ative na tela de Orquestradores."],
  }),
  owned("knowledge_documents", {
    type: "KNOWLEDGE_DOCUMENT",
    label: "Base de conhecimento",
    access: { permissions: ["knowledge.manage"] },
    nameSql: "t.title",
    restoreSet: "updated_at = now()",
    checks: [],
    notices: ["Volta arquivada: a IA não consulta até alguém publicar de novo na tela de Bases de conhecimento."],
  }),
  owned("argument_scripts_all", {
    type: "ARGUMENT_SCRIPT",
    label: "Argumentário",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    checks: [domainDeleted("argument_scripts_all")],
    lockParentsSql: [lockDomainOf("argument_scripts_all")],
    notices: ["Volta encerrado. Para valer de novo, reative na tela de Argumentários."],
  }),
  owned("business_domains_all", {
    type: "BUSINESS_DOMAIN",
    label: "Domínio de negócio",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    checks: [inUse("business_domains_all", "business_domains", "o.organization_id = r.organization_id and o.code = r.code", "o.code", "um domínio com o código")],
    notices: ["Volta desativado. Para usar em novas configurações, ative na tela de Domínios de negócio."],
  }),
  owned("channel_flags_all", {
    type: "CHANNEL_FLAG",
    label: "Flag de canal",
    access: { permissions: ["configuration.manage"] },
    nameSql: "coalesce(nullif(btrim(t.label), ''), t.flag_name)",
    restoreSet: "",
    checks: [inUse("channel_flags_all", "channel_flags", "o.organization_id = r.organization_id and o.channel = r.channel and o.flag_name = r.flag_name", "o.flag_name", "uma flag com o nome")],
    notices: ["Volta desativada. Enquanto isso, a carga recusa interações com esta flag."],
  }),
  owned("indicator_definitions_all", {
    type: "INDICATOR",
    label: "Indicador",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.name",
    restoreSet: "",
    checks: [inUse("indicator_definitions_all", "indicator_definitions", "o.organization_id = r.organization_id and o.code = r.code", "o.code", "um indicador com o código")],
    notices: ["Volta desativado, com medições, metas, fechamentos, regras e glossário como estavam. Para usar de novo, ative na tela de Indicadores.", "A flag que apontava para ele não volta a apontar sozinha."],
  }),
  owned("indicator_calculation_rules", {
    type: "INDICATOR_RULE",
    label: "Regra de cálculo",
    access: { permissions: ["configuration.manage"] },
    from: "indicator_calculation_rules t join indicator_definitions_all parent on parent.id = t.indicator_definition_id",
    nameSql: "parent.name",
    restoreSet: "active = false, updated_at = now()",
    checks: [parentDeleted(`select i.name as label from indicator_calculation_rules r join indicator_definitions_all i on i.id = r.indicator_definition_id where r.id = $1 and i.deleted_at is not null`, "o indicador", "os indicadores")],
    lockParentsSql: [`select 1 from indicator_calculation_rules r join indicator_definitions_all i on i.id = r.indicator_definition_id where r.id = $1 for share of i`],
    notices: ["Volta desativada. Para valer de novo, ative na tela de Indicadores."],
  }),
  owned("product_catalog_nodes_all", {
    type: "PRODUCT_NODE",
    label: "Produto ou categoria",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    checks: [
      inUse("product_catalog_nodes_all", "product_catalog_nodes", "o.organization_id = r.organization_id and o.code = r.code", "o.code", "um produto com o código"),
      parentDeleted(`select p.name as label from product_catalog_nodes_all r join product_catalog_nodes_all p on p.id = r.parent_id where r.id = $1 and p.deleted_at is not null`, "a categoria", "as categorias"),
    ],
    lockParentsSql: [`select 1 from product_catalog_nodes_all r join product_catalog_nodes_all p on p.id = r.parent_id where r.id = $1 for share of p`],
    notices: ["Volta desativado. Para usar de novo, ative na tela de Produtos."],
  }),
  owned("product_identification_criteria_all", {
    type: "PRODUCT_CRITERION",
    label: "Indício de produto",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.title",
    restoreSet: "updated_at = now()",
    checks: [parentDeleted(`select distinct n.name as label from product_identification_criterion_versions v join product_catalog_nodes_all n on n.id = any(v.target_node_ids) and n.deleted_at is not null where v.criterion_id = $1`, "o produto", "os produtos")],
    notices: ["Volta encerrado. Para valer de novo, reative na tela de Produtos."],
  }),
  owned("prohibited_topics_all", {
    type: "PROHIBITED_TOPIC",
    label: "Assunto proibido",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    checks: [inUse("prohibited_topics_all", "prohibited_topics", "o.organization_id = r.organization_id and o.name = r.name", "o.name", "um assunto proibido com o nome")],
    notices: ["Volta desligado: a IA só volta a respeitá-lo depois que alguém ativar na tela de Governança."],
  }),
  owned("glossary_terms_all", {
    type: "GLOSSARY_TERM",
    label: "Termo do glossário",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.term",
    restoreSet: "updated_at = now()",
    checks: [inUse("glossary_terms_all", "glossary_terms", "o.organization_id = r.organization_id and o.term = r.term", "o.term", "um termo com o nome")],
    notices: ["Volta desligado. Para valer de novo, ative na tela de Governança."],
  }),
  owned("organization_holidays_all", {
    type: "HOLIDAY",
    label: "Feriado",
    access: { permissions: ["configuration.manage"] },
    nameSql: "t.name || ' (' || to_char(t.holiday_date, 'DD/MM/YYYY') || ')'",
    restoreSet: "updated_at = now()",
    checks: [inUse("organization_holidays_all", "organization_holidays", "o.organization_id = r.organization_id and o.holiday_date = r.holiday_date and o.name = r.name", "o.name", "um feriado nesta data com o nome")],
    notices: ["Volta desligado e não muda o calendário até alguém ativar na tela de Calendário operacional."],
  }),
  owned("inia_scenes_all", {
    type: "INIA_SCENE",
    label: "Cenário da INIA",
    access: { permissions: ["inia_experience.manage"] },
    nameSql: "t.name",
    // Sem período, o cenário não entra sozinho na tela de ninguém. O período antigo poderia até coincidir com o de outro cenário.
    restoreSet: "schedule_start = null, schedule_end = null, updated_at = now()",
    checks: [inUse("inia_scenes_all", "inia_scenes", "o.organization_id = r.organization_id and lower(btrim(o.name)) = lower(btrim(r.name))", "o.name", "um cenário com o nome")],
    notices: ["Volta sem período agendado e sem ser o padrão. Para aparecer, configure na tela de Cenários."],
  }),
  owned("ai_connections_all", {
    type: "AI_CONNECTION",
    label: "Conexão de IA",
    access: { permissions: ["ai.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    restoreChildrenSql: [
      `update ai_models_all m set deleted_at = null, deleted_by_person_id = null, updated_at = now() from ai_connections_all c where c.id = $1 and m.connection_id = c.id and m.deleted_at = c.deleted_at`,
      `update ai_connection_secrets set revoked_at = now() where connection_id = $1 and revoked_at is null`,
    ],
    checks: [inUse("ai_connections_all", "ai_connections", "o.organization_id = r.organization_id and lower(o.name) = lower(r.name)", "o.name", "uma conexão com o nome")],
    notices: ["Volta desabilitada, com os modelos que saíram junto também desabilitados.", "A credencial foi revogada na exclusão e não volta: informe de novo na tela de Conexões."],
  }),
  owned("ai_models_all", {
    type: "AI_MODEL",
    label: "Modelo de IA",
    access: { permissions: ["ai.manage"] },
    nameSql: "t.display_name",
    listWhere: "not exists (select 1 from ai_connections_all c where c.id = t.connection_id and c.deleted_at = t.deleted_at)",
    restoreSet: "updated_at = now()",
    lockParentsSql: [`select 1 from ai_models_all r join ai_connections_all c on c.id = r.connection_id where r.id = $1 for share of c`],
    checks: [
      parentDeleted(`select c.name as label from ai_models_all r join ai_connections_all c on c.id = r.connection_id where r.id = $1 and c.deleted_at is not null`, "a conexão", "as conexões"),
      inUse("ai_models_all", "ai_models", "o.connection_id = r.connection_id and o.provider_model_id = r.provider_model_id", "o.display_name", "um modelo igual nesta conexão:"),
    ],
    notices: ["Volta desabilitado. Para usar de novo, habilite na tela de Modelos."],
  }),
  owned("ai_budgets_all", {
    type: "AI_BUDGET",
    label: "Orçamento de IA",
    access: { permissions: ["ai.manage"] },
    nameSql: "t.scope || coalesce(' · ' || t.scope_key, '') || ' · ' || t.currency",
    restoreSet: "updated_at = now()",
    checks: [inUse("ai_budgets_all", "ai_budgets", "o.organization_id = r.organization_id and o.scope = r.scope and coalesce(o.scope_key, '') = coalesce(r.scope_key, '') and o.currency = r.currency", "o.scope || ' · ' || o.currency", "um orçamento para")],
    notices: ["Volta desligado, sem limitar nenhum gasto até alguém ligar na tela de Orçamentos."],
  }),
  owned("data_sources", {
    type: "DATA_SOURCE",
    label: "Fonte de dados",
    access: { permissions: ["data_hub.manage"] },
    nameSql: "t.name",
    restoreSet: "updated_at = now()",
    // Fonte excluída antes de 15/10/2026 ainda tem credencial viva: restaurar nunca a devolve, qualquer que seja a idade da exclusão.
    restoreChildrenSql: [
      `update data_feeds f set deleted_at = null, deleted_by_person_id = null, updated_at = now() from data_sources s where s.id = $1 and f.source_id = s.id and f.deleted_at = s.deleted_at`,
      `update data_secrets set revoked_at = now() where source_id = $1 and revoked_at is null`,
      `update data_push_tokens set revoked_at = now() where source_id = $1 and revoked_at is null`,
    ],
    checks: [
      {
        code: AUTHORITATIVE_TAKEN,
        sql: `select f.name as label from data_sources s join data_feeds f on f.source_id = s.id and f.deleted_at = s.deleted_at
               where s.id = $1 and f.authoritative and exists (select 1 from data_feeds o where o.organization_id = f.organization_id and o.contract_key = f.contract_key and o.authoritative and o.deleted_at is null)`,
        message: (labels) => `O conjunto "${labels[0]}" é a fonte oficial de um dado que já tem outra fonte oficial. Tire essa marca do atual antes de restaurar.`,
      },
    ],
    notices: ["Volta pausada, com os conjuntos que saíram junto também pausados.", "Credenciais e tokens foram revogados na exclusão e não voltam: cadastre de novo antes de retomar."],
  }),
  owned("data_feeds", {
    type: "DATA_FEED",
    label: "Conjunto de dados",
    access: { permissions: ["data_hub.manage"] },
    nameSql: "t.name",
    listWhere: "not exists (select 1 from data_sources s where s.id = t.source_id and s.deleted_at = t.deleted_at)",
    restoreSet: "updated_at = now()",
    restoreChildrenSql: [`update data_push_tokens set revoked_at = now() where feed_id = $1 and revoked_at is null`],
    lockParentsSql: [`select 1 from data_feeds r join data_sources s on s.id = r.source_id where r.id = $1 for share of s`],
    checks: [
      parentDeleted(`select s.name as label from data_feeds r join data_sources s on s.id = r.source_id where r.id = $1 and s.deleted_at is not null`, "a fonte", "as fontes"),
      {
        code: AUTHORITATIVE_TAKEN,
        sql: `select o.name as label from data_feeds r join data_feeds o on o.organization_id = r.organization_id and o.contract_key = r.contract_key and o.authoritative and o.deleted_at is null where r.id = $1 and r.authoritative limit 1`,
        message: ([label]) => `"${label}" já é a fonte oficial deste dado. Tire essa marca dele antes de restaurar.`,
      },
    ],
    notices: ["Volta pausado, sem carga agendada. Para retomar, use a tela da Central de Dados.", "Tokens próprios deste conjunto foram revogados e não voltam: gere outro antes de retomar."],
  }),
  owned("reports", {
    type: "REPORT",
    label: "Report",
    access: { ownerOnly: true },
    nameSql: "t.name",
    deletedByPersonSql: "(select a.person_id from user_accounts a where a.id = t.deleted_by_account_id)",
    deletedByColumn: "deleted_by_account_id",
    restoreSet: "updated_at = now()",
    checks: [],
    notices: ["Volta inativo, sem nova entrega. Para retomar, ative na tela de Reports."],
  }),
]

const BY_TYPE = new Map<string, DeletedItemDefinition>(DELETED_ITEMS.map((definition) => [definition.type, definition]))

/** `Map`: `__proto__` ou `constructor` vindos do cliente nunca resolvem para nada. */
export const findDeletedItemDefinition = (type: string): DeletedItemDefinition | undefined => BY_TYPE.get(type)

/** Trecho da listagem de um tipo. `$1` é a organização e `$2`, a conta de quem pede. */
export function deletedItemsBranch(definition: DeletedItemDefinition): string {
  const owner = "ownerOnly" in definition.access ? " and t.owner_account_id = $2::uuid" : ""
  const extra = definition.listWhere ? ` and ${definition.listWhere}` : ""
  return `select '${definition.type}'::text as item_type, t.id::text as item_id, (${definition.nameSql})::text as item_name, t.deleted_at, ${definition.deletedByPersonSql} as person_id from ${definition.from} where ${definition.organizationSql} = $1 and t.deleted_at is not null${owner}${extra}`
}

export const restoreAssignments = (definition: DeletedItemDefinition): string => ["deleted_at = null", `${definition.deletedByColumn} = null`, definition.restoreSet].filter(Boolean).join(", ")
