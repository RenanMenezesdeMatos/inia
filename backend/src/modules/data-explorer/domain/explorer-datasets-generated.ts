import type { ExplorerColumn, ExplorerDataset } from "./explorer-catalog-types.js"

/**
 * CONJUNTOS GERADOS PELA APLICAÇÃO APROVADOS. Só dados de controle: situação, datas, volumes e referências. Regras da lista:
 *  - nenhum texto livre: título de caso e indicador impactado são escritos pela IA e citam a conduta da pessoa ou o caso do cliente; mensagem e chave de rejeição
 *    repetem o tipo de afastamento e o texto bruto da fonte. O detalhe fica nas telas de cada área, com a permissão delas;
 *  - caso e feedback ligam uma pessoa à situação do acompanhamento dela: exigem `indicators.view`, a permissão que abre esses dados nas telas. O Administrador de dados
 *    não a tem, e a consulta não pode ser um caminho lateral;
 *  - pessoas aparecem pela matrícula. Só "Excluído por", em Workflows, cai para o nome: é conta administrativa, que nem sempre tem matrícula;
 *  - intervenções, avaliações de política, conversas com a INIA e avaliações de feedback ficam fora: têm permissão e separação de funções próprias.
 */
const person = (alias: string, column: string) => `left join people ${alias} on ${alias}.id = t.${column} and ${alias}.organization_id = t.organization_id`

const created = (extra: Partial<ExplorerColumn> = {}): ExplorerColumn => ({ key: "created_at", label: "Criado em", type: "DATETIME", sql: "t.created_at", nullable: false, filterable: true, sortable: true, ...extra })
const updated: ExplorerColumn = { key: "updated_at", label: "Atualizado em", type: "DATETIME", sql: "t.updated_at", nullable: false, filterable: true, hiddenByDefault: true }
const identifier = (label: string, sql = "t.id", nullable = false): ExplorerColumn => ({ key: sql === "t.id" ? "id" : sql.replace(/^t\./, ""), label, type: "UUID", sql, nullable, filterable: true, hiddenByDefault: true })
const matricula = (key: string, label: string, sql: string): ExplorerColumn => ({ key, label, type: "TEXT", sql, nullable: true, personal: true, filterable: true, search: "EXACT" })
const count = (key: string, label: string, sql: string, nullable = false, extra: Partial<ExplorerColumn> = {}): ExplorerColumn => ({ key, label, type: "NUMBER", sql, nullable, filterable: true, ...extra })
const options = (values: readonly (readonly [string, string])[]) => values.map(([value, label]) => ({ value, label }))

const CASE_STATUS = options([["DETECTED", "Detectado"], ["DIAGNOSING", "Em diagnóstico"], ["DIAGNOSED", "Diagnosticado"], ["ACTION_PENDING", "Ação pendente"], ["FOLLOWING_UP", "Em acompanhamento"], ["ESCALATED", "Escalonado"], ["RESOLVED", "Resolvido"], ["CLOSED", "Encerrado"]])
const CASE_PRIORITY = options([["P1", "P1"], ["P2", "P2"], ["P3", "P3"]])
const FEEDBACK_STATUS = options([["DRAFT", "Rascunho"], ["IN_REVIEW", "Em revisão"], ["APPROVED", "Aprovado"], ["PUBLISHED", "Publicado"], ["ACKNOWLEDGED", "Ciência registrada"], ["CANCELLED", "Cancelado"]])
const FEEDBACK_KIND = options([["INDICATOR", "Indicador"], ["MONITORING", "Monitoria"]])
const ENROLLMENT_STATUS = options([["active", "Em execução"], ["waiting", "Aguardando"], ["completed", "Concluída"], ["failed", "Falhou"], ["dead", "Esgotada"], ["blocked", "Bloqueada"]])
const WORKFLOW_SITUATION = options([["ACTIVE", "Ativo"], ["PAUSED", "Pausado"], ["DRAFT", "Rascunho"], ["DELETED", "Excluído"]])
const WORKFLOW_SCOPE = options([["ALL_TEAMS", "Todos os Grupos"], ["TEAM", "Grupo"], ["SUBTEAM", "Subgrupo"]])
const AGENT_RUN_STATUS = options([["PENDING", "Pendente"], ["COMPLETED", "Concluída"], ["FAILED", "Falhou"]])
const AGENT_RUN_SOURCE = options([["MANUAL_TEST", "Teste manual"], ["WORKFLOW", "Workflow"]])
const RUN_STATUS = options([["QUEUED", "Na fila"], ["CONNECTING", "Conectando"], ["FETCHING", "Lendo"], ["PARSING", "Interpretando"], ["MAPPING", "Mapeando"], ["VALIDATING", "Validando"], ["APPLYING", "Aplicando"], ["COMPLETED", "Concluída"], ["PARTIAL", "Parcial"], ["FAILED", "Falhou"], ["CANCELLED", "Cancelada"]])
const RUN_TRIGGER = options([["MANUAL", "Manual"], ["SCHEDULE", "Agenda"], ["PUSH", "API Push"], ["FILE_UPLOAD", "Arquivo"], ["REPROCESS", "Reprocessamento"], ["CONTINUATION", "Continuação"]])

export const GENERATED_DATASETS: readonly ExplorerDataset[] = [
  {
    code: "supervision_cases",
    label: "Casos de supervisão",
    description: "Situação dos casos por pessoa. Título, resumo e causa raiz não aparecem. Exige também a permissão de ver Indicadores.",
    origin: "GENERATED",
    volume: "LARGE",
    requiresPermission: "indicators.view",
    from: `supervision_cases t ${person("op", "operator_id")} ${person("asg", "assignee_id")} left join teams tm on tm.id = t.team_id and tm.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      identifier("Identificador"),
      { key: "status", label: "Situação", type: "ENUM", sql: "t.status::text", nullable: false, filterable: true, options: CASE_STATUS },
      { key: "priority", label: "Prioridade", type: "ENUM", sql: "t.priority::text", nullable: false, filterable: true, options: CASE_PRIORITY },
      { key: "indicator_code", label: "Indicador", description: "Caso aberto por política de acompanhamento não mostra qual política.", type: "TEXT", sql: "(case when t.indicator_code like 'POLICY:%' then 'POLITICA_DE_ACOMPANHAMENTO' else t.indicator_code end)", nullable: false, filterable: true, search: "EXACT" },
      matricula("operator_matricula", "Matrícula do operador", "op.matricula"),
      matricula("assignee_matricula", "Matrícula do responsável", "asg.matricula"),
      { key: "group", label: "Grupo", type: "TEXT", sql: "tm.name", nullable: true, filterable: true },
      { key: "sla_due_at", label: "Prazo", type: "DATETIME", sql: "t.sla_due_at", nullable: true, filterable: true, hiddenByDefault: true },
      created(),
      updated,
    ],
  },
  {
    code: "feedbacks",
    label: "Feedbacks",
    description: "Situação e datas dos feedbacks por pessoa. O texto, a evidência e a recomendação não aparecem. Exige também a permissão de ver Indicadores.",
    origin: "GENERATED",
    volume: "LARGE",
    requiresPermission: "indicators.view",
    from: `feedbacks t ${person("op", "operator_id")} ${person("aut", "author_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      identifier("Identificador"),
      identifier("Caso", "t.case_id"),
      { key: "kind", label: "Tipo", type: "ENUM", sql: "t.feedback_kind::text", nullable: false, filterable: true, options: FEEDBACK_KIND },
      { key: "status", label: "Situação", type: "ENUM", sql: "t.status::text", nullable: false, filterable: true, options: FEEDBACK_STATUS },
      matricula("operator_matricula", "Matrícula do operador", "op.matricula"),
      matricula("author_matricula", "Matrícula de quem criou", "aut.matricula"),
      count("version", "Versão", "t.version", false, { hiddenByDefault: true }),
      { key: "published_at", label: "Publicado em", type: "DATETIME", sql: "t.published_at", nullable: true, filterable: true },
      { key: "acknowledged_at", label: "Ciência em", type: "DATETIME", sql: "t.acknowledged_at", nullable: true, filterable: true },
      created(),
      updated,
    ],
  },
  {
    code: "workflows",
    label: "Workflows",
    description: "Todos os Workflows, inclusive os excluídos, com a situação e quantas execuções tiveram. O desenho do fluxo e a descrição não aparecem.",
    origin: "GENERATED",
    volume: "SMALL",
    from: `workflows_all t left join teams tm on tm.id = t.team_id and tm.organization_id = t.organization_id left join subteams st on st.id = t.subteam_id and st.organization_id = t.organization_id ${person("del", "deleted_by_person_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      identifier("Identificador"),
      { key: "name", label: "Nome", type: "TEXT", sql: "t.name", nullable: false, filterable: true, sortable: true, search: "CONTAINS" },
      { key: "situation", label: "Situação", description: "Excluído continua guardado, mas não roda nem aparece nas telas de Workflow.", type: "ENUM", sql: "(case when t.deleted_at is not null then 'DELETED' when t.active then 'ACTIVE' when t.active_version_id is null then 'DRAFT' else 'PAUSED' end)", nullable: false, filterable: true, options: WORKFLOW_SITUATION },
      { key: "scope", label: "Abrangência", type: "ENUM", sql: "t.scope_type", nullable: false, filterable: true, options: WORKFLOW_SCOPE },
      { key: "group", label: "Grupo", type: "TEXT", sql: "tm.name", nullable: true, filterable: true },
      { key: "subgroup", label: "Subgrupo", type: "TEXT", sql: "st.name", nullable: true, filterable: true },
      count("executions", "Execuções", "(select count(e.id) from workflow_enrollments e where e.workflow_id = t.id)"),
      created(),
      updated,
      { key: "deleted_at", label: "Excluído em", type: "DATETIME", sql: "t.deleted_at", nullable: true, filterable: true, sortable: true },
      // Quem administra nem sempre tem matrícula (conta cadastrada à mão), e sem isso a coluna ficaria vazia justo para rastrear quem excluiu.
      { key: "deleted_by", label: "Excluído por", description: "Matrícula ou, sem matrícula, o nome de quem excluiu.", type: "TEXT", sql: "coalesce(del.matricula, del.name)", nullable: true, personal: true, filterable: true },
    ],
  },
  {
    code: "workflow_executions",
    label: "Execuções de Workflow",
    description: "Situação de cada execução. Saídas dos nós, variáveis e detalhes de bloqueio não aparecem.",
    origin: "GENERATED",
    volume: "LARGE",
    from: `workflow_enrollments t left join workflows_all w on w.id = t.workflow_id and w.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      identifier("Identificador"),
      { key: "workflow", label: "Workflow", type: "TEXT", sql: "w.name", nullable: true, filterable: true, search: "EXACT" },
      { key: "workflow_deleted_at", label: "Workflow excluído em", type: "DATETIME", sql: "w.deleted_at", nullable: true, filterable: true },
      { key: "status", label: "Situação", type: "ENUM", sql: "t.status", nullable: false, filterable: true, options: ENROLLMENT_STATUS },
      { key: "current_node", label: "Nó atual", type: "TEXT", sql: "t.current_node_id", nullable: false, filterable: true },
      { key: "matched_flag", label: "Flag do gatilho", type: "TEXT", sql: "t.matched_flag_name", nullable: true, filterable: true },
      { key: "scheduled_for", label: "Agendada para", type: "DATETIME", sql: "t.scheduled_for", nullable: true, filterable: true, hiddenByDefault: true },
      count("attempts", "Tentativas", "t.attempts"),
      { key: "blocked_at", label: "Bloqueada em", type: "DATETIME", sql: "t.blocked_at", nullable: true, filterable: true, hiddenByDefault: true },
      created(),
      updated,
    ],
  },
  {
    code: "agent_executions",
    label: "Execuções de Agents",
    description: "Situação e modelo de cada execução. Entrada, saída, erro e rastro de ferramentas não aparecem.",
    origin: "GENERATED",
    volume: "LARGE",
    from: `agent_runs t left join agents_all a on a.id = t.agent_id and a.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      identifier("Identificador"),
      { key: "agent", label: "Agent", type: "TEXT", sql: "a.name", nullable: true, filterable: true, search: "EXACT" },
      { key: "source", label: "Origem", type: "ENUM", sql: "t.source", nullable: false, filterable: true, options: AGENT_RUN_SOURCE },
      { key: "status", label: "Situação", type: "ENUM", sql: "t.status", nullable: false, filterable: true, options: AGENT_RUN_STATUS },
      { key: "model", label: "Modelo", type: "TEXT", sql: "t.model", nullable: true, filterable: true },
      identifier("Caso", "t.case_id", true),
      created(),
      { key: "completed_at", label: "Concluída em", type: "DATETIME", sql: "t.completed_at", nullable: true, filterable: true },
    ],
  },
  {
    code: "ai_usage",
    label: "Uso de IA",
    description: "Chamadas aos modelos, com tokens, custo e duração. Exige também a permissão de ver IA; não mostra quem pediu.",
    origin: "GENERATED",
    volume: "LARGE",
    from: `ai_usage_events t`,
    key: { sql: "t.id", cast: "bigint" },
    defaultSort: { column: "occurred_at", direction: "DESC" },
    requiresPermission: "ai.view",
    columns: [
      { key: "occurred_at", label: "Quando", type: "DATETIME", sql: "t.occurred_at", nullable: false, filterable: true, sortable: true },
      { key: "use_case", label: "Uso", type: "TEXT", sql: "t.use_case", nullable: false, filterable: true, search: "EXACT" },
      { key: "provider", label: "Provedor", type: "TEXT", sql: "t.provider_key", nullable: false, filterable: true },
      { key: "model", label: "Modelo", type: "TEXT", sql: "t.model_name", nullable: false, filterable: true, search: "EXACT" },
      { key: "status", label: "Situação", type: "TEXT", sql: "t.status", nullable: false, filterable: true },
      { key: "error_category", label: "Categoria do erro", type: "TEXT", sql: "t.error_category", nullable: true, filterable: true, hiddenByDefault: true },
      count("input_tokens", "Tokens de entrada", "t.input_tokens", true),
      count("output_tokens", "Tokens de saída", "t.output_tokens", true),
      count("total_tokens", "Tokens no total", "t.total_tokens", true, { hiddenByDefault: true }),
      count("cost", "Custo", "t.cost", true),
      { key: "currency", label: "Moeda", type: "TEXT", sql: "t.currency", nullable: true, filterable: true, hiddenByDefault: true },
      count("duration_ms", "Duração (ms)", "t.duration_ms", true),
    ],
  },
  {
    code: "data_runs",
    label: "Cargas da Central",
    description: "Cargas com contadores e situação. Posições de leitura, etapas e chaves de idempotência não aparecem.",
    origin: "GENERATED",
    volume: "LARGE",
    from: `data_ingestion_runs t left join data_sources s on s.id = t.source_id and s.organization_id = t.organization_id left join data_feeds f on f.id = t.feed_id and f.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      identifier("Identificador"),
      { key: "source", label: "Fonte", type: "TEXT", sql: "s.name", nullable: true, filterable: true, search: "EXACT" },
      { key: "feed", label: "Conjunto", type: "TEXT", sql: "f.name", nullable: true, filterable: true, search: "EXACT" },
      { key: "contract", label: "Contrato", type: "TEXT", sql: "t.contract_key", nullable: false, filterable: true, search: "EXACT" },
      { key: "trigger", label: "Origem", type: "ENUM", sql: "t.trigger_kind", nullable: false, filterable: true, options: RUN_TRIGGER },
      { key: "status", label: "Situação", type: "ENUM", sql: "t.status", nullable: false, filterable: true, options: RUN_STATUS },
      count("records_received", "Recebidos", "t.records_received"),
      count("records_inserted", "Inseridos", "t.records_inserted"),
      count("records_updated", "Atualizados", "t.records_updated"),
      count("records_rejected", "Rejeitados", "t.records_rejected"),
      count("warning_count", "Avisos", "t.warning_count", false, { hiddenByDefault: true }),
      { key: "error_code", label: "Código do erro", type: "TEXT", sql: "t.error_code", nullable: true, filterable: true, hiddenByDefault: true },
      count("duration_ms", "Duração (ms)", "t.duration_ms", true, { hiddenByDefault: true }),
      { key: "finished_at", label: "Terminou em", type: "DATETIME", sql: "t.finished_at", nullable: true, filterable: true },
      created(),
    ],
  },
  {
    code: "data_rejections",
    label: "Rejeições das cargas",
    description: "Em qual carga, linha e campo houve recusa, e o código do erro. A chave do registro e a mensagem ficam na tela da carga, porque repetem dados da fonte.",
    origin: "GENERATED",
    volume: "LARGE",
    from: `data_ingestion_rejections t left join data_ingestion_runs r on r.id = t.run_id and r.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      { key: "run_id", label: "Carga", type: "UUID", sql: "t.run_id", nullable: false, filterable: true },
      { key: "contract", label: "Contrato", type: "TEXT", sql: "r.contract_key", nullable: true, filterable: true },
      count("record_number", "Linha", "t.record_number"),
      { key: "error_code", label: "Código", type: "TEXT", sql: "t.error_code", nullable: false, filterable: true, search: "EXACT" },
      { key: "field", label: "Campo", type: "TEXT", sql: "t.field", nullable: true, filterable: true },
      created(),
    ],
  },
]
