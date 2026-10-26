import type { Database } from "../../../infrastructure/database/pool.js"
import type { CaseDetail, CaseListItem, CaseOwnership, CaseRepository, CaseVisibility } from "../application/case-repository.js"

type CaseRow = {
  id: string; title: string; summary: string; status: string; priority: string
  indicator_code: string; indicator_value: string; indicator_target: string
  root_cause: string | null; confidence: string | null; operator_id: string
  operator_name: string; team_id: string; team_name: string; updated_at: Date
}

function mapCase(row: CaseRow): CaseListItem {
  return {
    id: row.id, title: row.title, summary: row.summary, status: row.status,
    priority: row.priority, indicatorCode: row.indicator_code,
    indicatorValue: row.indicator_value, indicatorTarget: row.indicator_target,
    rootCause: row.root_cause, confidence: row.confidence === null ? null : Number(row.confidence),
    operator: { id: row.operator_id, name: row.operator_name },
    team: { id: row.team_id, name: row.team_name }, updatedAt: row.updated_at.toISOString(),
  }
}

const baseQuery = `select c.*, p.name operator_name, t.name team_name
  from supervision_cases c join people p on p.id = c.operator_id join teams t on t.id = c.team_id`

export class PgCaseRepository implements CaseRepository {
  constructor(private readonly db: Database) {}

  async list(visibility: CaseVisibility, limit: number): Promise<CaseListItem[]> {
    const result = await this.db.query<CaseRow>(
      `${baseQuery}
       where c.organization_id = $1
         and ($2::boolean or c.operator_id = any($3::uuid[]) or c.team_id = any($4::uuid[]) or p.subteam_id = any($5::uuid[]))
       order by c.priority, c.updated_at desc
       limit $6`,
      [visibility.organizationId, visibility.organizationWide, visibility.operatorIds, visibility.teamIds, visibility.subteamIds, limit],
    )
    return result.rows.map(mapCase)
  }

  async ownership(organizationId: string, id: string): Promise<CaseOwnership | null> {
    const result = await this.db.query<{ operator_id: string; team_id: string | null; subteam_id: string | null }>(
      `select c.operator_id, c.team_id, p.subteam_id from supervision_cases c join people p on p.id = c.operator_id where c.id = $1 and c.organization_id = $2`,
      [id, organizationId],
    )
    const row = result.rows[0]
    return row ? { operatorId: row.operator_id, teamId: row.team_id, subteamId: row.subteam_id } : null
  }

  async findById(organizationId: string, id: string): Promise<CaseDetail | null> {
    const result = await this.db.query<CaseRow>(`${baseQuery} where c.id = $1 and c.organization_id = $2`, [id, organizationId])
    const row = result.rows[0]
    if (!row) return null
    const [evidences, recommendations, feedbacks] = await Promise.all([
      this.db.query(`select id, evidence_type as type, title, description, source_type as "sourceType", source_id as "sourceId", occurred_at as "occurredAt" from evidences where case_id = $1 order by occurred_at desc`, [id]),
      this.db.query(`select id, action_type as "actionType", description, expected_impact as "expectedImpact", due_at as "dueAt" from recommendations where case_id = $1 order by created_at`, [id]),
      this.db.query(`select id, status, feedback_kind as kind, impacted_indicator as "impactedIndicator", evidence_found as "evidenceFound", observed_behavior as "observedBehavior", related_procedure as "relatedProcedure", recommendation, suggested_approach as "suggestedApproach" from feedbacks where case_id = $1 order by created_at desc`, [id]),
    ])
    return {
      ...mapCase(row),
      evidences: evidences.rows as CaseDetail["evidences"],
      recommendations: recommendations.rows as CaseDetail["recommendations"],
      feedbacks: feedbacks.rows as CaseDetail["feedbacks"],
    }
  }
}
