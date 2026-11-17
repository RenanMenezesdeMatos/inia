/**
 * MONITORIAS AVALIADAS PELO PROCEDIMENTO OFICIAL DURANTE A VIGÊNCIA DE UM ALINHAMENTO. Padrão = SÓ LISTA (nada muda, nenhuma IA).
 *
 *   npx tsx scripts/operational-alignments/reprocess.ts --organization <uuid> --alignment <uuid>
 *   npx tsx scripts/operational-alignments/reprocess.ts --organization <uuid> --alignment <uuid> --apply --reason "<motivo>" [--limit 5] [--all] [--assessment <uuid> ...] [--requested-by <pessoa uuid>]
 *
 * --apply reanalisa cada chamada com o MESMO especialista, pela data do atendimento (o alinhamento entra pela regra única), com gatilho
 * OPERATIONAL_ALIGNMENT_REPROCESS; a avaliação nova substitui a anterior (rastreável: superseded_by, trigger.parentRunId, audit_logs).
 * Por padrão só as que têm desvio no procedimento afetado (--all inclui as demais). CONSOME IA: confira a lista e o limite antes.
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { affectedAssessments } from "../../src/modules/operational-alignments/application/operational-alignment-service.js"
import { reprocessAffectedAssessments } from "../../src/modules/operational-alignments/application/reprocess-affected-assessments.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const many = (name: string) => args.flatMap((value, index) => (args[index - 1] === `--${name}` ? [value] : []))
try {
  const organizationId = option("organization")
  const alignmentId = option("alignment")
  if (!organizationId || !alignmentId) throw new Error("--organization e --alignment são obrigatórios")
  const scopes = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
  const found = await affectedAssessments(pool, organizationId, scopes, alignmentId, 1000)
  console.log(`${found.items.length}${found.truncated ? "+" : ""} avaliação(ões) vigente(s) da vigência sem o alinhamento (${found.items.filter((item) => item.withDeviation).length} com desvio no procedimento afetado):`)
  for (const item of found.items) console.log(`- ${item.callAssessmentId} · chamada ${item.interactionId} · ${item.personName} · ${item.occurredAt} · versão ${item.version} · ${item.deviations} desvio(s)/${item.criteria} critério(s)`)
  if (!args.includes("--apply")) {
    console.log("\nDry-run: nada foi alterado. Use --apply --reason \"…\" [--limit N] para reprocessar (consome IA).")
  } else {
    const reason = option("reason")
    if (!reason?.trim()) throw new Error("--reason é obrigatório")
    const limit = Number(option("limit") ?? 5)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("--limit deve ser um inteiro de 1 a 200")
    const result = await reprocessAffectedAssessments(pool, { organizationId, alignmentId, requestedBy: option("requested-by") ?? null, reason, limit, onlyWithDeviation: !args.includes("--all"), ...(many("assessment").length > 0 ? { callAssessmentIds: many("assessment") } : {}) })
    for (const entry of result.results) console.log(JSON.stringify(entry))
  }
} finally {
  await pool.end()
}
