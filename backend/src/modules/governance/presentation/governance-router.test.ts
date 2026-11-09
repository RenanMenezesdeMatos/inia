import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { createGovernanceRouter } from "./governance-router.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-0000000000a1"
const TOPIC = "00000000-0000-4000-8000-0000000000f1"
const user: AuthTokenPayload = { sub: "acc-admin", personId: ADMIN, organizationId: ORG, role: "ADMIN", name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }

function appWith(rows: unknown[]) {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      return { rows, rowCount: rows.length }
    },
  } as unknown as Database
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use("/admin", createGovernanceRouter(db))
  return { app, queries }
}

describe("Governança — exclusão de assunto proibido e termo do glossário", () => {
  it.each([
    ["/admin/prohibited-topics", "prohibited_topics", "prohibited_topic"],
    ["/admin/glossary", "glossary_terms", "glossary_term"],
  ])("DELETE %s exclui sem apagar, só na organização da sessão, e grava o texto em audit_logs na mesma instrução", async (path, table, entityType) => {
    const { app, queries } = appWith([{ entity_id: TOPIC }])
    const response = await request(app).delete(`${path}/${TOPIC}`)
    expect(response.status).toBe(204)
    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).toContain(`update ${table}_all set active=false, deleted_at=now()`)
    expect(queries[0]!.sql).toContain("where id=$1 and organization_id=$2 and deleted_at is null")
    expect(queries[0]!.sql).not.toContain("delete from")
    expect(queries[0]!.sql).toContain("insert into audit_logs")
    expect(queries[0]!.sql).toContain(`'${entityType}'`)
    expect(queries[0]!.params).toEqual([TOPIC, ORG, ADMIN])
  })

  it.each([
    ["/admin/prohibited-topics", "TOPIC_NOT_FOUND"],
    ["/admin/glossary", "GLOSSARY_TERM_NOT_FOUND"],
  ])("DELETE %s de item inexistente (ou de outra organização) responde 404", async (path, code) => {
    const { app } = appWith([])
    const response = await request(app).delete(`${path}/${TOPIC}`)
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe(code)
  })

  it("desativar continua sendo PATCH com active=false (o item fica guardado, fora do prompt)", async () => {
    const { app, queries } = appWith([{ id: TOPIC, name: "Política", requiredBehavior: "Não opine.", active: false }])
    const response = await request(app).patch(`/admin/prohibited-topics/${TOPIC}`).send({ active: false })
    expect(response.status).toBe(200)
    expect(response.body.data.active).toBe(false)
    expect(queries[0]!.params).toEqual([null, null, false, TOPIC, ORG])
  })
})
