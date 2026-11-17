import type { Database } from "../../../infrastructure/database/pool.js"
import type { CommunicationView } from "../../communications/domain/communication.js"

/**
 * Porta dos comunicados da liderança no feed do Acompanhamento (migration 199). O analytics não conhece a tabela nem a regra de
 * quem enxerga um comunicado: pede à porta o filtro SQL de visibilidade (para unir os comunicados ao feed na mesma consulta) e as
 * views dos comunicados da página. A implementação (módulo de comunicados) é ligada em
 * `performance-analytics/infrastructure/communication-notice-source.ts`.
 */
export type FollowUpNoticeSource = {
  /** Fragmento SQL "o comunicado `alias` é visível para a pessoa do parâmetro `personParam`". */
  visibleToSql(alias: string, personParam: string): string
  /** Views dos comunicados pedidos que a pessoa enxerga (revalida a visibilidade), por id. */
  loadViews(db: Pick<Database, "query">, organizationId: string, viewerId: string, ids: readonly string[]): Promise<Map<string, CommunicationView>>
}
