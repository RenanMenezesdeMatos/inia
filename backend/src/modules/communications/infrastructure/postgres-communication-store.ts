import { normalizeScopeLinks } from "../../auth/application/manageable-scopes.js"
import { assertNewScopeLinksAdmissible } from "../../org-structure/application/scope-unit-admission.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { canAnywhere, canOrganizationWide } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import type { CommunicationFields, CommunicationStore, NewCommunication, SavedCommunication } from "../application/communication-service.js"
import {
  COMMUNICATION_EXCERPT_LENGTH,
  communicationExcerpt,
  communicationStateOf,
  type CommunicationAudience,
  type CommunicationSegment,
  type CommunicationStatus,
  type CommunicationTag,
  type CommunicationUniverse,
  type CommunicationView,
  type EditorialCommunication,
  type EditorialCommunicationSummary,
  type ReceivedCommunicationSummary,
} from "../domain/communication.js"

type Queryable = Pick<Database, "query">

/**
 * A pessoa `personParam` está no público SEGMENT do comunicado `alias`: cadastro ATUAL, ativa, do universo (quando escolhido) e de um
 * dos Grupos/Subgrupos (quando escolhidos). Sem Grupo e sem Subgrupo = o universo inteiro.
 */
function segmentMatchSql(alias: string, personParam: string): string {
  return `exists (select 1 from people sp where sp.id = ${personParam} and sp.organization_id = ${alias}.organization_id and sp.active and ${segmentPersonSql(alias, "sp")})`
}

/**
 * A pessoa `person` (alias de `people`) está no recorte do comunicado `alias` (223): universo (quando escolhido) E — sem vínculo, o
 * universo inteiro — algum vínculo a alcança (Grupo inteiro = `team_id`; Subgrupo = `subteam_id`). FRAGMENTO ÚNICO: leitura (feed, por
 * id, recebidos), chat da pessoa e chat da estrutura do gestor.
 */
export function segmentPersonSql(alias: string, person: string): string {
  return `(${alias}.segment_universe is null or ${person}.operating_universe = ${alias}.segment_universe)
      and (not exists (select 1 from communication_segment_scopes ls where ls.communication_id = ${alias}.id)
        or exists (select 1 from communication_segment_scopes ls where ls.communication_id = ${alias}.id
          and ((ls.subteam_id is null and ls.team_id = ${person}.team_id) or ls.subteam_id = ${person}.subteam_id)))`
}

/** Grava os vínculos do recorte (substituídos inteiros, na transação da gravação do comunicado). */
async function writeSegmentLinks(db: Queryable, organizationId: string, communicationId: string, segment: CommunicationSegment) {
  await db.query(`delete from communication_segment_scopes where communication_id = $1`, [communicationId])
  if (segment.links.length === 0) return
  await db.query(
    `insert into communication_segment_scopes (communication_id, organization_id, team_id, subteam_id) select $1, $2, t, s from unnest($3::uuid[], $4::uuid[]) as u(t, s)`,
    [communicationId, organizationId, segment.links.map((link) => link.teamId), segment.links.map((link) => link.subteamId)],
  )
}

/** Publicado, já no ar e dentro do período de exibição (fragmento único: feed, leitura por id, recebidos e chat). */
export function communicationLiveSql(alias: string): string {
  return `(${alias}.deleted_at is null and ${alias}.status = 'PUBLISHED' and ${alias}.published_at <= now() and (${alias}.display_until is null or ${alias}.display_until > now()))`
}

/**
 * Quem enxerga o comunicado `alias` (fragmento ÚNICO — usado pelo Acompanhamento do colaborador, pelo ramo NOTICE do feed da
 * estrutura, pela leitura por id e pelo chat): só comunicado NO AR (publicado, horário de publicação já chegou, dentro do período de
 * exibição, não arquivado nem retirado) e, dele, quem publicou, quem está entre os destinatários gravados (TEAM), qualquer pessoa da
 * organização (ORGANIZATION) ou quem está no recorte (SEGMENT, pelo cadastro atual). `personParam` é o placeholder do id de quem lê.
 * Rascunho, agendado e arquivado só aparecem na área editorial do autor (`findOwn`/`listOwn`).
 */
export function communicationVisibleToSql(alias: string, personParam: string): string {
  return `(${communicationLiveSql(alias)} and (${alias}.author_person_id = ${personParam} or ${alias}.audience = 'ORGANIZATION'
    or (${alias}.audience = 'TEAM' and exists (select 1 from communication_recipients cr where cr.communication_id = ${alias}.id and cr.organization_id = ${alias}.organization_id and cr.person_id = ${personParam}))
    or (${alias}.audience = 'SEGMENT' and ${segmentMatchSql(alias, personParam)})))`
}

type Row = {
  id: string; title: string; contentHtml: string; plainText: string; tags: string[]; audience: string; authorPersonId: string; authorName: string; authorJobTitle: string | null
  recipientCount: number; publishedAt: Date; editedAt: Date | null; summary: string | null; featured: boolean; displayUntil: Date | null
}

const SELECT = `n.id::text id, n.title, n.content_html "contentHtml", n.plain_text "plainText", n.tags, n.audience, n.author_person_id::text "authorPersonId",
  p.name "authorName", p.job_title "authorJobTitle", n.recipient_count "recipientCount", n.published_at "publishedAt", n.edited_at "editedAt",
  n.summary, n.featured, n.display_until "displayUntil"`
const JOINS = `join people p on p.id = n.author_person_id`

/** Lista leve: sem `content_html` nem o texto inteiro; só um prefixo do texto e se há imagem (o HTML gravado é sempre o refeito
 * pelo servidor, então `<img ` só aparece como imagem de verdade). */
type SummaryRow = Omit<Row, "contentHtml" | "plainText"> & { plainTextStart: string; plainTextCut: boolean; hasImages: boolean }
const EXCERPT_SOURCE_LENGTH = COMMUNICATION_EXCERPT_LENGTH * 4
const LIGHT_CONTENT = `left(n.plain_text, ${EXCERPT_SOURCE_LENGTH}) "plainTextStart", char_length(n.plain_text) > ${EXCERPT_SOURCE_LENGTH} "plainTextCut", strpos(n.content_html, '<img ') > 0 "hasImages"`
const SUMMARY_SELECT = `n.id::text id, n.title, ${LIGHT_CONTENT}, n.tags, n.audience, n.author_person_id::text "authorPersonId",
  p.name "authorName", p.job_title "authorJobTitle", n.recipient_count "recipientCount", n.published_at "publishedAt", n.edited_at "editedAt",
  n.summary, n.featured, n.display_until "displayUntil"`

function toSummary(row: SummaryRow, viewerId: string): ReceivedCommunicationSummary {
  return { ...baseView(row, viewerId), excerpt: communicationExcerpt(row.plainTextStart, row.hasImages, row.plainTextCut), hasImages: row.hasImages }
}

function toView(row: Row, viewerId: string): CommunicationView {
  return { ...baseView(row, viewerId), contentHtml: row.contentHtml, plainText: row.plainText }
}

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null)

function baseView(row: Omit<Row, "contentHtml" | "plainText">, viewerId: string): Omit<CommunicationView, "contentHtml" | "plainText"> {
  const authoredByViewer = row.authorPersonId === viewerId
  return {
    id: row.id,
    title: row.title,
    tags: row.tags as CommunicationTag[],
    audience: row.audience as CommunicationAudience,
    author: { personId: row.authorPersonId, name: row.authorName, jobTitle: row.authorJobTitle },
    recipientCount: authoredByViewer ? row.recipientCount : null,
    authoredByViewer,
    publishedAt: new Date(row.publishedAt).toISOString(),
    editedAt: iso(row.editedAt),
    summary: row.summary,
    featured: row.featured,
    displayUntil: iso(row.displayUntil),
  }
}

/** Conteúdo dos comunicados de uma página do feed (montado DEPOIS do LIMIT, só para os itens exibidos), por id. */
export async function loadCommunicationViews(db: Queryable, organizationId: string, viewerId: string, ids: readonly string[]): Promise<Map<string, CommunicationView>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<Row>(`select ${SELECT} from communications n ${JOINS} where n.organization_id = $1 and n.id = any($2::uuid[]) and ${communicationVisibleToSql("n", "$3")}`, [organizationId, ids, viewerId])
  return new Map(result.rows.map((row) => [row.id, toView(row, viewerId)]))
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Área editorial (autor)

type EditorialRow = {
  id: string; status: CommunicationStatus; title: string; tags: string[]; summary: string | null; featured: boolean; audience: CommunicationAudience
  segmentUniverse: string | null; segmentLinks: CommunicationSegment["links"] | null; productNodeId: string | null; productName: string | null
  publishedAt: Date | null; displayUntil: Date | null; recipientCount: number; createdAt: Date; updatedAt: Date | null; editedAt: Date | null; archivedAt: Date | null
  authorPersonId: string; authorName: string; authorJobTitle: string | null
}
const EDITORIAL_SELECT = `n.id::text id, n.status, n.title, n.tags, n.summary, n.featured, n.audience, n.segment_universe "segmentUniverse",
  (select coalesce(json_agg(json_build_object('teamId', ls.team_id, 'teamName', lt.name, 'subteamId', ls.subteam_id, 'subteamName', lst.name) order by lt.name, ls.team_id, lst.name nulls first), '[]'::json)
     from communication_segment_scopes ls join teams lt on lt.id = ls.team_id left join subteams lst on lst.id = ls.subteam_id where ls.communication_id = n.id) "segmentLinks",
  n.product_node_id::text "productNodeId", pn.name "productName",
  n.published_at "publishedAt", n.display_until "displayUntil", n.recipient_count "recipientCount", n.created_at "createdAt", n.updated_at "updatedAt",
  n.edited_at "editedAt", n.archived_at "archivedAt", n.author_person_id::text "authorPersonId", p.name "authorName", p.job_title "authorJobTitle"`
const EDITORIAL_JOINS = `${JOINS} left join product_catalog_nodes_all pn on pn.id = n.product_node_id`

function editorialBase(row: EditorialRow): Omit<EditorialCommunication, "contentHtml" | "plainText"> {
  return {
    id: row.id,
    status: row.status,
    state: communicationStateOf({ status: row.status, publishedAt: row.publishedAt, displayUntil: row.displayUntil }),
    title: row.title,
    tags: row.tags as CommunicationTag[],
    summary: row.summary,
    featured: row.featured,
    audience: row.audience,
    segment: { universe: (row.segmentUniverse as CommunicationUniverse | null) ?? null, links: row.segmentLinks ?? [] },
    productNodeId: row.productNodeId,
    productName: row.productName,
    publishedAt: iso(row.publishedAt),
    displayUntil: iso(row.displayUntil),
    recipientCount: row.recipientCount,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: iso(row.updatedAt),
    editedAt: iso(row.editedAt),
    archivedAt: iso(row.archivedAt),
    author: { personId: row.authorPersonId, name: row.authorName, jobTitle: row.authorJobTitle },
  }
}

/** Pessoas do público AGORA (quem publica não entra). TEAM: a estrutura abaixo (ids, para gravar); demais: só a contagem. */
async function resolveAudience(db: Queryable, input: { organizationId: string; authorPersonId: string; audience: CommunicationAudience; segment: CommunicationSegment }): Promise<{ count: number; recipientIds: string[] }> {
  if (input.audience === "TEAM") {
    // `union` na CTE: um ciclo em reports_to termina em vez de travar (a mesma defesa do leitor da estrutura).
    const below = await db.query<{ id: string }>(
      `with recursive below as (
         select id from people where organization_id = $1 and reports_to_id = $2
         union
         select p.id from people p join below b on p.reports_to_id = b.id where p.organization_id = $1
       )
       select p.id::text id from people p where p.id in (select id from below) and p.active and p.id <> $2`,
      [input.organizationId, input.authorPersonId],
    )
    return { count: below.rows.length, recipientIds: below.rows.map((row) => row.id) }
  }
  if (input.audience === "ORGANIZATION") {
    const all = await db.query<{ count: number }>(`select count(*)::int count from people where organization_id = $1 and active and id <> $2`, [input.organizationId, input.authorPersonId])
    return { count: all.rows[0]?.count ?? 0, recipientIds: [] }
  }
  // Recorte ainda não gravado (prévia, publicação): o mesmo predicado de `segmentPersonSql`, com os vínculos em parâmetro. Uma pessoa
  // conta uma vez, mesmo alcançada por mais de um vínculo.
  const segment = await db.query<{ count: number }>(
    `select count(*)::int count from people sp where sp.organization_id = $1 and sp.active and sp.id <> $2
       and ($3::text is null or sp.operating_universe = $3)
       and (cardinality($4::uuid[]) = 0 or exists (select 1 from unnest($4::uuid[], $5::uuid[]) as l(team_id, subteam_id)
         where (l.subteam_id is null and l.team_id = sp.team_id) or l.subteam_id = sp.subteam_id))`,
    [input.organizationId, input.authorPersonId, input.segment.universe, input.segment.links.map((link) => link.teamId), input.segment.links.map((link) => link.subteamId)],
  )
  return { count: segment.rows[0]?.count ?? 0, recipientIds: [] }
}

const audit = (db: Queryable, organizationId: string, actorId: string, action: string, id: string, payload: Record<string, unknown>) =>
  db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'communication', $4, $5)`, [organizationId, actorId, action, id, JSON.stringify(payload)])

/** Auditoria sem conteúdo (título e texto ficam no registro do comunicado, rastreável pelo id). */
function auditPayload(fields: CommunicationFields & { publishedAt: Date | null; accountId: string }, recipientCount: number) {
  return {
    audience: fields.audience,
    ...(fields.audience === "SEGMENT" ? { segment: fields.segment } : {}),
    recipientCount,
    tags: fields.tags,
    publishedAt: iso(fields.publishedAt),
    displayUntil: iso(fields.displayUntil),
    featured: fields.featured,
    productNodeId: fields.productNodeId,
    accountId: fields.accountId,
  }
}

export function createPostgresCommunicationStore(db: Database): CommunicationStore {
  const access = createPostgresAccessRepository(db)
  return {
    async loadRights(organizationId, accountId) {
      const context = await access.loadContext(organizationId, accountId)
      return { team: canAnywhere(context, "communications.publish_team"), organization: canOrganizationWide(context, "communications.publish_organization"), moderate: canOrganizationWide(context, "communications.moderate") }
    },

    async insert(input: NewCommunication) {
      return inTransaction(db, async (client) => {
        const publishing = input.status === "PUBLISHED"
        // Público calculado AGORA, pelo servidor (na publicação ou no agendamento). Rascunho não calcula nada.
        const audience = publishing ? await resolveAudience(client, input) : { count: 0, recipientIds: [] }
        if (publishing && audience.count === 0) return null
        const created = await client.query<{ id: string }>(
          `insert into communications (organization_id, author_person_id, author_account_id, audience, title, content_html, plain_text, tags, recipient_count,
             status, published_at, summary, featured, display_until, segment_universe, product_node_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, $13, $14, $15, $16) returning id::text id`,
          [input.organizationId, input.authorPersonId, input.authorAccountId, input.audience, input.title, input.contentHtml, input.plainText, input.tags, audience.count,
            input.status, input.publishedAt, input.summary, input.featured, input.displayUntil, input.segment.universe, input.productNodeId],
        )
        const id = created.rows[0]!.id
        await writeSegmentLinks(client, input.organizationId, id, input.segment)
        if (publishing && input.audience === "TEAM") {
          await client.query(`insert into communication_recipients (communication_id, person_id, organization_id) select $1, unnest($2::uuid[]), $3`, [id, audience.recipientIds, input.organizationId])
        }
        const scheduled = publishing && input.publishedAt !== null && input.publishedAt.getTime() > Date.now()
        await audit(client, input.organizationId, input.authorPersonId, publishing ? (scheduled ? "COMMUNICATION_SCHEDULED" : "COMMUNICATION_PUBLISHED") : "COMMUNICATION_DRAFT_SAVED", id, auditPayload({ ...input, accountId: input.authorAccountId }, audience.count))
        return { id, status: input.status, recipientCount: audience.count, publishedAt: iso(input.publishedAt) }
      })
    },

    async update(input) {
      return inTransaction(db, async (client): Promise<SavedCommunication | "EMPTY_AUDIENCE" | null> => {
        // Trava a linha do autor: duas edições ao mesmo tempo não perdem a versão do meio.
        const locked = await client.query<{ status: CommunicationStatus; published_at: Date | null; title: string; content_html: string; plain_text: string; tags: string[]; summary: string | null; display_until: Date | null; featured: boolean; recipient_count: number }>(
          `select status, published_at, title, content_html, plain_text, tags, summary, display_until, featured, recipient_count from communications
           where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null and status <> 'ARCHIVED' for update`,
          [input.organizationId, input.authorPersonId, input.id],
        )
        const previous = locked.rows[0]
        if (!previous) return null
        const now = Date.now()
        const wentOut = previous.status === "PUBLISHED" && previous.published_at !== null && new Date(previous.published_at).getTime() <= now
        const publishing = input.status === "PUBLISHED"

        // Público: recalculado enquanto o comunicado não saiu (rascunho publicado agora/agendado ou agendado alterado); fixo depois.
        let recipientCount = previous.recipient_count
        if (publishing && !wentOut) {
          const audience = await resolveAudience(client, input)
          if (audience.count === 0) return "EMPTY_AUDIENCE"
          recipientCount = audience.count
          await client.query(`delete from communication_recipients where communication_id = $1`, [input.id])
          if (input.audience === "TEAM") await client.query(`insert into communication_recipients (communication_id, person_id, organization_id) select $1, unnest($2::uuid[]), $3`, [input.id, audience.recipientIds, input.organizationId])
        } else if (!publishing) {
          // Agendado que volta a rascunho: ninguém recebe nada até publicar de novo.
          await client.query(`delete from communication_recipients where communication_id = $1`, [input.id])
          recipientCount = 0
        }

        // A versão anterior de um comunicado que já saiu (ou estava agendado) fica guardada; rascunho não tem versões.
        if (previous.status !== "DRAFT") {
          await client.query(
            `insert into communication_revisions (communication_id, organization_id, title, content_html, plain_text, tags, replaced_by, summary, display_until, featured) values ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)`,
            [input.id, input.organizationId, previous.title, previous.content_html, previous.plain_text, previous.tags, input.authorPersonId, previous.summary, previous.display_until, previous.featured],
          )
        }
        await client.query(
          `update communications set status = $2, published_at = $3, title = $4, content_html = $5, plain_text = $6, tags = $7::text[], summary = $8, featured = $9,
             display_until = $10, audience = $11, segment_universe = $12, product_node_id = $13,
             recipient_count = $14, updated_at = now(),
             edited_at = case when $15::boolean then now() else edited_at end, edited_by = case when $15::boolean then $16::uuid else edited_by end
           where id = $1`,
          [input.id, input.status, input.publishedAt, input.title, input.contentHtml, input.plainText, input.tags, input.summary, input.featured, input.displayUntil,
            input.audience, input.segment.universe, input.productNodeId, recipientCount, wentOut, input.authorPersonId],
        )
        // Público fixo depois que saiu (o serviço já devolve o recorte atual); antes disso, os vínculos acompanham a gravação.
        if (!wentOut) await writeSegmentLinks(client, input.organizationId, input.id, input.segment)
        const scheduled = publishing && input.publishedAt !== null && input.publishedAt.getTime() > now
        const action = wentOut ? "COMMUNICATION_EDITED" : publishing ? (scheduled ? "COMMUNICATION_SCHEDULED" : "COMMUNICATION_PUBLISHED") : previous.status === "DRAFT" ? "COMMUNICATION_DRAFT_SAVED" : "COMMUNICATION_UNSCHEDULED"
        await audit(client, input.organizationId, input.authorPersonId, action, input.id, {
          ...auditPayload({ ...input, accountId: input.authorAccountId }, recipientCount),
          titleChanged: previous.title !== input.title,
          contentChanged: previous.content_html !== input.contentHtml,
        })
        return { id: input.id, status: input.status, recipientCount, publishedAt: iso(input.publishedAt) }
      })
    },

    async findOwn(organizationId, authorPersonId, id) {
      const result = await db.query<EditorialRow & { contentHtml: string; plainText: string }>(
        `select ${EDITORIAL_SELECT}, n.content_html "contentHtml", n.plain_text "plainText" from communications n ${EDITORIAL_JOINS}
         where n.organization_id = $1 and n.author_person_id = $2 and n.id = $3 and n.deleted_at is null`,
        [organizationId, authorPersonId, id],
      )
      const row = result.rows[0]
      return row ? { ...editorialBase(row), contentHtml: row.contentHtml, plainText: row.plainText } : null
    },

    async listOwn(organizationId, authorPersonId, limit) {
      const result = await db.query<EditorialRow & { plainTextStart: string; plainTextCut: boolean; hasImages: boolean }>(
        `select ${EDITORIAL_SELECT}, ${LIGHT_CONTENT} from communications n ${EDITORIAL_JOINS}
         where n.organization_id = $1 and n.author_person_id = $2 and n.deleted_at is null
         order by coalesce(n.updated_at, n.created_at) desc, n.id desc limit $3`,
        [organizationId, authorPersonId, limit],
      )
      return result.rows.map((row): EditorialCommunicationSummary => ({ ...editorialBase(row), excerpt: communicationExcerpt(row.plainTextStart, row.hasImages, row.plainTextCut), hasImages: row.hasImages }))
    },

    async setArchived(input) {
      return inTransaction(db, async (client) => {
        const result = input.archived
          ? await client.query(`update communications set status = 'ARCHIVED', archived_at = now(), archived_by_person_id = $2, updated_at = now() where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null and status = 'PUBLISHED'`, [input.organizationId, input.authorPersonId, input.id])
          : await client.query(`update communications set status = 'PUBLISHED', archived_at = null, archived_by_person_id = null, updated_at = now() where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null and status = 'ARCHIVED'`, [input.organizationId, input.authorPersonId, input.id])
        if (result.rowCount !== 1) return false
        await audit(client, input.organizationId, input.authorPersonId, input.archived ? "COMMUNICATION_ARCHIVED" : "COMMUNICATION_UNARCHIVED", input.id, {})
        return true
      })
    },

    async retire(input) {
      return inTransaction(db, async (client) => {
        const result = await client.query(
          `update communications set deleted_at = now(), deleted_by_person_id = $2 where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null`,
          [input.organizationId, input.authorPersonId, input.id],
        )
        if (result.rowCount !== 1) return false
        await audit(client, input.organizationId, input.authorPersonId, "COMMUNICATION_RETIRED", input.id, {})
        return true
      })
    },

    async listForModeration(organizationId, limit) {
      const result = await db.query<EditorialRow & { plainTextStart: string; plainTextCut: boolean; hasImages: boolean }>(
        `select ${EDITORIAL_SELECT}, ${LIGHT_CONTENT} from communications n ${EDITORIAL_JOINS}
         where n.organization_id = $1 and n.deleted_at is null and n.status <> 'DRAFT'
         order by coalesce(n.published_at, n.created_at) desc, n.id desc limit $2`,
        [organizationId, limit],
      )
      return result.rows.map((row): EditorialCommunicationSummary => ({ ...editorialBase(row), excerpt: communicationExcerpt(row.plainTextStart, row.hasImages, row.plainTextCut), hasImages: row.hasImages }))
    },

    async findForModeration(organizationId, id) {
      const result = await db.query<EditorialRow & { contentHtml: string; plainText: string }>(
        `select ${EDITORIAL_SELECT}, n.content_html "contentHtml", n.plain_text "plainText" from communications n ${EDITORIAL_JOINS}
         where n.organization_id = $1 and n.id = $2 and n.deleted_at is null and n.status <> 'DRAFT'`,
        [organizationId, id],
      )
      const row = result.rows[0]
      return row ? { ...editorialBase(row), contentHtml: row.contentHtml, plainText: row.plainText } : null
    },

    async retireAsModerator(input) {
      return inTransaction(db, async (client) => {
        const result = await client.query<{ author: string }>(
          `update communications set deleted_at = now(), deleted_by_person_id = $2 where organization_id = $1 and id = $3 and deleted_at is null and status <> 'DRAFT'
           returning author_person_id::text author`,
          [input.organizationId, input.moderatorPersonId, input.id],
        )
        const author = result.rows[0]?.author
        if (!author) return false
        // Moderação auditada: quem retirou, de quem era e por quê (o motivo é do moderador; o conteúdo da publicação não entra).
        await audit(client, input.organizationId, input.moderatorPersonId, "COMMUNICATION_RETIRED", input.id, { moderation: true, authorPersonId: author, reason: input.reason, accountId: input.moderatorAccountId })
        return true
      })
    },

    async countAudience(input) {
      return (await resolveAudience(db, input)).count
    },

    async audienceOptions(organizationId) {
      const [teams, subteams, products] = await Promise.all([
        db.query<{ id: string; name: string; universe: string | null }>(`select id::text id, name, operating_universe universe from teams where organization_id = $1 order by name`, [organizationId]),
        db.query<{ id: string; name: string; teamId: string; universe: string | null }>(`select id::text id, name, team_id::text "teamId", operating_universe universe from subteams where organization_id = $1 order by name`, [organizationId]),
        db.query<{ id: string; name: string; familyName: string | null }>(
          `select n.id::text id, n.name, f.name "familyName" from product_catalog_nodes n left join product_catalog_nodes f on f.id = n.parent_id
           where n.organization_id = $1 and n.kind = 'PRODUCT' and n.active order by f.name nulls first, n.name limit 2000`,
          [organizationId],
        ),
      ])
      const universes = [...new Set([...teams.rows, ...subteams.rows].map((item) => item.universe).filter((universe): universe is string => Boolean(universe)))].sort()
      return {
        teams: teams.rows.map((team) => ({ ...team, subteams: subteams.rows.filter((subteam) => subteam.teamId === team.id).map(({ id, name }) => ({ id, name })) })),
        universes,
        products: products.rows,
      }
    },

    async admitNewLinks(organizationId, links, options) {
      await assertNewScopeLinksAdmissible(db, organizationId, links, options)
    },

    async resolveReferences(organizationId, input) {
      if (input.productNodeId) {
        const product = await db.query(`select 1 from product_catalog_nodes where organization_id = $1 and id = $2`, [organizationId, input.productNodeId])
        if (!product.rowCount) return null
      }
      const links = await normalizeScopeLinks(db, organizationId, input.links)
      return links ? { links } : null
    },

    async findVisible(organizationId, viewerPersonId, id) {
      return (await loadCommunicationViews(db, organizationId, viewerPersonId, [id])).get(id) ?? null
    },

    async listReceived(organizationId, personId, limit) {
      // Recebidos (não os que a própria pessoa publicou): o Acompanhamento do colaborador. Cada ramo usa o índice próprio; a regra
      // final (no ar e no público) é a do fragmento único. Lista LEVE (achado U4-02): o conteúdo é lido pelo id, ao abrir.
      const result = await db.query<SummaryRow>(
        `with received as (
           (select n.id, n.published_at from communications n
            where n.organization_id = $1 and n.deleted_at is null and n.audience = 'ORGANIZATION' and n.author_person_id <> $2 and ${communicationLiveSql("n")}
            order by n.published_at desc, n.id desc limit $3)
           union all
           (select n.id, n.published_at from communications n
            where n.organization_id = $1 and n.deleted_at is null and n.audience = 'SEGMENT' and n.status = 'PUBLISHED' and n.author_person_id <> $2
              and ${communicationLiveSql("n")} and ${segmentMatchSql("n", "$2")}
            order by n.published_at desc, n.id desc limit $3)
           union all
           (select n.id, n.published_at from communication_recipients cr join communications n on n.id = cr.communication_id
            where cr.organization_id = $1 and cr.person_id = $2 and ${communicationLiveSql("n")}
            order by n.published_at desc, n.id desc limit $3)
         ), page as (select id from received order by published_at desc, id desc limit $3)
         select ${SUMMARY_SELECT} from communications n ${JOINS} where n.id in (select id from page) order by n.published_at desc, n.id desc`,
        [organizationId, personId, limit],
      )
      return result.rows.map((row) => toSummary(row, personId))
    },
  }
}
