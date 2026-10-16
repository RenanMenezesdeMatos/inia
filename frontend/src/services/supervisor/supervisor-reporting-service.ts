import { cookies } from "next/headers"

import type { PersonPresentation } from "@/schemas/profile/my-profile.schema"
import { SESSION_COOKIE_NAME } from "@/services/auth/auth-service"

export type SupervisorOperatorDetail = {
  /** `name` = nome CADASTRAL; `presentation` = como o colaborador VISITADO escolheu aparecer (nome, foto, capa). */
  profile: { id: string; name: string; matricula?: string | null; role: string; avatarUrl: string | null; jobTitle: string; bio: string | null; strengths: string[]; developmentFocus: string[]; hiredAt: string | null; teamId: string | null; teamName: string | null; presentation?: PersonPresentation | null }
  plans: Array<{ id: string; title: string; objective: string; status: string; startsAt: string; dueAt: string; actions: Array<{ id: string; type: string; description: string; status: string; dueAt: string }> }>
  monitorings: Array<{ id: string; score: number; status: string; strengths: string[]; errors: string[]; bestPractices: string[]; aiSummary: string | null; interactionExternalId: string; interactionReason: string; interactionSubReason?: string | null; interactionStartedAt: string; triggerType: string | null; triggerTitle: string | null; triggerReason: string | null; severity: string | null; metricCode: string | null; metricValue: number | null; thresholdValue: number | null; recurrenceCount: number | null; detectedAt: string | null }>
  escalation: { currentLevel: string; reason: string; consecutiveCycles: number; previousActions: string[]; aiRecommendation: string; confidence: number; generatedAt: string } | null
}

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

export type SupervisorOperatorResult = { status: "ok"; data: SupervisorOperatorDetail } | { status: "forbidden" } | { status: "not_found" } | { status: "error" }

/**
 * Ficha do colaborador (perfil, planos, monitorias; indicadores e Acompanhamento vêm das próprias abas) — chamada no servidor COM o cookie de sessão:
 * o backend valida o escopo (só quem está na estrutura de quem pede), então 403 é um estado da
 * tela, nunca um fallback de demonstração.
 */
export async function fetchSupervisorOperatorFromCookies(id: string): Promise<SupervisorOperatorResult> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  try {
    const response = await fetch(`${API_URL}/api/v1/supervisor/operators/${encodeURIComponent(id)}`, { headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : undefined, cache: "no-store" })
    if (response.status === 403) return { status: "forbidden" }
    if (response.status === 404) return { status: "not_found" }
    if (!response.ok) return { status: "error" }
    return { status: "ok", data: ((await response.json()) as { data: SupervisorOperatorDetail }).data }
  } catch {
    return { status: "error" }
  }
}
