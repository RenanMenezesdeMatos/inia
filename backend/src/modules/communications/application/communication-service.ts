import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { editCommunicationSchema, publishCommunicationSchema, type CommunicationAudience, type CommunicationTag, type CommunicationView, type ReceivedCommunicationSummary } from "../domain/communication.js"
import { prepareCommunicationContent } from "./communication-images.js"

/** O que a conta pode publicar, lido das atribuições de papel a cada request (nunca do JWT nem do corpo). */
export type CommunicationRights = { team: boolean; organization: boolean }

export type NewCommunication = {
  organizationId: string
  authorPersonId: string
  authorAccountId: string
  audience: CommunicationAudience
  title: string
  contentHtml: string
  plainText: string
  tags: CommunicationTag[]
}

/** Porta de persistência (Postgres em `infrastructure/`, memória em `testing/`). O público é calculado DENTRO do `insert`. */
export type CommunicationStore = {
  loadRights(organizationId: string, accountId: string): Promise<CommunicationRights>
  /** Grava o comunicado, os destinatários (público TEAM) e a auditoria numa transação. Público vazio = nada gravado (`null`). */
  insert(input: NewCommunication): Promise<{ id: string; recipientCount: number; publishedAt: string } | null>
  /** Recebidos pela pessoa, os mais recentes — lista LEVE, sem o conteúdo (achado U4-02). */
  listReceived(organizationId: string, personId: string, limit: number): Promise<ReceivedCommunicationSummary[]>
  /** Um comunicado inteiro, SÓ se quem lê o enxerga (autor, destinatário gravado ou público da organização); `null` = 404. */
  findVisible(organizationId: string, viewerPersonId: string, id: string): Promise<CommunicationView | null>
  /** Público do comunicado ativo DESTE autor; `null` = não existe, é de outra pessoa ou já foi retirado (a rota responde 404). */
  findOwnAudience(organizationId: string, authorPersonId: string, id: string): Promise<CommunicationAudience | null>
  /** Troca título/conteúdo/categorias guardando a versão anterior e a auditoria numa transação. `null` = não é mais do autor/ativo. */
  edit(input: { organizationId: string; authorPersonId: string; id: string; title: string; contentHtml: string; plainText: string; tags: CommunicationTag[] }): Promise<CommunicationView | null>
  /** Retira (exclusão lógica) com auditoria. `false` = não existe, é de outra pessoa ou já foi retirado. */
  retire(input: { organizationId: string; authorPersonId: string; id: string }): Promise<boolean>
}

const notFound = () => new DomainError("Comunicado não encontrado.", "COMMUNICATION_NOT_FOUND", 404)

export function rightsToPublish(rights: CommunicationRights): { canPublish: boolean; audiences: CommunicationAudience[] } {
  const audiences: CommunicationAudience[] = rights.team || rights.organization ? ["TEAM"] : []
  if (rights.organization) audiences.push("ORGANIZATION")
  return { canPublish: audiences.length > 0, audiences }
}

export async function publishCommunication(store: CommunicationStore, user: AuthTokenPayload, body: unknown) {
  const rights = await store.loadRights(user.organizationId, user.sub)
  const allowed = rightsToPublish(rights).audiences
  // Sem nenhuma das permissões: 403 antes de olhar o corpo.
  if (allowed.length === 0) throw new DomainError("Você não tem permissão para publicar comunicados.", "COMMUNICATION_FORBIDDEN", 403)
  const input = publishCommunicationSchema.parse(body)
  if (!allowed.includes(input.audience)) throw new DomainError("Você não tem permissão para publicar para toda a empresa.", "COMMUNICATION_AUDIENCE_FORBIDDEN", 403)
  const content = prepareCommunicationContent(input.contentHtml)
  const created = await store.insert({
    organizationId: user.organizationId,
    authorPersonId: user.personId,
    authorAccountId: user.sub,
    audience: input.audience,
    title: input.title,
    contentHtml: content.html,
    plainText: content.plainText,
    tags: [...new Set(input.tags)],
  })
  if (!created) throw new DomainError("Não há ninguém na sua equipe para receber o comunicado.", "COMMUNICATION_NO_AUDIENCE", 422)
  return created
}

/**
 * Editar: só o AUTOR, e só enquanto ainda tem o direito de publicar para aquele público (perdeu o papel = não edita; retirar
 * continua possível). Comunicado de outra pessoa, de outra organização ou já retirado = 404 (não revela que existe).
 */
export async function editCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string, body: unknown) {
  const audience = await store.findOwnAudience(user.organizationId, user.personId, id)
  if (!audience) throw notFound()
  const rights = await store.loadRights(user.organizationId, user.sub)
  if (!rightsToPublish(rights).audiences.includes(audience)) throw new DomainError("Você não tem mais permissão para publicar para este público; ainda pode retirar o comunicado.", "COMMUNICATION_EDIT_FORBIDDEN", 403)
  const input = editCommunicationSchema.parse(body)
  const content = prepareCommunicationContent(input.contentHtml)
  const edited = await store.edit({ organizationId: user.organizationId, authorPersonId: user.personId, id, title: input.title, contentHtml: content.html, plainText: content.plainText, tags: [...new Set(input.tags)] })
  if (!edited) throw notFound()
  return edited
}

/** Ler um comunicado pelo id: a visibilidade é conferida de novo para quem lê (outro público, outra organização ou retirado = 404). */
export async function readCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string): Promise<CommunicationView> {
  const view = await store.findVisible(user.organizationId, user.personId, id)
  if (!view) throw notFound()
  return view
}

/** Retirar: só o AUTOR, sempre (tirar de circulação nunca amplia exposição). Some do Acompanhamento de todos; o registro fica. */
export async function retireCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string) {
  if (!(await store.retire({ organizationId: user.organizationId, authorPersonId: user.personId, id }))) throw notFound()
}
