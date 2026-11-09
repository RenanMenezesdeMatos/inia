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
   * Limites de sessão do pool no SERVIDOR (infrastructure/database/session-limits.ts) — migrations, seeds, scripts e testes
   * não os recebem. 0 = sem limite. Espera por uma conexão livre do pool (pool esgotado = erro, nunca espera infinita).
   */
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).default(10_000),
  /** Duração máxima de um comando no processo `api` (telas, chat, admin). */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(30_000),
  /** Duração máxima de um comando nos processos `worker` e `all` e nas cargas da Central de Dados (mesmo quando rodam na API). */
  DATABASE_WORKER_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(300_000),
  /** Transação aberta e parada (sem comando) além disso é encerrada pelo banco — solta os bloqueios de uma transação esquecida. */
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(60_000),
  /**
   * Matrículas de Workflow executadas AO MESMO TEMPO por processo (workflow-worker.ts). Um workflow sozinho ocupa no
   * máximo metade das vagas. O teto real costuma ser o limite de requisições do provedor de IA, não a CPU.
   */
  WORKFLOW_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  /**
   * Quantas vezes o MESMO nó que chama a IA ("Chamar agente", "Gerar feedback", Orquestrador…) roda numa execução de Workflow.
   * Passou disso (um ciclo que volta ao nó), a execução é encerrada sem nova chamada paga. Contado no banco: vale com vários
   * workers e sobrevive a reinício (achado C06 da 4ª auditoria). Fluxo sem ciclo roda cada nó uma vez.
   */
  WORKFLOW_MAX_PAID_NODE_RUNS: z.coerce.number().int().min(1).max(50).default(5),
  /**
   * Papel do processo (main/server.ts): `all` (padrão) = API + processamento num processo só, como sempre; `api` = só HTTP;
   * `worker` = só o processamento (motor de Workflow + tarefas periódicas), com um /health mínimo. Também por `--role=`.
   */
  INIA_PROCESS_ROLE: z.enum(["all", "api", "worker"]).default("all"),
  /**
   * Desligamento (main/process-lifecycle.ts): ao receber o sinal de parada a API deixa de estar pronta (/ready = 503) e espera
   * INIA_SHUTDOWN_DRAIN_MS para o balanceador (web farm do ARR) tirá-la, antes de parar de aceitar conexões. Padrão: 5 s em
   * produção, 0 fora dela (o `tsx watch` reinicia na hora). INIA_SHUTDOWN_TIMEOUT_MS = prazo máximo do desligamento inteiro;
   * estourou, as conexões que sobraram são cortadas e o processo sai com código 1. Fica abaixo do <stoptimeout> do serviço.
   */
  INIA_SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(120_000).optional(),
  INIA_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(25_000),
  /**
   * Métricas internas (`GET /internal/metrics` da API; `/health` do worker): só de 127.0.0.1 e nunca pelo proxy. Com este
   * token, também exigem `Authorization: Bearer <token>` (ex.: máquina compartilhada com outros serviços).
   */
  INIA_METRICS_TOKEN: z.string().trim().min(16).optional(),
  /** /health do processo `worker` (só 127.0.0.1 por padrão — ver WORKER_HEALTH_HOST). 0 = não abre porta. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3334),
  WORKER_HEALTH_HOST: z.string().trim().min(1).default("127.0.0.1"),
  /**
   * Limitador de chamadas de IA (model-routing/ai-call-limiter.ts) — por processo. ON (padrão): no máximo
   * INIA_AI_MAX_CONCURRENT_CALLS chamadas ao provedor ao mesmo tempo neste processo, das quais INIA_AI_RESERVED_INTERACTIVE_CALLS
   * só para o chat/voz/telas (o lote de Workflow nunca as ocupa); 429/503 no lote = backoff com Retry-After. O limite do
   * PROVEDOR é por conexão (vagas da conexão + pausa depois de um 429, divididas por todas as instâncias —
   * provider-call-gate.ts). OFF = sai direto, como antes.
   */
  INIA_AI_LIMITER: z.enum(["ON", "OFF"]).default("ON"),
  INIA_AI_MAX_CONCURRENT_CALLS: z.coerce.number().int().min(2).max(512).default(16),
  INIA_AI_RESERVED_INTERACTIVE_CALLS: z.coerce.number().int().min(1).max(511).default(4),
  INIA_AI_INTERACTIVE_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(20_000),
  INIA_AI_BATCH_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  INIA_AI_BATCH_BACKOFF_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  INIA_AI_BATCH_BACKOFF_MAX_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  /**
   * Endereço(s) público(s) da interface, separados por vírgula: origens do CORS e da conferência de origem das escritas com
   * cookie (CSRF). Fora de produção, ausente = http://localhost:3000; em produção é obrigatório (ver productionOriginProblems).
   */
  CORS_ORIGIN: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.string().default("info"),
  GEMINI_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().default("inia-dev-secret-change-me"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  /**
   * Sessão parada (sem interação na tela nem ação que altere algo) além disso é encerrada pelo servidor — além do prazo
   * absoluto do JWT_EXPIRES_IN. 0 desliga. Leituras automáticas da tela (sino, avisos) não contam como atividade.
   */
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
  /** Validade da senha temporária gerada ao habilitar o acesso (ou ao gerar uma nova) — depois disso ela não entra mais. */
  TEMPORARY_PASSWORD_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  /**
   * Chave de cifra (AES-256-GCM) dos segredos da Central de Dados — FORA do banco. Em produção é
   * obrigatória (32 bytes em hex/base64); em desenvolvimento/teste cai num valor fixo documentado
   * para o ambiente subir sem configuração extra (nunca use esse fallback com dados reais).
   */
  DATA_HUB_SECRET_KEY: z.string().optional(),
  /**
   * Só durante a TROCA da chave de cifra: a chave antiga, para a INIA ainda ler as credenciais gravadas com ela enquanto
   * `npm run secrets:rotate` as recifra com a nova (DATA_HUB_SECRET_KEY). Depois da rotação, tire do .env.
   */
  DATA_HUB_SECRET_KEY_PREVIOUS: z.string().optional(),
  /** Retenção dos objetos brutos (arquivos/payloads) em dias — metadados do Run ficam para sempre. */
  DATA_HUB_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * Consulta de dados da Central: limites impostos pelo servidor (`data-explorer/domain/explorer-limits.ts`, docs/dev/central-de-dados-consulta.md). O teto de cada
   * variável impede configurar "sem limite".
   */
  DATA_EXPLORER_DEFAULT_PAGE_SIZE: z.coerce.number().int().min(10).max(100).default(25),
  DATA_EXPLORER_MAX_PAGE_SIZE: z.coerce.number().int().min(25).max(200).default(100),
  DATA_EXPLORER_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(5_000),
  DATA_EXPLORER_COUNT_CAP: z.coerce.number().int().min(1_000).max(100_000).default(10_000),
  DATA_EXPLORER_EXPORT_MAX_ROWS: z.coerce.number().int().min(1_000).max(100_000).default(20_000),
  DATA_EXPLORER_EXPORT_MAX_BYTES: z.coerce.number().int().min(1_048_576).max(104_857_600).default(20_971_520),
  DATA_EXPLORER_EXPORT_MAX_DURATION_MS: z.coerce.number().int().min(10_000).max(300_000).default(60_000),
  DATA_EXPLORER_QUERIES_PER_MINUTE: z.coerce.number().int().min(1).max(300).default(30),
  DATA_EXPLORER_QUERIES_PER_MINUTE_ORGANIZATION: z.coerce.number().int().min(1).max(1_200).default(120),
  DATA_EXPLORER_EXPORTS_PER_10_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  DATA_EXPLORER_EXPORTS_PER_10_MINUTES_ORGANIZATION: z.coerce.number().int().min(1).max(200).default(15),
  DATA_EXPLORER_CANCEL_MAX_ROWS: z.coerce.number().int().min(100).max(100_000).default(10_000),
  DATA_EXPLORER_CANCELLATIONS_PER_10_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  DATA_EXPLORER_CANCELLATIONS_PER_10_MINUTES_ORGANIZATION: z.coerce.number().int().min(1).max(200).default(30),
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
  /**
   * Máscara de dados pessoais na transcrição que vai para a IA (LGPD, R-31): CPF, telefone, e-mail e protocolo viram [CPF],
   * [TELEFONE], [EMAIL], [PROTOCOLO] em TODO texto de chamada enviado a um modelo — e as citações do modelo são conferidas contra
   * o mesmo texto mascarado. O original continua no banco. ON (padrão); OFF só para comparar resultados.
   */
  INIA_MODEL_PII_MASKING: z.enum(["ON", "OFF"]).default("ON"),
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
  /**
   * Base de boas práticas — SÓ DESENVOLVIMENTO: chave de um dataset SINTÉTICO (ex.: BP_SINTETICO_V1) cujos padrões aprovados a
   * ferramenta do chat do operador usa NO LUGAR dos reais, sempre rotulados como sintéticos, para demonstrar a integração ponta a
   * ponta. Ausente (padrão) = só padrões de dados reais. Ignorado com NODE_ENV=production.
   */
  INIA_BEST_PRACTICES_CHAT_SYNTHETIC_DATASET: z.string().trim().min(1).optional(),
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
  TRUST_PROXY: z
    .string()
    .trim()
    .min(1)
    .default("loopback")
    .refine((value) => value.toLowerCase() !== "true", "TRUST_PROXY=true confiaria em qualquer cliente; informe os proxies (ex.: loopback).")
    // Rede /0 = todo endereço é "proxy confiável": o mesmo que `true` (achado AUTH-17 da auditoria de 17/10/2026).
    .refine((value) => !value.split(",").some((entry) => /\/0$/.test(entry.trim())), "TRUST_PROXY com uma rede /0 confiaria em qualquer cliente; informe os proxies (ex.: loopback ou o IP do IIS)."),
  /**
   * Tentativas de login por IP + e-mail digitado a cada 5 minutos (além da trava por e-mail: 5 falhas em 15 min). Cada pessoa
   * tem o seu contador mesmo quando centenas saem pelo mesmo IP (Citrix, VDI, NAT) na virada de turno. 0 desliga este limite.
   */
  LOGIN_RATE_LIMIT_PER_IP_EMAIL: z.coerce.number().int().min(0).max(100_000).default(20),
  /**
   * Tentativas de login RECUSADAS por IP a cada 5 minutos — contra quem testa uma senha em muitas contas a partir de um
   * endereço. Login certo não conta (a virada de turno atrás de um NAT não esgota o limite). 0 desliga este limite.
   */
  LOGIN_RATE_LIMIT_PER_IP: z.coerce.number().int().min(0).max(100_000).default(200),
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

/** Valores publicados no repositório (código e `.env.example`): conhecidos por qualquer um — nunca valem em produção. */
const PUBLISHED_SECRETS = new Set(["inia-dev-secret-change-me", "troque-por-um-valor-aleatorio-longo", "inia-dev-data-hub-secret-key-change-me"])
const distinctCharacters = (value: string) => new Set(value).size

/**
 * Segredos de produção (achado AUTH-8 da auditoria de 17/10/2026). JWT_SECRET fraco/publicado = qualquer um assina a sessão
 * de um Administrador geral: a API não sobe (trocar só encerra as sessões). DATA_HUB_SECRET_KEY fraca só AVISA: trocá-la
 * deixaria ilegíveis as credenciais já cifradas — a troca exige a recifragem descrita em docs/security/configuracao-segura.md.
 */
export function productionSecretProblems(values: Pick<z.infer<typeof envSchema>, "NODE_ENV" | "JWT_SECRET" | "DATA_HUB_SECRET_KEY">): { fatal: string[]; warnings: string[] } {
  const fatal: string[] = []
  const warnings: string[] = []
  if (values.NODE_ENV !== "production") return { fatal, warnings }
  const jwt = values.JWT_SECRET.trim()
  if (PUBLISHED_SECRETS.has(jwt) || /^(troque|change|exemplo|example)/i.test(jwt)) fatal.push("JWT_SECRET é o valor de exemplo; em produção use um valor aleatório (npm run env:init gera um).")
  // HMAC-SHA256: um segredo curto ou repetitivo vira alvo de força bruta offline a partir de qualquer cookie de sessão.
  else if (jwt.length < 32 || distinctCharacters(jwt) < 10) fatal.push("JWT_SECRET precisa ter pelo menos 32 caracteres e não ser repetitivo em produção (npm run env:init gera um valor aleatório).")
  const key = values.DATA_HUB_SECRET_KEY?.trim()
  if (!key) fatal.push("DATA_HUB_SECRET_KEY é obrigatória em produção (chave de cifra dos segredos da Central de Dados).")
  else {
    const rawKey = /^[0-9a-f]{64}$/i.test(key) || Buffer.from(key, "base64").length === 32
    if (PUBLISHED_SECRETS.has(key) || (!rawKey && (key.length < 32 || distinctCharacters(key) < 10))) {
      warnings.push("DATA_HUB_SECRET_KEY fraca (valor publicado, curto ou repetitivo): as credenciais da Central de Dados e da IA ficam com chave adivinhável. Troque seguindo docs/security/configuracao-segura.md (recifrar antes de trocar).")
    }
  }
  return { fatal, warnings }
}

/** Origens do navegador autorizadas (CORS e conferência de origem das escritas com cookie): CORS_ORIGIN aceita lista separada por vírgula. */
export function parseAllowedOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter((origin) => origin.length > 0)
}

const DEVELOPMENT_ORIGIN = "http://localhost:3000"

/**
 * Origens em produção (R-33): sem CORS_ORIGIN a API assumiria o endereço de desenvolvimento e a instalação pareceria quebrada
 * sem dizer por quê; `*` (ou um endereço que não é http/https) liberaria qualquer site. Nos dois casos a API não sobe.
 */
export function productionOriginProblems(values: Pick<z.infer<typeof envSchema>, "NODE_ENV" | "CORS_ORIGIN">): string[] {
  if (values.NODE_ENV !== "production") return []
  if (!values.CORS_ORIGIN) return ["CORS_ORIGIN é obrigatória em produção: informe o endereço público da interface (ex.: https://inia.empresa.com.br)."]
  const invalid = parseAllowedOrigins(values.CORS_ORIGIN).filter((origin) => {
    if (origin.includes("*")) return true
    try {
      const url = new URL(origin)
      return (url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== origin
    } catch {
      return true
    }
  })
  return invalid.length > 0 ? [`CORS_ORIGIN aceita só endereços completos (https://servidor[:porta]), sem curinga nem caminho: ${invalid.join(", ")}.`] : []
}

const secretProblems = productionSecretProblems(parsed)
const startupProblems = [...secretProblems.fatal, ...productionOriginProblems(parsed)]
if (startupProblems.length > 0) throw new Error(startupProblems.join(" "))
for (const warning of secretProblems.warnings) console.warn(JSON.stringify({ event: "weak_production_secret", message: warning }))

export const env = {
  ...parsed,
  activeDatabaseUrl:
    parsed.NODE_ENV === "test" ? parsed.TEST_DATABASE_URL : parsed.DATABASE_URL,
  allowedOrigins: parseAllowedOrigins(parsed.CORS_ORIGIN ?? DEVELOPMENT_ORIGIN),
  sessionIdleTimeoutMs: parsed.SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
  sessionCookieSecure: parsed.SESSION_COOKIE_SECURE === "auto" ? parsed.NODE_ENV === "production" : parsed.SESSION_COOKIE_SECURE === "true",
  shutdownDrainMs: parsed.INIA_SHUTDOWN_DRAIN_MS ?? (parsed.NODE_ENV === "production" ? 5_000 : 0),
}
