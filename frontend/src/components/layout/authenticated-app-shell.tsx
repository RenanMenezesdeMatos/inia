"use client"

import { useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { SessionIdleGuard } from "@/components/auth/session-idle-guard"
import type { AppShellProfile } from "@/components/layout/app-shell-profile"
import { AppTopBar } from "@/components/layout/top-bar/app-top-bar"
import { useProfileEditor } from "@/components/profile/edit-profile/profile-editor-context"
import { ROLE_LABELS, sessionDisplayName } from "@/schemas/auth/auth.schema"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { CREATE_PASSWORD_ROUTE, logout, logoutEverywhere, myProfileHrefFor } from "@/services/auth/auth-service"
import { shutdownUsageForLogout, UsageAnalyticsProvider } from "@/lib/usage/usage-provider"

type AuthenticatedAppShellProps = {
  children: React.ReactNode
}

type ShellState = { profile: AppShellProfile; profileHref: string; canAccessAdministration: boolean; canReviewFeedback: boolean; canViewDiagnostics: boolean; canUseReports: boolean; canViewBestPractices: boolean }

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
        // "Administração" também para quem só lê as conversas com a INIA ou revisa contestações (a entrada /admin leva direto à área).
        canAccessAdministration: user.access.capabilities.canAccessAdministration || user.access.capabilities.canViewAssistantConversations || user.access.capabilities.canReviewFeedbackContestations || (user.features.usabilityPanel && user.access.capabilities.canViewUsability),
        canReviewFeedback: user.features.interactionFeedbackQa && user.access.capabilities.canReviewFeedback,
        canViewDiagnostics: user.access.capabilities.canViewDiagnostics,
        canUseReports: user.access.capabilities.canUseReports,
        canViewBestPractices: user.access.capabilities.canViewBestPractices,
      }
    : null

  function handleSignOut() {
    // A sessão (e tudo que dependia dela) sai do cache: a próxima conta nunca vê menus nem perfil da anterior. A fila de uso
    // desta conta é enviada (melhor esforço) e descartada ANTES do logout — nunca vai para a próxima conta.
    queryClient.clear()
    void shutdownUsageForLogout().finally(() => void logout())
    router.push("/auth/login")
  }

  async function handleSignOutEverywhere() {
    try {
      await logoutEverywhere()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível encerrar as outras sessões.")
      return
    }
    queryClient.clear()
    void shutdownUsageForLogout()
    router.push("/auth/login?motivo=todos-os-aparelhos")
  }

  // Parada além do limite: a sessão já caiu (ou cai agora) no servidor; a tela limpa o que era da conta e leva ao login.
  const handleIdleExpired = useCallback(() => {
    queryClient.clear()
    void shutdownUsageForLogout().finally(() => void logout())
    router.replace("/auth/login?motivo=inatividade")
  }, [queryClient, router])

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
    <SessionIdleGuard timeoutMinutes={user?.sessionIdleTimeoutMinutes ?? 0} onExpired={handleIdleExpired} />
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <AppTopBar
        profile={shell.profile}
        profileHref={shell.profileHref}
        onSignOut={handleSignOut}
        onSignOutEverywhere={() => void handleSignOutEverywhere()}
        canAccessAdministration={shell.canAccessAdministration}
        canReviewFeedback={shell.canReviewFeedback}
        canViewDiagnostics={shell.canViewDiagnostics}
        canUseReports={shell.canUseReports}
        canViewBestPractices={shell.canViewBestPractices}
        onEditProfile={() => editor.open("name")}
      />

      <main className="min-h-[calc(100vh-3.5rem)]">
        {children}
      </main>
    </div>
    </UsageAnalyticsProvider>
  )
}
