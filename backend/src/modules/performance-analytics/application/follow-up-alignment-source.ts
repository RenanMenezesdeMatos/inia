import type { Database } from "../../../infrastructure/database/pool.js"
import type { StructureAlignment } from "../../operational-alignments/application/structure-alignments.js"

/**
 * Porta dos alinhamentos operacionais no Acompanhamento de quem lidera (fase 2, 18/11/2026). O analytics não conhece a regra de público
 * dos alinhamentos: pede à porta os alinhamentos que alcançam os liderados (um por alinhamento, com alcance e leituras) e os une ao feed
 * pela mesma ordem e pelo mesmo cursor. A implementação fica em `performance-analytics/infrastructure/structure-alignment-source.ts`.
 */
export type FollowUpAlignmentSource = {
  listForStructure(db: Pick<Database, "query">, organizationId: string, memberIds: readonly string[], now: Date): Promise<StructureAlignment[]>
  /**
   * AL-06 (opcional): há alguma versão publicada até este instante? Página do feed ANTERIOR a todas as publicações não pode conter
   * alinhamento — o feed pula `listForStructure` (duas consultas sobre versões × liderados). Ausente = sempre calcula.
   */
  hasPublishedUpTo?(db: Pick<Database, "query">, organizationId: string, publishedUpTo: Date | string, now: Date): Promise<boolean>
}
