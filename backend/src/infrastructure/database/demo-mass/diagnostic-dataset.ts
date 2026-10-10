import { createHash } from "node:crypto"
import { DEMO_ORGANIZATION_ID } from "./demo-constants.js"
import { DIAGNOSTIC_CALLS_DATASET } from "./diagnostic-calls.js"
import { DIAGNOSTIC_CALLS_TEMPORAL_LAYOUT } from "./diagnostic-calls-schedule.js"
import { DIAGNOSTIC_SUBGROUP } from "./structure-generator.js"
import { DEMO_SUBJECT_CATALOG_VERSION } from "./subject-catalog.js"

/**
 * VERSÃO E FINGERPRINT DO DATASET DE DIAGNÓSTICO — metadado de QA/benchmark, e só isso.
 *
 * Não é população, não é coorte, não substitui Grupo/Subgrupo (as Tools continuam lendo a estrutura
 * organizacional REAL). Serve para responder "esta execução usou exatamente qual massa?": um benchmark
 * só compara antes × depois (tokens, latência, qualidade) quando os fingerprints coincidem; fingerprint
 * diferente = "Dataset diferente", nunca comparação silenciosa.
 *
 * O fingerprint cobre estrutura relevante, membership do Subgrupo, interações (ids/instantes/duração/
 * assunto bruto), transcrições (contagem + hash do conteúdo — nunca o texto), versão do catálogo de
 * assuntos canônicos e o período coberto. Sem PII, sem transcrição.
 *
 * FREEZE: `DIAGNOSTIC_DATASET_V1` está CONGELADO em 2026-09-18 (arquivo `inia_demo_90_v1` + layout
 * temporal V2 + catálogo DEMO_SUBJECTS_V1). Qualquer alteração relevante da massa é uma versão nova com
 * fingerprint novo — nunca edição silenciosa da V1.
 */
export const DIAGNOSTIC_DATASET = {
  /** Versão CONCEITUAL do dataset (o que um benchmark cita). V1 = lote original em layout V2; V1_1 = corpus v3 (coerência temporal). */
  version: "DIAGNOSTIC_DATASET_V1_1",
  previousVersion: "DIAGNOSTIC_DATASET_V1",
  /** HOMOLOGATED só depois de: coerência temporal + privacidade de pares + seed/provas (hotfix 2026-09-18). */
  status: "HOMOLOGATED",
  frozenAt: "2026-09-18",
  sourceLot: DIAGNOSTIC_CALLS_DATASET.lot,
  /** Versão do ARQUIVO (revisão do corpus) — distinta da versão conceitual. */
  corpus: DIAGNOSTIC_CALLS_DATASET.corpus,
  corpusSha256: DIAGNOSTIC_CALLS_DATASET.sha256,
  temporalLayout: DIAGNOSTIC_CALLS_TEMPORAL_LAYOUT,
  subjectCatalog: DEMO_SUBJECT_CATALOG_VERSION,
  group: DIAGNOSTIC_SUBGROUP.teamKey,
  subgroup: DIAGNOSTIC_SUBGROUP.name,
} as const

export type DiagnosticDatasetFingerprint = {
  version: string
  fingerprint: string
  components: {
    structure: { subgroupId: string; groupName: string; subgroupName: string; supervisorId: string | null; memberCount: number; membersHash: string }
    interactions: { count: number; transcripts: number; firstStartedAt: string | null; lastStartedAt: string | null; hash: string }
    transcripts: { hash: string }
    subjects: { catalogVersion: string; definitions: number; aliases: number; hash: string }
    dataset: { sourceLot: string; corpus: string; corpusSha256: string; temporalLayout: string }
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** Calculado no BANCO (contas e hashes ordenados) — determinístico enquanto a massa não muda. */
type Queryable = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }

export async function computeDiagnosticDatasetFingerprint(client: Queryable, organizationId = DEMO_ORGANIZATION_ID): Promise<DiagnosticDatasetFingerprint> {
  const subgroup = await client.query<{ id: string; team_name: string; supervisor_id: string | null }>(
    `select st.id, t.name team_name, (select p.reports_to_id from people p where p.subteam_id = st.id and p.role = 'OPERATOR' and p.active order by p.matricula limit 1) supervisor_id
     from subteams st join teams t on t.id = st.team_id where st.organization_id = $1 and st.name = $2`,
    [organizationId, DIAGNOSTIC_SUBGROUP.name],
  )
  const row = subgroup.rows[0]
  if (!row) throw new Error(`Subgrupo "${DIAGNOSTIC_SUBGROUP.name}" não existe — rode o seed demo antes de calcular o fingerprint.`)
  const members = await client.query<{ id: string; matricula: string | null; reports_to_id: string | null }>(`select id, matricula, reports_to_id from people where subteam_id = $1 and role = 'OPERATOR' and active order by id`, [row.id])
  const interactions = await client.query<{ id: string; started_at: string; ended_at: string; reason: string; channel: string; transcript_hash: string | null }>(
    `select i.id, i.started_at::text, i.ended_at::text, i.reason, i.channel, (select md5(t.content) from transcripts t where t.interaction_id = i.id order by t.version desc limit 1) transcript_hash
     from interactions i where i.operator_id in (select id from people where subteam_id = $1 and role = 'OPERATOR' and active) order by i.id`,
    [row.id],
  )
  const subjects = await client.query<{ raw: string; code: string }>(
    `select lower(btrim(a.raw_subject)) raw, d.code from interaction_subject_aliases a join interaction_subject_definitions d on d.id = a.subject_definition_id where a.organization_id = $1 and d.active order by 1, 2`,
    [organizationId],
  )
  const definitions = await client.query<{ n: string }>(`select count(*)::text n from interaction_subject_definitions where organization_id = $1 and active`, [organizationId])
  const membersHash = sha256(members.rows.map((member) => `${member.id}|${member.matricula ?? ""}|${member.reports_to_id ?? ""}`).join("\n"))
  const interactionsHash = sha256(interactions.rows.map((item) => `${item.id}|${item.started_at}|${item.ended_at}|${item.reason}|${item.channel}`).join("\n"))
  const transcriptsHash = sha256(interactions.rows.map((item) => `${item.id}|${item.transcript_hash ?? ""}`).join("\n"))
  const subjectsHash = sha256(subjects.rows.map((item) => `${item.raw}=${item.code}`).join("\n"))
  const startedAts = interactions.rows.map((item) => item.started_at).sort()
  const components: DiagnosticDatasetFingerprint["components"] = {
    structure: { subgroupId: row.id, groupName: row.team_name, subgroupName: DIAGNOSTIC_SUBGROUP.name, supervisorId: row.supervisor_id, memberCount: members.rows.length, membersHash },
    interactions: { count: interactions.rows.length, transcripts: interactions.rows.filter((item) => item.transcript_hash !== null).length, firstStartedAt: startedAts[0] ?? null, lastStartedAt: startedAts[startedAts.length - 1] ?? null, hash: interactionsHash },
    transcripts: { hash: transcriptsHash },
    subjects: { catalogVersion: DIAGNOSTIC_DATASET.subjectCatalog, definitions: Number(definitions.rows[0]!.n), aliases: subjects.rows.length, hash: subjectsHash },
    dataset: { sourceLot: DIAGNOSTIC_DATASET.sourceLot, corpus: DIAGNOSTIC_DATASET.corpus, corpusSha256: DIAGNOSTIC_DATASET.corpusSha256, temporalLayout: DIAGNOSTIC_DATASET.temporalLayout },
  }
  return { version: DIAGNOSTIC_DATASET.version, fingerprint: sha256(JSON.stringify(components)), components }
}

/** Dois fingerprints só são comparáveis num benchmark quando são o MESMO dataset; senão "Dataset diferente". */
export function compareDatasetFingerprints(a: string, b: string): { comparable: boolean; reason: string } {
  return a === b ? { comparable: true, reason: "mesmo dataset" } : { comparable: false, reason: "Dataset diferente" }
}
