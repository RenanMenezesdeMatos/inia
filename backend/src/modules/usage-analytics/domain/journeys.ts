/**
 * JORNADAS (funis) e SINAIS DE DIFICULDADE — configurados em código, versionados e documentados. Um funil sempre correlaciona
 * a MESMA entidade em todas as etapas (a etapa 1 de um feedback nunca completa a etapa 2 de outro); a coorte entra pelo
 * período filtrado e é acompanhada pela janela de conversão; janela ainda aberta = pendente (não é desistência).
 * Sinais são HEURÍSTICAS OBSERVACIONAIS: contagem + base + comparação + cobertura — nunca diagnóstico de intenção, nunca
 * score individual de produtividade, nunca notificação automática.
 */
export const FUNNEL_DEFINITION_VERSION = "USAGE_FUNNELS_V1"

export type FunnelStep = { key: string; label: string; source: string }
export type FunnelDefinition = { key: string; label: string; correlation: string; windowLabel: string; steps: readonly FunnelStep[] }

export const FUNNELS: readonly FunnelDefinition[] = [
  {
    key: "ENTRY_TO_RATING",
    label: "Entrada → Acompanhamento → feedback aberto → avaliação",
    correlation: "Sessão de uso; nas duas últimas etapas, o MESMO feedback aberto naquela sessão",
    windowLabel: "Etapas 1–3 dentro da sessão; avaliação do mesmo feedback em até N dias",
    steps: [
      { key: "SESSION", label: "Entrada (sessão iniciada)", source: "Sessões derivadas" },
      { key: "FOLLOWUP", label: "Acompanhamento visto", source: "screen.viewed (Acompanhamento)" },
      { key: "OPENED", label: "Feedback aberto", source: "screen.viewed (feedback aberto pelo destinatário)" },
      { key: "RATED", label: "Mesmo feedback avaliado", source: "feedback_ratings (oficial)" },
    ],
  },
  {
    key: "FEEDBACK_ACK",
    label: "Feedback disponível → exposição → abertura → ciência",
    correlation: "Fonte × destinatário",
    windowLabel: "N dias após a entrega",
    steps: [
      { key: "AVAILABLE", label: "Disponibilizado", source: "Publicação/entrega oficial" },
      { key: "EXPOSED", label: "Exposto", source: "element.exposed (card) ou abertura" },
      { key: "OPENED", label: "Aberto", source: "screen.viewed (feedback)" },
      { key: "ACKED", label: "Ciência confirmada", source: "acknowledged_at (oficial)" },
    ],
  },
  {
    key: "INVITE_TO_ACK",
    label: "Convite da INIA → aceite → aplicação → interação → ciência",
    correlation: "Fonte do feedback convidada",
    windowLabel: "N dias após a oferta do convite",
    steps: [
      { key: "OFFERED", label: "Convite oferecido", source: "feedback_application.invite OFFER" },
      { key: "ACCEPTED", label: "Convite aceito", source: "feedback_application.invite ACCEPT" },
      { key: "STARTED", label: "Aplicação iniciada", source: "feedback_applications.started_at" },
      { key: "INTERACTED", label: "Pergunta feita na aplicação", source: "Mensagem humana na conversa da aplicação" },
      { key: "ACKED", label: "Ciência confirmada", source: "acknowledged_at (oficial)" },
    ],
  },
  {
    key: "CHAT",
    label: "Chat aberto → entrada humana → resposta recebida",
    correlation: "Abertura do painel da INIA (instância) e o turno enviado a partir dela",
    windowLabel: "Entrada em até 30 min da abertura; resposta em até 5 min da entrada",
    steps: [
      { key: "OPENED", label: "Painel da INIA aberto", source: "screen.viewed (painel)" },
      { key: "INPUT", label: "Mensagem enviada", source: "Mensagem humana persistida" },
      { key: "ANSWERED", label: "Resposta da INIA", source: "Mensagem da INIA persistida" },
    ],
  },
  {
    key: "VOICE",
    label: "Voz solicitada → permissão → conexão → primeira fala → resposta em áudio",
    correlation: "Intenção de voz (voiceIntentId — reconexão mantém a mesma)",
    windowLabel: "Dentro da conexão",
    steps: [
      { key: "REQUESTED", label: "Voz solicitada", source: "voice.connection REQUESTED" },
      { key: "PERMISSION", label: "Microfone permitido", source: "voice.mic_permission GRANTED" },
      { key: "CONNECTED", label: "Conexão estabelecida", source: "voice.connection ESTABLISHED" },
      { key: "SPOKE", label: "Primeira fala humana", source: "Turno de voz persistido" },
      { key: "AUDIO_REPLY", label: "Resposta em áudio", source: "voice.playback STARTED (conversa)" },
    ],
  },
  {
    key: "MANUAL_WORKFLOW",
    label: "Execução manual solicitada → raiz criada → término → resultado entregue → resultado aberto",
    correlation: "Execução manual (workflow_manual_runs)",
    windowLabel: "N dias após a solicitação",
    steps: [
      { key: "REQUESTED", label: "Execução solicitada", source: "workflow_manual_runs" },
      { key: "ROOT", label: "Raiz criada", source: "workflow_enrollments.manual_run_id" },
      { key: "TERMINAL", label: "Execução terminou", source: "Estado completed/failed/dead" },
      { key: "DELIVERED", label: "Resultado entregue", source: "Emissão de feedback / saída entregue" },
      { key: "OPENED", label: "Resultado aberto", source: "Feedback aberto / recado ouvido / conversa vista" },
    ],
  },
  {
    key: "NOTIFICATION",
    label: "Notificação exposta → aberta → destino apresentado → lida",
    correlation: "Notificação (alerta)",
    windowLabel: "Destino em até 10 s do clique",
    steps: [
      { key: "EXPOSED", label: "Notificação exposta", source: "element.exposed (sino)" },
      { key: "OPENED", label: "Notificação aberta", source: "element.activated (sino)" },
      { key: "DESTINATION", label: "Destino apresentado", source: "screen.viewed na mesma aba em até 10 s" },
      { key: "READ", label: "Marcada como lida", source: "alerts.read_at (oficial)" },
    ],
  },
]

export const DIFFICULTY_RULES = {
  version: "USAGE_DIFFICULTY_V1",
  rageClick: { activations: 3, windowMs: 2_000 },
  actionOutcomeWindowMinutes: 5,
  retryWindowMinutes: 10,
  lowUtility: { minRatings: 5, downShare: 50 },
  usageDrop: { minBase: 5, dropPercent: 30 },
  voiceFailure: { minIntents: 5, failurePercent: 20 },
  notificationDestinationSeconds: 10,
} as const

export const DIFFICULTY_SIGNAL_LABELS: Record<string, string> = {
  RAGE_CLICK: "Possíveis cliques repetitivos",
  NO_RESULT: "Possível ação sem retorno",
  ACTION_ERRORS: "Erros funcionais por ação",
  VALIDATION_ERRORS: "Validações recusadas",
  REPEATED_ATTEMPTS: "Tentativas repetidas até conseguir",
  EMPTY_SEARCH: "Buscas sem resultado",
  UNFINISHED_OPERATIONS: "Operações iniciadas sem desfecho",
  VOICE_FAILURES: "Concentração de falhas de voz",
  LOW_UTILITY: "Baixa utilidade nas avaliações",
  USAGE_DROP: "Queda de uso",
  REVIEW_WAIT: "Espera da revisão humana",
}
