import { cookies } from "next/headers"

import {
  operatorIndicatorsDataSchema,
  operatorProfileSchema,
  type OperatorIndicator,
  type OperatorIndicatorsData,
  type OperatorProfile,
} from "@/schemas/operator"
import { operatorOverviewSchema, type OperatorIndicatorRow, type OperatorOverview } from "@/schemas/operator/operator-overview.schema"
import { ROLE_LABELS, type PlatformRole } from "@/schemas/auth/auth.schema"

import { readSessionCookie, sessionCookieHeader } from "@/lib/auth/session-cookie"
import { redirectIfSessionEnded } from "@/services/auth/server-session"
import { mapOperatorFeedbackHistory } from "@/services/operator/operator-feed"
import { publicAsset } from "@/lib/assets/public-asset"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

function formatIndicatorValue(value: number, unit: string): string {
  if (unit === "SECONDS") {
    const minutes = Math.floor(value / 60)
    const seconds = Math.round(value % 60)
    return `${minutes}m${seconds.toString().padStart(2, "0")}s`
  }
  if (unit === "PERCENT") return `${Math.round(value * 10) / 10}%`
  return `${Math.round(value * 10) / 10}`
}

function mapIndicators(rows: OperatorIndicatorRow[]): OperatorIndicator[] {
  const latestByCode = new Map<string, OperatorIndicatorRow>()
  for (const row of rows) if (!latestByCode.has(row.code)) latestByCode.set(row.code, row)

  return [...latestByCode.values()].map((row, index) => ({
    id: row.code,
    title: row.name,
    value: formatIndicatorValue(row.value, row.unit),
    meta: row.targetValue !== null ? `Meta: ${formatIndicatorValue(row.targetValue, row.unit)}` : "Sem meta definida para o período",
    status: row.achieved === false ? "attention" : "good",
    priority: index,
    description: row.glossaryDescription ?? undefined,
    recommendation: row.feedbackGuidance ?? row.goodPractices ?? undefined,
    actions: [],
    relatedHistoryIds: [],
  }))
}

async function fetchOperatorOverview(): Promise<OperatorOverview> {
  const cookieStore = await cookies()
  const session = readSessionCookie(cookieStore)
  const token = session?.value
  const response = await fetch(`${API_URL}/api/v1/operator/overview`, {
    headers: token ? { cookie: sessionCookieHeader(session) } : undefined,
    cache: "no-store",
  })
  await redirectIfSessionEnded(response)
  if (!response.ok) throw new Error(`API retornou ${response.status} ao buscar dados do operador.`)
  const payload = (await response.json()) as { data: unknown }
  return operatorOverviewSchema.parse(payload.data)
}

/** Perfil de header a partir de qualquer usuário autenticado (operador ou gestor). */
export function buildProfileHeader(profile: { name: string; role: string; avatarUrl: string | null; jobTitle?: string | null }): OperatorProfile {
  return operatorProfileSchema.parse({
    name: profile.name,
    role: profile.jobTitle ?? ROLE_LABELS[profile.role as PlatformRole] ?? profile.role,
    avatarUrl: profile.avatarUrl,
    periodLabel: new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    assistantName: "INIA",
    // Avatar pequeno (192 px, ~10 KB): o INIA.png de 1,4 MB aparecia em 32–64 px.
    assistantImage: publicAsset("/inia-avatar.webp"),
  })
}

/**
 * Surface Acompanhamento do operador: perfil do header + PRIMEIRA página do feed de feedbacks (+ cursor da seguinte) + contexto
 * leve pro chat (último período de cada indicador) — UMA chamada ao overview. O PRV e os indicadores analíticos NÃO passam
 * por aqui: vêm da área de analytics (fonte oficial).
 */
export async function fetchOperatorSurface(): Promise<{ profile: OperatorProfile; indicators: OperatorIndicatorsData }> {
  const { profile, indicators, feedbacks, feedbacksNextCursor } = await fetchOperatorOverview()
  return {
    profile: buildProfileHeader(profile),
    indicators: operatorIndicatorsDataSchema.parse({ current: mapIndicators(indicators), history: mapOperatorFeedbackHistory(feedbacks), historyNextCursor: feedbacksNextCursor }),
  }
}
