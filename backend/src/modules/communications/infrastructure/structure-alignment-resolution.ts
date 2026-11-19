import type { Database } from "../../../infrastructure/database/pool.js"
import { isOperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { resolveOperationalAlignments, type AlignmentCandidate, type AlignmentResolution, type AlignmentSubject } from "../../operational-alignments/domain/operational-alignment.js"
import { loadAlignmentCandidatesAt } from "../../operational-alignments/infrastructure/operational-alignment-loaders.js"
import { recordAlignmentUsage } from "../../operational-alignments/application/alignment-audit.js"
import type { LeaderStructureScope } from "../domain/leader-structure.js"
import { structurePeopleCte } from "./structure-people-sql.js"

/**
 * Alinhamentos vigentes para os PÚBLICOS da estrutura de quem lidera. Arquivo próprio (ARQ-06): é usado pelo bloco da estrutura
 * (`leader-structure-context.ts`) e pela decisão de relevância das publicações (`conversation-publications.ts`), e NÃO importa nenhum
 * dos dois nem `communication-conversation-loader.ts` — assim não há ciclo de import (antes contornado com `import()` adiado).
 */
type Queryable = Pick<Database, "query">

/** Públicos distintos (Grupo, Subgrupo, universo) da estrutura — cada um é avaliado pela regra única dos alinhamentos. */
export async function loadStructureSubjects(db: Queryable, organizationId: string, scope: LeaderStructureScope): Promise<AlignmentSubject[]> {
  const result = await db.query<{ team_id: string | null; subteam_id: string | null; operating_universe: string | null; enforced: boolean }>(
    `with recursive ${structurePeopleCte("$1", "$2", "$3")}
     select distinct sp.team_id::text team_id, sp.subteam_id::text subteam_id, sp.operating_universe,
            (select o.operating_universe_enforced_at is not null from organizations o where o.id = $1) enforced
     from structure_people sp`,
    [organizationId, scope.leaderPersonId, scope.teamIds ? [...scope.teamIds] : null],
  )
  return result.rows.map((row) => ({ teamId: row.team_id, subteamId: row.subteam_id, operatingUniverse: isOperatingUniverse(row.operating_universe) ? row.operating_universe : null, universeEnforced: row.enforced }))
}

/**
 * Alinhamentos vigentes para os públicos da estrutura: a regra única aplicada a CADA público, juntando o que vale para algum deles
 * (sem repetir versão). `documentIds` = bases autorizadas ao agente (consulta de processo); null = todos os processos (chat só de
 * liderança, que filtra depois pela pergunta).
 */
export async function resolveAlignmentsForStructure(db: Queryable, input: { organizationId: string; scope: LeaderStructureScope; at: Date; documentIds: readonly string[] | null; usage?: { agentId?: string | null } }): Promise<AlignmentResolution | null> {
  if (input.documentIds && input.documentIds.length === 0) return null
  const candidates = await loadAlignmentCandidatesAt(db, input.organizationId, input.at, input.documentIds)
  if (candidates.length === 0) return null
  const subjects = await loadStructureSubjects(db, input.organizationId, input.scope)
  if (subjects.length === 0) return null
  const authorized = new Set(input.documentIds ?? candidates.flatMap((candidate) => candidate.affectedDocuments.map((document) => document.id)))
  const applied = new Map<string, AlignmentCandidate>()
  let base: AlignmentResolution | null = null
  for (const subject of subjects) {
    const resolution = resolveOperationalAlignments(candidates, subject, input.at, authorized)
    base ??= resolution
    for (const candidate of resolution.applied) applied.set(candidate.versionId, candidate)
  }
  if (!base) return null
  const resolution: AlignmentResolution = { ...base, applied: [...applied.values()], setAside: [], productPrecedence: [] }
  // Rastro (qual versão a IA leu), como no caminho pessoal: quem conversa é o gestor. Sem `usage`, quem chama grava depois do filtro.
  if (input.usage) recordAlignmentUsage(db, input.organizationId, resolution, { surface: "CONVERSATION", personId: input.scope.leaderPersonId, agentId: input.usage.agentId ?? null })
  return resolution
}
