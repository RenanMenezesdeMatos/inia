import { z } from "zod"

/**
 * BANCOS EXTERNOS — bancos de dados do CLIENTE que a INIA só LÊ (nunca o banco interno da INIA, que é o
 * `DATABASE_URL` do backend). Esta é a configuração NÃO secreta da conexão; a senha vive cifrada em
 * `data_secrets` (purpose DATABASE_PASSWORD) e só o adaptador a lê.
 *
 * Só entram aqui os bancos com adaptador real E validação contra um servidor de verdade (prova
 * `external-database-proof`). Acrescentar um banco = adaptador + dialeto + prova, nunca só um rótulo.
 */
export const DATABASE_ENGINES = ["SQLSERVER", "POSTGRESQL", "MARIADB", "MYSQL"] as const
export type DatabaseEngine = (typeof DATABASE_ENGINES)[number]

export const DATABASE_ENGINE_LABELS: Record<DatabaseEngine, string> = {
  SQLSERVER: "SQL Server",
  POSTGRESQL: "PostgreSQL",
  MARIADB: "MariaDB",
  MYSQL: "MySQL",
}

export const DEFAULT_DATABASE_PORTS: Record<DatabaseEngine, number> = { SQLSERVER: 1433, POSTGRESQL: 5432, MARIADB: 3306, MYSQL: 3306 }

/**
 * Criptografia da conexão (TLS):
 *  - DISABLED: sem TLS (rede privada/confiável).
 *  - PREFERRED: tenta TLS sem validar o certificado e, se o servidor não oferecer TLS, conecta sem — o padrão dos
 *    clientes nativos do PostgreSQL (libpq `prefer`) e do MySQL/MariaDB. Não existe no SQL Server.
 *  - REQUIRED: exige TLS, sem validar o certificado (cifra o tráfego; não prova a identidade do servidor). Padrão
 *    do SQL Server, que sempre oferece TLS com certificado próprio.
 *  - VERIFY_FULL: exige TLS e valida a cadeia do certificado e o nome do servidor (com CA própria opcional).
 */
export const DATABASE_TLS_MODES = ["DISABLED", "PREFERRED", "REQUIRED", "VERIFY_FULL"] as const
export type DatabaseTlsMode = (typeof DATABASE_TLS_MODES)[number]

export const DATABASE_TLS_LABELS: Record<DatabaseTlsMode, string> = {
  DISABLED: "Desligada",
  PREFERRED: "Usar quando o servidor oferecer",
  REQUIRED: "Obrigatória (sem validar certificado)",
  VERIFY_FULL: "Obrigatória e validando o certificado",
}

/**
 * Modo de uma fonte GRAVADA sem `tls` (fontes antigas): o padrão de antes, para nada mudar sem alguém escolher. Fonte NOVA sem
 * `tls` nasce em `NEW_SOURCE_TLS_MODE` (achado DATA-5 da auditoria de 17/10/2026: o padrão aceitava qualquer certificado — quem
 * intercepta a rede entre a INIA e o banco do cliente recebia a senha).
 */
export const DEFAULT_TLS_MODE: Record<DatabaseEngine, DatabaseTlsMode> = { SQLSERVER: "REQUIRED", POSTGRESQL: "PREFERRED", MARIADB: "PREFERRED", MYSQL: "PREFERRED" }
export const NEW_SOURCE_TLS_MODE: DatabaseTlsMode = "VERIFY_FULL"

export function supportedTlsModes(engine: DatabaseEngine): DatabaseTlsMode[] {
  return engine === "SQLSERVER" ? ["DISABLED", "REQUIRED", "VERIFY_FULL"] : [...DATABASE_TLS_MODES]
}

/** Nome de host/IP sem protocolo, porta, caminho nem credencial (a porta tem campo próprio). */
const hostSchema = z
  .string()
  .trim()
  .min(1, "Informe o servidor.")
  .max(255)
  .refine((value) => !/[\s/@]|:\/\//.test(value), "Informe só o nome ou IP do servidor, sem protocolo, usuário ou caminho.")
  .refine((value) => !/:\d+$/.test(value) || value.split(":").length > 2, "Informe a porta no campo Porta.")

export const databaseConfigSchema = z
  .object({
    engine: z.enum(DATABASE_ENGINES),
    host: hostSchema,
    /** Ausente = porta padrão do banco. SQL Server com instância nomeada ignora a porta (resolvida pelo SQL Browser). */
    port: z.number().int().min(1).max(65535).optional(),
    database: z.string().trim().min(1, "Informe o banco de dados.").max(128),
    username: z.string().trim().min(1, "Informe o usuário.").max(128),
    /** Só SQL Server: instância nomeada (ex.: SQLEXPRESS). */
    instanceName: z.string().trim().min(1).max(128).optional(),
    tls: z
      .object({
        mode: z.enum(DATABASE_TLS_MODES),
        /** Certificado da CA (PEM) — público, não é segredo. Só com VERIFY_FULL. */
        caCertificate: z.string().trim().min(1).max(20_000).optional(),
      })
      .optional(),
    connectTimeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
    queryTimeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  })
  .superRefine((config, issue) => {
    if (config.instanceName && config.engine !== "SQLSERVER") issue.addIssue({ code: "custom", path: ["instanceName"], message: "Instância nomeada só existe no SQL Server." })
    if (config.tls && !supportedTlsModes(config.engine).includes(config.tls.mode)) issue.addIssue({ code: "custom", path: ["tls", "mode"], message: `${DATABASE_ENGINE_LABELS[config.engine]} não aceita o modo "${DATABASE_TLS_LABELS[config.tls.mode]}".` })
    if (config.tls?.caCertificate && config.tls.mode !== "VERIFY_FULL") issue.addIssue({ code: "custom", path: ["tls", "caCertificate"], message: "O certificado da CA só é usado quando a validação do certificado está ligada." })
    if (config.tls?.caCertificate && !/-----BEGIN CERTIFICATE-----/.test(config.tls.caCertificate)) issue.addIssue({ code: "custom", path: ["tls", "caCertificate"], message: "Cole o certificado no formato PEM (-----BEGIN CERTIFICATE-----)." })
  })
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>

/** Configuração com os padrões resolvidos — o que os adaptadores recebem. */
export type ResolvedDatabaseConnection = {
  engine: DatabaseEngine
  host: string
  port: number | null
  database: string
  username: string
  password: string
  instanceName: string | null
  tlsMode: DatabaseTlsMode
  caCertificate: string | null
  connectTimeoutMs: number
  queryTimeoutMs: number
}

export function resolveDatabaseConnection(config: DatabaseConfig, password: string): ResolvedDatabaseConnection {
  const instanceName = config.engine === "SQLSERVER" ? config.instanceName ?? null : null
  return {
    engine: config.engine,
    host: config.host,
    port: instanceName ? null : config.port ?? DEFAULT_DATABASE_PORTS[config.engine],
    database: config.database,
    username: config.username,
    password,
    instanceName,
    tlsMode: config.tls?.mode ?? DEFAULT_TLS_MODE[config.engine],
    caCertificate: config.tls?.caCertificate ?? null,
    connectTimeoutMs: config.connectTimeoutMs,
    queryTimeoutMs: config.queryTimeoutMs,
  }
}

/** Texto curto para listas/auditoria — nunca a senha. */
export function describeDatabaseConnection(config: DatabaseConfig): string {
  const where = config.engine === "SQLSERVER" && config.instanceName ? `${config.host}\\${config.instanceName}` : `${config.host}:${config.port ?? DEFAULT_DATABASE_PORTS[config.engine]}`
  return `${DATABASE_ENGINE_LABELS[config.engine]} · ${where} · ${config.database}`
}
