import { toQueryString } from "@/lib/admin/list-query"
import { apiGet } from "@/lib/api/api-client"
import { myJourneyViewSchema, type MyJourneyView } from "@/schemas/my-journey/my-journey.schema"

/** A pessoa vem da sessão no backend: o pedido só leva a semana (qualquer data dela). */
export async function fetchMyJourney(week: string | null): Promise<MyJourneyView> {
  return myJourneyViewSchema.parse(await apiGet<unknown>(`/api/v1/my-journey${toQueryString({ week })}`))
}
