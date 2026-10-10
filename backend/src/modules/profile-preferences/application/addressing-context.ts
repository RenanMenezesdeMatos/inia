import type { Database } from "../../../infrastructure/database/pool.js"
import { renderAddressingContext } from "../domain/person-presentation.js"
import { loadPersonPresentation } from "./person-presentation-loader.js"

/**
 * Contexto de tratamento da pessoa da SESSÃO para o chat e a voz (lido do banco a cada conversa/sessão: uma preferência salva
 * vale na próxima mensagem). Falha de leitura nunca derruba a conversa: sem contexto, o modelo só não usa nome.
 */
export async function loadAddressingContext(db: Pick<Database, "query">, organizationId: string, personId: string): Promise<string> {
  try {
    return renderAddressingContext(await loadPersonPresentation(db, organizationId, personId))
  } catch (error) {
    console.error(JSON.stringify({ event: "addressing_context_failed", message: (error as Error).message }))
    return ""
  }
}
