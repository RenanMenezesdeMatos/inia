import { apiGet, apiSend } from "@/lib/api/api-client"
import { savedViewLayoutSchema, type ViewLayoutKey, type ViewLayoutPayload } from "@/schemas/view-layouts/view-layout.schema"

/** `/api/v1/me/view-layouts/:viewKey` — a disposição da PRÓPRIA pessoa numa tela (ler, salvar, restaurar o padrão). */
const BASE = "/api/v1/me/view-layouts"

export async function fetchViewLayout(viewKey: ViewLayoutKey) {
  return savedViewLayoutSchema.parse(await apiGet<unknown>(`${BASE}/${viewKey}`))
}
export async function saveViewLayout(viewKey: ViewLayoutKey, layout: ViewLayoutPayload) {
  return savedViewLayoutSchema.parse(await apiSend<unknown>(`${BASE}/${viewKey}`, "PUT", layout))
}
export async function resetViewLayout(viewKey: ViewLayoutKey) {
  await apiSend(`${BASE}/${viewKey}`, "DELETE")
}
