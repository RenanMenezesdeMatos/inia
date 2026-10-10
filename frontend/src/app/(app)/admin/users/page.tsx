import { redirect } from "next/navigation"

import { UsersAndAccessPage } from "@/components/admin/access/users-and-access-page"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

/** Usuários e acessos — as abas dependem das capabilities (derivadas dos papéis da conta), nunca do cargo. */
export default async function Page() {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  return <UsersAndAccessPage capabilities={user.access.capabilities} />
}
