import "dotenv/config"
import { z } from "zod"

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  /** Endereço em que a API escuta. Vazio = todas as interfaces; atrás do IIS/proxy, 127.0.0.1 (só a própria máquina). */
  HOST: z.string().trim().min(1).optional(),
  /** BANCO INTERNO da INIA (não confundir com os bancos EXTERNOS que a Central de Dados lê). Sem usuário na URL = usuário do sistema operacional. */
  DATABASE_URL: z.string().default("postgresql://localhost:5432/inia"),
  TEST_DATABASE_URL: z.string().default("postgresql://localhost:5432/inia_test"),
  /** Conexões do pool do Postgres por processo — dimensionado para o worker de Workflow + API ao mesmo tempo. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  /**
   * Matrículas de Workflow executadas AO MESMO TEMPO por processo (workflow-worker.ts). Um workflow sozinho ocupa no
   * máximo metade das vagas. O teto real costuma ser o limite de requisições do provedor de IA, não a CPU.
   */
  WORKFLOW_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  /**
   * Papel do processo (main/server.ts): `all` (padrão) = API + processamento num processo só, como sempre; `api` = só HTTP;
   * `worker` = só o processamento (motor de Workflow + tarefas periódicas), com um /health mínimo. Também por `--role=`.
   */
  INIA_PROCESS_ROLE: z.enum(["all", "api", "worker"]).default("all"),
  /** /health do processo `worker` (só 127.0.0.1 por padrão — ver WORKER_HEALTH_HOST). 0 = não abre porta. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3334),
  WORKER_HEALTH_HOST: z.string().trim().min(1).default("127.0.0.1"),
  /**
   * Limitador de chamadas de IA (model-routing/ai-call-limiter.ts) — por processo. ON (padrão): no máximo
   * INIA_AI_MAX_CONCURRENT_CALLS chamadas ao provedor ao mesmo tempo, das quais INIA_AI_RESERVED_INTERACTIVE_CALLS só para o
   * chat/voz/telas (o lote de Workflow nunca as ocupa); 429/503 no lote = backoff com Retry-After. OFF = sai direto, como antes.
   */
  INIA_AI_LIMITER: z.enum(["ON", "OFF"]).default("ON"),
  INIA_AI_MAX_CONCURRENT_CALLS: z.coerce.number().int().min(2).max(512).default(16),
  INIA_AI_RESERVED_INTERACTIVE_CALLS: z.coerce.number().int().min(1).max(511).default(4),
  INIA_AI_INTERACTIVE_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(20_000),
  INIA_AI_BATCH_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  INIA_AI_BATCH_BACKOFF_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  INIA_AI_BATCH_BACKOFF_MAX_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),
  GEMINI_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().default("inia-dev-secret-change-me"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  /** Validade da senha temporária gerada ao habilitar o acesso (ou ao gerar uma nova) — depois disso ela não entra mais. */
  TEMPORARY_PASSWORD_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  /**
   * Chave de cifra (AES-256-GCM) dos segredos da Central de Dados — FORA do banco. Em produção é
   * obrigatória (32 bytes em hex/base64); em desenvolvimento/teste cai num valor fixo documentado
   * para o ambiente subir sem configuração extra (nunca use esse fallback com dados reais).
   */
  DATA_HUB_SECRET_KEY: z.string().optional(),
  /** Retenção dos objetos brutos (arquivos/payloads) em dias — metadados do Run ficam para sempre. */
  DATA_HUB_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Token Budget da investigação (V1.1): limiares de AVISO por execução (nunca teto cego). 0 desliga o limiar. */
  INVESTIGATION_TOKEN_WARNING_TOTAL: z.coerce.number().int().min(0).default(60_000),
  INVESTIGATION_TOKEN_WARNING_INPUT: z.coerce.number().int().min(0).default(50_000),
  INVESTIGATION_TOKEN_WARNING_OUTPUT: z.coerce.number().int().min(0).default(8_000),
  /** Model routing (V1.2): CURRENT = rotas da V1.1 (padrão); EFFICIENCY = planejamento no BASIC, análise/síntese no STANDARD/DEEP. */
  INIA_MODEL_ROUTING: z.enum(["CURRENT", "EFFICIENCY"]).default("CURRENT"),
  /** Perfis de modelo (JSON) que sobrescrevem/acrescentam os padrões — ver model-routing/model-registry.ts. */
  INIA_MODEL_PROFILES: z.string().optional(),
  /** Preços por perfil de modelo (JSON) — só para CUSTO ESTIMADO (V1.3); ausente = NOT_CONFIGURED. Ver model-routing/model-pricing.ts. */
  INIA_MODEL_PRICING: z.string().optional(),
  /** Prompt por fase (V1.3): CURRENT = composição da V1.2 (braço de controle do A/B); COMPACT = componentes por fase, estático × dinâmico separados — padrão após o A/B POC_V13 (mesma qualidade, −55% de prompt estático). */
  INIA_PROMPT_PROFILE: z.enum(["CURRENT", "COMPACT"]).default("COMPACT"),
  /** Declaração das Tools ao modelo (V1.3): FULL = catálogo integral; COMPACT = declaração model-facing enxuta (validação continua no catálogo/Zod) — padrão após o A/B (−42% de schema, mesma seleção de Tools, zero argumento inválido). */
  INIA_TOOL_SCHEMA: z.enum(["FULL", "COMPACT"]).default("COMPACT"),
  /** Prompt cache explícito do provider (V1.3): NONE = só o implícito do provider (padrão — no A/B o braço EXPLICIT recomendou menos materiais de apoio, 1/6 × 4/6; não adotado até A/B maior); EXPLICIT = prefixo estático em cache nomeado (adapter). */
  INIA_PROMPT_CACHE: z.enum(["NONE", "EXPLICIT"]).default("NONE"),
  INIA_PROMPT_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1_800),
  /** Sidecar needKind (V1.4.8f): anota a INTENÇÃO de cada CustomerNeed (ACTION/INFORMATION/MIXED/UNKNOWN) numa chamada própria depois da Fase A. OFF (padrão) = nenhuma chamada extra, comportamento idêntico ao anterior. Feasibility: G-NK1 (784fe37). */
  INIA_NEED_KIND_SIDECAR: z.enum(["OFF", "ON"]).default("OFF"),
  // V1.5.0 — pipeline controlado do InteractionFeedback (Writer → validação → Revisão humana → persistência). OFF = nada roda.
  INIA_INTERACTION_FEEDBACK_PIPELINE: z.enum(["OFF", "ON"]).default("OFF"),
  // V1.5.9 — política de entrega do feedback de interação. PILOT_V1 (padrão) = 100% HOLD_FOR_QA; AUTONOMOUS_V1 = QA só por
  // exceção com motivo estruturado. Nunca muda por omissão: trocar exige configurar explicitamente.
  INIA_FEEDBACK_DELIVERY_POLICY: z.enum(["PILOT_V1", "AUTONOMOUS_V1"]).default("PILOT_V1"),
  // Recado do avatar (Workflow Output → Avatar): texto EXATO sintetizado pelo TTS do Gemini — o mesmo tipo de voz do Live, sem
  // o modelo reescrever nada. Voz vazia = "Puck" no TTS e a voz padrão no Live (nada muda no Live); definida = a MESMA nos dois.
  INIA_AVATAR_TTS_MODEL: z.string().trim().min(1).default("gemini-3.8-flash-lite-tts"),
  /** Voz da INIA (Live + recado do avatar); ausente = DEFAULT_INIA_VOICE em config/inia-voice.ts. */
  INIA_AVATAR_VOICE: z.string().trim().min(1).optional(),
  // Monitoria de usabilidade — COLETA (ingestão do navegador, fatos de servidor e projeções) e PAINEL (Administração) ligam
  // separados, para ativar aos poucos. OFF (padrão) = nada é coletado / a área não é montada; o produto funciona igual.
  INIA_USAGE_COLLECTION: z.enum(["OFF", "ON"]).default("OFF"),
  INIA_USABILITY_PANEL: z.enum(["OFF", "ON"]).default("OFF"),
  /** Ambiente que carimba os eventos de uso (padrão = NODE_ENV). */
  INIA_ENVIRONMENT: z.string().trim().min(1).max(40).optional(),
  // Segurança HTTP — ver docs/security/configuracao-segura.md.
  /**
   * Atributo Secure do cookie de sessão. `auto` (padrão) = só com NODE_ENV=production. `false` existe para a instalação em
   * HTTP de rede interna rodar em modo produção (em HTTP o navegador descarta um cookie Secure); `true` força o atributo.
   */
  SESSION_COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  /**
   * De quem a API aceita X-Forwarded-For para saber o IP do cliente (limites de tentativas). Sintaxe do `trust proxy` do
   * Express: `loopback` (padrão — IIS/proxy na própria máquina), lista de IPs/sub-redes (`10.0.0.5, 10.1.0.0/16`) ou `false`
   * (nenhum: vale o IP da conexão). Nunca `true`: qualquer cliente forjaria o próprio IP.
   */
  TRUST_PROXY: z.string().trim().min(1).default("loopback").refine((value) => value.toLowerCase() !== "true", "TRUST_PROXY=true confiaria em qualquer cliente; informe os proxies (ex.: loopback)."),
  /** Tentativas de login por IP a cada 5 minutos (além da trava por e-mail). 0 desliga este limite. */
  LOGIN_RATE_LIMIT_PER_IP: z.coerce.number().int().min(0).max(100_000).default(30),
  /**
   * Destinos de saída das integrações configuradas na tela (Central de Dados, provedores de IA) — ver
   * shared/infrastructure/outbound-destination-policy.ts. OPEN (padrão) = qualquer destino, exceto metadados de nuvem,
   * link-local, o banco interno e (em produção) a própria máquina; ALLOWLIST = só INIA_OUTBOUND_ALLOWED_DESTINATIONS.
   */
  INIA_OUTBOUND_MODE: z.enum(["OPEN", "ALLOWLIST"]).default("OPEN"),
  /** `host`, `*.dominio`, IP ou CIDR, com `:porta` opcional, separados por vírgula (ex.: `10.20.0.0/16, 127.0.0.1:11434`). */
  INIA_OUTBOUND_ALLOWED_DESTINATIONS: z.string().trim().max(4000).optional(),
})

const parsed = envSchema.parse(process.env)

if (parsed.NODE_ENV === "production" && parsed.JWT_SECRET === "inia-dev-secret-change-me") {
  throw new Error("JWT_SECRET é obrigatória em produção (npm run env:init gera um valor aleatório).")
}

// HMAC-SHA256: um segredo curto vira alvo de força bruta offline a partir de qualquer cookie de sessão.
if (parsed.NODE_ENV === "production" && parsed.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET precisa ter pelo menos 32 caracteres em produção (npm run env:init gera um valor aleatório).")
}

if (parsed.NODE_ENV === "production" && !parsed.DATA_HUB_SECRET_KEY) {
  throw new Error("DATA_HUB_SECRET_KEY é obrigatória em produção (chave de cifra dos segredos da Central de Dados).")
}

/** Origens do navegador autorizadas (CORS e conferência de origem das escritas com cookie): CORS_ORIGIN aceita lista separada por vírgula. */
export function parseAllowedOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter((origin) => origin.length > 0)
}

export const env = {
  ...parsed,
  activeDatabaseUrl:
    parsed.NODE_ENV === "test" ? parsed.TEST_DATABASE_URL : parsed.DATABASE_URL,
  allowedOrigins: parseAllowedOrigins(parsed.CORS_ORIGIN),
  sessionCookieSecure: parsed.SESSION_COOKIE_SECURE === "auto" ? parsed.NODE_ENV === "production" : parsed.SESSION_COOKIE_SECURE === "true",
}
