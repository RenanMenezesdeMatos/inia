import { apiGet, apiPost, apiSend } from "@/lib/api/api-client"
import {
  audienceOptionsSchema,
  audiencePreviewResultSchema,
  communicationSchema,
  editorialCommunicationSchema,
  editorialCommunicationsSchema,
  publishedCommunicationSchema,
  receivedCommunicationsSchema,
  type AudienceOptions,
  type Communication,
  type CommunicationSegment,
  type EditorialCommunication,
  type EditorialCommunicationSummary,
  type EditorialPayload,
  type PublishedCommunication,
  type ReceivedCommunication,
} from "@/schemas/communications/communication.schema"

const BASE = "/api/v1/communications"
const byId = (id: string) => `${BASE}/${encodeURIComponent(id)}`

/** Cria uma publicação: rascunho ou publicada (agora ou agendada). O público é calculado no servidor pela permissão de quem publica. */
export async function createCommunication(input: EditorialPayload): Promise<PublishedCommunication> {
  return publishedCommunicationSchema.parse(await apiPost<unknown>(BASE, input))
}

/** Altera uma publicação do autor; devolve a publicação como o editor a mostra (estado derivado, público, datas). */
export async function updateCommunication(id: string, input: Partial<EditorialPayload>): Promise<EditorialCommunication> {
  return editorialCommunicationSchema.parse(await apiSend<unknown>(byId(id), "PATCH", input))
}

/** Comunicados que a pessoa da sessão recebeu (os mais recentes), para o Acompanhamento do colaborador — lista leve, sem conteúdo. */
export async function fetchReceivedCommunications(): Promise<ReceivedCommunication[]> {
  return receivedCommunicationsSchema.parse(await apiGet<unknown>(`${BASE}/received`)).items
}

/** Um comunicado NO AR pelo id (o servidor confere de novo se a pessoa da sessão o enxerga; senão 404). */
export async function fetchCommunication(id: string): Promise<Communication> {
  return communicationSchema.parse(await apiGet<unknown>(byId(id)))
}

/** Área editorial: as publicações do autor (rascunho, agendado, publicado, encerrado, arquivado). */
export async function fetchMyCommunications(): Promise<EditorialCommunicationSummary[]> {
  return editorialCommunicationsSchema.parse(await apiGet<unknown>(`${BASE}/mine`)).items
}

export async function fetchMyCommunication(id: string): Promise<EditorialCommunication> {
  return editorialCommunicationSchema.parse(await apiGet<unknown>(`${BASE}/mine/${encodeURIComponent(id)}`))
}

export async function fetchAudienceOptions(): Promise<AudienceOptions> {
  return audienceOptionsSchema.parse(await apiGet<unknown>(`${BASE}/audience-options`))
}

export async function previewAudience(input: { audience: EditorialPayload["audience"]; segment: CommunicationSegment | null }): Promise<number> {
  return audiencePreviewResultSchema.parse(await apiPost<unknown>(`${BASE}/audience-preview`, input)).recipientCount
}

export async function setCommunicationArchived(id: string, archived: boolean): Promise<void> {
  await apiPost(`${byId(id)}/${archived ? "archive" : "unarchive"}`, {})
}

/** O autor retira o comunicado (exclusão lógica: volta por Consultar dados › Itens excluídos). */
export async function retireCommunication(id: string): Promise<void> {
  await apiSend(byId(id), "DELETE")
}

/** Moderação (Administrador geral): publicações de todos da organização (sem rascunhos). */
export async function fetchModerationCommunications(): Promise<EditorialCommunicationSummary[]> {
  return editorialCommunicationsSchema.parse(await apiGet<unknown>(`${BASE}/moderation`)).items
}

export async function fetchModerationCommunication(id: string): Promise<EditorialCommunication> {
  return editorialCommunicationSchema.parse(await apiGet<unknown>(`${BASE}/moderation/${encodeURIComponent(id)}`))
}

/** Moderação: retira a publicação de qualquer autor, com o motivo (exclusão lógica auditada). */
export async function moderateRetireCommunication(id: string, reason: string): Promise<void> {
  await apiPost(`${byId(id)}/moderate-retire`, { reason })
}

