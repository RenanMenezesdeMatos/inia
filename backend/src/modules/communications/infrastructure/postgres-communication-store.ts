import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { canAnywhere, canOrganizationWide } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import type { CommunicationStore, NewCommunication } from "../application/communication-service.js"
import { COMMUNICATION_EXCERPT_LENGTH, communicationExcerpt, type CommunicationAudience, type CommunicationTag, type CommunicationView, type ReceivedCommunicationSummary } from "../domain/communication.js"

/**
 * Quem enxerga o comunicado `alias` (fragmento ÚNICO — usado pelo Acompanhamento do colaborador e pelo ramo NOTICE do feed da
 * estrutura): quem publicou, quem está entre os destinatários gravados ou qualquer pessoa da organização quando o público é ela
 * inteira. `personParam` é o placeholder do id da pessoa que lê (ex.: `$4`). Excluído (lógico) nunca aparece.
 */
export function communicationVisibleToSql(alias: string, personParam: string): string {
  return `(${alias}.deleted_at is null and (${alias}.author_person_id = ${personParam} or ${alias}.audience = 'ORGANIZATION'
    or exists (select 1 from communication_recipients cr where cr.communication_id = ${alias}.id and cr.organization_id = ${alias}.organization_id and cr.person_id = ${personParam})))`
}

type Row = { id: string; title: string; contentHtml: string; plainText: string; tags: string[]; audience: string; authorPersonId: string; authorName: string; recipientCount: number; publishedAt: Date; editedAt: Date | null }

const SELECT = `n.id::text id, n.title, n.content_html "contentHtml", n.plain_text "plainText", n.tags, n.audience, n.author_person_id::text "authorPersonId",
  p.name "authorName", n.recipient_count "recipientCount", n.published_at "publishedAt", n.edited_at "editedAt"`
const JOINS = `join people p on p.id = n.author_person_id`

/** Lista leve: sem `content_html` nem o texto inteiro; só um prefixo do texto e se há imagem (o HTML gravado é sempre o refeito
 * pelo servidor, então `<img ` só aparece como imagem de verdade). */
type SummaryRow = Omit<Row, "contentHtml" | "plainText"> & { plainTextStart: string; plainTextCut: boolean; hasImages: boolean }
const EXCERPT_SOURCE_LENGTH = COMMUNICATION_EXCERPT_LENGTH * 4
const SUMMARY_SELECT = `n.id::text id, n.title, left(n.plain_text, ${EXCERPT_SOURCE_LENGTH}) "plainTextStart", char_length(n.plain_text) > ${EXCERPT_SOURCE_LENGTH} "plainTextCut",
  strpos(n.content_html, '<img ') > 0 "hasImages", n.tags, n.audience, n.author_person_id::text "authorPersonId",
  p.name "authorName", n.recipient_count "recipientCount", n.published_at "publishedAt", n.edited_at "editedAt"`

function toSummary(row: SummaryRow, viewerId: string): ReceivedCommunicationSummary {
  return { ...baseView(row, viewerId), excerpt: communicationExcerpt(row.plainTextStart, row.hasImages, row.plainTextCut), hasImages: row.hasImages }
}

function toView(row: Row, viewerId: string): CommunicationView {
  return { ...baseView(row, viewerId), contentHtml: row.contentHtml, plainText: row.plainText }
}

function baseView(row: Omit<Row, "contentHtml" | "plainText">, viewerId: string): Omit<CommunicationView, "contentHtml" | "plainText"> {
  const authoredByViewer = row.authorPersonId === viewerId
  return {
    id: row.id,
    title: row.title,
    tags: row.tags as CommunicationTag[],
    audience: row.audience as CommunicationAudience,
    author: { personId: row.authorPersonId, name: row.authorName },
    recipientCount: authoredByViewer ? row.recipientCount : null,
    authoredByViewer,
    publishedAt: new Date(row.publishedAt).toISOString(),
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null,
  }
}

/** Conteúdo dos comunicados de uma página do feed (montado DEPOIS do LIMIT, só para os itens exibidos), por id. */
export async function loadCommunicationViews(db: Pick<Database, "query">, organizationId: string, viewerId: string, ids: readonly string[]): Promise<Map<string, CommunicationView>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<Row>(`select ${SELECT} from communications n ${JOINS} where n.organization_id = $1 and n.id = any($2::uuid[]) and ${communicationVisibleToSql("n", "$3")}`, [organizationId, ids, viewerId])
  return new Map(result.rows.map((row) => [row.id, toView(row, viewerId)]))
}

export function createPostgresCommunicationStore(db: Database): CommunicationStore {
  const access = createPostgresAccessRepository(db)
  return {
    async loadRights(organizationId, accountId) {
      const context = await access.loadContext(organizationId, accountId)
      return { team: canAnywhere(context, "communications.publish_team"), organization: canOrganizationWide(context, "communications.publish_organization") }
    },

    async insert(input: NewCommunication) {
      return inTransaction(db, async (client) => {
        // Público calculado AGORA, pelo servidor: a estrutura (reports_to) de quem publica, pessoas ativas; ou a organização inteira.
        // `union` na CTE: um ciclo em reports_to termina em vez de travar (a mesma defesa do leitor da estrutura).
        const audience = input.audience === "TEAM"
          ? await client.query<{ id: string }>(
            `with recursive below as (
               select id from people where organization_id = $1 and reports_to_id = $2
               union
               select p.id from people p join below b on p.reports_to_id = b.id where p.organization_id = $1
             )
             select p.id::text id from people p where p.id in (select id from below) and p.active and p.id <> $2`,
            [input.organizationId, input.authorPersonId],
          )
          : await client.query<{ id: string }>(`select count(*)::int::text id from people where organization_id = $1 and active and id <> $2`, [input.organizationId, input.authorPersonId])
        const recipientCount = input.audience === "TEAM" ? audience.rows.length : Number(audience.rows[0]?.id ?? 0)
        if (recipientCount === 0) return null
        const created = await client.query<{ id: string; publishedAt: Date }>(
          `insert into communications (organization_id, author_person_id, author_account_id, audience, title, content_html, plain_text, tags, recipient_count)
           values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9) returning id::text id, published_at "publishedAt"`,
          [input.organizationId, input.authorPersonId, input.authorAccountId, input.audience, input.title, input.contentHtml, input.plainText, input.tags, recipientCount],
        )
        const row = created.rows[0]!
        if (input.audience === "TEAM") {
          await client.query(
            `insert into communication_recipients (communication_id, person_id, organization_id) select $1, unnest($2::uuid[]), $3`,
            [row.id, audience.rows.map((recipient) => recipient.id), input.organizationId],
          )
        }
        // Auditoria sem o conteúdo (título e texto ficam no registro do comunicado, que já é rastreável pelo id).
        await client.query(
          `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'COMMUNICATION_PUBLISHED', 'communication', $3, $4)`,
          [input.organizationId, input.authorPersonId, row.id, JSON.stringify({ audience: input.audience, recipientCount, tags: input.tags, accountId: input.authorAccountId })],
        )
        return { id: row.id, recipientCount, publishedAt: new Date(row.publishedAt).toISOString() }
      })
    },

    async findOwnAudience(organizationId, authorPersonId, id) {
      const result = await db.query<{ audience: CommunicationAudience }>(`select audience from communications where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null`, [organizationId, authorPersonId, id])
      return result.rows[0]?.audience ?? null
    },

    async edit(input) {
      return inTransaction(db, async (client) => {
        // Trava a linha do autor: duas edições ao mesmo tempo não perdem a versão do meio.
        const current = await client.query<{ title: string; content_html: string; plain_text: string; tags: string[] }>(
          `select title, content_html, plain_text, tags from communications where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null for update`,
          [input.organizationId, input.authorPersonId, input.id],
        )
        const previous = current.rows[0]
        if (!previous) return null
        await client.query(
          `insert into communication_revisions (communication_id, organization_id, title, content_html, plain_text, tags, replaced_by) values ($1, $2, $3, $4, $5, $6::text[], $7)`,
          [input.id, input.organizationId, previous.title, previous.content_html, previous.plain_text, previous.tags, input.authorPersonId],
        )
        await client.query(
          `update communications set title = $2, content_html = $3, plain_text = $4, tags = $5::text[], edited_at = now(), edited_by = $6 where id = $1`,
          [input.id, input.title, input.contentHtml, input.plainText, input.tags, input.authorPersonId],
        )
        await client.query(
          `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'COMMUNICATION_EDITED', 'communication', $3, $4)`,
          [input.organizationId, input.authorPersonId, input.id, JSON.stringify({ tags: input.tags, titleChanged: previous.title !== input.title, contentChanged: previous.content_html !== input.contentHtml })],
        )
        const row = await client.query<Row>(`select ${SELECT} from communications n ${JOINS} where n.id = $1`, [input.id])
        return toView(row.rows[0]!, input.authorPersonId)
      })
    },

    async retire(input) {
      return inTransaction(db, async (client) => {
        const result = await client.query(
          `update communications set deleted_at = now(), deleted_by_person_id = $2 where organization_id = $1 and author_person_id = $2 and id = $3 and deleted_at is null`,
          [input.organizationId, input.authorPersonId, input.id],
        )
        if (result.rowCount !== 1) return false
        await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'COMMUNICATION_RETIRED', 'communication', $3, '{}'::jsonb)`, [input.organizationId, input.authorPersonId, input.id])
        return true
      })
    },

    async findVisible(organizationId, viewerPersonId, id) {
      return (await loadCommunicationViews(db, organizationId, viewerPersonId, [id])).get(id) ?? null
    },

    async listReceived(organizationId, personId, limit) {
      // Recebidos (não os que a própria pessoa publicou): o Acompanhamento do colaborador. Os dois ramos usam os índices próprios.
      // Lista LEVE (achado U4-02): o conteúdo (até 2 MB cada) é lido pelo id, ao abrir — `findVisible`.
      const result = await db.query<SummaryRow>(
        `with received as (
           (select n.id, n.published_at from communications n
            where n.organization_id = $1 and n.deleted_at is null and n.audience = 'ORGANIZATION' and n.author_person_id <> $2
            order by n.published_at desc, n.id desc limit $3)
           union all
           (select n.id, n.published_at from communication_recipients cr join communications n on n.id = cr.communication_id
            where cr.organization_id = $1 and cr.person_id = $2 and n.deleted_at is null
            order by n.published_at desc, n.id desc limit $3)
         ), page as (select id from received order by published_at desc, id desc limit $3)
         select ${SUMMARY_SELECT} from communications n ${JOINS} where n.id in (select id from page) order by n.published_at desc, n.id desc`,
        [organizationId, personId, limit],
      )
      return result.rows.map((row) => toSummary(row, personId))
    },
  }
}
