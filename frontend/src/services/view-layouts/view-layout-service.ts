import { apiGet, apiSend } from "@/lib/api/api-client"
import type { ViewLayout } from "@/components/ui/customizable-grid/layout"
import { savedViewLayoutSchema, type ViewLayoutKey } from "@/schemas/view-layouts/view-layout.schema"

/** `/api/v1/me/view-layouts/:viewKey` — a disposição da PRÓPRIA pessoa numa tela (ler, salvar, restaurar o padrão). */
const BASE = "/api/v1/me/view-layouts"

export async function fetchViewLayout(viewKey: ViewLayoutKey) {
  return savedViewLayoutSchema.parse(await apiGet<unknown>(`${BASE}/${viewKey}`))
}
export async function saveViewLayout(viewKey: ViewLayoutKey, layout: ViewLayout) {
  return savedViewLayoutSchema.parse(await apiSend<unknown>(`${BASE}/${viewKey}`, "PUT", layout))
}
export async function resetViewLayout(viewKey: ViewLayoutKey) {
  await apiSend(`${BASE}/${viewKey}`, "DELETE")
}
