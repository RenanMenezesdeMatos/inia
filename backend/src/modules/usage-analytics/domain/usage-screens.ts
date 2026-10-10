/**
 * CATÁLOGO DE TELAS da Monitoria de usabilidade (fonte ÚNICA — o frontend recebe uma cópia gerada, conferida por teste).
 *
 * Uma TELA é o que a pessoa efetivamente vê em primeiro plano: uma rota (ROUTE), uma aba dentro dela (TAB — com ou sem
 * mudança de URL), um painel (PANEL) ou um diálogo (MODAL). `screen_key` é estável e de baixa cardinalidade; rotas dinâmicas
 * são normalizadas no template (`/supervisor/cases/:caseId`) e o id da entidade, quando importa, vai em campo próprio — nunca
 * no texto da dimensão. Rótulos vêm daqui, nunca do conteúdo da tela.
 *
 * ÁREA separa o uso operacional do produto (padrão dos rankings) do uso administrativo e do próprio painel de monitoria, que
 * só entram quando o leitor pede ("Incluir uso da Administração").
 *
 * INSTRUMENTAÇÃO: `INSTRUMENTED` = visualização + elementos centrais medidos; `PARTIAL` = só a visualização (cliques sem
 * identificador estável contam como "elemento sem identificação"); `NOT_INSTRUMENTED` = existe no produto, mas não emite eventos.
 */
export const USAGE_AREAS = ["OPERATIONAL", "MANAGEMENT", "ADMINISTRATION", "USABILITY_PANEL", "TOOLS", "WIKI"] as const
export type UsageArea = (typeof USAGE_AREAS)[number]
export const USAGE_AREA_LABELS: Record<UsageArea, string> = {
  OPERATIONAL: "Uso do colaborador",
  MANAGEMENT: "Gestão (perfil e ficha)",
  ADMINISTRATION: "Administração",
  USABILITY_PANEL: "Painel de monitoria",
  TOOLS: "Ferramentas (Diagnóstico, QA)",
  WIKI: "Wiki",
}
/** Áreas que NÃO entram nos rankings/atividade operacionais por padrão. */
export const ADMIN_AREAS: readonly UsageArea[] = ["ADMINISTRATION", "USABILITY_PANEL"]

export const SCREEN_KINDS = ["ROUTE", "TAB", "PANEL", "MODAL"] as const
export type ScreenKind = (typeof SCREEN_KINDS)[number]
export type InstrumentationStatus = "INSTRUMENTED" | "PARTIAL" | "NOT_INSTRUMENTED"

export type ScreenDefinition = {
  key: string
  label: string
  kind: ScreenKind
  area: UsageArea
  feature: string
  /** Rota (template) onde a tela vive. TAB/PANEL/MODAL herdam a rota do pai. */
  routeTemplate: string | null
  parent?: string
  instrumentation: InstrumentationStatus
}

const route = (key: string, label: string, routeTemplate: string, area: UsageArea, feature: string, instrumentation: InstrumentationStatus = "PARTIAL"): ScreenDefinition => ({ key, label, kind: "ROUTE", area, feature, routeTemplate, instrumentation })
const tab = (parent: string, key: string, label: string, area: UsageArea, feature: string, instrumentation: InstrumentationStatus = "PARTIAL"): ScreenDefinition => ({ key, label, kind: "TAB", area, feature, routeTemplate: null, parent, instrumentation })
const overlay = (kind: "PANEL" | "MODAL", key: string, label: string, area: UsageArea, feature: string, instrumentation: InstrumentationStatus = "INSTRUMENTED"): ScreenDefinition => ({ key, label, kind, area, feature, routeTemplate: null, instrumentation })

/** Abas do perfil (o mesmo shell para todos os papéis) — `tab=` na URL. */
/** Aba × instrumentação no PERFIL PRÓPRIO: o Acompanhamento tem os elementos centrais medidos (cartões, abertura, avaliação,
 * ciência, sessão); as demais abas medem visualização, troca de aba e links. Na ficha do colaborador todas são PARCIAIS. */
const PROFILE_TABS = [
  ["followup", "Acompanhamento", "followup", "INSTRUMENTED"],
  ["indicators", "Indicadores", "indicators", "PARTIAL"],
  ["people", "Equipe", "team", "PARTIAL"],
  ["pending", "Pendências", "pending", "PARTIAL"],
  ["structure", "Organograma", "structure", "PARTIAL"],
  ["calendar", "Calendário da equipe", "calendar", "PARTIAL"],
] as const

export const USAGE_SCREENS: readonly ScreenDefinition[] = [
  route("home", "Início", "/", "OPERATIONAL", "home"),
  // Perfil próprio — Operador (/operator) e gestão/fora da hierarquia (/supervisor). Mesmo shell, contexto diferente.
  route("my_profile.operator", "Meu perfil (operador)", "/operator", "OPERATIONAL", "profile", "INSTRUMENTED"),
  route("my_profile.manager", "Meu perfil (gestão)", "/supervisor", "MANAGEMENT", "profile", "INSTRUMENTED"),
  ...PROFILE_TABS.map(([value, label, feature, instrumentation]) => tab("my_profile.operator", `my_profile.operator.${value}`, `Meu perfil › ${label}`, "OPERATIONAL", feature, instrumentation)),
  ...PROFILE_TABS.map(([value, label, feature, instrumentation]) => tab("my_profile.manager", `my_profile.manager.${value}`, `Meu perfil (gestão) › ${label}`, "MANAGEMENT", feature, instrumentation)),
  route("employee_profile", "Ficha do colaborador", "/supervisor/operators/:operatorId", "MANAGEMENT", "employee_profile", "PARTIAL"),
  ...PROFILE_TABS.map(([value, label, feature]) => tab("employee_profile", `employee_profile.${value}`, `Ficha › ${label}`, "MANAGEMENT", feature, "PARTIAL")),
  route("case_detail", "Caso de supervisão", "/supervisor/cases/:caseId", "MANAGEMENT", "cases"),
  route("profile_edit", "Editar perfil", "/perfil/editar", "OPERATIONAL", "profile_edit"),
  route("support_material", "Material de apoio", "/materiais/:materialId", "OPERATIONAL", "support_materials", "INSTRUMENTED"),
  route("diagnostics", "Diagnóstico", "/diagnostics", "TOOLS", "diagnostics"),
  ...(
    [["processes", "Processos"], ["people", "Pessoas e equipes"], ["concentration", "Concentração"], ["materials", "Materiais"], ["indicators", "Indicadores"]] as const
  ).map(([value, label]) => tab("diagnostics", `diagnostics.${value}`, `Diagnóstico › ${label}`, "TOOLS", "diagnostics")),
  route("qa_feedbacks", "QA de feedbacks", "/qa-lab/feedbacks", "TOOLS", "qa_lab"),

  // Painéis e diálogos (declarados com data-usage-screen nos componentes).
  overlay("PANEL", "followup.chat_panel", "Conversa com a INIA (painel)", "OPERATIONAL", "chat"),
  overlay("PANEL", "followup.conversation_history", "Conversas anteriores", "OPERATIONAL", "chat_history"),
  overlay("MODAL", "feedback.detail", "Feedback aberto", "OPERATIONAL", "feedback_read"),
  overlay("MODAL", "feedback.session", "Sessão de feedback com a INIA", "OPERATIONAL", "feedback_application"),
  overlay("MODAL", "feedback.confirm_reading", "Confirmação de ciência", "OPERATIONAL", "feedback_read_confirmation"),
  overlay("PANEL", "feedback.rating_reason", "Motivo de “não foi útil”", "OPERATIONAL", "feedback_rating"),
  overlay("PANEL", "notifications.panel", "Notificações (sino)", "OPERATIONAL", "notifications"),
  overlay("MODAL", "workflow.manual_run", "Executar workflow agora", "ADMINISTRATION", "workflow_manual_run"),

  // Administração.
  route("admin.knowledge", "Base de conhecimento", "/admin/knowledge", "ADMINISTRATION", "admin_knowledge"),
  route("admin.knowledge.new", "Nova base de conhecimento", "/admin/knowledge/new", "ADMINISTRATION", "admin_knowledge"),
  route("admin.knowledge.detail", "Base de conhecimento (detalhe)", "/admin/knowledge/:documentId", "ADMINISTRATION", "admin_knowledge"),
  route("admin.knowledge.edit", "Editar base de conhecimento", "/admin/knowledge/:documentId/edit", "ADMINISTRATION", "admin_knowledge"),
  route("admin.checkpoints", "Checkpoints", "/admin/checkpoints", "ADMINISTRATION", "admin_knowledge"),
  route("admin.business_domains", "Domínios de negócio", "/admin/business-domains", "ADMINISTRATION", "admin_configuration"),
  route("admin.agents", "Agentes", "/admin/agents", "ADMINISTRATION", "admin_agents"),
  route("admin.agents.new", "Novo agente", "/admin/agents/new", "ADMINISTRATION", "admin_agents"),
  route("admin.agents.detail", "Agente (edição)", "/admin/agents/:agentId", "ADMINISTRATION", "admin_agents"),
  route("admin.orchestrators", "Orquestradores", "/admin/assistant", "ADMINISTRATION", "admin_orchestrators"),
  route("admin.orchestrators.detail", "Orquestrador (edição)", "/admin/assistant/:orchestratorId", "ADMINISTRATION", "admin_orchestrators"),
  route("admin.ai", "IA / Modelos", "/admin/ai", "ADMINISTRATION", "admin_ai"),
  route("admin.indicators", "Indicadores (configuração)", "/admin/indicators", "ADMINISTRATION", "admin_indicators"),
  route("admin.argument_scripts", "Argumentários", "/admin/argument-scripts", "ADMINISTRATION", "admin_configuration"),
  route("admin.call_rules", "Regras de chamada", "/admin/call-rules", "ADMINISTRATION", "admin_configuration"),
  route("admin.channel_flags", "Flags de canal", "/admin/channel-flags", "ADMINISTRATION", "admin_configuration"),
  route("admin.workflows", "Workflows", "/admin/workflows", "ADMINISTRATION", "admin_workflows"),
  route("admin.workflows.detail", "Workflow", "/admin/workflows/:workflowId", "ADMINISTRATION", "admin_workflows"),
  tab("admin.workflows.detail", "admin.workflows.detail.editor", "Workflow › Editor", "ADMINISTRATION", "admin_workflows"),
  tab("admin.workflows.detail", "admin.workflows.detail.enrollments", "Workflow › Execuções", "ADMINISTRATION", "admin_workflows"),
  tab("admin.workflows.detail", "admin.workflows.detail.results", "Workflow › Resultados", "ADMINISTRATION", "admin_workflows"),
  route("admin.qa_lab", "QA Lab", "/admin/simulate", "ADMINISTRATION", "qa_lab"),
  ...(
    [["workflow", "Workflow"], ["agent", "Agente"], ["orchestrator", "Orquestrador"], ["feedbacks", "Feedbacks"], ["history", "Histórico"]] as const
  ).map(([value, label]) => tab("admin.qa_lab", `admin.qa_lab.${value}`, `QA Lab › ${label}`, "ADMINISTRATION", "qa_lab")),
  route("admin.conversations", "Conversas com a INIA", "/admin/conversations", "ADMINISTRATION", "admin_conversations"),
  route("admin.inia_scenes", "Cenário da INIA", "/admin/inia-scenes", "ADMINISTRATION", "admin_configuration"),
  route("admin.users", "Usuários e acessos", "/admin/users", "ADMINISTRATION", "admin_users"),
  route("admin.governance", "Governança", "/admin/governance", "ADMINISTRATION", "admin_configuration"),
  route("admin.operational_calendar", "Calendário operacional", "/admin/operational-calendar", "ADMINISTRATION", "admin_configuration"),
  route("admin.data_hub", "Central de Dados", "/admin/data-hub", "ADMINISTRATION", "admin_data_hub"),
  route("admin.data_hub.import", "Central de Dados › Importar", "/admin/data-hub/import", "ADMINISTRATION", "admin_data_hub"),
  route("admin.data_hub.source_new", "Central de Dados › Nova fonte", "/admin/data-hub/sources/new", "ADMINISTRATION", "admin_data_hub"),
  route("admin.data_hub.source", "Central de Dados › Fonte", "/admin/data-hub/sources/:sourceId", "ADMINISTRATION", "admin_data_hub"),
  route("admin.data_hub.feed", "Central de Dados › Feed", "/admin/data-hub/feeds/:feedId", "ADMINISTRATION", "admin_data_hub"),
  route("admin.data_hub.run", "Central de Dados › Carga", "/admin/data-hub/runs/:runId", "ADMINISTRATION", "admin_data_hub"),
  // O próprio painel — sempre identificado como uso administrativo do painel.
  route("admin.usability", "Monitoria de usabilidade", "/admin/usability", "USABILITY_PANEL", "admin_usability", "INSTRUMENTED"),
  route("admin.usability.person", "Monitoria de usabilidade › Pessoa", "/admin/usability/people/:personId", "USABILITY_PANEL", "admin_usability", "INSTRUMENTED"),
  route("wiki", "Wiki", "/wiki/*", "WIKI", "wiki"),
]

/**
 * Abas reconhecidas pelo PARÂMETRO de URL (`?tab=`) de uma rota. A aba padrão (sem parâmetro) também é uma visualização da
 * aba — "abrir o perfil" é ver o Acompanhamento. Abas sem URL (Radix) são reconhecidas pelo valor do gatilho ativo.
 */
export const URL_TABS: Record<string, { param: string; default: string; values: readonly string[] }> = {
  "my_profile.operator": { param: "tab", default: "followup", values: PROFILE_TABS.map(([value]) => value) },
  "my_profile.manager": { param: "tab", default: "followup", values: PROFILE_TABS.map(([value]) => value) },
  employee_profile: { param: "tab", default: "followup", values: PROFILE_TABS.map(([value]) => value) },
}

/** Abas Radix (sem URL) reconhecidas: rota → valores do gatilho. */
export const UNROUTED_TABS: Record<string, readonly string[]> = {
  diagnostics: ["processes", "people", "concentration", "materials", "indicators"],
  "admin.workflows.detail": ["editor", "enrollments", "results"],
  "admin.qa_lab": ["workflow", "agent", "orchestrator", "feedbacks", "history"],
}

export const SCREEN_BY_KEY: ReadonlyMap<string, ScreenDefinition> = new Map(USAGE_SCREENS.map((screen) => [screen.key, screen]))
export function screenAreaOf(key: string | null): UsageArea | null {
  return key ? (SCREEN_BY_KEY.get(key)?.area ?? null) : null
}
