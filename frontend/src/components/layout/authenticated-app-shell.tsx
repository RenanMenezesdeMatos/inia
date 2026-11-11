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
import { loadSessionDocument } from "@/lib/auth/session-navigation"
import { shutdownUsageForLogout, UsageAnalyticsProvider } from "@/lib/usage/usage-provider"
import { HumanSupportStateProvider } from "@/queries/human-support/use-human-support-state"

type AuthenticatedAppShellProps = {
  children: React.ReactNode
}

type ShellState = { profile: AppShellProfile; profileHref: string; canAccessAdministration: boolean; canReviewFeedback: boolean; canViewDiagnostics: boolean; canUseReports: boolean; canViewBestPractices: boolean; canAttendHumanSupport: boolean }

export function AuthenticatedAppShell({ children }: AuthenticatedAppShellProps) {
  const router = useRouter()
  const navigateTo = useCallback((href: string) => router.push(href), [router])
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
    if (unauthenticated) loadSessionDocument("/auth/login", { replace: true })
    else if (passwordChangePending) router.replace(CREATE_PASSWORD_ROUTE)
  }, [router, unauthenticated, passwordChangePending])

  // Saída = documento novo (lib/auth/session-navigation.ts), DEPOIS de a sessão cair no servidor: a página de login já abre sem ela.
  // A fila de uso desta conta é enviada (melhor esforço) e descartada antes do logout — nunca vai para a próxima conta.
  const leaveSession = useCallback((url: string) => {
    queryClient.clear()
    void shutdownUsageForLogout()
      .finally(() => logout().catch(() => undefined))
      .finally(() => loadSessionDocument(url, { replace: true }))
  }, [queryClient])

  const shell: ShellState | null = user
    ? {
        profile: { name: sessionDisplayName(user), registeredName: user.name, role: user.jobTitle ?? ROLE_LABELS[user.role], avatarSrc: user.avatarUrl ?? undefined },
        profileHref: myProfileHrefFor(user),
        // "Administração" também para quem só lê as conversas com a INIA ou revisa contestações (a entrada /admin leva direto à área).
        // Também o Coordenador de Anjos: a entrada leva à área isolada do painel do apoio.
        canAccessAdministration: user.access.capabilities.canAccessAdministration || user.access.capabilities.canViewAssistantConversations || user.access.capabilities.canReviewFeedbackContestations || (user.features.usabilityPanel && user.access.capabilities.canViewUsability) || user.access.capabilities.canCoordinateHumanSupport,
        canReviewFeedback: user.features.interactionFeedbackQa && user.access.capabilities.canReviewFeedback,
        canViewDiagnostics: user.access.capabilities.canViewDiagnostics,
        canUseReports: user.access.capabilities.canUseReports,
        canViewBestPractices: user.access.capabilities.canViewBestPractices,
        // Apoio com Anjo: "Área do Anjo" no seletor de área (o Anjo atende em /apoio).
        canAttendHumanSupport: user.access.capabilities.canAttendHumanSupport,
      }
    : null

  function handleSignOut() {
    leaveSession("/auth/login")
  }

  async function handleSignOutEverywhere() {
    try {
      await logoutEverywhere()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível encerrar as outras sessões.")
      return
    }
    queryClient.clear()
    void shutdownUsageForLogout().finally(() => loadSessionDocument("/auth/login?motivo=todos-os-aparelhos", { replace: true }))
  }

  // Parada além do limite: a sessão já caiu (ou cai agora) no servidor; a tela limpa o que era da conta e leva ao login.
  const handleIdleExpired = useCallback(() => leaveSession("/auth/login?motivo=inatividade"), [leaveSession])

  if (passwordChangePending) return null

  // A MESMA árvore antes e depois de a sessão chegar (no servidor e no primeiro render ela ainda não existe): só o cabeçalho
  // entra depois. Trocar o elemento raiz desmontava e remontava a página inteira — efeitos rodando duas vezes (o chat
  // carregava a conversa de novo). O provider de uso, sem sessão, não coleta nada (ver usage-provider.tsx).
  return (
    <UsageAnalyticsProvider>
    <SessionIdleGuard timeoutMinutes={user?.sessionIdleTimeoutMinutes ?? 0} onExpired={handleIdleExpired} />
    <div className="min-h-screen overflow-x-clip bg-canvas text-foreground">
      {shell ? (
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
          canAttendHumanSupport={shell.canAttendHumanSupport}
          onEditProfile={() => editor.open("name")}
        />
      ) : null}

      {/* Estado do Apoio com Anjo do operador: UMA chamada por navegador (aba líder), lida pelo chat, pelo selo e pela sala. */}
      <HumanSupportStateProvider enabled={Boolean(user)} profileHref={shell?.profileHref ?? null} onNavigate={navigateTo}>
        <main className="min-h-[calc(100vh-3.5rem)]">
          {children}
        </main>
      </HumanSupportStateProvider>
    </div>
    </UsageAnalyticsProvider>
  )
}
