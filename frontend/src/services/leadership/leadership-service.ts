import { apiGet } from "@/lib/api/api-client"
import { leadershipHomeSchema, type LeadershipHome } from "@/schemas/leadership/leadership.schema"

/** Início do líder: prioridades do dia ("Onde atuar hoje") e perguntas para começar a conversa — determinístico, sem IA. */
export async function fetchLeadershipHome(): Promise<LeadershipHome> {
  return leadershipHomeSchema.parse(await apiGet("/api/v1/leadership/home"))
}
