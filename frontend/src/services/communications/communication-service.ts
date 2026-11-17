import { apiGet, apiPost, apiSend } from "@/lib/api/api-client"
import { communicationSchema, publishedCommunicationSchema, receivedCommunicationsSchema, type Communication, type EditCommunicationInput, type PublishCommunicationInput, type PublishedCommunication, type ReceivedCommunication } from "@/schemas/communications/communication.schema"

const BASE = "/api/v1/communications"

/** Publica um comunicado (o público é calculado no servidor pela permissão e pela estrutura de quem publica). */
export async function publishCommunication(input: PublishCommunicationInput): Promise<PublishedCommunication> {
  return publishedCommunicationSchema.parse(await apiPost<unknown>(BASE, input))
}

/** Comunicados que a pessoa da sessão recebeu (os mais recentes), para o Acompanhamento do colaborador — lista leve, sem conteúdo. */
export async function fetchReceivedCommunications(): Promise<ReceivedCommunication[]> {
  return receivedCommunicationsSchema.parse(await apiGet<unknown>(`${BASE}/received`)).items
}

/** Um comunicado inteiro pelo id (o servidor confere de novo se a pessoa da sessão o enxerga; senão 404). */
export async function fetchCommunication(id: string): Promise<Communication> {
  return communicationSchema.parse(await apiGet<unknown>(`${BASE}/${encodeURIComponent(id)}`))
}

/** O autor edita título, conteúdo e categorias; a versão anterior fica guardada no servidor. */
export async function editCommunication(id: string, input: EditCommunicationInput): Promise<Communication> {
  return communicationSchema.parse(await apiSend<unknown>(`${BASE}/${encodeURIComponent(id)}`, "PATCH", input))
}

/** O autor retira o comunicado (exclusão lógica: volta por Consultar dados › Itens excluídos). */
export async function retireCommunication(id: string): Promise<void> {
  await apiSend(`${BASE}/${encodeURIComponent(id)}`, "DELETE")
}
