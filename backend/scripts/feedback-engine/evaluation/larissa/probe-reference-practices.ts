/**
 * SONDA SEM CUSTO (02/10/2026): o grupo de referência que o motor escolheria para o TMA de agosto/2026 da Larissa (colegas do mesmo
 * Grupo com melhor duração no assunto "contestacao") e as práticas que a MEMÓRIA atual sustenta — agrupadas pela identidade da
 * obrigação (como hoje) × pela linha-âncora da base (a primeira linha da regra). Banco somente leitura; nenhum modelo.
 */
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { NO_SIGNAL, createPostgresIndicatorData, segmentKeySql } from "../../../../src/modules/feedback-engine/infrastructure/postgres-indicator-data.js"
import { REFERENCE_MINIMUM_ASSESSMENTS, REFERENCE_MINIMUM_CONTRIBUTORS, topReferenceMembers } from "../../../../src/modules/feedback-engine/domain/indicator-investigation.js"
import { loadFrozenSources } from "./frozen-call.js"

const db = createReadOnlyDatabase(pool)
try {
  const frozen = await loadFrozenSources(db, "C07")
  const data = createPostgresIndicatorData(db)
  const org = frozen.org
  const person = frozen.person.id
  const placement = await data.placement(org, person)
  if (!placement?.teamId) throw new Error("sem Grupo")
  const peers = await data.teamPeers(org, placement.teamId, person)
  const window = { start: new Date("2026-08-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z") }
  const rows = (await data.segmentRows(org, peers, window, NO_SIGNAL)).filter((row) => row.key === "contestacao")
  const bySubject = topReferenceMembers(rows.map((row) => ({ personId: row.personId, n: row.n, value: row.avgDuration ?? 0 })), "LOWER", 3)
  const indicatorId = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TMA'`, [org])).rows[0]!.id
  const official = await data.peerOfficialValues(org, peers, indicatorId, "2026-08")
  const byOfficial = topReferenceMembers(official.map((value) => ({ ...value, n: 3 })), "LOWER", 3)
  const basis = process.argv.includes("--official") ? "OVERALL_INDICATOR" : "SUBJECT_METRIC"
  const { members, population } = basis === "OVERALL_INDICATOR" ? byOfficial : bySubject
  console.log(JSON.stringify({ basis, peers: peers.length, subjectPopulation: bySubject.population, subjectMembers: bySubject.members.length, officialPopulation: byOfficial.population, officialMembers: byOfficial.members.length, population, members: members.length }))
  const memory = (await db.query<{ person_id: string; interaction_id: string; criterion_key: string; anchor: string; anchor_key: string | null; anchor_text: string | null; status: string; segment_key: string | null }>(
    `select ${segmentKeySql("i")} segment_key, c.person_id, c.interaction_id, c.criterion_key, split_part(c.verification->>'lineKey', '#', 1) anchor, kc.criterion_key anchor_key, kc.text anchor_text,
            case when c.verification->>'confirmation' = 'CONFIRMED' then c.status else 'NOT_OBSERVABLE' end status
       from call_criterion_assessments c
       join call_assessments a on a.id = c.call_assessment_id and a.is_current
       join feedback_analysis_runs r on r.id = a.analysis_run_id and r.logic_version = 'CALL_ANALYSIS_LOGIC_V13'
       join interactions i on i.id = c.interaction_id
       left join knowledge_criteria kc on kc.organization_id = c.organization_id and kc.document_id = c.document_id and kc.document_version = c.document_version and kc.line_key = split_part(c.verification->>'lineKey', '#', 1)
      where c.organization_id = $1 and c.is_current and c.person_id = any($2::uuid[]) and i.started_at >= $3 and i.started_at < $4`,
    [org, [...members, person], window.start, window.end],
  )).rows
  const memberSet = new Set(members)
  const subjectOnly = process.argv.includes("--subject")
  if (subjectOnly) memory.splice(0, memory.length, ...memory.filter((row) => row.segment_key === "contestacao"))
  console.log(JSON.stringify({ subjectOnly, segments: Object.fromEntries([...new Set(memory.map((row) => row.segment_key))].map((key) => [key, new Set(memory.filter((row) => row.segment_key === key && memberSet.has(row.person_id)).map((row) => row.interaction_id)).size])) }))
  const ref = memory.filter((row) => memberSet.has(row.person_id))
  console.log(JSON.stringify({ memberCallsInMemory: new Set(ref.map((row) => row.interaction_id)).size, membersWithMemory: new Set(ref.map((row) => row.person_id)).size, larissaCalls: new Set(memory.filter((row) => row.person_id === person).map((row) => row.interaction_id)).size, anchorResolved: memory.filter((row) => row.anchor_key).length + "/" + memory.length }))
  const practices = (keyOf: (row: (typeof memory)[number]) => string) => {
    const by = new Map<string, typeof memory>()
    for (const row of ref) by.set(keyOf(row), [...(by.get(keyOf(row)) ?? []), row])
    return [...by.entries()].map(([key, group]) => {
      const eligible = group.filter((row) => ["MET", "NOT_MET", "PARTIAL"].includes(row.status))
      return { key, text: (group[0]!.anchor_text ?? "").slice(0, 90), eligible: eligible.length, met: eligible.filter((row) => row.status === "MET").length, contributors: new Set(eligible.map((row) => row.person_id)).size, larissa: memory.filter((row) => row.person_id === person && keyOf(row) === key && ["MET", "NOT_MET", "PARTIAL"].includes(row.status)).map((row) => row.status) }
    }).filter((entry) => entry.eligible >= REFERENCE_MINIMUM_ASSESSMENTS && entry.contributors >= REFERENCE_MINIMUM_CONTRIBUTORS).sort((a, b) => b.eligible - a.eligible)
  }
  console.log("\nPRÁTICAS com mínimos — por obrigação (hoje):", JSON.stringify(practices((row) => row.criterion_key), null, 1))
  console.log("\nPRÁTICAS com mínimos — por linha-âncora:", JSON.stringify(practices((row) => row.anchor_key ?? row.criterion_key), null, 1))
} finally {
  await pool.end()
}
