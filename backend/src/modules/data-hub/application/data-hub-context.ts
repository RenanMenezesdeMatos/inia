import pino from "pino"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { FetchHttpClient } from "../infrastructure/fetch-http-client.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"
import { PgRawObjectStore } from "../infrastructure/pg-raw-object-store.js"
import { Ssh2SftpClient } from "../infrastructure/ssh2-sftp-client.js"
import { DriverExternalDatabaseConnector } from "../infrastructure/external-databases/external-database-connector.js"
import { systemClock, type Clock, type ExternalDatabaseConnector, type HttpClient, type RawObjectStore, type SecretStore, type SftpClient } from "./ports.js"

/**
 * Contexto da Central de Dados: banco + ports. Produção monta com os adaptadores reais; os
 * testes injetam fakes (mock HTTP, SFTP em memória, secret store em memória).
 *
 * Logger: estruturado (pino) e SEMPRE com campos de identificação (sourceId, feedId, runId,
 * contract, status, counts) — nunca payload nem segredo. Quem chama passa só metadados.
 */
export type DataHubLogger = Pick<pino.Logger, "info" | "warn" | "error" | "debug">

export type DataHubContext = {
  db: Database
  secrets: SecretStore
  rawObjects: RawObjectStore
  http: HttpClient
  sftp: SftpClient
  /** Bancos externos do cliente (somente leitura). */
  databases: ExternalDatabaseConnector
  clock: Clock
  logger: DataHubLogger
}

export function createDataHubContext(db: Database, overrides: Partial<Omit<DataHubContext, "db">> = {}): DataHubContext {
  return {
    db,
    secrets: overrides.secrets ?? new PgAesSecretStore(db),
    rawObjects: overrides.rawObjects ?? new PgRawObjectStore(db),
    http: overrides.http ?? new FetchHttpClient(),
    sftp: overrides.sftp ?? new Ssh2SftpClient(),
    databases: overrides.databases ?? new DriverExternalDatabaseConnector(),
    clock: overrides.clock ?? systemClock,
    logger: overrides.logger ?? pino({ level: env.LOG_LEVEL, name: "data-hub", enabled: env.NODE_ENV !== "test" }),
  }
}
