import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { ASSISTANT_CONVERSATIONS_PATH } from "@/components/admin/assistant-conversations/assistant-conversations-route"
import { USABILITY_PATH } from "@/components/admin/usability/usability-route"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { landingRouteFor } from "@/services/auth/auth-service"
import { getCurrentUserFromCookies } from "@/services/auth/current-user-server"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies()
  if (!user) redirect("/auth/login")
  // V1.5.7: a Administração abre por PERMISSÃO (papéis da conta), nunca por cargo/nível hierárquico.
  const { canAccessAdministration, canViewAssistantConversations } = user.access.capabilities
  // Monitoria de usabilidade: permissão própria E painel ligado no ambiente (módulo desligado ≠ sem permissão: some do menu).
  const canViewUsability = user.access.capabilities.canViewUsability && user.features.usabilityPanel
  if (!canAccessAdministration && !canViewAssistantConversations && !canViewUsability) redirect(landingRouteFor(user))
  // Quem só lê as conversas e/ou a monitoria entra SÓ nessas áreas — nenhum outro módulo abre por aqui (o backend também nega).
  if (!canAccessAdministration) {
    const pathname = (await headers()).get("x-inia-pathname") ?? ""
    const allowed = [canViewAssistantConversations ? ASSISTANT_CONVERSATIONS_PATH : null, canViewUsability ? USABILITY_PATH : null].filter((path): path is string => path !== null)
    if (!allowed.some((path) => pathname.startsWith(path))) redirect(allowed[0]!)
  }

  return (
    <div className="relative mx-auto w-full max-w-7xl" style={{ contain: "layout" }}>
      {/* Um fundo só (o da página): sem a faixa de cor do variant "inset" nem o conteúdo como painel flutuante com sombra. */}
      <SidebarProvider className="has-data-[variant=inset]:bg-transparent">
        <AdminSidebar capabilities={{ ...user.access.capabilities, canViewUsability }} />
        <SidebarInset className="min-w-0 bg-transparent md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm font-medium text-muted-foreground">Administração</span>
          </div>
          <div className="min-w-0 flex-1 space-y-5 overflow-x-hidden p-4 sm:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
