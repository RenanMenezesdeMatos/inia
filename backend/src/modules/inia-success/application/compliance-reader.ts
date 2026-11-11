import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { responseCheckMode } from "../../governance/domain/response-compliance.js"
import { foldByBucket, rate, type Bucket, type Rate } from "../domain/success-metrics.js"
import { boundsCte, localDay, placementFilter, type Queryable, type SuccessQuery, type SuccessViewer } from "./success-query.js"

/**
 * CONFORMIDADE DAS RESPOSTAS — a conferência automática das respostas da INIA (PEN-017, `response_compliance_checks`) contra as regras
 * cadastradas (assuntos proibidos da Governança e limites de atuação do Agent). Mede CONFORMIDADE com regras, nunca correção: uma
 * resposta sem violação não é necessariamente correta. Leitura da organização inteira (`configuration.manage` com escopo de
 * organização), como o registro da Governança.
 *
 * Unidade = conferência gravada, nas superfícies em que a INIA fala com a pessoa (chat, ferramenta da voz e fala da voz); as conferências
 * de execuções de Agent, de especialistas e de Workflow ficam fora. Conversas de treino ficam fora. Com Grupo/Subgrupo, só as
 * conferências ligadas a uma conversa de alguém do recorte. Referência temporal: data da conferência.
 *   Conformidade = permitidas ÷ conferências conclusivas (permitidas + violações); a falha da conferência (inconclusiva) fica à parte.
 */
const SURFACES = ["CHAT", "VOICE_TOOL", "VOICE_SPOKEN"] as const
export const SURFACE_LABELS: Record<(typeof SURFACES)[number], string> = { CHAT: "Chat de texto", VOICE_TOOL: "Voz · resposta de especialista", VOICE_SPOKEN: "Voz · fala da INIA" }

export type ComplianceCounts = { checks: number; allowed: number; violations: number; blocked: number; recorded: number; failed: number }
export type ComplianceSummary = {
  mode: string
  counts: ComplianceCounts
  conformity: Rate
  violation: Rate
  inconclusive: Rate
  bySurface: { surface: string; label: string; counts: ComplianceCounts; violation: Rate }[]
  series: { bucket: Bucket; checks: number; violations: number; conclusive: number; violation: Rate }[]
}

type Row = { day: string; surface: string; outcome: string; action: string; total: number }
const empty = (): ComplianceCounts => ({ checks: 0, allowed: 0, violations: 0, blocked: 0, recorded: 0, failed: 0 })
function add(counts: ComplianceCounts, row: Row) {
  counts.checks += row.total
  if (row.outcome === "ALLOWED") counts.allowed += row.total
  if (row.outcome === "VIOLATION") {
    counts.violations += row.total
    if (row.action === "BLOCKED") counts.blocked += row.total
    else counts.recorded += row.total
  }
  if (row.outcome === "CHECK_FAILED") counts.failed += row.total
}

export async function complianceSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<ComplianceSummary> {
  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const bounds = boundsCte(p, viewer.organizationId, query)
  const surfaces = p.typed([...SURFACES], "text[]")
  const filtered = Boolean(query.teamId || query.subteamId)
  const placed = placementFilter(p, query)
  const result = await db.query<Row>(
    `with ${bounds}
     select ${localDay("rc.created_at")} as day, rc.surface, rc.outcome, rc.action, count(*)::int total
       from response_compliance_checks rc
       cross join bounds b
       left join assistant_conversations c on c.id = rc.conversation_id and c.organization_id = rc.organization_id
       left join people p on p.id = c.owner_person_id
       left join subteams st on st.id = p.subteam_id
      where rc.organization_id = ${org} and rc.surface = any(${surfaces}) and rc.created_at >= b.starts and rc.created_at < b.ends
        and (c.id is null or c.origin <> 'TRAINING')
        ${filtered ? `and c.id is not null and ${placed}` : ""}
      group by 1, 2, 3, 4`,
    p.values,
  )
  const counts = empty()
  for (const row of result.rows) add(counts, row)
  const conclusive = counts.allowed + counts.violations
  return {
    mode: responseCheckMode(),
    counts,
    conformity: rate(counts.allowed, conclusive),
    violation: rate(counts.violations, conclusive),
    inconclusive: rate(counts.failed, counts.checks),
    bySurface: SURFACES.map((surface) => {
      const surfaceCounts = empty()
      for (const row of result.rows.filter((entry) => entry.surface === surface)) add(surfaceCounts, row)
      return { surface, label: SURFACE_LABELS[surface], counts: surfaceCounts, violation: rate(surfaceCounts.violations, surfaceCounts.allowed + surfaceCounts.violations) }
    }),
    series: foldByBucket(result.rows, query, () => ({ checks: 0, violations: 0, conclusive: 0 }), (totals, row) => {
      totals.checks += row.total
      if (row.outcome === "VIOLATION") totals.violations += row.total
      if (row.outcome !== "CHECK_FAILED") totals.conclusive += row.total
    }).map(({ bucket, totals }) => ({ bucket, ...totals, violation: rate(totals.violations, totals.conclusive) })),
  }
}
