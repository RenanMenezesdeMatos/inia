import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import {
  CONVERSATION_COMMUNICATION_CANDIDATES,
  renderCommunicationsForConversation,
  selectCommunicationsForQuestion,
  type ConversationCommunication,
} from "../domain/communication-conversation.js"
import type { LeaderStructureScope } from "../domain/leader-structure.js"
import { communicationLiveSql, communicationVisibleToSql } from "./postgres-communication-store.js"
import { structurePeopleCte } from "./structure-people-sql.js"

/**
 * Comunicados para a conversa de `personId` sobre `question` (`COMMUNICATION_CONVERSATION_V2`). Lido do banco a CADA pergunta (sem
 * cache nem índice próprio): publicar, editar, agendar chegar, arquivar, retirar ou encerrar a exibição vale na próxima mensagem.
 * Só o que a pessoa enxerga no Acompanhamento (o mesmo fragmento `communicationVisibleToSql`); quem publicou também conta como
 * leitor (o autor perguntando sobre o próprio comunicado).
 */
export async function loadCommunicationsForConversation(
  db: Pick<Database, "query">,
  input: { organizationId: string; personId: string; question: string; structure?: LeaderStructureScope | null },
): Promise<{ items: ConversationCommunication[]; promptBlock: string }> {
  if (input.question.trim() === "") return { items: [], promptBlock: "" }
  // Gestor perguntando sobre a estrutura (`LEADER_STRUCTURE_CONTEXT_V1`): os comunicados no ar que CHEGAM a alguém dela — equipe
  // gravada, recorte ou empresa — e, sem Grupo escolhido, também os que o próprio gestor enxerga.
  const structure = input.structure ?? null
  const audience = structure
    ? `${communicationLiveSql("n")} and (
         ($3::uuid[] is null and ${communicationVisibleToSql("n", "$2")})
         or (exists (select 1 from structure_people) and n.audience = 'ORGANIZATION')
         or (n.audience = 'TEAM' and exists (select 1 from communication_recipients cr join structure_people sp on sp.id = cr.person_id where cr.communication_id = n.id))
         or (n.audience = 'SEGMENT' and exists (select 1 from structure_people sp where (n.segment_universe is null or sp.operating_universe = n.segment_universe)
               and ((cardinality(n.segment_team_ids) = 0 and cardinality(n.segment_subteam_ids) = 0) or sp.team_id = any(n.segment_team_ids) or sp.subteam_id = any(n.segment_subteam_ids)))))`
    : communicationVisibleToSql("n", "$2")
  const result = await db.query<Omit<ConversationCommunication, "publishedAt" | "displayUntil"> & { publishedAt: Date; displayUntil: Date | null }>(
    `${structure ? `with recursive ${structurePeopleCte("$1", "$2", "$3")} ` : ""}select n.id::text id, n.title, n.summary, left(n.plain_text, 6000) "plainText", n.tags, p.name "authorName", p.job_title "authorJobTitle",
            n.published_at "publishedAt", n.display_until "displayUntil", pn.name "productName", n.featured
     from communications n
     join people p on p.id = n.author_person_id
     left join product_catalog_nodes_all pn on pn.id = n.product_node_id
     where n.organization_id = $1 and ${audience}
     order by n.featured desc, n.published_at desc, n.id desc
     limit ${CONVERSATION_COMMUNICATION_CANDIDATES}`,
    structure ? [input.organizationId, structure.leaderPersonId, structure.teamIds ? [...structure.teamIds] : null] : [input.organizationId, input.personId],
  )
  const candidates = result.rows.map((row) => ({ ...row, publishedAt: new Date(row.publishedAt), displayUntil: row.displayUntil ? new Date(row.displayUntil) : null, plainText: row.plainText === "(imagem)" ? "" : row.plainText }))
  const items = selectCommunicationsForQuestion(input.question, candidates)
  if (items.length === 0) return { items, promptBlock: "" }
  return { items, promptBlock: renderCommunicationsForConversation(items, await resolveOrganizationTimezone(db, input.organizationId), structure) }
}
