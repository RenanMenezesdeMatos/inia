import { collectUnits } from "../../performance-analytics/application/build-team-overview.js"
import { splitIntoGroups, type GroupBucket } from "../../performance-analytics/application/structure-groups.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { GroupingDimension } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { ResolvedStructure } from "./references.js"

/**
 * Unidades abaixo de uma estrutura: o agrupamento pedido, ou a CASCATA da Equipe (nível de gestão mais alto presente abaixo; quem não
 * tem esse nível cai no seguinte — ex.: supervisores sem coordenador viram unidades próprias). Pessoas ligadas diretamente à
 * âncora ficam num balde não navegável. Equipe de Supervisor não tem unidades.
 */
export function unitBuckets(scope: ViewerScope, structure: ResolvedStructure, groupBy: GroupingDimension | null): { buckets: GroupBucket[]; groupedBy: GroupingDimension | null } {
  if (groupBy) return { buckets: splitIntoGroups(scope, structure.resolved, groupBy), groupedBy: groupBy }
  const cascade = collectUnits(scope, structure.resolved, structure.subject)
  if (cascade.units.length === 0) return { buckets: [], groupedBy: null }
  const direct: GroupBucket[] = cascade.directMembers.length > 0 ? [{ key: "direct", label: "Ligados diretamente", description: "Sem gestor intermediário", subject: null, leader: null, members: cascade.directMembers }] : []
  return { buckets: [...cascade.units, ...direct], groupedBy: cascade.topGroupBy }
}
