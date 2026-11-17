import type { Database } from "../../../infrastructure/database/pool.js"
import type { KnowledgeChunk } from "../../knowledge/domain/knowledge-chunking.js"
import { rankChunks } from "../../knowledge/domain/lexical-retrieval.js"
import { isOperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { renderAlignmentsForConversation, resolveOperationalAlignments, type AlignmentCandidate, type AlignmentResolution, type AlignmentSubject } from "../../operational-alignments/domain/operational-alignment.js"
import { loadAlignmentCandidatesAt } from "../../operational-alignments/infrastructure/operational-alignment-loaders.js"
import { recordAlignmentUsage } from "../../operational-alignments/application/alignment-audit.js"
import { structureAlignmentHeader, type LeaderStructureScope } from "../domain/leader-structure.js"
import { loadCommunicationsForConversation } from "./communication-conversation-loader.js"
import { structurePeopleCte } from "./structure-people-sql.js"

type Queryable = Pick<Database, "query">

/** Quantos alinhamentos da estrutura entram no chat só de liderança (sem Orquestrador: sem bases autorizadas para filtrar). */
export const MAX_STRUCTURE_ALIGNMENTS_WITHOUT_ORCHESTRATOR = 3

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

/** Mesmo bloco da regra única, com o cabeçalho de quem lidera: cada alinhamento vale para o público dele. */
export function renderAlignmentsForStructure(resolution: AlignmentResolution, scope: LeaderStructureScope): string {
  const rendered = renderAlignmentsForConversation(resolution)
  if (!rendered) return ""
  const [, ...rest] = rendered.split("\n")
  return [...structureAlignmentHeader(scope), ...rest].join("\n")
}

/** Os alinhamentos relacionados à pergunta (sem Orquestrador não há bases autorizadas para restringir): busca da base, até 3. */
export function alignmentsRelatedTo(question: string, candidates: readonly AlignmentCandidate[], max = MAX_STRUCTURE_ALIGNMENTS_WITHOUT_ORCHESTRATOR): AlignmentCandidate[] {
  if (question.trim() === "" || candidates.length === 0) return []
  const chunks: KnowledgeChunk[] = candidates.map((candidate, index) => ({
    documentId: candidate.versionId,
    documentTitle: candidate.title,
    heading: candidate.affectedDocuments.map((document) => document.title).join("; "),
    index,
    text: [candidate.affectedTopic ?? "", candidate.guidance, candidate.affectedDocuments.map((document) => document.title).join(" ")].join("\n"),
  }))
  const byVersion = new Map(candidates.map((candidate) => [candidate.versionId, candidate]))
  const picked: AlignmentCandidate[] = []
  for (const ranked of rankChunks(question, chunks)) {
    const candidate = byVersion.get(ranked.documentId)
    if (!candidate || picked.includes(candidate)) continue
    picked.push(candidate)
    if (picked.length >= max) break
  }
  return picked
}

/**
 * Chat só de liderança (sem Orquestrador do Grupo de quem lidera): alinhamentos vigentes da estrutura e comunicados que chegam a ela,
 * os dois só quando relacionados à pergunta. Texto pronto para somar às instruções da liderança ("" = nada relacionado).
 */
export async function loadLeaderStructureBlock(db: Queryable, input: { organizationId: string; scope: LeaderStructureScope; question: string; at?: Date }): Promise<{ text: string; alignments: AlignmentCandidate[]; communicationIds: string[] }> {
  const question = input.question.trim()
  if (!question) return { text: "", alignments: [], communicationIds: [] }
  const at = input.at ?? new Date()
  const [resolution, communications] = await Promise.all([
    resolveAlignmentsForStructure(db, { organizationId: input.organizationId, scope: input.scope, at, documentIds: null }),
    loadCommunicationsForConversation(db, { organizationId: input.organizationId, personId: input.scope.leaderPersonId, question, structure: input.scope }),
  ])
  const related = resolution ? alignmentsRelatedTo(question, resolution.applied) : []
  // Rastro só do que entrou de fato (os relacionados à pergunta).
  if (resolution && related.length > 0) recordAlignmentUsage(db, input.organizationId, { ...resolution, applied: related }, { surface: "CONVERSATION", personId: input.scope.leaderPersonId })
  const alignmentsText = resolution && related.length > 0 ? renderAlignmentsForStructure({ ...resolution, applied: related }, input.scope) : ""
  const text = [alignmentsText, communications.promptBlock].filter(Boolean).join("\n\n")
  return { text, alignments: related, communicationIds: communications.items.map((item) => item.id) }
}
