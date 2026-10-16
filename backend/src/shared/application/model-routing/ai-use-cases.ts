import type { LlmRequestClassification } from "../llm-telemetry.js"
import type { RoutePurpose } from "./route-policy.js"

/**
 * AI USE CASES (§18–§20) — o contrato ESTÁVEL entre regra de negócio e roteador. A regra de negócio
 * pede um propósito (RoutePurpose, já existente desde a V1.2) e o roteador o traduz para um Use Case;
 * trocar Gemini → GPT → Grok → local é configuração da organização, nunca código.
 *
 * O catálogo foi derivado da AUDITORIA dos pontos reais de chamada (llm-gateway.ts + os dois
 * bypasses documentados), não de uma lista desejada: cada entrada abaixo corresponde a pelo menos
 * um `generateForRoute`/stream real. As etapas da análise semântica (extração, síntese de padrões,
 * sidecar de atribuição) chegam pelo mesmo propósito ANALYZE_INTERACTIONS e se distinguem pela tag
 * `stage:*` da classificação — é por isso que custo por etapa é visível no dashboard.
 *
 * Os requisitos são os MESMOS que `requirementsFor` (route-policy.ts) já aplica aos perfis legados
 * (+ streaming/áudio dos canais interativos) — o roteador nunca escolhe um modelo que não sustente o contrato.
 */
export const AI_USE_CASE_KEYS = [
  "INVESTIGATION_PLANNING",
  "SEMANTIC_EXTRACTION",
  "PATTERN_SYNTHESIS",
  "OUTCOME_ATTRIBUTION",
  "AGENT_RESPONSE",
  "SPECIALIST_RESPONSE",
  "ORCHESTRATOR_ROUTING",
  "ORCHESTRATOR_SYNTHESIS",
  "MANAGERIAL_SYNTHESIS",
  "FEEDBACK_WRITER",
  "FEEDBACK_ANALYSIS",
  "INTERVENTION_WRITER",
  "REPORT_ANALYST",
  "CHAT",
  "VOICE_REALTIME",
  "SPEECH_SYNTHESIS",
  "MODEL_TEST",
  "UNCLASSIFIED",
] as const
export type AiUseCaseKey = (typeof AI_USE_CASE_KEYS)[number]

export type UseCaseCapability = "STRUCTURED_OUTPUT" | "TOOLS" | "STREAMING" | "AUDIO"

export type AiUseCaseDefinition = {
  key: AiUseCaseKey
  label: string
  description: string
  group: "INVESTIGATION" | "RESPONSE" | "ORCHESTRATION" | "INTERACTIVE" | "INTERNAL"
  /** Capacidades obrigatórias — modelo sem elas nunca é selecionado (§20, §73, §74). */
  requiredCapabilities: readonly UseCaseCapability[]
  /** Capacidades desejáveis: usadas se o modelo tiver (ex.: streaming no chat), nunca bloqueiam. */
  preferredCapabilities: readonly UseCaseCapability[]
  /** false = não configurável na V1 (ex.: voz em tempo real é sessão própria do provider no navegador). */
  routable: boolean
  /** true = uso interno da própria administração (teste de modelo) — aparece no dashboard, não na tela de roteamento. */
  internal: boolean
  /** Síntese de voz: o modelo precisa de uma voz cadastrada e de um provider que leia texto em voz (`ai-speech.ts`). */
  requiresSpeechVoice?: boolean
  /** Propósitos (RoutePurpose) que chegam a este Use Case — auditoria. */
  purposes: readonly string[]
  notes?: string
}

export const AI_USE_CASES: readonly AiUseCaseDefinition[] = [
  { key: "INVESTIGATION_PLANNING", label: "Planejamento da investigação", description: "Rodadas em que o Agent escolhe quais Tools consultar (function calling) e as notas de investigação.", group: "INVESTIGATION", requiredCapabilities: ["TOOLS"], preferredCapabilities: [], routable: true, internal: false, purposes: ["PLANNING", "TOOL_ARGUMENT_GENERATION", "INVESTIGATION_NOTES"] },
  { key: "SEMANTIC_EXTRACTION", label: "Extração semântica", description: "Leitura de transcrições (frames semânticos, análise de pares) e tradução de trechos da base em regras.", group: "INVESTIGATION", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["ANALYZE_INTERACTIONS", "ANALYZE_PEER_PATTERNS"] },
  { key: "PATTERN_SYNTHESIS", label: "Síntese de padrões", description: "Promoção de findings e síntese de padrões entre interações (Fase B).", group: "INVESTIGATION", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["ANALYZE_INTERACTIONS (stage:SYNTHESIS)"] },
  { key: "OUTCOME_ATTRIBUTION", label: "Atribuição de resultado e procedimento", description: "Sidecars que anotam observações já verificadas: de quê cada necessidade depende, o significado normativo das afirmações e a intenção (needKind) de cada necessidade.", group: "INVESTIGATION", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["ANALYZE_INTERACTIONS (stage:SIDECAR)", "ANALYZE_INTERACTIONS (stage:NEED_KIND)"] },
  { key: "AGENT_RESPONSE", label: "Resposta do Agent", description: "Síntese final do Agent (feedback, resultado estruturado, texto livre) e a correção de evidência.", group: "RESPONSE", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["AGENT_SYNTHESIS", "GATING_CORRECTION", "ASSESSMENT_COVERAGE_REPAIR"] },
  { key: "SPECIALIST_RESPONSE", label: "Resposta de especialista", description: "Resposta de um especialista acionado por um Orquestrador (chat, voz ou Workflow).", group: "RESPONSE", requiredCapabilities: [], preferredCapabilities: [], routable: true, internal: false, purposes: ["SPECIALIST_SYNTHESIS", "ASSESSMENT_COVERAGE_REPAIR"], notes: "V1.7.3: o reparo único da cobertura da avaliação de processo usa a mesma rota e aparece à parte pelo propósito ASSESSMENT_COVERAGE_REPAIR (tag stage:ASSESSMENT_REPAIR)." },
  { key: "ORCHESTRATOR_ROUTING", label: "Roteamento do Orquestrador", description: "Decisão de quais especialistas acionar (function calling).", group: "ORCHESTRATION", requiredCapabilities: ["TOOLS"], preferredCapabilities: [], routable: true, internal: false, purposes: ["ORCHESTRATOR_ROUTING"] },
  { key: "ORCHESTRATOR_SYNTHESIS", label: "Síntese do Orquestrador", description: "Resposta final do Orquestrador a partir dos especialistas (chat e Workflow).", group: "ORCHESTRATION", requiredCapabilities: [], preferredCapabilities: [], routable: true, internal: false, purposes: ["ORCHESTRATOR_SYNTHESIS"] },
  { key: "MANAGERIAL_SYNTHESIS", label: "Síntese gerencial (pós-JOIN)", description: "Especialista de síntese que consolida os resultados de um fan-out de Workflow.", group: "ORCHESTRATION", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["POST_JOIN_SYNTHESIS"] },
  { key: "FEEDBACK_WRITER", label: "Redação e verificação do feedback", description: "Escreve e confere o texto do feedback: redação e verificação da mensagem do motor de feedback, redatores do feedback confiável (monitoria e indicador), narrativas de supervisor e do fechamento mensal, verificação semântica da narrativa e o redator do feedback por interação.", group: "RESPONSE", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["FEEDBACK_WRITING"], notes: "Sem policy da organização: as rotas fixas de sempre — gemini-3.8-flash na redação e verificação do motor (tags stage:ENGINE_COMPOSITION e stage:ENGINE_VERIFICATION) e na verificação semântica da narrativa (stage:NARRATIVE_FACTUALITY); gemini-3.1-flash-lite nos redatores e nas narrativas (stage:SUPERVISOR_NARRATIVE, stage:PRV_DIAGNOSIS_NARRATIVE) — sem fallback, sem escalação e zero retry onde a etapa pede. Com policy: UMA policy atende todas essas etapas, e cada uma continua mandando o schema da saída, o teto de saída e o tempo dela (piso; o do modelo só estende)." },
  { key: "FEEDBACK_ANALYSIS", label: "Diagnóstico do motor de feedback", description: "Análise de uma chamada pelo motor de feedback: cenário, procedimento aplicável da base, caminho correto × seguido e disposição por critério com evidência. A mesma análise alimenta memória, diagnóstico e feedback.", group: "INVESTIGATION", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["FEEDBACK_ANALYSIS"], notes: "Sem policy da organização: modelo fixo gemini-3.8-flash (rota do motor, sem fallback nem escalação). A redação e a verificação da mensagem usam o Use Case FEEDBACK_WRITER (tags stage:ENGINE_COMPOSITION e stage:ENGINE_VERIFICATION)." },
  { key: "INTERVENTION_WRITER", label: "Relatório e rascunho de intervenção", description: "Narrativa do relatório de inteligência de uma avaliação de política de acompanhamento e rascunho de treinamento ou plano de ação — sempre a partir dos fatos e fontes já verificados, citando cada um; nunca muda o resultado das regras.", group: "RESPONSE", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, purposes: ["INTERVENTION_WRITING"], notes: "Etapas pela tag stage:REPORT_NARRATIVE e stage:INTERVENTION_DRAFT. Falha nunca apaga o fundamento estruturado: fica registrada e pode ser tentada de novo." },
  { key: "REPORT_ANALYST", label: "Análise de report recorrente", description: "Resumo e comparação de cada entrega de um report recorrente — a IA interpreta a tabela, os destaques e a comparação já calculados pela aplicação; nunca calcula nem inventa número.", group: "RESPONSE", requiredCapabilities: [], preferredCapabilities: [], routable: true, internal: false, purposes: ["REPORT_ANALYSIS"], notes: "Falha da IA preserva a entrega (dados válidos) com \"análise indisponível\"; o worker tenta de novo sem duplicar a entrega." },
  { key: "CHAT", label: "Chat de texto", description: "Resposta do chat quando não há Orquestrador ativo (streaming).", group: "INTERACTIVE", requiredCapabilities: [], preferredCapabilities: ["STREAMING"], routable: true, internal: false, purposes: ["CHAT_STREAM"] },
  { key: "VOICE_REALTIME", label: "Voz em tempo real", description: "Sessão de voz do avatar (sessão própria do provider no navegador).", group: "INTERACTIVE", requiredCapabilities: ["AUDIO", "STREAMING"], preferredCapabilities: [], routable: false, internal: false, purposes: ["VOICE_SESSION"], notes: "V1: usa a configuração legada por ambiente; o uso aparece no dashboard (sessão iniciada, tokens não informados)." },
  { key: "SPEECH_SYNTHESIS", label: "Voz do recado do avatar", description: "Síntese de voz (TTS) do texto EXATO do recado de um Workflow para o avatar e do \"Ouvir com a INIA\" — nada é reescrito pelo modelo; o áudio fica em cache por entrega.", group: "INTERACTIVE", requiredCapabilities: ["AUDIO"], preferredCapabilities: [], routable: true, internal: false, requiresSpeechVoice: true, purposes: ["SPEECH_SYNTHESIS"], notes: "Sem policy da organização: a voz da conversa (Gemini Live no servidor, conferida pela transcrição) com o TTS do Gemini como reserva (INIA_AVATAR_TTS_MODEL) e a voz da INIA (config/inia-voice.ts). Com policy: o modelo da policy lê o texto exato com a voz e a instrução de tom cadastradas NO MODELO (hoje: OpenAI e compatíveis, /v1/audio/speech em PCM 24 kHz). A conversa por voz continua no Gemini — o recado pode ficar com voz diferente da conversa." },
  { key: "MODEL_TEST", label: "Teste de modelo (admin)", description: "Requisição mínima disparada pelo botão \"Testar modelo\".", group: "INTERNAL", requiredCapabilities: [], preferredCapabilities: [], routable: false, internal: true, purposes: [] },
  { key: "UNCLASSIFIED", label: "Não classificado", description: "Chamada com propósito sem mapeamento (rota montada fora do roteador). Nunca roteável: segue a configuração legada, mas o uso e o orçamento global continuam valendo.", group: "INTERNAL", requiredCapabilities: [], preferredCapabilities: [], routable: false, internal: true, purposes: [] },
]

export function findUseCase(key: string): AiUseCaseDefinition | null {
  return AI_USE_CASES.find((useCase) => useCase.key === key) ?? null
}

/** Etapa da análise semântica anunciada pela classificação (`stage:EXTRACTION|SYNTHESIS|SIDECAR|NEED_KIND`). */
function semanticStage(classification: LlmRequestClassification | undefined): string | null {
  const tag = classification?.tags?.find((item) => item.startsWith("stage:"))
  return tag ? tag.slice("stage:".length) : null
}

/**
 * Propósito da rota (+ classificação) → Use Case. Determinístico; todo RoutePurpose tem mapeamento
 * (teste cobre). null = propósito desconhecido (rota montada à mão) → o gateway segue pelo legado,
 * nunca por uma policy escolhida por palpite.
 */
export function useCaseForPurpose(purpose: RoutePurpose | string, classification?: LlmRequestClassification): AiUseCaseKey | null {
  switch (purpose) {
    case "PLANNING":
    case "TOOL_ARGUMENT_GENERATION":
    case "INVESTIGATION_NOTES":
      return "INVESTIGATION_PLANNING"
    case "ANALYZE_INTERACTIONS": {
      const stage = semanticStage(classification)
      return stage === "SYNTHESIS" ? "PATTERN_SYNTHESIS" : stage === "SIDECAR" || stage === "NEED_KIND" ? "OUTCOME_ATTRIBUTION" : "SEMANTIC_EXTRACTION"
    }
    case "ANALYZE_PEER_PATTERNS":
      return "SEMANTIC_EXTRACTION"
    case "AGENT_SYNTHESIS":
      return "AGENT_RESPONSE"
    case "SPECIALIST_SYNTHESIS":
      return "SPECIALIST_RESPONSE"
    case "ORCHESTRATOR_ROUTING":
      return "ORCHESTRATOR_ROUTING"
    case "ORCHESTRATOR_SYNTHESIS":
      return "ORCHESTRATOR_SYNTHESIS"
    case "POST_JOIN_SYNTHESIS":
      return "MANAGERIAL_SYNTHESIS"
    case "FEEDBACK_WRITING":
      return "FEEDBACK_WRITER"
    case "FEEDBACK_ANALYSIS":
      return "FEEDBACK_ANALYSIS"
    case "INTERVENTION_WRITING":
      return "INTERVENTION_WRITER"
    case "REPORT_ANALYSIS":
      return "REPORT_ANALYST"
    case "GATING_CORRECTION":
      return classification?.source === "SPECIALIST" ? "SPECIALIST_RESPONSE" : classification?.source === "ORCHESTRATOR" || classification?.source === "WORKFLOW_ORCHESTRATOR" ? "ORCHESTRATOR_SYNTHESIS" : "AGENT_RESPONSE"
    case "CHAT_STREAM":
      return "CHAT"
    case "VOICE_SESSION":
      return "VOICE_REALTIME"
    case "SPEECH_SYNTHESIS":
      return "SPEECH_SYNTHESIS"
    case "MODEL_TEST":
      return "MODEL_TEST"
    default:
      return null
  }
}
