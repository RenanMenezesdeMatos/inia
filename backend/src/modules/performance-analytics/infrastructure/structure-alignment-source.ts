import { listStructureAlignments } from "../../operational-alignments/application/structure-alignments.js"
import type { FollowUpAlignmentSource } from "../application/follow-up-alignment-source.js"

/** Liga a porta dos alinhamentos do feed da liderança (application/follow-up-alignment-source.ts) à leitura do módulo de alinhamentos. */
export const structureAlignmentSource: FollowUpAlignmentSource = {
  listForStructure: (db, organizationId, memberIds, now) => listStructureAlignments(db, { organizationId, memberIds, now }),
}
