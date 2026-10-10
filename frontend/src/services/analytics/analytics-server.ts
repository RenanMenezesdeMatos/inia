import { cookies } from "next/headers"

import { analyticsContextSchema, type AnalyticsContext } from "@/schemas/analytics/analytics.schema"
import { SESSION_COOKIE_NAME } from "@/services/auth/auth-service"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/**
 * Contexto de analytics carregado no servidor (mesmo padrão de `current-user-server.ts`) e
 * entregue como `initialData` pro React Query — as abas do perfil já nascem certas para o papel,
 * sem layout shift nem uma segunda cópia da política de capabilities no frontend.
 */
export async function fetchAnalyticsContextFromCookies(): Promise<AnalyticsContext | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  try {
    const response = await fetch(`${API_URL}/api/v1/analytics/context`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` }, cache: "no-store" })
    if (!response.ok) return null
    const payload = (await response.json()) as { data: unknown }
    return analyticsContextSchema.parse(payload.data)
  } catch {
    return null
  }
}
