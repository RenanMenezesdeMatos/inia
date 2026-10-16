"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import type { AppShellProfile } from "@/components/layout/app-shell-profile"
import { AppTopBar } from "@/components/layout/top-bar/app-top-bar"
import { useProfileEditor } from "@/components/profile/edit-profile/profile-editor-context"
import { ROLE_LABELS, sessionDisplayName } from "@/schemas/auth/auth.schema"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { CREATE_PASSWORD_ROUTE, logout, myProfileHrefFor } from "@/services/auth/auth-service"
import { shutdownUsageForLogout, UsageAnalyticsProvider } from "@/lib/usage/usage-provider"

type AuthenticatedAppShellProps = {
  children: React.ReactNode
}

type ShellState = { profile: AppShellProfile; profileHref: string; canAccessAdministration: boolean; canReviewFeedback: boolean; canViewDiagnostics: boolean; canUseReports: boolean }

export function AuthenticatedAppShell({ children }: AuthenticatedAppShellProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const editor = useProfileEditor()
  // Sessão por query invalidável (V1.5.8a): atribuir/revogar papel atualiza "Administração" e "QA Lab" sem logout; salvar o
  // perfil atualiza nome e foto do cabeçalho da mesma forma.
  const currentUser = useCurrentUserQuery()
  const user = currentUser.data
  const unauthenticated = currentUser.isSuccess && user === null
  // Primeiro acesso pendente: a sessão existe, mas nenhuma tela da plataforma abre até a pessoa criar a própria senha.
  const passwordChangePending = user?.passwordChangeRequired === true

  useEffect(() => {
    if (unauthenticated) router.replace("/auth/login")
    else if (passwordChangePending) router.replace(CREATE_PASSWORD_ROUTE)
  }, [router, unauthenticated, passwordChangePending])

  const shell: ShellState | null = user
    ? {
        profile: { name: sessionDisplayName(user), registeredName: user.name, role: user.jobTitle ?? ROLE_LABELS[user.role], avatarSrc: user.avatarUrl ?? undefined },
        profileHref: myProfileHrefFor(user),
        // "Administração" também para quem só lê as conversas com a INIA (a entrada /admin leva direto a essa área).
        canAccessAdministration: user.access.capabilities.canAccessAdministration || user.access.capabilities.canViewAssistantConversations || (user.features.usabilityPanel && user.access.capabilities.canViewUsability),
        canReviewFeedback: user.features.interactionFeedbackQa && user.access.capabilities.canReviewFeedback,
        canViewDiagnostics: user.access.capabilities.canViewDiagnostics,
        canUseReports: user.access.capabilities.canUseReports,
      }
    : null

  function handleSignOut() {
    // A sessão (e tudo que dependia dela) sai do cache: a próxima conta nunca vê menus nem perfil da anterior. A fila de uso
    // desta conta é enviada (melhor esforço) e descartada ANTES do logout — nunca vai para a próxima conta.
    queryClient.clear()
    void shutdownUsageForLogout().finally(() => void logout())
    router.push("/auth/login")
  }

  if (passwordChangePending) return null

  if (!shell) {
    return (
      <div className="min-h-screen overflow-x-clip bg-background text-foreground">
        {children}
      </div>
    )
  }

  return (
    <UsageAnalyticsProvider>
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppTopBar
        profile={shell.profile}
        profileHref={shell.profileHref}
        onSignOut={handleSignOut}
        canAccessAdministration={shell.canAccessAdministration}
        canReviewFeedback={shell.canReviewFeedback}
        canViewDiagnostics={shell.canViewDiagnostics}
        canUseReports={shell.canUseReports}
        onEditProfile={() => editor.open("name")}
      />

      <main className="min-h-[calc(100vh-3.5rem)]">
        {children}
      </main>
    </div>
    </UsageAnalyticsProvider>
  )
}
