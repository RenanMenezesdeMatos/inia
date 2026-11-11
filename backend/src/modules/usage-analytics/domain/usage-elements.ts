/**
 * CATÁLOGO DE FUNCIONALIDADES, ELEMENTOS e CONTEÚDOS da Monitoria de usabilidade.
 *
 * FUNCIONALIDADE (`feature_key`) = capacidade do produto (ler feedback, conversar por voz, executar workflow…). ELEMENTO
 * (`element_key`) = controle acionável identificado de forma estável nos componentes (`data-usage-element`). CONTEÚDO
 * (`content_key`) = área cuja rolagem é observada (`data-usage-scroll`). Nada aqui guarda texto da tela.
 *
 * `central` = a exposição é medida (≥ 50 % visível por 1 s, uma vez por visualização) e a taxa de acionamento existe.
 * `repeatExpected` = repetição é o uso normal (paginação, setas) e nunca vira "clique repetitivo".
 * `resultTimeoutMs` = o elemento tem contrato de resultado conhecido (ação iniciada/concluída/falhou) — sem nenhum desses no
 * prazo, o acionamento vira "possível ação sem retorno" (heurística observacional, nunca diagnóstico de intenção).
 */
export type FeatureDefinition = { key: string; label: string; domainAction: boolean }

export const USAGE_FEATURES: readonly FeatureDefinition[] = [
  { key: "home", label: "Início", domainAction: false },
  { key: "profile", label: "Perfil", domainAction: false },
  { key: "followup", label: "Acompanhamento", domainAction: false },
  { key: "indicators", label: "Indicadores", domainAction: false },
  { key: "team", label: "Equipe", domainAction: false },
  { key: "pending", label: "Pendências", domainAction: false },
  { key: "structure", label: "Organograma", domainAction: false },
  { key: "calendar", label: "Calendário da equipe", domainAction: false },
  { key: "employee_profile", label: "Ficha do colaborador", domainAction: false },
  { key: "cases", label: "Casos de supervisão", domainAction: false },
  { key: "profile_edit", label: "Edição do perfil", domainAction: false },
  { key: "support_materials", label: "Materiais de apoio", domainAction: false },
  { key: "feedback_read", label: "Leitura de feedback", domainAction: false },
  { key: "feedback_rating", label: "Avaliação de feedback", domainAction: true },
  { key: "feedback_read_confirmation", label: "Confirmação de ciência", domainAction: true },
  { key: "feedback_application", label: "Aplicação de feedback com a INIA", domainAction: true },
  { key: "chat", label: "Conversa com a INIA", domainAction: true },
  { key: "chat_history", label: "Histórico de conversas", domainAction: false },
  { key: "voice", label: "Voz com a INIA", domainAction: true },
  { key: "notifications", label: "Notificações", domainAction: false },
  { key: "diagnostics", label: "Diagnóstico", domainAction: false },
  { key: "qa_lab", label: "QA Lab", domainAction: false },
  { key: "workflow_manual_run", label: "Execução manual de workflow", domainAction: true },
  { key: "admin_workflows", label: "Workflows (administração)", domainAction: false },
  { key: "admin_knowledge", label: "Bases de conhecimento", domainAction: false },
  { key: "admin_agents", label: "Agentes", domainAction: false },
  { key: "admin_orchestrators", label: "Orquestradores", domainAction: false },
  { key: "admin_ai", label: "IA / Modelos", domainAction: false },
  { key: "admin_indicators", label: "Indicadores (configuração)", domainAction: false },
  { key: "admin_configuration", label: "Configurações operacionais", domainAction: false },
  { key: "admin_users", label: "Usuários e acessos", domainAction: false },
  { key: "admin_data_hub", label: "Central de Dados", domainAction: false },
  { key: "admin_conversations", label: "Conversas com a INIA (leitura)", domainAction: false },
  { key: "admin_usability", label: "Monitoria de usabilidade", domainAction: false },
  { key: "search", label: "Busca", domainAction: false },
  { key: "export", label: "Exportação", domainAction: false },
  { key: "navigation", label: "Navegação", domainAction: false },
  { key: "wiki", label: "Wiki", domainAction: false },
]

export type ElementKind = "BUTTON" | "LINK" | "TAB" | "CARD" | "TOGGLE" | "MENU_ITEM" | "INPUT"
export type ElementDefinition = {
  key: string
  label: string
  feature: string
  kind: ElementKind
  central?: boolean
  repeatExpected?: boolean
  /** Prazo do contrato de resultado (ms). Ausente = sem contrato: nunca vira "ação sem retorno". */
  resultTimeoutMs?: number
}

export const USAGE_ELEMENTS: readonly ElementDefinition[] = [
  // Navegação (automáticos: link interno e aba Radix ganham a chave sem atributo nos componentes).
  { key: "nav.link", label: "Link interno", feature: "navigation", kind: "LINK" },
  { key: "nav.tab", label: "Aba", feature: "navigation", kind: "TAB" },
  { key: "nav.user_menu", label: "Menu da pessoa (cabeçalho)", feature: "navigation", kind: "MENU_ITEM" },
  { key: "nav.area_switcher", label: "Seletor de área", feature: "navigation", kind: "MENU_ITEM" },
  // Feedback no Acompanhamento.
  { key: "feedback.card", label: "Card de feedback", feature: "feedback_read", kind: "CARD", central: true },
  { key: "feedback.open_detail", label: "Abrir feedback", feature: "feedback_read", kind: "BUTTON", central: true },
  { key: "feedback.listen", label: "Ouvir com a INIA", feature: "feedback_application", kind: "BUTTON", central: true, resultTimeoutMs: 15_000 },
  { key: "feedback.confirm_reading.open", label: "Confirmar ciência", feature: "feedback_read_confirmation", kind: "BUTTON", central: true },
  { key: "feedback.confirm_reading.submit", label: "Confirmar (login e senha)", feature: "feedback_read_confirmation", kind: "BUTTON", resultTimeoutMs: 15_000 },
  { key: "feedback.confirm_reading.cancel", label: "Cancelar confirmação", feature: "feedback_read_confirmation", kind: "BUTTON" },
  // Concordância na ciência (migration 186): a escolha é a avaliação do feedback.
  { key: "feedback.confirm_reading.agree", label: "Concordo com o feedback", feature: "feedback_read_confirmation", kind: "BUTTON" },
  { key: "feedback.confirm_reading.disagree", label: "Não concordo com o feedback", feature: "feedback_read_confirmation", kind: "BUTTON" },
  { key: "feedback.confirm_reading.continue", label: "Continuar para login e senha", feature: "feedback_read_confirmation", kind: "BUTTON" },
  { key: "feedback.confirm_reading.change", label: "Alterar a escolha antes de confirmar", feature: "feedback_read_confirmation", kind: "BUTTON" },
  { key: "feedback.evaluation.details", label: "Ver detalhes da avaliação", feature: "feedback_read_confirmation", kind: "BUTTON" },
  { key: "feedback.evaluation.register", label: "Dizer se concorda (ciência anterior)", feature: "feedback_read_confirmation", kind: "BUTTON", central: true },
  // LEGADO: o "Este conteúdo foi útil?" saiu da tela em 10/11/2026. As chaves ficam para os eventos históricos.
  { key: "feedback.rating.up", label: "Foi útil (legado)", feature: "feedback_rating", kind: "BUTTON", central: true, resultTimeoutMs: 10_000 },
  { key: "feedback.rating.down", label: "Não foi útil (legado)", feature: "feedback_rating", kind: "BUTTON", central: true },
  { key: "feedback.rating.submit_reason", label: "Enviar motivo (legado)", feature: "feedback_rating", kind: "BUTTON", resultTimeoutMs: 10_000 },
  { key: "feedback.material.open", label: "Abrir material de apoio", feature: "support_materials", kind: "LINK", central: true },
  { key: "feedback.invite.listen", label: "Convite: ouvir agora", feature: "feedback_application", kind: "BUTTON", central: true },
  { key: "feedback.invite.read", label: "Convite: ler", feature: "feedback_application", kind: "BUTTON" },
  { key: "feedback.invite.later", label: "Convite: depois", feature: "feedback_application", kind: "BUTTON" },
  { key: "feedback.session.exit", label: "Sair da sessão de feedback", feature: "feedback_application", kind: "BUTTON" },
  { key: "feedback.session.replay", label: "Ouvir/repetir apresentação", feature: "feedback_application", kind: "BUTTON" },
  { key: "material.download", label: "Baixar material", feature: "support_materials", kind: "BUTTON" },
  // Conversa com a INIA.
  { key: "chat.send", label: "Enviar mensagem", feature: "chat", kind: "BUTTON", central: true, resultTimeoutMs: 30_000 },
  { key: "chat.mic", label: "Microfone", feature: "voice", kind: "TOGGLE", central: true },
  { key: "chat.mute", label: "Silenciar a INIA", feature: "voice", kind: "TOGGLE" },
  { key: "chat.camera", label: "Câmera (avatar)", feature: "voice", kind: "TOGGLE" },
  { key: "chat.end_call", label: "Encerrar chamada", feature: "voice", kind: "BUTTON" },
  { key: "chat.start_call", label: "Chamar a INIA", feature: "voice", kind: "BUTTON", central: true },
  { key: "chat.interrupt", label: "Interromper a INIA", feature: "voice", kind: "BUTTON" },
  { key: "chat.new_conversation", label: "Nova conversa", feature: "chat", kind: "BUTTON" },
  { key: "chat.history.open", label: "Conversas anteriores", feature: "chat_history", kind: "BUTTON" },
  { key: "chat.collapse", label: "Recolher painel da INIA", feature: "chat", kind: "BUTTON" },
  // Sino.
  { key: "notifications.bell", label: "Sino de notificações", feature: "notifications", kind: "BUTTON", central: true },
  { key: "notifications.item", label: "Notificação", feature: "notifications", kind: "CARD", central: true },
  { key: "notifications.mark_all_read", label: "Marcar todas como lidas", feature: "notifications", kind: "BUTTON" },
  // Workflows.
  { key: "workflow.manual_run.open", label: "Executar agora", feature: "workflow_manual_run", kind: "BUTTON", central: true },
  { key: "workflow.manual_run.submit", label: "Confirmar execução manual", feature: "workflow_manual_run", kind: "BUTTON", resultTimeoutMs: 15_000 },
  // Listas (busca, filtros, paginação) — componentes compartilhados.
  { key: "list.search", label: "Busca da lista", feature: "search", kind: "INPUT" },
  { key: "list.filter", label: "Filtro da lista", feature: "search", kind: "INPUT" },
  { key: "list.pagination", label: "Paginação", feature: "search", kind: "BUTTON", repeatExpected: true },
  // Painel de monitoria.
  { key: "usability.export", label: "Exportar CSV (monitoria)", feature: "export", kind: "BUTTON", resultTimeoutMs: 60_000 },
  { key: "usability.drilldown", label: "Abrir detalhe de um número", feature: "admin_usability", kind: "BUTTON" },
]

/** Conteúdos com rolagem observada (25/50/75/100 %). Rolagem nunca é leitura. */
export const USAGE_CONTENTS: readonly { key: string; label: string; feature: string }[] = [
  { key: "feedback.content", label: "Conteúdo do feedback", feature: "feedback_read" },
  { key: "feedback.session.content", label: "Feedback na sessão com a INIA", feature: "feedback_application" },
  { key: "material.content", label: "Material de apoio", feature: "support_materials" },
  { key: "followup.feed", label: "Feed do Acompanhamento", feature: "followup" },
]

/** Superfícies de busca/filtro (sem guardar a consulta). */
export const USAGE_SEARCH_SURFACES: readonly { key: string; label: string }[] = [
  { key: "admin.list", label: "Listas da Administração" },
  { key: "followup.feed", label: "Acompanhamento" },
  { key: "team", label: "Equipe" },
  { key: "structure", label: "Organograma" },
  { key: "usability", label: "Monitoria de usabilidade" },
]

export const FEATURE_BY_KEY: ReadonlyMap<string, FeatureDefinition> = new Map(USAGE_FEATURES.map((feature) => [feature.key, feature]))
export const ELEMENT_BY_KEY: ReadonlyMap<string, ElementDefinition> = new Map(USAGE_ELEMENTS.map((element) => [element.key, element]))
export const CONTENT_KEYS: ReadonlySet<string> = new Set(USAGE_CONTENTS.map((content) => content.key))
export const SEARCH_SURFACE_KEYS: ReadonlySet<string> = new Set(USAGE_SEARCH_SURFACES.map((surface) => surface.key))
