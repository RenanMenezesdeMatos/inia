/**
 * PROVA contra o banco de TESTE real — SELETOR DE BASES DO AGENT (`/api/v1/admin/agents/knowledge-options`). Cenário com bases de
 * dois Grupos, um Subgrupo, globais, de outro universo, pendente, arquivada e sem versão, com assunto e produto:
 *  - busca sem acento e sem caixa pelo título, pelo assunto e pelo produto (e pela família do produto);
 *  - universo do agente (pendente cabe, outro universo não), alcance do agente (globais e do mesmo Grupo — a regra do salvar);
 *  - filtros Grupo/Subgrupo/só globais, produto (família inclui os produtos dela), assunto e situação;
 *  - página por posição (limit 2) percorre tudo sem repetir, `total` só na primeira; cursor inválido = 400;
 *  - "selecionar as filtradas" (ids) e pré-seleção pelo Grupo (regra de sempre do formulário);
 *  - escolhidas pelo id voltam mesmo arquivadas ou de outro universo; disponíveis excluem as escolhidas;
 *  - quem administra agentes só do Grupo B não enxerga a base do Grupo A.
 * ZERO chamada de modelo. Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run agent-knowledge-options-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const URL = "/api/v1/admin/agents/knowledge-options"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Seletor de bases do Agent — prova Postgres", () => {
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

  it("busca, filtros encadeados, posição, seleção das filtradas, pré-seleção e escolhidas", async () => {
    // A organização de teste já tem bases: o cenário usa um prefixo próprio na busca e restringe pelo Grupo onde precisa.
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const team = async (name: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, $3, 'B2C') returning id", [ORG, operation, name])).rows[0]!.id
    const teamA = await team("Proof KBOPT Grupo A")
    const teamB = await team("Proof KBOPT Grupo B")
    const subA1 = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof KBOPT A1') returning id", [ORG, teamA])).rows[0]!.id

    const hash = await hashPassword("Proof@12345")
    let n = 0
    const admin = async (scope: { type: "ORGANIZATION" } | { type: "GROUP"; teamId: string }) => {
      n += 1
      const personId = (await client.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, $2, 'OPERATOR') returning id", [ORG, `Proof KBOPT ${n}`])).rows[0]!.id
      const email = `proof-kbopt-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, personId, email, hash])).rows[0]!.id
      await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, scope.type === "ORGANIZATION" ? "ADMINISTRADOR_GERAL" : "ADMINISTRADOR", scope.type, scope.type === "GROUP" ? scope.teamId : null])
      return email
    }
    const geral = await admin({ type: "ORGANIZATION" })
    const adminB = await admin({ type: "GROUP", teamId: teamB })

    const subject = (await client.query<{ id: string }>("insert into interaction_subject_definitions (organization_id, code, name) values ($1, $2, 'Proof KBOPT Portabilidade numérica') returning id", [ORG, `proof_kbopt_${Date.now() % 100000}`])).rows[0]!.id
    const family = (await client.query<{ id: string }>("insert into product_catalog_nodes_all (organization_id, kind, code, name) values ($1, 'FAMILY', 'PROOF_KBOPT_FAM', 'Proof KBOPT Fibra') returning id", [ORG])).rows[0]!.id
    const product = (await client.query<{ id: string }>("insert into product_catalog_nodes_all (organization_id, kind, code, name, parent_id, operating_universe) values ($1, 'PRODUCT', 'PROOF_KBOPT_PRD', 'Proof KBOPT Ultra Velocidade', $2, 'B2C') returning id", [ORG, family])).rows[0]!.id

    const doc = async (title: string, options: { universe?: string | null; scopes: ({ type: "ALL_TEAMS" } | { type: "TEAM"; teamId: string } | { type: "SUBTEAM"; subteamId: string })[]; version?: "PUBLISHED" | "ARCHIVED" | "DRAFT" }) => {
      const id = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, $2, 'PROCEDURE', $3) returning id", [ORG, title, options.universe === undefined ? "B2C" : options.universe])).rows[0]!.id
      await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'Conteúdo da prova do seletor de bases.', $3, $4)", [ORG, id, options.version ?? "PUBLISHED", `h-kbopt-${id}`])
      for (const scope of options.scopes) {
        if (scope.type === "ALL_TEAMS") await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1, 'ALL_TEAMS')", [id])
        else if (scope.type === "TEAM") await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, 'TEAM', $2)", [id, scope.teamId])
        else await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, subteam_id) values ($1, 'SUBTEAM', $2)", [id, scope.subteamId])
      }
      return id
    }
    const global = await doc("Proof KBOPT Ácido global", { scopes: [{ type: "ALL_TEAMS" }] })
    const ofA = await doc("Proof KBOPT Base do Grupo A", { scopes: [{ type: "TEAM", teamId: teamA }] })
    const ofA1 = await doc("Proof KBOPT Base do Subgrupo A1", { scopes: [{ type: "SUBTEAM", subteamId: subA1 }] })
    const ofB = await doc("Proof KBOPT Base do Grupo B", { scopes: [{ type: "TEAM", teamId: teamB }] })
    const b2b = await doc("Proof KBOPT Corporativo", { universe: "B2B", scopes: [{ type: "ALL_TEAMS" }] })
    const pending = await doc("Proof KBOPT Pendente", { universe: null, scopes: [{ type: "TEAM", teamId: teamA }] })
    const archived = await doc("Proof KBOPT Arquivada", { scopes: [{ type: "TEAM", teamId: teamA }], version: "ARCHIVED" })
    const draft = await doc("Proof KBOPT Rascunho", { scopes: [{ type: "TEAM", teamId: teamA }], version: "DRAFT" })
    await client.query("insert into knowledge_document_subject_scopes (knowledge_document_id, scope_type, subject_id) values ($1, 'SUBJECT', $2)", [ofA, subject])
    await client.query("insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from) values ($1, 'KNOWLEDGE_DOCUMENT', $2, $3, now() - interval '1 day')", [ORG, ofA1, [product]])

    const app = createApp(client as never, { knowledgeInlineProcessing: false, rateLimits: false })
    const login = async (email: string) => {
      const http = request.agent(app)
      expect((await http.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return http
    }
    const org = await login(geral)
    const search = async (body: Record<string, unknown>, http = org) => {
      const response = await http.post(`${URL}/search`).send(body)
      expect(response.status).toBe(200)
      return response.body.data as { items: { id: string; title: string; state: string; subjects: string[]; products: string[]; orgScopes: { teamName: string | null; subteamName: string | null }[] }[]; nextCursor: string | null; total: number | null }
    }
    const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id)

    // Busca sem acento/caixa: título ("acido" acha "Ácido"), assunto ("portabilidade numerica"), produto e família.
    expect(ids(await search({ search: "proof kbopt acido" }))).toEqual([global])
    expect(ids(await search({ search: "PORTABILIDADE NUMERICA" }))).toEqual([ofA])
    expect(ids(await search({ search: "ultra velocidade" }))).toEqual([ofA1])
    expect(ids(await search({ search: "kbopt fibra" }))).toEqual([ofA1])

    // Universo do agente B2C: B2B some, pendente fica. Filtro "Pendente" isola o pendente.
    const b2c = ids(await search({ search: "Proof KBOPT", agentUniverse: "B2C", limit: 100 }))
    expect(b2c).toContain(pending)
    expect(b2c).not.toContain(b2b)
    expect(ids(await search({ search: "Proof KBOPT", universe: "PENDING" }))).toEqual([pending])

    // Alcance do agente (Grupo A): globais e do Grupo A (inclusive por Subgrupo); nada do Grupo B. Agente do Subgrupo A1: a mesma regra.
    for (const agentScope of [{ scopeType: "TEAM", teamId: teamA }, { scopeType: "SUBTEAM", subteamId: subA1 }]) {
      const fit = ids(await search({ search: "Proof KBOPT", agentScope, limit: 100 }))
      expect(fit).toEqual(expect.arrayContaining([global, ofA, ofA1, pending, archived, draft]))
      expect(fit).not.toContain(ofB)
    }

    // Filtros do seletor: Grupo B, Subgrupo A1 (o Subgrupo e o Grupo-pai inteiro), só globais, assunto, produto pela família, situação.
    expect(ids(await search({ search: "Proof KBOPT", teamId: teamB }))).toEqual([ofB])
    expect(ids(await search({ search: "Proof KBOPT", subteamId: subA1 })).sort()).toEqual([ofA, ofA1, pending, archived, draft].sort())
    expect(ids(await search({ search: "Proof KBOPT", scopeType: "ALL_TEAMS" })).sort()).toEqual([global, b2b].sort())
    expect(ids(await search({ subjectId: subject }))).toEqual([ofA])
    expect(ids(await search({ productId: family }))).toEqual([ofA1])
    expect(ids(await search({ search: "Proof KBOPT", state: "ARCHIVED" }))).toEqual([archived])
    expect(ids(await search({ search: "Proof KBOPT", state: "NO_VERSION" }))).toEqual([draft])

    // Linha leve: Grupos com nome, assuntos e produtos (família › produto).
    const rowA1 = (await search({ search: "Subgrupo A1" })).items[0]!
    expect(rowA1.orgScopes).toEqual([expect.objectContaining({ teamName: "Proof KBOPT Grupo A", subteamName: "Proof KBOPT A1" })])
    expect(rowA1.products).toEqual(["Proof KBOPT Fibra › Proof KBOPT Ultra Velocidade"])

    // Posição: limit 2 percorre as 8 bases sem repetir, em ordem de título; total só na primeira página.
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await search({ search: "Proof KBOPT", limit: 2, ...(cursor ? { cursor } : {}) })
      if (pages === 0) expect(page.total).toBe(8)
      else expect(page.total).toBeNull()
      seen.push(...ids(page))
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 10)
    expect(pages).toBe(4)
    expect(new Set(seen).size).toBe(8)
    expect(seen).toEqual(ids(await search({ search: "Proof KBOPT", limit: 100 })))
    expect((await org.post(`${URL}/search`).send({ cursor: "nao-e-um-cursor" })).body.error.code).toBe("KNOWLEDGE_OPTIONS_CURSOR_INVALID")

    // Disponíveis excluem as escolhidas.
    expect(ids(await search({ search: "Proof KBOPT", excludeIds: [global, ofA], limit: 100 }))).not.toEqual(expect.arrayContaining([global]))

    // "Selecionar as filtradas": os ids do filtro inteiro (não só da página).
    const filtered = (await org.post(`${URL}/ids`).send({ search: "Proof KBOPT", agentUniverse: "B2C", agentScope: { scopeType: "TEAM", teamId: teamA } })).body.data
    expect(filtered.total).toBe(6)
    expect(filtered.truncated).toBe(false)
    expect([...filtered.ids].sort()).toEqual([global, ofA, ofA1, pending, archived, draft].sort())

    // Pré-seleção pelo Grupo: regra de sempre (Grupo = globais + do Grupo, inclusive Subgrupos; Subgrupo = globais + do Subgrupo).
    const defaults = async (agentScope: Record<string, unknown>) => (await org.post(`${URL}/group-defaults`).send({ agentScope, agentUniverse: "B2C" })).body.data.ids as string[]
    const teamDefaults = await defaults({ scopeType: "TEAM", teamId: teamA })
    expect(teamDefaults).toEqual(expect.arrayContaining([global, ofA, ofA1, pending, archived, draft]))
    expect(teamDefaults).not.toEqual(expect.arrayContaining([ofB]))
    expect(teamDefaults).not.toEqual(expect.arrayContaining([b2b]))
    const subDefaults = await defaults({ scopeType: "SUBTEAM", subteamId: subA1 })
    expect(subDefaults).toEqual(expect.arrayContaining([global, ofA1]))
    expect(subDefaults).not.toEqual(expect.arrayContaining([ofA]))
    expect(await defaults({ scopeType: "ALL_TEAMS" })).toEqual([])

    // Escolhidas pelo id: arquivada e de outro universo continuam visíveis.
    const lookup = (await org.post(`${URL}/lookup`).send({ ids: [archived, b2b] })).body.data as { id: string; state: string; operatingUniverse: string }[]
    expect(lookup.map((row) => [row.id, row.state, row.operatingUniverse]).sort()).toEqual([[archived, "ARCHIVED", "B2C"], [b2b, "IN_USE", "B2B"]].sort())

    // Filtros Produto e Assunto oferecem o que aparece nas bases.
    const facets = (await org.get(`${URL}/facets`).query({ agentUniverse: "B2C" })).body.data as { products: { id: string; parentId: string | null }[]; subjects: { id: string }[] }
    expect(facets.products).toEqual(expect.arrayContaining([expect.objectContaining({ id: product, parentId: family })]))
    expect(facets.subjects.map((item) => item.id)).toContain(subject)

    // Quem administra agentes só do Grupo B: vê globais e o Grupo B; a base do Grupo A não aparece nem pelo id.
    const http = await login(adminB)
    const scoped = ids(await search({ search: "Proof KBOPT", limit: 100 }, http))
    expect(scoped).toEqual(expect.arrayContaining([global, ofB]))
    expect(scoped).not.toContain(ofA)
    expect((await http.post(`${URL}/lookup`).send({ ids: [ofA] })).body.data).toEqual([])
  })
})
