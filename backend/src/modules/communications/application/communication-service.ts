import { linkKey, scopeLinkProblems, sortLinks, type ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import {
  audiencePreviewSchema,
  communicationWentOut,
  COMMUNICATION_MAX_SCHEDULE_DAYS,
  COMMUNICATION_SCHEDULE_TOLERANCE_MS,
  editCommunicationSchema,
  publishCommunicationSchema,
  type CommunicationAudience,
  type CommunicationSegment,
  type CommunicationSegmentInput,
  type CommunicationStatus,
  moderationRetireSchema,
  type CommunicationTag,
  type CommunicationView,
  type EditorialCommunication,
  type EditorialCommunicationSummary,
  type ReceivedCommunicationSummary,
} from "../domain/communication.js"
import { prepareCommunicationContent } from "./communication-images.js"

/** O que a conta pode publicar, lido das atribuições de papel a cada request (nunca do JWT nem do corpo). */
export type CommunicationRights = { team: boolean; organization: boolean; moderate?: boolean }

/** Campos editoriais já validados e saneados, prontos para gravar. */
export type CommunicationFields = {
  title: string
  contentHtml: string
  plainText: string
  tags: CommunicationTag[]
  summary: string | null
  featured: boolean
  displayUntil: Date | null
  productNodeId: string | null
  audience: CommunicationAudience
  segment: CommunicationSegment
}

export type NewCommunication = CommunicationFields & {
  organizationId: string
  authorPersonId: string
  authorAccountId: string
  status: Extract<CommunicationStatus, "DRAFT" | "PUBLISHED">
  /** Instante da publicação (agora ou agendado); null = rascunho. */
  publishedAt: Date | null
}

export type CommunicationUpdate = CommunicationFields & {
  organizationId: string
  authorPersonId: string
  authorAccountId: string
  id: string
  status: Extract<CommunicationStatus, "DRAFT" | "PUBLISHED">
  publishedAt: Date | null
}

export type SavedCommunication = { id: string; status: CommunicationStatus; recipientCount: number; publishedAt: string | null }

export type AudienceOptions = {
  teams: { id: string; name: string; universe: string | null; subteams: { id: string; name: string }[] }[]
  universes: string[]
  products: { id: string; name: string; familyName: string | null }[]
}

/** Porta de persistência (Postgres em `infrastructure/`, memória em `testing/`). O público é calculado DENTRO da gravação. */
export type CommunicationStore = {
  loadRights(organizationId: string, accountId: string): Promise<CommunicationRights>
  /** Grava o comunicado (rascunho ou publicado), os destinatários (TEAM) e a auditoria numa transação. Público vazio ao publicar = `null`. */
  insert(input: NewCommunication): Promise<SavedCommunication | null>
  /** Altera um comunicado ATIVO do autor (não arquivado). `null` = não existe/não é dele; `"EMPTY_AUDIENCE"` = público vazio ao publicar. */
  update(input: CommunicationUpdate): Promise<SavedCommunication | "EMPTY_AUDIENCE" | null>
  /** Recebidos pela pessoa, os mais recentes — lista LEVE, sem o conteúdo (achado U4-02). */
  listReceived(organizationId: string, personId: string, limit: number): Promise<ReceivedCommunicationSummary[]>
  /** Um comunicado inteiro, SÓ se quem lê o enxerga (publicado, no período de exibição e no público); `null` = 404. */
  findVisible(organizationId: string, viewerPersonId: string, id: string): Promise<CommunicationView | null>
  /** A publicação inteira DESTE autor (rascunho e arquivado incluídos); `null` = não existe, é de outra pessoa ou foi retirada. */
  findOwn(organizationId: string, authorPersonId: string, id: string): Promise<EditorialCommunication | null>
  /** Publicações do autor para a área editorial (lista leve, mais recentes primeiro). */
  listOwn(organizationId: string, authorPersonId: string, limit: number): Promise<EditorialCommunicationSummary[]>
  /** Arquivar (`true`) ou desarquivar (`false`) com auditoria. `false` no retorno = não existe/não é dele/estado não permite. */
  setArchived(input: { organizationId: string; authorPersonId: string; id: string; archived: boolean }): Promise<boolean>
  /** Retira (exclusão lógica) com auditoria. `false` = não existe, é de outra pessoa ou já foi retirado. */
  retire(input: { organizationId: string; authorPersonId: string; id: string }): Promise<boolean>
  /** Moderação: publicações de TODAS as pessoas da organização que já saíram ou estão agendadas (rascunho é privado do autor). */
  listForModeration(organizationId: string, limit: number): Promise<EditorialCommunicationSummary[]>
  /** Moderação: uma publicação (não rascunho, não retirada) de qualquer autor da organização; `null` = 404. */
  findForModeration(organizationId: string, id: string): Promise<EditorialCommunication | null>
  /** Moderação: retira a publicação de qualquer autor com o motivo na auditoria. `false` = não existe, é rascunho ou já foi retirada. */
  retireAsModerator(input: { organizationId: string; moderatorPersonId: string; moderatorAccountId: string; id: string; reason: string }): Promise<boolean>
  /** Quantas pessoas ativas o público alcançaria agora (prévia; quem publica não entra). */
  countAudience(input: { organizationId: string; authorPersonId: string; audience: CommunicationAudience; segment: CommunicationSegment }): Promise<number>
  /** Grupos/Subgrupos, universos em uso e produtos ativos da organização (opções do público e do produto relacionado). */
  audienceOptions(organizationId: string): Promise<AudienceOptions>
  /**
   * Confere vínculos e produto na organização: cada Subgrupo ganha o Grupo-pai REAL (e um `teamId` enviado que não é o pai é recusado).
   * `null` = algum Grupo, Subgrupo ou o produto não existe nela.
   */
  resolveReferences(organizationId: string, input: { links: { teamId: string | null; subteamId: string | null }[]; productNodeId: string | null }): Promise<{ links: ScopeLink[] } | null>
  /**
   * Vínculos NOVOS (fora de `previous`) admissíveis: do universo escolhido (quando há) e com ao menos um operador em produção — a mesma
   * regra do seletor (`assertNewScopeLinksAdmissible`); lança 422 com a lista. O que já estava salvo continua aceito.
   */
  admitNewLinks(organizationId: string, links: readonly ScopeLink[], options: { previous: readonly ScopeLink[]; universe: string | null }): Promise<void>
}

const notFound = () => new DomainError("Comunicado não encontrado.", "COMMUNICATION_NOT_FOUND", 404)
const DAY_MS = 86_400_000

export function rightsToPublish(rights: CommunicationRights): { canPublish: boolean; audiences: CommunicationAudience[] } {
  const audiences: CommunicationAudience[] = rights.team || rights.organization ? ["TEAM"] : []
  if (rights.organization) audiences.push("ORGANIZATION", "SEGMENT")
  return { canPublish: audiences.length > 0, audiences }
}

async function requirePublisher(store: CommunicationStore, user: AuthTokenPayload): Promise<CommunicationAudience[]> {
  const allowed = rightsToPublish(await store.loadRights(user.organizationId, user.sub)).audiences
  // Sem nenhuma das permissões: 403 antes de olhar o corpo.
  if (allowed.length === 0) throw new DomainError("Você não tem permissão para publicar comunicados.", "COMMUNICATION_FORBIDDEN", 403)
  return allowed
}

const EMPTY_SEGMENT: CommunicationSegment = { universe: null, links: [] }

/** Mesmo recorte? (universo + o conjunto de vínculos, sem depender da ordem nem dos nomes). */
const segmentKey = (segment: Pick<CommunicationSegment, "universe" | "links">) => `${segment.universe ?? ""}|${segment.links.map(linkKey).sort().join(",")}`

/**
 * Recorte validado no servidor (223): fora de SEGMENT, vazio; universo ou ao menos um vínculo; cada vínculo com o Grupo-pai real; sem
 * vínculo repetido nem Subgrupo junto do próprio Grupo inteiro. O produto relacionado é conferido junto.
 */
async function resolveSegment(store: CommunicationStore, organizationId: string, audience: CommunicationAudience, segment: CommunicationSegmentInput | CommunicationSegment | null | undefined, productNodeId: string | null, admission: { previous: readonly ScopeLink[] } | null = { previous: [] }): Promise<CommunicationSegment> {
  const value = audience === "SEGMENT" ? (segment ?? EMPTY_SEGMENT) : EMPTY_SEGMENT
  if (audience === "SEGMENT" && !value.universe && value.links.length === 0) {
    throw new DomainError("Escolha o universo, ao menos um Grupo ou ao menos um Subgrupo para o público.", "COMMUNICATION_SEGMENT_EMPTY", 422)
  }
  if (value.links.length === 0 && !productNodeId) return { universe: value.universe ?? null, links: [] }
  const resolved = await store.resolveReferences(organizationId, { links: value.links.map((link) => ({ teamId: link.teamId ?? null, subteamId: link.subteamId ?? null })), productNodeId })
  if (!resolved) throw new DomainError("Um Grupo, Subgrupo ou produto escolhido não existe nesta organização (o Subgrupo precisa ser do Grupo informado).", "COMMUNICATION_REFERENCE_INVALID", 422)
  const problems = scopeLinkProblems(resolved.links)
  if (problems.length > 0) throw new DomainError(problems[0]!.code === "DUPLICATE" ? "O mesmo Grupo/Subgrupo foi escolhido mais de uma vez." : "Um Subgrupo foi escolhido junto com o Grupo inteiro dele: escolha o Grupo inteiro OU os Subgrupos.", "COMMUNICATION_SEGMENT_INVALID", 422)
  const links = sortLinks(resolved.links)
  if (admission) await store.admitNewLinks(organizationId, links, { previous: admission.previous, universe: value.universe ?? null })
  return { universe: value.universe ?? null, links }
}

/** Instante da publicação: ausente = agora; um pouco no passado (relógio do navegador) = agora; até um ano à frente. */
function resolvePublishAt(publishAt: string | null | undefined, now: Date): Date {
  if (!publishAt) return now
  const at = new Date(publishAt)
  if (at.getTime() < now.getTime() - COMMUNICATION_SCHEDULE_TOLERANCE_MS) throw new DomainError("A data de publicação já passou. Escolha agora ou um horário futuro.", "COMMUNICATION_SCHEDULE_IN_PAST", 422)
  if (at.getTime() > now.getTime() + COMMUNICATION_MAX_SCHEDULE_DAYS * DAY_MS) throw new DomainError("O agendamento pode ser de no máximo um ano.", "COMMUNICATION_SCHEDULE_TOO_FAR", 422)
  return at.getTime() < now.getTime() ? now : at
}

function resolveDisplayUntil(displayUntil: string | null | undefined, publishedAt: Date | null, now: Date): Date | null {
  if (!displayUntil) return null
  const until = new Date(displayUntil)
  const start = publishedAt ?? now
  if (until.getTime() <= start.getTime()) throw new DomainError("O fim da exibição precisa ser depois do início da publicação.", "COMMUNICATION_DISPLAY_WINDOW_INVALID", 422)
  if (until.getTime() > start.getTime() + COMMUNICATION_MAX_SCHEDULE_DAYS * DAY_MS) throw new DomainError("O período de exibição pode ser de no máximo um ano.", "COMMUNICATION_DISPLAY_WINDOW_TOO_LONG", 422)
  return until
}

/** Conteúdo saneado. Rascunho pode estar vazio; publicar exige texto ou imagem e ao menos uma categoria. */
function prepareContent(contentHtml: string, publishing: boolean): { html: string; plainText: string } {
  if (!publishing && contentHtml.trim() === "") return { html: "", plainText: "" }
  return prepareCommunicationContent(contentHtml)
}

function requireComplete(fields: { tags: CommunicationTag[] }) {
  if (fields.tags.length === 0) throw new DomainError("Selecione ao menos uma categoria.", "COMMUNICATION_TAGS_REQUIRED", 422)
}



/**
 * Criar: rascunho (`mode: "DRAFT"`) ou publicação (agora ou agendada). Sem `mode` = publicar agora — o corpo de antes continua
 * valendo igual. Público sempre conferido contra a permissão; SEGMENT só com a permissão de organização.
 */
export async function publishCommunication(store: CommunicationStore, user: AuthTokenPayload, body: unknown, now: Date = new Date()): Promise<SavedCommunication> {
  const allowed = await requirePublisher(store, user)
  const input = publishCommunicationSchema.parse(body)
  const publishing = (input.mode ?? "PUBLISH") === "PUBLISH"
  const audience = input.audience ?? "TEAM"
  if (!allowed.includes(audience)) throw new DomainError("Você não tem permissão para publicar para este público.", "COMMUNICATION_AUDIENCE_FORBIDDEN", 403)
  const productNodeId = input.productNodeId ?? null
  const segment = await resolveSegment(store, user.organizationId, audience, input.segment, productNodeId)
  const tags = [...new Set(input.tags)]
  if (publishing) requireComplete({ tags })
  const content = prepareContent(input.contentHtml, publishing)
  const publishedAt = publishing ? resolvePublishAt(input.publishAt, now) : null
  const created = await store.insert({
    organizationId: user.organizationId,
    authorPersonId: user.personId,
    authorAccountId: user.sub,
    status: publishing ? "PUBLISHED" : "DRAFT",
    publishedAt,
    title: input.title,
    contentHtml: content.html,
    plainText: content.plainText,
    tags,
    summary: input.summary?.trim() || null,
    featured: input.featured ?? false,
    displayUntil: resolveDisplayUntil(input.displayUntil, publishedAt, now),
    productNodeId,
    audience,
    segment,
  })
  if (!created) throw new DomainError("Não há ninguém neste público para receber o comunicado.", "COMMUNICATION_NO_AUDIENCE", 422)
  return created
}

/**
 * Alterar: só o AUTOR, e só enquanto ainda tem o direito de publicar para aquele público (perdeu o papel = não edita; arquivar e
 * retirar continuam possíveis). Rascunho: tudo muda; `mode: "PUBLISH"` publica (agora ou agendado). Agendado (ainda não saiu):
 * tudo muda, inclusive público e horário, e `mode: "DRAFT"` volta a rascunho. Já publicado: título, conteúdo, categorias, resumo,
 * destaque, produto e fim da exibição — público e instante da publicação ficam fixos (alguém pode já ter lido). Arquivado: 409
 * (desarquive antes). Comunicado de outra pessoa, de outra organização ou retirado = 404.
 */
export async function editCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string, body: unknown, now: Date = new Date()): Promise<EditorialCommunication> {
  const current = await store.findOwn(user.organizationId, user.personId, id)
  if (!current) throw notFound()
  if (current.status === "ARCHIVED") throw new DomainError("Desarquive o comunicado antes de alterá-lo.", "COMMUNICATION_ARCHIVED", 409)
  const allowed = rightsToPublish(await store.loadRights(user.organizationId, user.sub)).audiences
  if (!allowed.includes(current.audience)) throw new DomainError("Você não tem mais permissão para publicar para este público; ainda pode arquivar ou retirar o comunicado.", "COMMUNICATION_EDIT_FORBIDDEN", 403)
  const input = editCommunicationSchema.parse(body)
  const wentOut = communicationWentOut(current, now)

  const requestedAudience = input.audience ?? current.audience
  const productNodeId = input.productNodeId === undefined ? current.productNodeId : input.productNodeId
  const requestedSegment = input.segment !== undefined || input.audience !== undefined
    ? await resolveSegment(store, user.organizationId, requestedAudience, input.segment ?? (requestedAudience === current.audience ? current.segment : null), productNodeId, { previous: current.audience === "SEGMENT" ? current.segment.links : [] })
    : current.segment
  const audienceChanged = requestedAudience !== current.audience || (input.segment !== undefined && segmentKey(requestedSegment) !== segmentKey(current.segment))
  if (wentOut && audienceChanged) throw new DomainError("O público não muda depois que o comunicado saiu. Arquive e crie outro, se precisar.", "COMMUNICATION_AUDIENCE_LOCKED", 409)
  if (wentOut && input.publishAt) throw new DomainError("O comunicado já foi publicado; o instante da publicação não muda.", "COMMUNICATION_PUBLISHED_AT_LOCKED", 409)
  if (wentOut && input.mode === "DRAFT") throw new DomainError("Um comunicado que já saiu não volta a rascunho. Arquive-o para tirá-lo de circulação.", "COMMUNICATION_ALREADY_OUT", 409)
  if (!allowed.includes(requestedAudience)) throw new DomainError("Você não tem permissão para publicar para este público.", "COMMUNICATION_AUDIENCE_FORBIDDEN", 403)

  const audience = wentOut ? current.audience : requestedAudience
  // Depois que saiu, o público fica fixo (alguém pode já ter lido); antes, vale o recorte validado acima.
  const segment = wentOut ? current.segment : requestedSegment

  const status: "DRAFT" | "PUBLISHED" = wentOut ? "PUBLISHED" : input.mode === "PUBLISH" ? "PUBLISHED" : input.mode === "DRAFT" ? "DRAFT" : current.status === "DRAFT" ? "DRAFT" : "PUBLISHED"
  const publishing = status === "PUBLISHED"
  const publishedAt = wentOut
    ? new Date(current.publishedAt!)
    : publishing
      ? input.publishAt !== undefined || input.mode === "PUBLISH" ? resolvePublishAt(input.publishAt, now) : new Date(current.publishedAt ?? now)
      : null
  const tags = input.tags ? [...new Set(input.tags)] : current.tags
  if (publishing) requireComplete({ tags })
  // Rascunho que vira publicação passa de novo pela conferência completa (o rascunho pode ter sido guardado vazio).
  const content = input.contentHtml !== undefined
    ? prepareContent(input.contentHtml, publishing)
    : publishing && current.status === "DRAFT" ? prepareContent(current.contentHtml, true) : { html: current.contentHtml, plainText: current.plainText }
  const displayUntil = input.displayUntil !== undefined ? resolveDisplayUntil(input.displayUntil, publishedAt, now) : current.displayUntil ? new Date(current.displayUntil) : null
  if (displayUntil && publishedAt && displayUntil.getTime() <= publishedAt.getTime()) throw new DomainError("O fim da exibição precisa ser depois do início da publicação.", "COMMUNICATION_DISPLAY_WINDOW_INVALID", 422)

  const saved = await store.update({
    organizationId: user.organizationId,
    authorPersonId: user.personId,
    authorAccountId: user.sub,
    id,
    status,
    publishedAt,
    title: input.title ?? current.title,
    contentHtml: content.html,
    plainText: content.plainText,
    tags,
    summary: input.summary === undefined ? current.summary : input.summary?.trim() || null,
    featured: input.featured ?? current.featured,
    displayUntil,
    productNodeId,
    audience,
    segment,
  })
  if (saved === "EMPTY_AUDIENCE") throw new DomainError("Não há ninguém neste público para receber o comunicado.", "COMMUNICATION_NO_AUDIENCE", 422)
  if (!saved) throw notFound()
  // Devolve a publicação como o editor a mostra (estado derivado, público, datas) — a tela não precisa reler.
  const updated = await store.findOwn(user.organizationId, user.personId, id)
  if (!updated) throw notFound()
  return updated
}

/** Ler um comunicado pelo id: a visibilidade é conferida de novo para quem lê (outro público, outra organização ou retirado = 404). */
export async function readCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string): Promise<CommunicationView> {
  const view = await store.findVisible(user.organizationId, user.personId, id)
  if (!view) throw notFound()
  return view
}

/** A publicação inteira para o autor editar (área editorial). Exige ainda poder publicar (a área é de quem publica). */
export async function readOwnCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string): Promise<EditorialCommunication> {
  await requirePublisher(store, user)
  const own = await store.findOwn(user.organizationId, user.personId, id)
  if (!own) throw notFound()
  return own
}

export async function listOwnCommunications(store: CommunicationStore, user: AuthTokenPayload, limit: number): Promise<EditorialCommunicationSummary[]> {
  await requirePublisher(store, user)
  return store.listOwn(user.organizationId, user.personId, limit)
}

/** Arquivar tira de circulação (feed e chat) sem excluir; sempre permitido ao autor. Desarquivar exige ainda poder publicar. */
export async function setCommunicationArchived(store: CommunicationStore, user: AuthTokenPayload, id: string, archived: boolean) {
  const current = await store.findOwn(user.organizationId, user.personId, id)
  if (!current) throw notFound()
  if (archived && current.status === "DRAFT") throw new DomainError("Rascunho não é arquivado: descarte-o pelo menu.", "COMMUNICATION_DRAFT_NOT_ARCHIVABLE", 409)
  if (!archived) {
    const allowed = rightsToPublish(await store.loadRights(user.organizationId, user.sub)).audiences
    if (!allowed.includes(current.audience)) throw new DomainError("Você não tem mais permissão para publicar para este público.", "COMMUNICATION_EDIT_FORBIDDEN", 403)
  }
  if (!(await store.setArchived({ organizationId: user.organizationId, authorPersonId: user.personId, id, archived }))) {
    throw new DomainError(archived ? "O comunicado já está arquivado." : "O comunicado não está arquivado.", "COMMUNICATION_ARCHIVE_STATE", 409)
  }
}

/** Retirar: só o AUTOR, sempre (tirar de circulação nunca amplia exposição). Some do Acompanhamento de todos; o registro fica. */
export async function retireCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string) {
  if (!(await store.retire({ organizationId: user.organizationId, authorPersonId: user.personId, id }))) throw notFound()
}

export async function previewCommunicationAudience(store: CommunicationStore, user: AuthTokenPayload, body: unknown): Promise<{ recipientCount: number }> {
  const allowed = await requirePublisher(store, user)
  const input = audiencePreviewSchema.parse(body)
  if (!allowed.includes(input.audience)) throw new DomainError("Você não tem permissão para publicar para este público.", "COMMUNICATION_AUDIENCE_FORBIDDEN", 403)
  // Prévia: só a contagem do recorte (a admissão dos vínculos novos é conferida ao salvar/publicar).
  const segment = await resolveSegment(store, user.organizationId, input.audience, input.segment, null, null)
  return { recipientCount: await store.countAudience({ organizationId: user.organizationId, authorPersonId: user.personId, audience: input.audience, segment }) }
}

export async function communicationAudienceOptions(store: CommunicationStore, user: AuthTokenPayload): Promise<AudienceOptions & { audiences: CommunicationAudience[] }> {
  const audiences = await requirePublisher(store, user)
  const options = await store.audienceOptions(user.organizationId)
  // Quem só publica para a própria equipe não precisa (nem deve) ver o mapa de Grupos da organização.
  return audiences.includes("SEGMENT") ? { ...options, audiences } : { teams: [], universes: [], products: options.products, audiences }
}

async function requireModerator(store: CommunicationStore, user: AuthTokenPayload) {
  if (!(await store.loadRights(user.organizationId, user.sub)).moderate) throw new DomainError("Você não tem permissão para moderar publicações.", "COMMUNICATION_MODERATION_FORBIDDEN", 403)
}

/** Moderação — lista as publicações da organização (de qualquer autor; rascunhos ficam de fora). */
export async function listCommunicationsForModeration(store: CommunicationStore, user: AuthTokenPayload, limit: number): Promise<EditorialCommunicationSummary[]> {
  await requireModerator(store, user)
  return store.listForModeration(user.organizationId, limit)
}

export async function readCommunicationForModeration(store: CommunicationStore, user: AuthTokenPayload, id: string): Promise<EditorialCommunication> {
  await requireModerator(store, user)
  const found = await store.findForModeration(user.organizationId, id)
  if (!found) throw notFound()
  return found
}

/**
 * Moderação — retirar a publicação de outra pessoa (ou a própria) com MOTIVO: exclusão lógica (sai do Acompanhamento e do chat na
 * hora; volta por Consultar dados › Itens excluídos), auditada com quem moderou, o autor e o motivo. Nunca altera o conteúdo.
 */
export async function moderateRetireCommunication(store: CommunicationStore, user: AuthTokenPayload, id: string, body: unknown) {
  await requireModerator(store, user)
  const input = moderationRetireSchema.parse(body)
  if (!(await store.retireAsModerator({ organizationId: user.organizationId, moderatorPersonId: user.personId, moderatorAccountId: user.sub, id, reason: input.reason }))) throw notFound()
}

