import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { fixtureOrg, IDS } from "../../performance-analytics/testing/fixture-org.js"
import { InMemoryAnalyticsRepository, ORG } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { inMemoryHierarchyReader } from "../../workflows/testing/in-memory-hierarchy-reader.js"
import { createPersonOrganizationStructureRouter } from "./person-organization-structure-router.js"

const noDatabase = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database

function appAs(user: AuthTokenPayload | null) {
  const org = fixtureOrg()
  const app = express()
  app.use((requestObject, _response, next) => {
    if (user) requestObject.user = user
    next()
  })
  app.use(
    "/people",
    (requestObject, response, next) => (requestObject.user ? next() : response.status(401).json({ error: { code: "UNAUTHENTICATED" } })),
    createPersonOrganizationStructureRouter(noDatabase, {
      analytics: new InMemoryAnalyticsRepository(org),
      hierarchy: inMemoryHierarchyReader(org.people.map((node) => ({ ...node }))),
      corporateEmails: async (ids) => new Map(ids.map((id) => [id, `${id}@inia.com`])),
      structureFreshness: async () => ({ state: "UNKNOWN", configured: false, feeds: [], consideredFeedIds: [], lastSuccessAt: null, lastDataAt: null, lastSuccessLocalDate: null }),
    }),
  )
  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof DomainError) return response.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    if (error instanceof ZodError) return response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    void next
    return response.status(500).json({ error: { code: "INTERNAL_ERROR" } })
  }
  app.use(errorHandler)
  return app
}

function user(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe("GET /people/:personId/organization-structure", () => {
  it("sem sessão → 401", async () => {
    expect((await request(appAs(null)).get(`/people/${IDS.op1}/organization-structure`)).status).toBe(401)
  })

  it("operador vê a própria estrutura: cadeia, Grupo/Subgrupo, equipe com integrantes e sem origem quando não há feed", async () => {
    const response = await request(appAs(user(IDS.op1, "OPERATOR"))).get(`/people/${IDS.op1}/organization-structure`)
    expect(response.status).toBe(200)
    expect(response.body.data.subject).toMatchObject({ personId: IDS.op1, isViewer: true, roleLabel: "Operador" })
    expect(response.body.data.managementChain.map((entry: { roleLabel: string }) => entry.roleLabel)).toEqual(["Supervisor", "Coordenador", "Gerente", "Gerente Sênior", "Diretor"])
    expect(response.body.data.organizationalContext).toMatchObject({ group: { name: "ATENDIMENTO" }, subgroup: { name: "Chat" }, team: { label: "Equipe de Vanessa Supervisora", memberCount: 2, memberCountLabel: "Operadores da equipe" }, directManagerStatus: "PRESENT" })
    expect(response.body.data.directReports).toEqual([])
    expect(response.body.data.sourceMetadata).toBeNull()
  })

  it("navegação progressiva: Gerente abre a estrutura de uma Supervisora (subordinados diretos + capabilities por pessoa + trilha)", async () => {
    const response = await request(appAs(user(IDS.managerA, "MANAGER"))).get(`/people/${IDS.vanessa}/organization-structure`)
    expect(response.status).toBe(200)
    expect(response.body.data.subject).toMatchObject({ personId: IDS.vanessa, isViewer: false, email: `${IDS.vanessa}@inia.com`, capabilities: { canViewProfile: false, canViewStructure: true, hasReports: true } })
    expect(response.body.data.breadcrumb.map((entry: { name: string }) => entry.name)).toEqual(["Roberto Gerente", "Patrícia Coordenadora", "Vanessa Supervisora"])
    expect(response.body.data.directReports.map((report: { name: string; capabilities: unknown }) => [report.name, report.capabilities])).toEqual([
      ["Ana Operadora", { canViewProfile: true, canViewStructure: true, hasReports: false }],
      ["Bia Operadora", { canViewProfile: true, canViewStructure: true, hasReports: false }],
    ])
    expect(response.body.data.organizationalContext.team).toMatchObject({ memberCountKind: "OPERATORS_BELOW", memberCountLabel: "Operadores na estrutura" })
  })

  it("supervisor abre um operador da equipe e também alguém de outra gerência (organograma aberto); inexistente → 403 STRUCTURE_ACCESS_DENIED (não 500, não 404)", async () => {
    const app = appAs(user(IDS.vanessa, "SUPERVISOR"))
    expect((await request(app).get(`/people/${IDS.op1}/organization-structure`)).status).toBe(200)
    const other = await request(app).get(`/people/${IDS.op3}/organization-structure`)
    expect(other.status).toBe(200)
    expect(other.body.data.subject.capabilities.canViewProfile).toBe(false)
    const denied = await request(app).get(`/people/10000000-0000-4000-8000-0000000000ff/organization-structure`)
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe("STRUCTURE_ACCESS_DENIED")
  })

  it("id malformado → 400 de validação", async () => {
    expect((await request(appAs(user(IDS.op1, "OPERATOR"))).get("/people/nao-e-uuid/organization-structure")).status).toBe(400)
  })
})
