"use client"

import type { AppShellProfile } from "@/components/layout/app-shell-profile"
import { AreaSwitcher } from "@/components/layout/top-bar/area-switcher"
import { AppUserMenu } from "@/components/layout/user-menu/app-user-menu"
import { NotificationBell } from "@/components/notifications/notification-bell"

type AppTopBarProps = {
  profile: AppShellProfile
  /** "Meu perfil" da pessoa autenticada — destino da marca, do seletor de área e dos deep links do sino. */
  profileHref: string
  onSignOut?: () => void
  /** Mostra "Administração" só com a capability (derivada dos papéis); o backend continua autorizando. */
  canAccessAdministration?: boolean
  /** Atalho "QA Lab" (QA de feedback): módulo LIGADO (`features`) e permissão do papel — os dois vêm do /auth/me. */
  canReviewFeedback?: boolean
  /** Diagnóstico: capability do /auth/me (liderança OU `indicators.view`). */
  canViewDiagnostics?: boolean
  canUseReports?: boolean
  onEditProfile?: () => void
}

/**
 * Cabeçalho GLOBAL no roxo da marca — sempre identifica quem está logado. À esquerda, a pessoa (menu pessoal) e o
 * seletor de área; à direita, o sino. Compacto (56 px, sem filete) para não empurrar o conteúdo; a faixa de abas do
 * perfil fica fixa logo abaixo dele (`profile-tabs.tsx`).
 */
export function AppTopBar({ profile, profileHref, onSignOut, canAccessAdministration = false, canReviewFeedback = false, canViewDiagnostics = false, canUseReports = false, onEditProfile }: AppTopBarProps) {
  return (
    <header className="sticky top-0 z-30 w-full bg-topbar text-topbar-foreground shadow-sm">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 md:px-6">
        <AppUserMenu profile={profile} profileHref={profileHref} onSignOut={onSignOut} onEditProfile={onEditProfile} />
        <span className="hidden h-6 w-px bg-topbar-foreground/25 sm:block" aria-hidden />
        <nav aria-label="Áreas da INIA" className="min-w-0">
          <AreaSwitcher profileHref={profileHref} canAccessAdministration={canAccessAdministration} canReviewFeedback={canReviewFeedback} canViewDiagnostics={canViewDiagnostics} canUseReports={canUseReports} />
        </nav>
        <div className="ml-auto flex shrink-0 items-center">
          <NotificationBell profileHref={profileHref} />
        </div>
      </div>
    </header>
  )
}
