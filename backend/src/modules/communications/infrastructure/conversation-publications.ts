import type { Database } from "../../../infrastructure/database/pool.js"
import { loadAlignmentCandidatesAt, loadAlignmentSubject } from "../../operational-alignments/infrastructure/operational-alignment-loaders.js"
import { resolveOperationalAlignments, type AlignmentCandidate } from "../../operational-alignments/domain/operational-alignment.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { gatewayPublicationRelevanceModel, type PublicationRelevanceModel } from "../application/publication-relevance-model.js"
import { CONVERSATION_COMMUNICATION_CANDIDATES, type ConversationCommunication } from "../domain/communication-conversation.js"
import type { LeaderStructureScope } from "../domain/leader-structure.js"
import {
  EMPTY_SELECTION,
  hasRelevanceCandidates,
  parseRelevanceSelection,
  PUBLICATION_RELEVANCE_SYSTEM,
  renderRelevanceRequest,
  type RelevanceSelection,
} from "../domain/publication-relevance.js"
import { communicationLiveSql, communicationVisibleToSql, segmentPersonSql } from "./postgres-communication-store.js"
import { structurePeopleCte } from "./structure-people-sql.js"

type Queryable = Pick<Database, "query">

export type ConversationPublicationsInput = {
  organizationId: string
  personId: string
  question: string
  structure?: LeaderStructureScope | null
  recentTurns?: readonly { role: "user" | "model"; text: string }[]
  /** Troca o modelo (testes e provas). Com modelo trocado, o resultado não é memorizado. */
  model?: PublicationRelevanceModel
}

export type ConversationPublications = {
  /** Comunicados escolhidos pela IA, na ordem dela (do mais ao menos relacionado). */
  communications: ConversationCommunication[]
  /** Alinhamentos escolhidos pela IA (entre os em vigor para a pessoa hoje). */
  alignments: AlignmentCandidate[]
  /** Todos os alinhamentos em vigor para a pessoa hoje (qualquer processo) — a resposta das bases sobre um desses processos não encerra o turno. */
  alignmentsInForce: AlignmentCandidate[]
  selection: RelevanceSelection
  /** A IA foi consultada (havia comunicado no ar ou alinhamento em vigor e pergunta). */
  consulted: boolean
}

/**
 * Comunicados no ar que `personId` enxerga (o mesmo fragmento do Acompanhamento; quem publicou também conta como leitor) — ou, para o
 * gestor perguntando sobre a estrutura (`LEADER_STRUCTURE_CONTEXT_V1`), os que CHEGAM a alguém dela. Lido do banco a cada pergunta: publicar,
 * editar, arquivar ou encerrar vale na próxima mensagem.
 */
export async function loadLiveCommunications(db: Queryable, input: { organizationId: string; personId: string; structure?: LeaderStructureScope | null }): Promise<ConversationCommunication[]> {
  const structure = input.structure ?? null
  const audience = structure
    ? `${communicationLiveSql("n")} and (
         ($3::uuid[] is null and ${communicationVisibleToSql("n", "$2")})
         or (exists (select 1 from structure_people) and n.audience = 'ORGANIZATION')
         or (n.audience = 'TEAM' and exists (select 1 from communication_recipients cr join structure_people sp on sp.id = cr.person_id where cr.communication_id = n.id))
         or (n.audience = 'SEGMENT' and exists (select 1 from structure_people sp where ${segmentPersonSql("n", "sp")})))`
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
  return result.rows.map((row) => ({ ...row, publishedAt: new Date(row.publishedAt), displayUntil: row.displayUntil ? new Date(row.displayUntil) : null, plainText: row.plainText === "(imagem)" ? "" : row.plainText }))
}

/** Alinhamentos em vigor HOJE para a pessoa, em qualquer processo (a mesma regra única, sem o filtro das bases do agente). */
export async function loadAlignmentsInForceFor(db: Queryable, organizationId: string, personId: string, at: Date): Promise<AlignmentCandidate[]> {
  const candidates = await loadAlignmentCandidatesAt(db, organizationId, at, null)
  if (candidates.length === 0) return []
  const subject = await loadAlignmentSubject(db, organizationId, personId, at)
  return subject ? resolveOperationalAlignments(candidates, subject, at, null).applied : []
}

// Memória curta da decisão por pergunta: o chat/voz decide ANTES (junto do esclarecimento) e cada prompt de agente da mesma resposta
// reaproveita a mesma promessa — uma chamada ao modelo por pergunta. Só o processo atual; expira rápido (o que muda no banco vale na
// próxima pergunta, que é outra chave ou já passou do prazo).
const MEMO_TTL_MS = 30_000
const MEMO_MAX = 500
const memo = new Map<string, { at: number; value: Promise<ConversationPublications> }>()

const keyOf = (input: ConversationPublicationsInput) =>
  [input.organizationId, input.personId, input.structure ? `${input.structure.leaderPersonId}:${(input.structure.teamIds ?? ["*"]).join(",")}` : "", input.question.trim().replace(/\s+/g, " ")].join("|")

/**
 * Interruptor `INIA_PUBLICATION_RELEVANCE` (`off` = a IA não é consultada e nenhum comunicado/alinhamento é escolhido; os alinhamentos
 * em vigor continuam carregados). Ligado por padrão; desligado nos testes (vitest.config.ts) para nenhuma prova sem modelo simulado
 * fazer chamada real — quem testa passa `model`.
 */
export function publicationRelevanceEnabled(): boolean {
  const value = process.env.INIA_PUBLICATION_RELEVANCE?.trim().toLowerCase()
  return !(value === "off" || value === "false" || value === "0")
}

export function conversationPublicationsFor(db: Queryable, input: ConversationPublicationsInput): Promise<ConversationPublications> {
  if (input.model) return decide(db, input, input.model)
  if (!publicationRelevanceEnabled()) return decide(db, input, null)
  const key = keyOf(input)
  const now = Date.now()
  const cached = memo.get(key)
  if (cached && now - cached.at < MEMO_TTL_MS) return cached.value
  const value = decide(db, input, gatewayPublicationRelevanceModel)
  memo.set(key, { at: now, value })
  value.catch(() => memo.delete(key))
  if (memo.size > MEMO_MAX) {
    for (const [entry, item] of memo) if (now - item.at >= MEMO_TTL_MS || memo.size > MEMO_MAX) memo.delete(entry)
  }
  return value
}

async function decide(db: Queryable, input: ConversationPublicationsInput, model: PublicationRelevanceModel | null): Promise<ConversationPublications> {
  const empty = (alignmentsInForce: AlignmentCandidate[] = []): ConversationPublications => ({ communications: [], alignments: [], alignmentsInForce, selection: EMPTY_SELECTION, consulted: false })
  if (input.question.trim() === "") return empty()
  const at = new Date()
  const [communications, alignmentsInForce] = await Promise.all([
    loadLiveCommunications(db, input),
    // Gestor sobre a estrutura: os alinhamentos da estrutura têm bloco próprio (`renderAlignmentsForStructure`); aqui só os da pessoa.
    input.structure ? Promise.resolve([] as AlignmentCandidate[]) : loadAlignmentsInForceFor(db, input.organizationId, input.personId, at),
  ])
  const alignments = alignmentsInForce.map((item) => ({ alignmentId: item.alignmentId, title: item.title, guidance: item.guidance, processes: item.affectedDocuments.map((document) => document.title), startsOn: item.startsOn, endsOn: item.endsOn }))
  const request = { question: input.question, recentTurns: input.recentTurns ?? [], communications, alignments, timeZone: await resolveOrganizationTimezone(db as Database, input.organizationId), leaderStructure: Boolean(input.structure) }
  if (!model || !hasRelevanceCandidates(request)) return empty(alignmentsInForce)
  let selection: RelevanceSelection = EMPTY_SELECTION
  try {
    selection = parseRelevanceSelection(await model({ organizationId: input.organizationId, system: PUBLICATION_RELEVANCE_SYSTEM, user: renderRelevanceRequest(request) }), request)
  } catch (error) {
    // Fail-closed: sem decisão, nenhum comunicado entra (nunca um aleatório) e a resposta segue pelas bases, como antes.
    console.warn(JSON.stringify({ event: "publication_relevance_failed", organizationId: input.organizationId, failure: error instanceof Error ? error.message : String(error) }))
  }
  const byCommunication = new Map(communications.map((item) => [item.id, item]))
  const byAlignment = new Map(alignmentsInForce.map((item) => [item.alignmentId, item]))
  return {
    communications: selection.communicationIds.flatMap((id) => byCommunication.get(id) ?? []),
    alignments: selection.alignmentIds.flatMap((id) => byAlignment.get(id) ?? []),
    alignmentsInForce,
    selection,
    consulted: true,
  }
}

/** Só para testes: esvazia a memória curta. */
export function clearConversationPublicationsMemo(): void {
  memo.clear()
}
