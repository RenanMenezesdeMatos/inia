import { cookies } from "next/headers"

import { supervisionCaseSchema, type SupervisionCase } from "@/schemas/supervision-cases/supervision-case.schema"
import { SESSION_COOKIE_NAME } from "@/services/auth/auth-service"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/**
 * Caso de supervisão pela sessão (server-side). `null` = fora do escopo ou inexistente (a API responde 404 nos dois casos) —
 * nunca mais um caso de demonstração no lugar do real: mostrar dados fictícios para um id real enganava quem lia o caso.
 */
export async function fetchSupervisionCase(id: string): Promise<SupervisionCase | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
    const response = await fetch(`${API_URL}/api/v1/supervision-cases/${id}`, {
      headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : undefined,
      cache: "no-store",
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    return supervisionCaseSchema.parse((payload as { data: unknown }).data)
  } catch {
    return null
  }
}
