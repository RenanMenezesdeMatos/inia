/**
 * PROVA contra o banco de TESTE real — ASSUNTOS DA BASE = ASSUNTOS CANÔNICOS DAS CHAMADAS (migration 224).
 *  - banco: o vínculo da base aponta para `interaction_subject_definitions` (FK) e cada id antigo migrado tem o de/para com o mesmo nome;
 *  - catálogo: listar mostra os assuntos e diz quem pode incluir; incluir só com alcance da organização (o administrador de um Grupo
 *    recebe 403); o assunto incluído pela Base aparece nos "Pedidos do cliente relacionados" dos Alinhamentos (mesmo catálogo);
 *    repetido = 409;
 *  - cadastro: 1..N assuntos, "todos" sozinho, sem nenhum = nenhum (nunca "todos"), assunto inexistente/desativado recusado (422), o
 *    desativado que a base já tinha continua;
 *  - versão anterior à 224 (cita o id antigo de `subjects`): o detalhe abre com o canônico, o rascunho novo nasce canônico, a comparação
 *    dá o nome e a versão publicada não é reescrita.
 * ZERO chamada de modelo (processamento inline desligado). Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run knowledge-subjects-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Assuntos da Base de conhecimento (catálogo canônico) — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("banco migrado: vínculo aponta para o catálogo canônico e o de/para preserva o nome", async () => {
    const fk = (await client.query<{ target: string }>(
      `select confrelid::regclass::text target from pg_constraint where conname = 'knowledge_document_subject_scopes_subject_id_fkey'`,
    )).rows[0]
    expect(fk?.target).toBe("interaction_subject_definitions")
    const orphans = (await client.query<{ n: number }>(`select count(*)::int n from knowledge_document_subject_scopes ss where ss.scope_type = 'SUBJECT' and not exists (select 1 from interaction_subject_definitions d where d.id = ss.subject_id)`)).rows[0]!.n
    expect(orphans).toBe(0)
    // O de/para casa pelo nome (ou pelo código gerado dele): sem acento, caixa e pontuação, os dois nomes são o mesmo.
    const norm = (column: string) => `regexp_replace(translate(lower(${column}), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]', '', 'g')`
    const renamed = (await client.query<{ n: number }>(
      `select count(*)::int n from knowledge_subject_canonical_map m join subjects s on s.id = m.legacy_subject_id join interaction_subject_definitions d on d.id = m.interaction_subject_id
        where ${norm("s.name")} <> ${norm("d.name")}`,
    )).rows[0]!.n
    expect(renamed).toBe(0)
  })

  it("catálogo, cadastro, validação e versão anterior à 224 pela API", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof KBS Grupo A') returning id", [ORG, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, roleCode: string, scope: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, 'OPERATOR', $3) returning id", [ORG, `Proof KBS ${n}`, teamId])).rows[0]!.id
      const email = `proof-kbs-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { email }
    }
    const geral = await person(null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminA = await person(teamA, "ADMINISTRADOR", { type: "GROUP", teamId: teamA })

    const app = createApp(client as never, { knowledgeInlineProcessing: false, rateLimits: false })
    const login = async (email: string) => {
      const http = request.agent(app)
      expect((await http.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return http
    }
    const org = await login(geral.email)
    const admin = await login(adminA.email)
    const kb = "/api/v1/admin/knowledge"

    // Catálogo: quem administra a organização pode incluir; o administrador de um Grupo só escolhe.
    const listing = (await org.get(`${kb}/subjects`)).body.data as { items: { id: string; name: string; active: boolean }[]; canCreate: boolean }
    expect(listing.canCreate).toBe(true)
    expect(listing.items.length).toBeGreaterThan(0)
    expect((await admin.get(`${kb}/subjects`)).body.data.canCreate).toBe(false)
    const forbidden = await admin.post(`${kb}/subjects`).send({ name: "Proof KBS Proibido" })
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.error.code).toBe("ORGANIZATION_SCOPE_REQUIRED")

    const created = await org.post(`${kb}/subjects`).send({ name: "Proof KBS Mudança de plano" })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ name: "Proof KBS Mudança de plano", code: "proof_kbs_mudanca_de_plano", active: true })
    const newSubject = created.body.data.id as string
    expect((await org.post(`${kb}/subjects`).send({ name: "proof kbs  mudança de plano" })).body.error.code).toBe("KNOWLEDGE_SUBJECT_DUPLICATED")
    expect((await org.post(`${kb}/subjects`).send({ name: "!!" })).body.error.code).toBe("KNOWLEDGE_SUBJECT_INVALID")
    // Mesmo catálogo dos Alinhamentos operacionais (pedidos do cliente relacionados).
    const requestReasons = (await org.get("/api/v1/admin/operational-alignments/request-reasons")).body.data as { id: string }[]
    expect(requestReasons.some((reason) => reason.id === newSubject)).toBe(true)
    expect((await client.query("select 1 from audit_logs where action = 'KNOWLEDGE_SUBJECT_CREATED' and entity_id = $1", [newSubject])).rowCount).toBe(1)

    const other = listing.items.find((subject) => subject.active && subject.id !== newSubject)!
    const createBase = (title: string, subjectScopes: unknown[]) =>
      org.post(kb).send({ title, documentType: "PROCEDURE", content: "## Procedimento\nPasso a passo da prova de assuntos.", orgScopes: JSON.stringify([{ scopeType: "ALL_TEAMS" }]), subjectScopes: JSON.stringify(subjectScopes), operatingUniverse: "B2C" })
    const linksOf = async (documentId: string) => (await client.query<{ scope_type: string; subject_id: string | null }>("select scope_type, subject_id from knowledge_document_subject_scopes where knowledge_document_id = $1 order by subject_id", [documentId])).rows

    // 1..N assuntos.
    const many = await createBase("Proof KBS — vários assuntos", [{ scopeType: "SUBJECT", subjectId: other.id }, { scopeType: "SUBJECT", subjectId: newSubject }])
    expect(many.status).toBe(201)
    const manyId = many.body.data.id as string
    expect((await linksOf(manyId)).map((row) => row.subject_id).sort()).toEqual([other.id, newSubject].sort())
    const row = ((await org.get(`${kb}?page=1&pageSize=20&search=Proof KBS — vários`)).body.data.items as { id: string; subjectScopes: { subjectName: string }[] }[]).find((item) => item.id === manyId)!
    expect(row.subjectScopes.map((scope) => scope.subjectName).sort()).toEqual([other.name, "Proof KBS Mudança de plano"].sort())
    // Filtro da lista por assunto.
    expect(((await org.get(`${kb}?page=1&pageSize=20&search=Proof KBS&subjectId=${newSubject}`)).body.data.items as { id: string }[]).map((item) => item.id)).toEqual([manyId])

    // Sem nenhum assunto = nenhum (nunca "todos"); "todos" sozinho.
    const none = await createBase("Proof KBS — sem assunto", [])
    expect(await linksOf(none.body.data.id)).toEqual([])
    const all = await createBase("Proof KBS — todos", [{ scopeType: "ALL_SUBJECTS" }])
    expect(await linksOf(all.body.data.id)).toEqual([{ scope_type: "ALL_SUBJECTS", subject_id: null }])
    expect((await createBase("Proof KBS — inválido", [{ scopeType: "ALL_SUBJECTS" }, { scopeType: "SUBJECT", subjectId: other.id }])).body.error.code).toBe("KNOWLEDGE_SUBJECT_INVALID")
    expect((await createBase("Proof KBS — inexistente", [{ scopeType: "SUBJECT", subjectId: "00000000-0000-4000-8000-0000000000ff" }])).body.error.code).toBe("KNOWLEDGE_SUBJECT_NOT_FOUND")

    // Desativado: recusado para quem não tinha; quem já tinha mantém.
    await client.query("update interaction_subject_definitions set active = false where id = $1", [newSubject])
    expect((await org.patch(`${kb}/${all.body.data.id}`).send({ subjectScopes: [{ scopeType: "SUBJECT", subjectId: newSubject }] })).body.error.code).toBe("KNOWLEDGE_SUBJECT_INACTIVE")
    expect((await org.patch(`${kb}/${manyId}`).send({ subjectScopes: [{ scopeType: "SUBJECT", subjectId: newSubject }] })).status).toBe(200)
    expect(((await org.get(`${kb}/subjects`)).body.data.items as { id: string; active: boolean }[]).find((subject) => subject.id === newSubject)?.active).toBe(false)

    // Versão anterior à 224: a configuração publicada cita o id antigo (`subjects`), que o mapa traduz.
    const legacy = (await client.query<{ id: string }>("insert into subjects (organization_id, name) values ($1, 'Proof KBS Legado') returning id", [ORG])).rows[0]!.id
    await client.query("insert into knowledge_subject_canonical_map (legacy_subject_id, organization_id, interaction_subject_id, created_canonical) values ($1, $2, $3, false)", [legacy, ORG, other.id])
    const legacyDoc = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof KBS — versão antiga', 'PROCEDURE', 'B2C') returning id", [ORG])).rows[0]!.id
    await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1, 'ALL_TEAMS')", [legacyDoc])
    await client.query("insert into knowledge_document_subject_scopes (knowledge_document_id, scope_type, subject_id) values ($1, 'SUBJECT', $2)", [legacyDoc, other.id])
    const legacyConfig = { title: "Proof KBS — versão antiga", documentType: "PROCEDURE", sourceType: "TEXT", file: null, orgScopes: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], subjectScopes: [{ scopeType: "SUBJECT", subjectId: legacy }], productNodeIds: [] }
    const legacyVersion = (await client.query<{ id: string }>(
      "insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, config, published_at) values ($1, $2, 1, '## Antigo\nTexto da versão antiga da prova.', 'PUBLISHED', 'h-kbs', $3, now()) returning id",
      [ORG, legacyDoc, JSON.stringify(legacyConfig)],
    )).rows[0]!.id

    const legacyDetail = (await org.get(`${kb}/${legacyDoc}`)).body.data
    expect(legacyDetail.editable.config.subjectScopes).toEqual([{ scopeType: "SUBJECT", subjectId: other.id }])
    // Rascunho novo a partir da versão antiga: nasce com o canônico.
    expect((await org.patch(`${kb}/${legacyDoc}`).send({ title: "Proof KBS — versão antiga (editada)" })).status).toBe(200)
    const draft = (await client.query<{ id: string; config: { subjectScopes: { subjectId: string }[] } }>("select id, config from knowledge_versions where document_id = $1 and version = 2", [legacyDoc])).rows[0]!
    expect(draft.config.subjectScopes.map((scope) => scope.subjectId)).toEqual([other.id])
    // A versão publicada continua como foi gravada (imutável), e a comparação dá nome aos dois lados sem acusar mudança de assunto.
    const sealed = (await client.query<{ config: { subjectScopes: { subjectId: string }[] } }>("select config from knowledge_versions where id = $1", [legacyVersion])).rows[0]!
    expect(sealed.config.subjectScopes[0]!.subjectId).toBe(legacy)
    const comparison = (await org.get(`${kb}/${legacyDoc}/versions/compare?from=${legacyVersion}&to=${draft.id}`)).body.data
    expect(comparison.configuration.changes.map((change: { field: string }) => change.field)).not.toContain("subjectScopes")
    expect((await org.get(`${kb}/${legacyDoc}/versions/${legacyVersion}`)).body.data.config.subjectScopes).toEqual([{ scopeType: "SUBJECT", subjectId: other.id }])
  })
})
