import { cookies } from "next/headers"

import { myProfileSchema, type MyProfile } from "@/schemas/profile/my-profile.schema"
import { SESSION_COOKIE_NAME } from "@/services/auth/auth-service"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/** Leitura no servidor (primeira pintura do perfil já com nome escolhido, foto e capa). `null` = sem sessão/erro. */
export async function fetchMyProfileFromCookies(): Promise<MyProfile | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  const response = await fetch(`${API_URL}/api/v1/me/profile`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` }, cache: "no-store" })
  if (!response.ok) return null
  return myProfileSchema.parse(((await response.json()) as { data: unknown }).data)
}
