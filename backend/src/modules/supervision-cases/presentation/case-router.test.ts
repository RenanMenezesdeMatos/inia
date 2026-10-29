import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { CaseDetail, CaseOwnership, CaseRepository, CaseVisibility } from "../application/case-repository.js"
import { caseVisibleTo } from "../application/case-visibility.js"
import { CASE_LIST_LIMIT, createCaseRouter } from "./case-router.js"

/**
 * Achado F-1 da auditoria de segurança: a lista e o detalhe de casos não filtravam organização nem escopo — qualquer sessão lia
 * diagnóstico, evidências e feedbacks (inclusive não publicados) de qualquer colaborador. Agora o recorte vem da sessão.
 */
const ORG_A = "00000000-0000-4000-8000-00000000000a"
const ORG_B = "00000000-0000-4000-8000-00000000000b"
const IN_SCOPE_CASE = "10000000-0000-4000-8000-000000000001"
const OUT_OF_SCOPE_CASE = "10000000-0000-4000-8000-000000000002"
const OTHER_ORG_CASE = "10000000-0000-4000-8000-000000000003"
const TEAM_CASE = "10000000-0000-4000-8000-000000000004"

const owners: Record<string, { organizationId: string; owner: CaseOwnership }> = {
  [IN_SCOPE_CASE]: { organizationId: ORG_A, owner: { operatorId: "op-visible", teamId: "team-1", subteamId: null } },
  [OUT_OF_SCOPE_CASE]: { organizationId: ORG_A, owner: { operatorId: "op-other", teamId: "team-2", subteamId: null } },
  [OTHER_ORG_CASE]: { organizationId: ORG_B, owner: { operatorId: "op-visible", teamId: "team-1", subteamId: null } },
  [TEAM_CASE]: { organizationId: ORG_A, owner: { operatorId: "op-team3", teamId: "team-3", subteamId: null } },
}

function fakeRepository() {
  const listCalls: { visibility: CaseVisibility; limit: number }[] = []
  const repository: CaseRepository = {
    async list(visibility, limit) {
      listCalls.push({ visibility, limit })
      return []
    },
    async ownership(organizationId, id) {
      const entry = owners[id]
      return entry && entry.organizationId === organizationId ? entry.owner : null
    },
    async findById(organizationId, id) {
      const entry = owners[id]
      if (!entry || entry.organizationId !== organizationId) return null
      return { id, operator: { id: entry.owner.operatorId, name: "x" } } as unknown as CaseDetail
    },
  }
  return { repository, listCalls }
}

const supervisorVisibility: CaseVisibility = { organizationId: ORG_A, viewerPersonId: "viewer", operatorIds: ["op-visible"], organizationWide: false, teamIds: [], subteamIds: [] }

function appWith(visibility: CaseVisibility) {
  const { repository, listCalls } = fakeRepository()
  const app = express()
  app.use(createCaseRouter(repository, async () => visibility))
  app.use(((error, _request, response, next) => {
    void next
    response.status(500).json({ error: String(error) })
  }) as ErrorRequestHandler)
  return { app, listCalls }
}

describe("casos de supervisão — recorte pela sessão", () => {
  it("o líder abre o caso de quem está no escopo dele", async () => {
    const { app } = appWith(supervisorVisibility)
    const response = await request(app).get(`/${IN_SCOPE_CASE}`)
    expect(response.status).toBe(200)
    expect(response.body.data.id).toBe(IN_SCOPE_CASE)
  })

  it("caso de colaborador fora do escopo, de outra organização ou id malformado: 404 igual (não revela existência)", async () => {
    const { app } = appWith(supervisorVisibility)
    for (const id of [OUT_OF_SCOPE_CASE, OTHER_ORG_CASE, "nao-e-uuid", "' or 1=1 --"]) {
      const response = await request(app).get(`/${encodeURIComponent(id)}`)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe("CASE_NOT_FOUND")
    }
  })

  it("administrador de Agents vê os casos do Grupo do escopo dele; organização inteira vê todos da própria organização", async () => {
    const teamAdmin = appWith({ organizationId: ORG_A, viewerPersonId: "viewer", operatorIds: [], organizationWide: false, teamIds: ["team-3"], subteamIds: [] }).app
    expect((await request(teamAdmin).get(`/${TEAM_CASE}`)).status).toBe(200)
    expect((await request(teamAdmin).get(`/${IN_SCOPE_CASE}`)).status).toBe(404)
    const orgAdmin = appWith({ organizationId: ORG_A, viewerPersonId: "viewer", operatorIds: [], organizationWide: true, teamIds: [], subteamIds: [] }).app
    expect((await request(orgAdmin).get(`/${OUT_OF_SCOPE_CASE}`)).status).toBe(200)
    expect((await request(orgAdmin).get(`/${OTHER_ORG_CASE}`)).status).toBe(404)
  })

  it("a lista recebe o recorte da sessão e um teto de linhas", async () => {
    const { app, listCalls } = appWith(supervisorVisibility)
    expect((await request(app).get("/")).status).toBe(200)
    expect(listCalls).toEqual([{ visibility: supervisorVisibility, limit: CASE_LIST_LIMIT }])
  })

  it("o próprio colaborador nunca abre o caso dele — nem administrando Agents no Grupo dele ou na organização (C17, 4ª auditoria)", async () => {
    const own = owners[TEAM_CASE]!.owner
    for (const visibility of [
      { organizationId: ORG_A, viewerPersonId: own.operatorId, operatorIds: [own.operatorId], organizationWide: false, teamIds: [], subteamIds: [] },
      { organizationId: ORG_A, viewerPersonId: own.operatorId, operatorIds: [], organizationWide: false, teamIds: [own.teamId!], subteamIds: [] },
      { organizationId: ORG_A, viewerPersonId: own.operatorId, operatorIds: [], organizationWide: true, teamIds: [], subteamIds: [] },
    ] satisfies CaseVisibility[]) {
      expect(caseVisibleTo(visibility, own)).toBe(false)
      const response = await request(appWith(visibility).app).get(`/${TEAM_CASE}`)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe("CASE_NOT_FOUND")
    }
  })

  it("sem escopo nenhum (ex.: operador sem liderados), nada é visível", () => {
    const none: CaseVisibility = { organizationId: ORG_A, viewerPersonId: "viewer", operatorIds: [], organizationWide: false, teamIds: [], subteamIds: [] }
    expect(caseVisibleTo(none, owners[IN_SCOPE_CASE]!.owner)).toBe(false)
    expect(caseVisibleTo({ ...none, subteamIds: ["sub-1"] }, { operatorId: "x", teamId: "t", subteamId: "sub-1" })).toBe(true)
  })
})
