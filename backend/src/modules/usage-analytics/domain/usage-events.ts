import { z } from "zod"

/**
 * CATÁLOGO DE EVENTOS da Monitoria de usabilidade — contrato fechado por evento (schema Zod `.strict()`), versão explícita e
 * documentação de cada um: finalidade, emissor, momento exato, correlação, deduplicação, dimensão temporal e sensibilidade.
 *
 * O navegador só envia o que está aqui; organização, ator, ambiente, classificação (teste/demonstração) e estrutura são
 * derivados pelo SERVIDOR. Nenhum evento carrega texto de tela, conteúdo de conversa/feedback, consulta digitada, login ou
 * senha. Sucesso de negócio nunca vem do navegador: avaliação, ciência, mensagem, execução de workflow são lidos das tabelas
 * oficiais; eventos de servidor (`SERVER`) só complementam fatos que as tabelas oficiais não guardam como histórico.
 */
export const USAGE_EVENT_SCHEMA_VERSION = 1

export const USAGE_ENTITY_TYPES = ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "ALERT", "KNOWLEDGE_MATERIAL", "CONVERSATION", "WORKFLOW", "PERSON", "CASE", "WORKFLOW_OUTPUT"] as const
export type UsageEntityType = (typeof USAGE_ENTITY_TYPES)[number]

export const USAGE_EVENT_FAMILIES = ["AUTH", "SESSION", "NAVIGATION", "ELEMENT", "SCROLL", "ACTION", "SEARCH", "FEEDBACK", "APPLICATION", "CHAT", "VOICE", "NOTIFICATION", "EXPORT"] as const
export type UsageEventFamily = (typeof USAGE_EVENT_FAMILIES)[number]
export const USAGE_FAMILY_LABELS: Record<UsageEventFamily, string> = {
  AUTH: "Autenticação",
  SESSION: "Sessão e tempo ativo",
  NAVIGATION: "Telas visualizadas",
  ELEMENT: "Elementos (exposição e acionamento)",
  SCROLL: "Rolagem",
  ACTION: "Ações de interface",
  SEARCH: "Busca e filtros",
  FEEDBACK: "Feedback (exposição e abertura)",
  APPLICATION: "Aplicação de feedback com a INIA",
  CHAT: "Conversa (interface)",
  VOICE: "Voz (transporte e reprodução)",
  NOTIFICATION: "Notificações",
  EXPORT: "Exportações da monitoria",
}

const isoInstant = z.string().datetime({ offset: true })
const BUCKETS_QUERY = ["1-2", "3-5", "6-10", "11+"] as const
const BUCKETS_RESULTS = ["0", "1-5", "6-20", "21+"] as const
const errorCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/)
const voiceIntent = z.string().uuid()

/** Ações de interface com contrato (iniciada → concluída | falhou | cancelada). Sucesso aqui = o navegador recebeu a confirmação. */
export const USAGE_ACTIONS = [
  "chat.send_message",
  "feedback.rate",
  "feedback.confirm_reading",
  "feedback.start_application",
  "workflow.manual_run",
  "material.download",
  "profile.save",
  "usability.export",
] as const
export const USAGE_ACTION_LABELS: Record<(typeof USAGE_ACTIONS)[number], string> = {
  "chat.send_message": "Enviar mensagem à INIA",
  "feedback.rate": "Avaliar feedback",
  "feedback.confirm_reading": "Confirmar ciência",
  "feedback.start_application": "Iniciar/retomar aplicação com a INIA",
  "workflow.manual_run": "Executar workflow manualmente",
  "material.download": "Baixar material de apoio",
  "profile.save": "Salvar perfil",
  "usability.export": "Exportar CSV da monitoria",
}

export type UsageEventDefinition = {
  name: string
  family: UsageEventFamily
  emitter: "CLIENT" | "SERVER"
  /** Quem é a autoridade do fato medido. */
  authority: string
  purpose: string
  moment: string
  correlation: string
  dedupe: string
  sensitivity: "LOW" | "MEDIUM"
  /** O evento conta como atividade humana qualificada (torna a pessoa ativa / estende a sessão)? */
  qualifiesActivity: boolean
  requiresScreen?: boolean
  requiresElement?: boolean
  entityTypes?: readonly UsageEntityType[]
  properties: z.ZodTypeAny
}

const empty = z.object({}).strict()
const def = (value: UsageEventDefinition) => value

export const USAGE_EVENTS: readonly UsageEventDefinition[] = [
  // ------------------------------------------------------------------ navegador
  def({ name: "screen.viewed", family: "NAVIGATION", emitter: "CLIENT", authority: "Navegador (catálogo fechado)", purpose: "Visualização canônica de tela/aba/painel/diálogo — base do ranking de telas.", moment: "Quando a tela está apresentada em primeiro plano (aba do navegador visível); prefetch e render no servidor não emitem.", correlation: "screenInstanceId (uma por apresentação); usageSessionId; tabId", dedupe: "eventId único; remontagem técnica (Strict Mode/hidratação) na mesma tela em < 1,5 s não gera outra instância", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "PERSON", "CASE", "WORKFLOW", "KNOWLEDGE_MATERIAL", "CONVERSATION"], properties: z.object({ kind: z.enum(["ROUTE", "TAB", "PANEL", "MODAL"]), navigation: z.enum(["INITIAL", "NAVIGATION", "RETURN", "RELOAD", "TAB_SWITCH", "OPEN"]), previousScreenKey: z.string().max(80).nullable().optional(), entry: z.boolean() }).strict() }),
  def({ name: "screen.left", family: "NAVIGATION", emitter: "CLIENT", authority: "Navegador", purpose: "Saída/transição observada (fechamento explícito). Saída sem este evento é INFERIDA e rotulada.", moment: "Ao trocar de tela, fechar o painel/diálogo, esconder a aba ou descarregar a página (best effort).", correlation: "screenInstanceId da visualização encerrada", dedupe: "eventId; no máximo uma saída por instância", sensitivity: "LOW", qualifiesActivity: false, requiresScreen: true, properties: z.object({ reason: z.enum(["NAVIGATION", "HIDDEN", "CLOSED", "PAGEHIDE", "LOGOUT"]), visibleMs: z.number().int().min(0).max(86_400_000) }).strict() }),
  def({ name: "activity.heartbeat", family: "SESSION", emitter: "CLIENT", authority: "Navegador", purpose: "Confirma um intervalo de atenção observada (tempo ativo). Não renova sozinho a última interação.", moment: "A cada ≤ 15 s enquanto a aba está visível e houve interação nos últimos 60 s (ou voz em andamento); ao esconder a aba fecha o intervalo parcial.", correlation: "screenInstanceId; usageSessionId", dedupe: "eventId; intervalos sobrepostos são unidos por pessoa (nunca somados)", sensitivity: "LOW", qualifiesActivity: false, requiresScreen: true, properties: z.object({ spanStart: isoInstant, spanEnd: isoInstant, reason: z.enum(["INTERACTION", "MEDIA", "INITIAL_NAVIGATION"]), lastInteractionAt: isoInstant.nullable() }).strict() }),
  def({ name: "element.activated", family: "ELEMENT", emitter: "CLIENT", authority: "Navegador (catálogo fechado)", purpose: "Clique, toque ou ativação por teclado de um elemento identificado. NÃO comprova o resultado da ação.", moment: "No acionamento (captura), antes do efeito.", correlation: "screenInstanceId; correlationId quando a ação tem contrato", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, requiresElement: true, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "ALERT", "KNOWLEDGE_MATERIAL", "WORKFLOW", "PERSON", "CONVERSATION"], properties: z.object({ interaction: z.enum(["CLICK", "TAP", "KEYBOARD"]), targetScreenKey: z.string().max(80).nullable().optional(), tabValue: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).nullable().optional() }).strict() }),
  def({ name: "element.exposed", family: "ELEMENT", emitter: "CLIENT", authority: "Navegador", purpose: "Exposição real de elemento central: ≥ 50 % visível por 1 s em primeiro plano, uma vez por visualização.", moment: "Ao completar 1 s contínuo de visibilidade ≥ 50 %.", correlation: "screenInstanceId + elementKey (+ entidade)", dedupe: "uma exposição por (instância de tela, elemento, entidade)", sensitivity: "LOW", qualifiesActivity: false, requiresScreen: true, requiresElement: true, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "ALERT", "KNOWLEDGE_MATERIAL"], properties: empty }),
  def({ name: "content.scrolled", family: "SCROLL", emitter: "CLIENT", authority: "Navegador", purpose: "Profundidade de rolagem observada (25/50/75/100 %). Nunca é leitura.", moment: "Ao atingir cada marco pela primeira vez na visualização; conteúdo que cabe na tela emite um único marco 100 com fitsViewport=true.", correlation: "screenInstanceId + contentKey", dedupe: "um marco por (instância, conteúdo, profundidade)", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "KNOWLEDGE_MATERIAL"], properties: z.object({ contentKey: z.string().max(60), depth: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]), fitsViewport: z.boolean() }).strict() }),
  def({ name: "action.started", family: "ACTION", emitter: "CLIENT", authority: "Navegador (intenção)", purpose: "Início de uma operação de interface com contrato.", moment: "Quando a requisição é disparada.", correlation: "correlationId (mesmo nos estágios seguintes)", dedupe: "eventId; estágios correlacionados por correlationId", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, properties: z.object({ actionKey: z.enum(USAGE_ACTIONS) }).strict() }),
  def({ name: "action.succeeded", family: "ACTION", emitter: "CLIENT", authority: "Navegador (confirmação recebida)", purpose: "A interface recebeu a confirmação do servidor. O FATO de negócio continua sendo o da tabela oficial.", moment: "Quando a resposta 2xx chega.", correlation: "correlationId", dedupe: "um sucesso por correlationId", sensitivity: "LOW", qualifiesActivity: false, requiresScreen: true, properties: z.object({ actionKey: z.enum(USAGE_ACTIONS), durationMs: z.number().int().min(0).max(3_600_000).nullable().optional() }).strict() }),
  def({ name: "action.failed", family: "ACTION", emitter: "CLIENT", authority: "Navegador", purpose: "Falha observada na interface (erro devolvido ou rede).", moment: "Quando o erro chega.", correlation: "correlationId", dedupe: "um desfecho por correlationId", sensitivity: "LOW", qualifiesActivity: false, requiresScreen: true, properties: z.object({ actionKey: z.enum(USAGE_ACTIONS), errorCode: errorCode.nullable().optional(), durationMs: z.number().int().min(0).max(3_600_000).nullable().optional() }).strict() }),
  def({ name: "action.cancelled", family: "ACTION", emitter: "CLIENT", authority: "Navegador", purpose: "Cancelamento explícito pela pessoa (fechar, desistir). Diferente de ausência de desfecho e de falha.", moment: "No cancelamento.", correlation: "correlationId", dedupe: "um desfecho por correlationId", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, properties: z.object({ actionKey: z.enum(USAGE_ACTIONS) }).strict() }),
  def({ name: "search.performed", family: "SEARCH", emitter: "CLIENT", authority: "Navegador", purpose: "Busca iniciada; guarda só FAIXA de tamanho da consulta e de resultados — nunca a consulta.", moment: "Quando a lista é recarregada com a busca (após o debounce).", correlation: "screenInstanceId", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, properties: z.object({ surface: z.string().max(40), queryLength: z.enum(BUCKETS_QUERY), resultCount: z.enum(BUCKETS_RESULTS).nullable(), empty: z.boolean().nullable() }).strict() }),
  def({ name: "search.result_opened", family: "SEARCH", emitter: "CLIENT", authority: "Navegador", purpose: "Abertura de um resultado depois de uma busca.", moment: "No acionamento do resultado.", correlation: "screenInstanceId", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, properties: z.object({ surface: z.string().max(40) }).strict() }),
  def({ name: "filter.applied", family: "SEARCH", emitter: "CLIENT", authority: "Navegador", purpose: "Filtro utilizado (nome do filtro, nunca o valor).", moment: "Quando o filtro muda.", correlation: "screenInstanceId", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: true, requiresScreen: true, properties: z.object({ surface: z.string().max(40), filterKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/) }).strict() }),
  def({ name: "latency.measured", family: "CHAT", emitter: "CLIENT", authority: "Navegador", purpose: "Latência percebida até o primeiro texto ou o primeiro áudio da INIA, com desfecho.", moment: "No primeiro fragmento recebido, na interrupção ou no tempo-limite.", correlation: "correlationId do turno", dedupe: "uma medida por (correlationId, métrica)", sensitivity: "LOW", qualifiesActivity: false, properties: z.object({ metric: z.enum(["CHAT_FIRST_TEXT", "VOICE_FIRST_AUDIO"]), ms: z.number().int().min(0).max(600_000).nullable(), outcome: z.enum(["OK", "INTERRUPTED", "TIMEOUT", "FAILED"]) }).strict() }),
  def({ name: "voice.mic_permission", family: "VOICE", emitter: "CLIENT", authority: "Navegador (API de mídia)", purpose: "Resultado do pedido de microfone.", moment: "Quando o navegador responde ao pedido.", correlation: "voiceIntentId", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: true, properties: z.object({ result: z.enum(["GRANTED", "DENIED", "UNAVAILABLE"]), voiceIntentId: voiceIntent }).strict() }),
  def({ name: "voice.connection", family: "VOICE", emitter: "CLIENT", authority: "Transporte de voz (navegador)", purpose: "Ciclo técnico da conexão de voz; reconexão mantém a mesma intenção (voiceIntentId) e nunca cria conversa.", moment: "Em cada mudança de estado do transporte.", correlation: "voiceIntentId (intenção de uso) + connectionSeq", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: false, properties: z.object({ stage: z.enum(["REQUESTED", "ESTABLISHED", "RECONNECTING", "RECONNECTED", "CLOSED", "FAILED"]), voiceIntentId: voiceIntent, reason: z.enum(["USER", "IDLE", "NETWORK", "SERVER", "PERMISSION", "UNKNOWN"]).nullable().optional() }).strict() }),
  def({ name: "voice.mic_span", family: "VOICE", emitter: "CLIENT", authority: "Transporte de voz", purpose: "Intervalo com microfone ativo. Microfone aberto NÃO é fala.", moment: "Ao desligar o microfone (ou no heartbeat de 15 s enquanto ligado).", correlation: "voiceIntentId", dedupe: "intervalos unidos por pessoa", sensitivity: "LOW", qualifiesActivity: false, properties: z.object({ spanStart: isoInstant, spanEnd: isoInstant, voiceIntentId: voiceIntent }).strict() }),
  def({ name: "voice.playback", family: "VOICE", emitter: "CLIENT", authority: "Reprodução no navegador", purpose: "Reprodução da fala da INIA (conversa, apresentação de feedback ou recado), com interrupção.", moment: "No início real do áudio e no fim/interrupção (com o intervalo efetivamente tocado).", correlation: "voiceIntentId ou correlationId", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: false, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "WORKFLOW_OUTPUT"], properties: z.object({ stage: z.enum(["STARTED", "COMPLETED", "INTERRUPTED", "FAILED"]), context: z.enum(["CONVERSATION", "FEEDBACK_PRESENTATION", "RECADO"]), spanStart: isoInstant.nullable().optional(), spanEnd: isoInstant.nullable().optional(), voiceIntentId: voiceIntent.nullable().optional() }).strict() }),
  def({ name: "voice.mode_changed", family: "VOICE", emitter: "CLIENT", authority: "Navegador", purpose: "Mudança de modo (silenciar, microfone, câmera).", moment: "Na mudança.", correlation: "voiceIntentId quando houver", dedupe: "eventId", sensitivity: "LOW", qualifiesActivity: true, properties: z.object({ mode: z.enum(["MUTED", "UNMUTED", "MIC_ON", "MIC_OFF", "CAMERA_ON", "CAMERA_OFF"]) }).strict() }),

  // ------------------------------------------------------------------ servidor (após o fato de negócio responder 2xx)
  def({ name: "auth.login_succeeded", family: "AUTH", emitter: "SERVER", authority: "Servidor (login aceito)", purpose: "Login bem-sucedido. last_login_at continua só o último.", moment: "Depois de a sessão ser emitida.", correlation: "conta", dedupe: "eventId do servidor", sensitivity: "MEDIUM", qualifiesActivity: false, properties: empty }),
  def({ name: "auth.logout", family: "AUTH", emitter: "SERVER", authority: "Servidor", purpose: "Logout explícito — encerra a sessão de uso.", moment: "Na chamada de logout com sessão válida.", correlation: "conta", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, properties: empty }),
  def({ name: "voice.session_issued", family: "VOICE", emitter: "SERVER", authority: "Servidor (token de voz emitido)", purpose: "Pedido de conexão de voz aceito pelo servidor.", moment: "Depois de emitir a sessão efêmera.", correlation: "conta", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, properties: z.object({ context: z.enum(["GENERAL", "FEEDBACK_APPLICATION"]) }).strict() }),
  def({ name: "feedback_application.lifecycle", family: "APPLICATION", emitter: "SERVER", authority: "Servidor (aplicação)", purpose: "Início, retomada, abertura e pausa da aplicação — a tabela oficial guarda só o último estado.", moment: "Depois de a operação responder 2xx.", correlation: "fonte do feedback (entidade) + applicationId", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"], properties: z.object({ stage: z.enum(["STARTED", "RESUMED", "OPENED", "PAUSED"]), applicationId: z.string().uuid().nullable() }).strict() }),
  def({ name: "feedback_application.presentation", family: "APPLICATION", emitter: "SERVER", authority: "Servidor (fatos do áudio informados pela sessão)", purpose: "Apresentação por áudio iniciada, concluída, interrompida ou com falha — histórico (a tabela guarda o último).", moment: "Depois de a operação responder 2xx.", correlation: "applicationId", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"], properties: z.object({ stage: z.enum(["STARTED", "COMPLETED", "INTERRUPTED", "FAILED"]), applicationId: z.string().uuid() }).strict() }),
  def({ name: "feedback_application.invite", family: "APPLICATION", emitter: "SERVER", authority: "Servidor (convite)", purpose: "Convite oferecido, aceito, lido ou adiado.", moment: "Depois de a operação responder 2xx.", correlation: "fonte do feedback (entidade)", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, entityTypes: ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"], properties: z.object({ decision: z.enum(["OFFER", "ACCEPT", "READ", "SNOOZE"]) }).strict() }),
  def({ name: "notification.read", family: "NOTIFICATION", emitter: "SERVER", authority: "Servidor (alerts.read_at)", purpose: "Notificação marcada como lida (uma ou todas).", moment: "Depois de a operação responder 2xx.", correlation: "alerta (ou todos)", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, entityTypes: ["ALERT"], properties: z.object({ scope: z.enum(["ONE", "ALL"]) }).strict() }),
  def({ name: "usability.export", family: "EXPORT", emitter: "SERVER", authority: "Servidor (monitoria)", purpose: "Exportação CSV da monitoria concluída ou recusada.", moment: "Depois de gerar (ou falhar) o arquivo.", correlation: "aba + recorte", dedupe: "eventId do servidor", sensitivity: "LOW", qualifiesActivity: false, properties: z.object({ stage: z.enum(["COMPLETED", "FAILED"]), tab: z.string().max(40), rows: z.number().int().min(0).nullable() }).strict() }),
]

export const EVENT_BY_NAME: ReadonlyMap<string, UsageEventDefinition> = new Map(USAGE_EVENTS.map((event) => [event.name, event]))
export const CLIENT_EVENT_NAMES = USAGE_EVENTS.filter((event) => event.emitter === "CLIENT").map((event) => event.name)

/** Funcionalidade de cada ação de interface (ranking de funcionalidades: ações concluídas e falhas). */
export const ACTION_FEATURE: Record<(typeof USAGE_ACTIONS)[number], string> = {
  "chat.send_message": "chat",
  "feedback.rate": "feedback_rating",
  "feedback.confirm_reading": "feedback_read_confirmation",
  "feedback.start_application": "feedback_application",
  "workflow.manual_run": "workflow_manual_run",
  "material.download": "support_materials",
  "profile.save": "profile_edit",
  "usability.export": "export",
}
