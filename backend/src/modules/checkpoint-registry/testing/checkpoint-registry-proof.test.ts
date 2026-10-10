/**
 * PROVA contra o banco de TESTE real — Checkpoint Registry Foundation: publicação da base → extração → reconciliação → governança
 * pela API real (permissão, organização da sessão, regra oficial read-only, escopo, auditoria) → runtime (recorte ATIVO) →
 * observação persistida com identidade lógica. ZERO chamada de modelo. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run checkpoint-registry-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { loadCheckpointGovernance } from "../application/checkpoint-governance-loader.js"
import { REGISTRY_DOC_TITLE, REGISTRY_KB_V1, REGISTRY_KB_V2 } from "./checkpoint-registry-fixture.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const KNOWLEDGE_ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Checkpoint Registry — prova Postgres (publicação, delta, governança, histórico, runtime)", () => {
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

  it("KB publicada vira candidatos; admin governa o delta; a regra que muda mantém a identidade; a que some deixa de valer sem apagar histórico", async () => {
    const org = KNOWLEDGE_ORG
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof CR Grupo A') returning id", [org, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof CR Grupo B') returning id", [org, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, 'OPERATOR', $3) returning id", [org, `Proof CR ${n}`, teamId])).rows[0]!.id
      const email = `proof-cr-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [org, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person(null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminA = await person(teamA, "ADMINISTRADOR", { type: "GROUP", teamId: teamA })
    const semPapel = await person(teamA)
    const operatorA = await person(teamA)
    const operatorB = await person(teamB)

    const app = createApp(client as never)
    const login = async (email: string) => {
      const agentHttp = request.agent(app)
      expect((await agentHttp.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return agentHttp
    }
    const admin = await login(geral.email)
    const scopedAdmin = await login(adminA.email)
    const nobody = await login(semPapel.email)
    const base = "/api/v1/admin/checkpoints"

    // Base publicada (a rota de Bases abre conexão própria, fora da transação da prova: a versão entra por SQL e a extração é
    // chamada pela API — a MESMA função `syncCheckpointRegistry` que o gancho de publicação da rota de Bases chama).
    const documentId = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1, $2, 'PROCEDURE', 'TEXT') returning id", [org, REGISTRY_DOC_TITLE])).rows[0]!.id
    const publish = (version: number, content: string) => client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, $3, $4, 'PUBLISHED', md5($4))", [org, documentId, version, content])
    await publish(1, REGISTRY_KB_V1)
    expect((await admin.post(`${base}/documents/${documentId}/extract`)).body.data).toMatchObject({ status: "SYNCED", knowledgeVersion: 1 })

    // 1) A regra publicada virou CANDIDATA (primeira extração: tudo proposto; nada vale ainda; o runtime continua legado).
    const v1 = (await admin.get(`${base}/documents/${documentId}`)).body.data
    expect(v1.changeSets).toHaveLength(1)
    expect(v1.changeSets[0].counts).toMatchObject({ NEW: 6 })
    expect(v1.checkpoints.every((checkpoint: { status: string; changeKind: string }) => checkpoint.status === "PROPOSED" && checkpoint.changeKind === "NEW")).toBe(true)
    expect(v1.checkpoints.map((checkpoint: { name: string }) => checkpoint.name)).not.toContain("Exemplos de fala")
    // Idempotente: reprocessar a mesma versão não duplica nada.
    expect((await admin.post(`${base}/documents/${documentId}/extract`)).body.data).toMatchObject({ status: "ALREADY_SYNCED" })

    // Permissões: sem papel = 403; administrador escopado lê, mas não governa.
    expect((await nobody.get(`${base}/documents`)).status).toBe(403)
    expect((await scopedAdmin.get(`${base}/documents/${documentId}`)).status).toBe(200)
    expect((await scopedAdmin.post(`${base}/change-sets/${v1.changeSets[0].id}/approve-proposed`)).status).toBe(403)

    // 2) Governança: aprovar o conjunto inicial, rejeitar um candidato com motivo, ligar a governança do documento.
    const reference = v1.checkpoints.find((checkpoint: { requirement: string }) => checkpoint.requirement.includes("ponto de referência"))
    expect((await admin.post(`${base}/versions/${reference.versionId}/reject`).send({ note: "x" })).status).toBe(400)
    expect((await admin.post(`${base}/change-sets/${v1.changeSets[0].id}/approve-proposed`)).body.data).toMatchObject({ approved: 6 })
    expect((await admin.post(`${base}/versions/${reference.versionId}/approve`)).status).toBe(409)
    expect((await admin.post(`${base}/documents/${documentId}/governance`).send({ enabled: true })).status).toBe(204)

    // M) a regra oficial não é editável: só a configuração operacional (esquema estrito).
    const adult = v1.checkpoints.find((checkpoint: { requirement: string }) => checkpoint.requirement.includes("maior de idade"))
    const official = await admin.patch(`${base}/definitions/${adult.definitionId}`).send({ requirement: "Qualquer outra regra" })
    expect(official.status).toBe(422)
    expect(official.body.error.code).toBe("CHECKPOINT_OFFICIAL_RULE_READ_ONLY")
    expect((await admin.patch(`${base}/definitions/${adult.definitionId}`).send({ operationalLabel: "Maior de idade disponível para visita", criticality: "HIGH", highlight: true })).status).toBe(204)
    const telephone = v1.checkpoints.find((checkpoint: { requirement: string }) => checkpoint.requirement.includes("telefone"))
    // N) escopo = associação: o telefone vale só para o Grupo A — a definição NÃO é duplicada por equipe.
    expect((await admin.put(`${base}/definitions/${telephone.definitionId}/scopes`).send({ scopes: [{ scopeType: "TEAM", teamId: teamA }] })).status).toBe(204)
    expect((await client.query("select count(*)::int n from checkpoint_definitions where knowledge_document_id = $1", [documentId])).rows[0].n).toBe(6)

    // 5) Runtime: o recorte ATIVO do documento governado, no escopo do colaborador.
    const forA = (await loadCheckpointGovernance(client, org, [{ id: documentId, version: 1 }], { personId: operatorA.id }))!
    const forB = (await loadCheckpointGovernance(client, org, [{ id: documentId, version: 1 }], { personId: operatorB.id }))!
    expect(forA.governed).toEqual([{ documentId, knowledgeVersion: 1 }])
    expect(forA.active.map((entry) => entry.ref)).toContain(telephone.checkpointRef)
    expect(forB.active.map((entry) => entry.ref)).not.toContain(telephone.checkpointRef)
    expect(forA.active.find((entry) => entry.ref === adult.checkpointRef)).toMatchObject({ name: "Maior de idade disponível para visita", highlight: true, criticality: "HIGH", definitionId: adult.definitionId, versionId: adult.versionId })

    // 8) ProcessObservation com a identidade lógica (cauda longa: CHECKPOINT:<definição>) — a restrição do banco aceita.
    const interaction = (await client.query<{ id: string }>("insert into interactions (organization_id, operator_id, channel, reason, started_at, ended_at, external_id) values ($1, $2, 'VOICE', 'Visita técnica', now() - interval '5 minutes', now(), $3) returning id", [org, operatorA.id, `PROOF-CR-${Date.now()}`])).rows[0]!.id
    await client.query(
      `insert into process_checkpoint_observations (organization_id, person_id, interaction_id, practice_key, document_id, document_version, requirement, status, occurred_at, analytics_status, checkpoint_ref, checkpoint_definition_id, checkpoint_version_id)
       values ($1, $2, $3, $4, $5, 1, $6, 'FOLLOWED', now(), 'VERIFIED', $7, $8, $9)`,
      [org, operatorA.id, interaction, `CHECKPOINT:${adult.definitionId}`, documentId, adult.requirement, adult.checkpointRef, adult.definitionId, adult.versionId],
    )
    await expect(client.query("savepoint bad_key").then(() => client.query(`insert into process_checkpoint_observations (organization_id, person_id, interaction_id, practice_key, document_id, document_version, requirement, status, occurred_at) values ($1, $2, $3, 'CHECKPOINT:qualquer', $4, 1, 'r', 'FOLLOWED', now())`, [org, operatorA.id, interaction, documentId]))).rejects.toThrow()
    await client.query("rollback to savepoint bad_key")

    // 3/4) Nova versão da base: a mesma regra reescrita mantém a identidade; a modificada espera revisão; a removida deixa de valer.
    await publish(2, REGISTRY_KB_V2)
    expect((await admin.post(`${base}/documents/${documentId}/extract`)).body.data).toMatchObject({ status: "SYNCED", knowledgeVersion: 2 })
    const v2 = (await admin.get(`${base}/documents/${documentId}`)).body.data
    expect(v2.changeSets.map((changeSet: { knowledgeVersion: number }) => changeSet.knowledgeVersion)).toEqual([2, 1])
    expect(v2.changeSets[0].counts).toEqual({ UNCHANGED: 3, SEMANTICALLY_EQUIVALENT: 1, MODIFIED: 1, NEW: 1, REMOVED: 1, AMBIGUOUS: 0 })
    const inV2 = (text: string) => v2.checkpoints.find((checkpoint: { requirement: string }) => checkpoint.requirement.includes(text))
    expect(inV2("telefone de contato")).toMatchObject({ changeKind: "SEMANTICALLY_EQUIVALENT", status: "ACTIVE", definitionId: telephone.definitionId, definitionVersion: 2, scopeCount: 1 })
    expect(inV2("maior de 18 anos")).toMatchObject({ changeKind: "MODIFIED", status: "NEEDS_REVIEW", definitionId: adult.definitionId, definitionVersion: 2, name: "Maior de idade disponível para visita" })
    expect(inV2("janela de horário")).toMatchObject({ changeKind: "NEW", status: "PROPOSED" })
    expect(inV2("ponto de referência")).toMatchObject({ changeKind: "REMOVED", status: "REMOVED", definitionId: reference.definitionId, checkpointRef: null })
    // O delta revisa só o que mudou: a regra modificada ainda não vale na v2; a removida nunca mais é apresentada.
    const runtimeV2 = (await loadCheckpointGovernance(client, org, [{ id: documentId, version: 2 }], { personId: operatorA.id }))!
    expect(runtimeV2.active.map((entry) => entry.ref)).not.toContain(inV2("maior de 18 anos").checkpointRef)
    expect(runtimeV2.active.some((entry) => entry.definitionId === reference.definitionId)).toBe(false)
    expect((await admin.post(`${base}/versions/${inV2("maior de 18 anos").versionId}/approve`).send({ note: "Regra passou a exigir 18 anos." })).status).toBe(204)
    expect((await admin.post(`${base}/versions/${inV2("ponto de referência").versionId}/acknowledge-removal`)).status).toBe(204)

    // K/L) histórico: nada foi apagado; a versão antiga continua resolvível ("qual regra valia em outubro?").
    const history = (await admin.get(`${base}/definitions/${adult.definitionId}`)).body.data
    expect(history.versions.map((version: { knowledgeVersion: number; status: string; definitionVersion: number }) => [version.knowledgeVersion, version.status, version.definitionVersion])).toEqual([[2, "ACTIVE", 2], [1, "SUPERSEDED", 1]])
    expect(history.versions[1].sourceLiteral).toContain("maior de idade disponível")
    expect(history.versions[1].effectiveUntil).not.toBeNull()
    const removedHistory = (await admin.get(`${base}/definitions/${reference.definitionId}`)).body.data
    expect(removedHistory.versions.map((version: { knowledgeVersion: number; status: string }) => [version.knowledgeVersion, version.status])).toEqual([[2, "REMOVED"], [1, "SUPERSEDED"]])
    const observation = (await client.query("select checkpoint_definition_id, checkpoint_version_id, document_version from process_checkpoint_observations where interaction_id = $1", [interaction])).rows[0]
    expect(observation).toEqual({ checkpoint_definition_id: adult.definitionId, checkpoint_version_id: adult.versionId, document_version: 1 })
    // Auditoria: quem, quando, o quê (versão antiga/nova e motivo).
    expect(history.audit.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(["CHECKPOINT_VERSION_APPROVED", "CHECKPOINT_DEFINITION_CONFIGURED"]))
    expect(history.audit.find((entry: { action: string; payload: { note?: string } }) => entry.action === "CHECKPOINT_VERSION_APPROVED" && entry.payload.note)).toMatchObject({ payload: { from: "NEEDS_REVIEW", to: "ACTIVE", changeKind: "MODIFIED", knowledgeVersion: 2 } })

    // Organização da sessão: id de definição inexistente/de fora = 404.
    expect((await admin.get(`${base}/definitions/00000000-0000-4000-8000-00000000dead`)).status).toBe(404)
  })
})
