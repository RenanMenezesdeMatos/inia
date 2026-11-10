/** @vitest-environment jsdom */
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { accessCapabilitiesSchema, type AccessCapabilities, type CurrentUser } from "@/schemas/auth/auth.schema"

import AdminLayout from "./layout"
import AdminIndexPage from "./page"
import HumanSupportPage from "./human-support/page"
import HumanSupportMonitoringPage from "./human-support-monitoring/page"

const state = vi.hoisted(() => ({ pathname: "/admin", user: null as unknown }))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-inia-pathname": state.pathname }) }))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
vi.mock("@/services/auth/current-user-server", () => ({ getCurrentUserFromCookies: async () => state.user }))
// Só o acesso interessa aqui: as telas têm testes próprios.
vi.mock("@/components/admin/admin-sidebar", () => ({ AdminSidebar: () => null }))
vi.mock("@/components/human-support/admin/human-support-admin-page", () => ({ HumanSupportAdminPage: () => null }))
vi.mock("@/components/human-support/monitoring/human-support-monitoring-page", () => ({ HumanSupportMonitoringPage: () => null }))

function signIn(capabilities: Partial<AccessCapabilities>, pathname = "/admin") {
  state.pathname = pathname
  state.user = {
    role: "SUPERVISOR",
    passwordChangeRequired: false,
    features: { interactionFeedbackQa: false, usageCollection: false, usabilityPanel: false },
    access: { permissions: [], roles: [], capabilities: { ...accessCapabilitiesSchema.parse({}), ...capabilities } },
  } as unknown as CurrentUser
}
async function redirectOf(render: () => Promise<unknown>): Promise<string | null> {
  try {
    await render()
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length)
    throw error
  }
}
const layoutAt = () => AdminLayout({ children: null })

const COORDINATOR = { canCoordinateHumanSupport: true }
const GENERAL_ADMIN = { canAccessAdministration: true, canCoordinateHumanSupport: true, canManageHumanSupport: true, canOpenUsersAndAccess: true }

afterEach(() => {
  state.user = null
  state.pathname = "/admin"
})

describe("Administração — área isolada do Coordenador de Anjos (CUJ 9)", () => {
  it("sem nenhum outro papel administrativo, só o painel do apoio abre", async () => {
    signIn(COORDINATOR, "/admin/human-support-monitoring")
    expect(await redirectOf(layoutAt)).toBeNull()
    for (const pathname of ["/admin/knowledge", "/admin/users", "/admin/conversations", "/admin/human-support"]) {
      signIn(COORDINATOR, pathname)
      expect(await redirectOf(layoutAt)).toBe("/admin/human-support-monitoring")
    }
  })

  it("/admin leva o Coordenador direto ao painel do apoio", async () => {
    signIn(COORDINATOR)
    expect(await redirectOf(AdminIndexPage)).toBe("/admin/human-support-monitoring")
  })

  it("Coordenador que também lê as conversas abre as duas áreas, e nada além delas", async () => {
    signIn({ ...COORDINATOR, canViewAssistantConversations: true }, "/admin/human-support-monitoring")
    expect(await redirectOf(layoutAt)).toBeNull()
    signIn({ ...COORDINATOR, canViewAssistantConversations: true }, "/admin/conversations")
    expect(await redirectOf(layoutAt)).toBeNull()
    signIn({ ...COORDINATOR, canViewAssistantConversations: true }, "/admin/agents")
    expect(await redirectOf(layoutAt)).toBe("/admin/conversations")
  })

  it("quem não tem nada da Administração volta à própria tela inicial", async () => {
    signIn({}, "/admin/human-support-monitoring")
    expect(await redirectOf(layoutAt)).toBe("/supervisor")
  })

  it("acesso administrativo continua abrindo tudo, como antes", async () => {
    signIn(GENERAL_ADMIN, "/admin/knowledge")
    expect(await redirectOf(layoutAt)).toBeNull()
    signIn(GENERAL_ADMIN)
    expect(await redirectOf(AdminIndexPage)).toBe("/admin/knowledge")
  })
})

describe("Páginas do Apoio com Anjo — capability antes de renderizar", () => {
  it("painel do apoio: Coordenador entra sem o filtro de escopo; o Administrador geral, com ele; sem `coordinate`, volta a /admin", async () => {
    signIn(COORDINATOR)
    expect(((await HumanSupportMonitoringPage()) as ReactElement<{ canFilterByScope: boolean }>).props.canFilterByScope).toBe(false)
    signIn(GENERAL_ADMIN)
    expect(((await HumanSupportMonitoringPage()) as ReactElement<{ canFilterByScope: boolean }>).props.canFilterByScope).toBe(true)
    signIn({ canAccessAdministration: true })
    expect(await redirectOf(HumanSupportMonitoringPage)).toBe("/admin")
  })

  it("configuração: só o Administrador geral (`manage`); o Coordenador volta a /admin", async () => {
    signIn(GENERAL_ADMIN)
    expect(((await HumanSupportPage()) as ReactElement<{ canGrantRoles: boolean }>).props.canGrantRoles).toBe(true)
    signIn(COORDINATOR)
    expect(await redirectOf(HumanSupportPage)).toBe("/admin")
  })
})
