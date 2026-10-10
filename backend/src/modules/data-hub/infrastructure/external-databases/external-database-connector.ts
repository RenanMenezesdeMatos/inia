import { outboundPolicy } from "../../../../config/outbound-policy.js"
import { assertOutboundDestination, OutboundDestinationDenied } from "../../../../shared/infrastructure/outbound-destination-policy.js"
import type { ResolvedDatabaseConnection } from "../../domain/database/database-engine.js"
import type { ExternalDatabaseConnector, ExternalDatabaseSession } from "../../application/ports.js"
import { DataRunError } from "../../domain/error-codes.js"
import { openMySqlSession } from "./mysql-session.js"
import { openPostgresSession } from "./postgres-session.js"
import { openSqlServerSession } from "./sqlserver-session.js"

/** Adaptadores reais por banco externo (somente leitura). Os drivers só são carregados aqui. */
export class DriverExternalDatabaseConnector implements ExternalDatabaseConnector {
  async open(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession> {
    // Política de saída (SSRF): nunca o banco interno da INIA, metadados de nuvem ou, em produção, a própria máquina.
    try {
      // Instância nomeada do SQL Server (porta descoberta pelo SQL Browser): confere o host na porta padrão.
      await assertOutboundDestination(outboundPolicy, connection.host, connection.port ?? 1433)
    } catch (error) {
      if (error instanceof OutboundDestinationDenied) throw new DataRunError("DATA_SOURCE_DESTINATION_DENIED", error.message)
      throw error
    }
    switch (connection.engine) {
      case "POSTGRESQL":
        return openPostgresSession(connection)
      case "SQLSERVER":
        return openSqlServerSession(connection)
      case "MARIADB":
      case "MYSQL":
        return openMySqlSession(connection)
    }
  }
}
