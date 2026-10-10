import { redirect } from "next/navigation"

import { EditProfilePage } from "@/components/profile/edit-profile/edit-profile-page"
import { sectionFromParam } from "@/components/profile/edit-profile/edit-profile-route"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"
import { myProfileHrefFor } from "@/services/auth/auth-service"
import { fetchMyProfileFromCookies } from "@/services/profile/profile-server"

/** "Editar perfil" — sempre da pessoa AUTENTICADA (sem id na rota; a API edita só a pessoa da sessão). */
export default async function Page({ searchParams }: { searchParams: Promise<{ secao?: string }> }) {
  const [user, profile, params] = await Promise.all([getCurrentUserFromCookies(), fetchMyProfileFromCookies(), searchParams])
  if (!user) redirect("/auth/login")
  return <EditProfilePage initialProfile={profile} profileHref={myProfileHrefFor(user)} initialSection={sectionFromParam(params.secao)} />
}
