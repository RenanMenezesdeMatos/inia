import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CreatePasswordForm } from "@/components/auth/create-password-form"
import { landingRouteFor } from "@/services/auth/auth-service"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

export const metadata: Metadata = {
  title: "Crie sua senha | INIA",
  description: "Primeiro acesso à plataforma INIA",
}

/** Primeiro acesso: só existe para uma sessão aberta com senha temporária. Sem sessão → login; troca já feita → a casa da pessoa. */
export default async function CreatePasswordPage() {
  const user = await getCurrentUserFromCookies({ allowPasswordChangePending: true })
  if (!user) redirect("/auth/login")
  if (!user.passwordChangeRequired) redirect(landingRouteFor(user))
  return <CreatePasswordForm name={user.addressName ?? user.displayName ?? user.name} email={user.email} temporaryPasswordExpiresAt={user.temporaryPasswordExpiresAt} />
}
