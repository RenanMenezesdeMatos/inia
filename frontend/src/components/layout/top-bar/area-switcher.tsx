"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Check, ChevronsUpDown, FileBarChart2, FlaskConical, HeartHandshake, Lightbulb, Settings2, Stethoscope, UserRound, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type Area = { key: "profile" | "admin" | "anjo" | "qa" | "diagnostics" | "best-practices" | "reports"; label: string; href: string; icon: LucideIcon; description: string }

export type AreaSwitcherProps = {
  /** Destino de "Meu perfil" — resolvido a partir da sessão (sempre a pessoa autenticada). */
  profileHref: string
  /** Capability de acesso à Administração (inclui quem só lê as conversas com a INIA). O backend continua autorizando. */
  canAccessAdministration: boolean
  /** QA de feedback: módulo ligado E permissão do papel. */
  canReviewFeedback: boolean
  /** Diagnóstico: lidera alguém OU tem `indicators.view` (capability do /auth/me). */
  canViewDiagnostics: boolean
  /** Reports recorrentes: quem lidera/tem acesso de consulta ou tem o papel Report (capability do /auth/me). */
  canUseReports?: boolean
  /** Base de boas práticas: público do Diagnóstico ou quem administra a configuração (capability do /auth/me). */
  canViewBestPractices?: boolean
  /** Área do Anjo (Apoio com Anjo): papel Anjo em algum escopo (capability do /auth/me). */
  canAttendHumanSupport?: boolean
}

/** Área atual pela rota. Perfis de outras pessoas e materiais de apoio pertencem à área de perfis. */
export function currentAreaOf(pathname: string, profileHref: string): { key: Area["key"]; label: string } {
  if (pathname.startsWith("/admin")) return { key: "admin", label: "Administração" }
  if (pathname === "/apoio" || pathname.startsWith("/apoio/")) return { key: "anjo", label: "Área do Anjo" }
  if (pathname.startsWith("/qa-lab")) return { key: "qa", label: "QA Lab" }
  if (pathname.startsWith("/diagnostics")) return { key: "diagnostics", label: "Diagnóstico" }
  if (pathname.startsWith("/best-practices")) return { key: "best-practices", label: "Boas práticas" }
  if (pathname.startsWith("/reports")) return { key: "reports", label: "Reports" }
  if (pathname.startsWith("/supervisor/operators/")) return { key: "profile", label: "Perfil do colaborador" }
  if (pathname.startsWith("/materiais")) return { key: "profile", label: "Material de apoio" }
  void profileHref
  return { key: "profile", label: "Meu perfil" }
}

/** O que o seletor oferece — só pelas capabilities já calculadas pelo backend (nunca por cargo). */
export function areasFor({ profileHref, canAccessAdministration, canReviewFeedback, canViewDiagnostics, canUseReports = false, canViewBestPractices = false, canAttendHumanSupport = false }: AreaSwitcherProps): { areas: Area[]; tools: Area[] } {
  return {
    areas: [
      { key: "profile", label: "Meu perfil", href: profileHref, icon: UserRound, description: "Acompanhamento, indicadores e estrutura" },
      ...(canAccessAdministration ? [{ key: "admin" as const, label: "Administração", href: "/admin", icon: Settings2, description: "Configuração da operação e acessos" }] : []),
      ...(canAttendHumanSupport ? [{ key: "anjo" as const, label: "Área do Anjo", href: "/apoio", icon: HeartHandshake, description: "Atender pedidos de apoio dos operadores" }] : []),
    ],
    tools: [
      ...(canReviewFeedback ? [{ key: "qa" as const, label: "QA Lab", href: "/qa-lab/feedbacks", icon: FlaskConical, description: "Avaliação de feedbacks" }] : []),
      ...(canViewDiagnostics ? [{ key: "diagnostics" as const, label: "Diagnóstico", href: "/diagnostics", icon: Stethoscope, description: "Diagnósticos de performance" }] : []),
      ...(canViewBestPractices ? [{ key: "best-practices" as const, label: "Boas práticas", href: "/best-practices", icon: Lightbulb, description: "O que os melhores resultados fazem nas chamadas" }] : []),
      ...(canUseReports ? [{ key: "reports" as const, label: "Reports", href: "/reports", icon: FileBarChart2, description: "Consultas recorrentes com dados atualizados" }] : []),
    ],
  }
}

/**
 * Seletor de ÁREA (substitui os links fixos "Operador/Supervisor/Diagnóstico"): Meu perfil ⇄ Administração, mais as
 * ferramentas que a conta já podia abrir. Só mostra o que as capabilities permitem; nada aqui concede acesso.
 */
export function AreaSwitcher({ profileHref, canAccessAdministration, canReviewFeedback, canViewDiagnostics, canUseReports = false, canViewBestPractices = false, canAttendHumanSupport = false }: AreaSwitcherProps) {
  const pathname = usePathname() ?? ""
  const current = currentAreaOf(pathname, profileHref)
  const { areas, tools } = areasFor({ profileHref, canAccessAdministration, canReviewFeedback, canViewDiagnostics, canUseReports, canViewBestPractices, canAttendHumanSupport })
  const CurrentIcon = [...areas, ...tools].find((area) => area.key === current.key)?.icon ?? UserRound

  const item = (area: Area) => {
    // Perfil de OUTRA pessoa não marca "Meu perfil" como atual (o destino continua sendo o próprio perfil).
    const active = area.key === current.key && (area.key !== "profile" || current.label === "Meu perfil")
    return (
      <DropdownMenuItem key={area.key} asChild className="items-start gap-3 py-2">
        <Link href={area.href} aria-current={active ? "page" : undefined}>
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4"><area.icon aria-hidden /></span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{area.label}</span>
            <span className="text-xs text-muted-foreground">{area.description}</span>
          </span>
          {active ? <Check className="mt-1 size-4 text-primary" aria-hidden /> : null}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 min-w-0 max-w-[13rem] gap-2 rounded-full border border-topbar-foreground/25 bg-topbar-foreground/10 px-2.5 text-sm font-medium text-topbar-foreground hover:bg-topbar-foreground/20 hover:text-topbar-foreground focus-visible:ring-topbar-foreground/60 aria-expanded:bg-topbar-foreground/20 dark:hover:bg-topbar-foreground/20" aria-label={`Área atual: ${current.label}. Trocar de área`}>
          <CurrentIcon className="size-4 shrink-0" aria-hidden />
          <span className="hidden truncate sm:inline">{current.label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-topbar-foreground/70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-72">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Áreas</DropdownMenuLabel>
        <DropdownMenuGroup>{areas.map(item)}</DropdownMenuGroup>
        {tools.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ferramentas</DropdownMenuLabel>
            <DropdownMenuGroup>{tools.map(item)}</DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
