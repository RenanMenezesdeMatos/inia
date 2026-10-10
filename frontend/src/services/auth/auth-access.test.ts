import { describe, expect, it } from "vitest"

import { accessCapabilitiesSchema, NO_ACCESS_CAPABILITIES, profileLinksFor, type AccessCapabilities } from "@/schemas/auth/auth.schema"
import { landingRouteFor } from "@/services/auth/auth-service"

const caps = (partial: Partial<AccessCapabilities>): AccessCapabilities => accessCapabilitiesSchema.parse(partial)
const user = (role: Parameters<typeof landingRouteFor>[0]["role"], capabilities: AccessCapabilities = NO_ACCESS_CAPABILITIES) => ({ role, access: { permissions: [], capabilities, roles: [] } })

describe("V1.5.8 — links e destino do login vêm de capabilities (permissions), nunca do nível hierárquico", () => {
  it("'Gerenciar' (cadastro de pessoas) só com people.manage ou visão de usuários; 'Origem do dado' só com a Central de Dados", () => {
    expect(profileLinksFor(NO_ACCESS_CAPABILITIES)).toEqual({ manageHref: null, canSeeLineage: false })
    expect(profileLinksFor(caps({ canManagePeople: true }))).toEqual({ manageHref: "/admin/users", canSeeLineage: false })
    expect(profileLinksFor(caps({ canViewUsers: true }))).toMatchObject({ manageHref: "/admin/users" })
    expect(profileLinksFor(caps({ canManageDataHub: true }))).toEqual({ manageHref: null, canSeeLineage: true })
    // QA de feedback / visões ampliadas não abrem links administrativos.
    expect(profileLinksFor(caps({ canReviewFeedback: true, canViewIndicators: true, canManageCalendar: true }))).toEqual({ manageHref: null, canSeeLineage: false })
  })

  it("destino do login: nível legado ADMIN sem capability NÃO vai para a Administração; com capability vai", () => {
    expect(landingRouteFor(user("ADMIN"))).toBe("/supervisor")
    expect(landingRouteFor(user("ADMIN", caps({ canAccessAdministration: true })))).toBe("/admin")
  })

  it("destino do login: casa operacional pelo nível (Operador → /operator; gestão → /supervisor), mesmo com papel administrativo", () => {
    expect(landingRouteFor(user("OPERATOR", caps({ canAccessAdministration: true })))).toBe("/operator")
    for (const role of ["SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"] as const) expect(landingRouteFor(user(role, caps({ canAccessAdministration: true })))).toBe("/supervisor")
  })

  it("capabilities novas chegam com deny by default quando o backend não as manda", () => {
    expect(accessCapabilitiesSchema.parse({})).toMatchObject({ canViewIndicators: false, canViewStructureMetrics: false, canManageCalendar: false })
  })
})
