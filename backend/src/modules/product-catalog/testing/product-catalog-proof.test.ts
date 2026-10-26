/**
 * PROVA contra o banco de TESTE real — Produtos e aplicabilidade (`PRODUCT_APPLICABILITY_V1`, migration 154): cadastro pela API real
 * (sessão, `configuration.manage` com escopo da organização para escrever), árvore família → produto, critério em linguagem natural
 * rascunho → aprovado (imutável) → nova versão com vigência futura → encerrado, abrangência por produto das fontes com vigência
 * própria, leitura do cadastro NA DATA DA CHAMADA pelo motor (rascunho e fora da vigência nunca), análise com a identificação gravada
 * em `call_assessments.product_identification` e a leitura da liderança. ZERO chamada de modelo (as leituras são escritas aqui). Os
 * produtos e critérios são EXEMPLOS FICTÍCIOS de teste. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run product-catalog-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { buildProcedureContext } from "../../feedback-engine/domain/procedure.js"
import { productContextOf, scopeLabelFor } from "../../feedback-engine/domain/product-applicability.js"
import { createPostgresFeedbackMemoryStore } from "../../feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { assessmentDetail } from "../../feedback-engine/application/leadership-diagnostics.js"
import { analysis, confirmingReview, evidence, obligation, reading, request as modelRequest, verifyWithReview } from "../../feedback-engine/testing/product-scenarios.js"
import { loadProductCatalogAt } from "../infrastructure/product-catalog-loaders.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

function savepointDb(connection: pg.PoolClient): Database {
  const proxy = { query: (sql: string, params?: unknown[]) => (sql === "begin" ? connection.query("savepoint memory_tx") : sql === "commit" ? connection.query("release savepoint memory_tx") : sql === "rollback" ? connection.query("rollback to savepoint memory_tx") : connection.query(sql, params)), release: () => undefined }
  return { query: (sql: string, params?: unknown[]) => connection.query(sql, params), connect: async () => proxy } as unknown as Database
}

describe.skipIf(!ENABLED)("Produtos e aplicabilidade — prova Postgres (cadastro, versões, vigência, abrangência, motor, memória)", () => {
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

  it("cadastro pela API, vigência nunca retroativa, versão aprovada imutável, abrangência com histórico; o motor lê o que valia na data", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof PR Grupo') returning id", [ORG, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, 'OPERATOR', $3) returning id", [ORG, `Proof PR ${n}`, team])).rows[0]!.id
      const email = `proof-pr-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person("ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const groupAdmin = await person("ADMINISTRADOR", { type: "GROUP", teamId: team })
    const nobody = await person()
    const operator = await person()
    const app = createApp(client as never)
    const login = async (email: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return agent
    }
    const org = await login(geral.email)
    const group = await login(groupAdmin.email)
    const none = await login(nobody.email)
    const base = "/api/v1/admin/product-catalog"
    const suffix = String(Date.now() % 100000)

    // Permissões: sem `configuration.manage` nada; com escopo de Grupo só leitura (catálogo da organização inteira).
    expect((await none.get(`${base}/nodes`)).status).toBe(403)
    expect((await group.get(`${base}/nodes`)).status).toBe(200)
    expect((await group.post(`${base}/nodes`).send({ kind: "FAMILY", code: `PRF_FAM_${suffix}`, name: "Família de prova" })).status).toBe(403)

    // Árvore: família → produto; produto dentro de produto é recusado.
    const family = (await org.post(`${base}/nodes`).send({ kind: "FAMILY", code: `PRF_FAM_${suffix}`, name: "Produtos de voz (prova)" })).body.data
    const product = (await org.post(`${base}/nodes`).send({ kind: "PRODUCT", code: `PRF_SIP_${suffix}`, name: "Tronco de voz (prova)", parentId: family.id })).body.data
    const other = (await org.post(`${base}/nodes`).send({ kind: "PRODUCT", code: `PRF_DDR_${suffix}`, name: "Ramal direto (prova)", parentId: family.id })).body.data
    expect((await org.post(`${base}/nodes`).send({ kind: "PRODUCT", code: `PRF_X_${suffix}`, name: "Inválido", parentId: product.id })).body.error.code).toBe("PRODUCT_TREE_INVALID")
    expect((await org.post(`${base}/nodes`).send({ kind: "PRODUCT", code: `PRF_SIP_${suffix}`, name: "Repetido" })).status).toBe(409)

    // Critério: rascunho → aprovação exige fonte; nunca retroativo.
    const createdResponse = (await org.post(`${base}/criteria`).send({ title: `Conta iniciada em 7000 (prova ${suffix})`, content: { statement: "Conta iniciada em 7000 identifica o tronco de voz.", targetNodeIds: [product.id], strength: "CONCLUSIVE", conclusiveWhen: "o cliente diz a conta completa do próprio pedido" } }))
    expect(createdResponse.status, JSON.stringify(createdResponse.body)).toBe(201)
    const created = createdResponse.body.data
    expect(created.versions[0]).toMatchObject({ status: "DRAFT", situation: "DRAFT" })
    const notReady = await org.post(`${base}/criteria/${created.id}/approve`).send({})
    expect(notReady.body.error).toMatchObject({ code: "PRODUCT_CRITERION_NOT_READY" })
    await org.patch(`${base}/criteria/${created.id}`).send({ content: { ...created.versions[0].content, sourceReference: "Comunicado de prova 01" } })
    expect((await org.post(`${base}/criteria/${created.id}/approve`).send({ effectiveFrom: new Date(Date.now() - 3_600_000).toISOString() })).body.error.code).toBe("PRODUCT_CRITERION_RETROACTIVE")
    const beforeApproval = new Date()
    // Como a tela manda quando ninguém escolhe a data: `effectiveFrom: null` = a partir de agora.
    const approved = (await org.post(`${base}/criteria/${created.id}/approve`).send({ effectiveFrom: null })).body.data
    expect(approved.versions[0]).toMatchObject({ status: "APPROVED", situation: "IN_FORCE", version: 1 })

    // Versão aprovada é imutável (gatilho no banco).
    await client.query("savepoint immutable")
    await expect(client.query("update product_identification_criterion_versions set statement = 'mudado' where id = $1", [approved.versions[0].id])).rejects.toThrow(/imutável/)
    await client.query("rollback to savepoint immutable")

    // Nova versão com vigência FUTURA: até lá vale a v1; o rascunho nunca vale.
    await org.patch(`${base}/criteria/${created.id}`).send({ content: { ...approved.versions[0].content, statement: "Conta iniciada em 7000 identifica o tronco de voz, exceto contas de teste." } })
    const future = new Date(Date.now() + 86_400_000)
    const v2 = (await org.post(`${base}/criteria/${created.id}/approve`).send({ effectiveFrom: future.toISOString() })).body.data
    expect(v2.versions.map((version: { version: number; status: string; situation: string }) => [version.version, version.status, version.situation])).toEqual([[2, "APPROVED", "SCHEDULED"], [1, "SUPERSEDED", "IN_FORCE"]])
    const draftOnly = (await org.post(`${base}/criteria`).send({ title: `Rascunho de prova ${suffix}`, content: { statement: "Nunca aprovado.", targetNodeIds: [other.id], sourceReference: "x" } })).body.data

    // Abrangência por produto de uma fonte, com histórico (nunca reescrita).
    const documentId = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type) values ($1, $2, 'PROCEDURE') returning id", [ORG, `Segunda via — tronco de voz (prova ${suffix})`])).rows[0]!.id
    await client.query("insert into knowledge_versions (organization_id, document_id, version, content, content_hash, status) values ($1, $2, 1, $3, 'h', 'PUBLISHED')", [ORG, documentId, "# Segunda via — tronco de voz\n\n## Procedimento\n\n- Informar que a segunda via vai ao e-mail do gestor do contrato."])
    const firstScope = (await org.put(`${base}/sources/KNOWLEDGE_DOCUMENT/${documentId}/scope`).send({ nodeIds: [family.id] })).body.data
    expect(firstScope.history).toHaveLength(1)
    const betweenScopes = new Date()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const secondScope = (await org.put(`${base}/sources/KNOWLEDGE_DOCUMENT/${documentId}/scope`).send({ nodeIds: [product.id] })).body.data
    expect(secondScope.history.map((entry: { nodeIds: string[]; effectiveUntil: string | null }) => [entry.nodeIds, entry.effectiveUntil === null])).toEqual([[[product.id], true], [[family.id], false]])
    await client.query("savepoint scope_history")
    await expect(client.query("delete from product_scope_assignments where source_id = $1", [documentId])).rejects.toThrow(/histórico/)
    await client.query("rollback to savepoint scope_history")
    expect((await group.put(`${base}/sources/KNOWLEDGE_DOCUMENT/${documentId}/scope`).send({ nodeIds: [] })).status).toBe(403)

    // Código em uso fica travado; item em uso não é excluído.
    expect((await org.patch(`${base}/nodes/${product.id}`).send({ code: `PRF_NOVO_${suffix}` })).body.error.code).toBe("PRODUCT_CODE_LOCKED")
    expect((await org.delete(`${base}/nodes/${product.id}`)).body.error.code).toBe("PRODUCT_NODE_IN_USE")

    // O motor lê o cadastro NA DATA: antes da aprovação, nada do critério; entre as abrangências, a primeira; agora, a v1 e a segunda.
    const atBefore = await loadProductCatalogAt(client, ORG, new Date(beforeApproval.getTime() - 600_000), [documentId])
    expect(atBefore?.criteria.find((criterion) => criterion.criterionId === created.id)).toBeUndefined()
    const atBetween = await loadProductCatalogAt(client, ORG, betweenScopes, [documentId])
    expect(atBetween!.scopes.find((scope) => scope.sourceId === documentId)!.nodeIds).toEqual([family.id])
    const now = await loadProductCatalogAt(client, ORG, new Date(), [documentId])
    expect(now!.criteria.find((criterion) => criterion.criterionId === created.id)).toMatchObject({ version: 1, strength: "CONCLUSIVE", sourceLabel: "Comunicado de prova 01" })
    expect(now!.criteria.find((criterion) => criterion.criterionId === draftOnly.id)).toBeUndefined()
    expect(now!.scopes.find((scope) => scope.sourceId === documentId)!.nodeIds).toEqual([product.id])
    const afterFuture = await loadProductCatalogAt(client, ORG, new Date(future.getTime() + 60_000), [documentId])
    expect(afterFuture!.criteria.find((criterion) => criterion.criterionId === created.id)).toMatchObject({ version: 2 })
    // Isolamento: outra organização não vê nada deste cadastro.
    expect(await loadProductCatalogAt(client, "00000000-0000-4000-8000-0000000000ff", new Date(), [documentId])).toBeNull()

    // Análise com a identificação → memória → leitura da liderança (fotografia; mudanças posteriores no cadastro não a alteram).
    const transcript = ["Operador: Bom dia.", "Cliente: Preciso da segunda via. A conta é 7000 1234 5678.", "Operador: Certo, vou gerar."].join("\n")
    const interaction = (await client.query<{ id: string }>("insert into interactions (organization_id, operator_id, channel, reason, started_at, ended_at, external_id) values ($1, $2, 'VOICE', 'Segunda via', now() - interval '5 minutes', now(), $3) returning id", [ORG, operator.id, `PROOF-PR-${suffix}`])).rows[0]!.id
    await client.query("insert into transcripts (organization_id, interaction_id, version, content) values ($1, $2, 1, $3)", [ORG, interaction, transcript])
    const context = buildProcedureContext([{ documentId, title: "Segunda via — tronco de voz (prova)", version: 1, content: "# Segunda via — tronco de voz\n\n## Procedimento\n\n- Informar que a segunda via vai ao e-mail do gestor do contrato.", contentHash: "h", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }])
    const products = productContextOf(now, { presentedSourceIds: [documentId], metadata: [{ label: "Assunto registrado", value: "Segunda via" }] })!
    for (const document of context.documents) document.productScopeLabel = scopeLabelFor(products, document.documentId)
    const productHandle = products.nodes.find((node) => node.id === product.id)!.handle
    const criterionHandle = products.criteria.find((criterion) => criterion.criterionId === created.id)!.handle
    const world = { context, products, projection: projectTranscript(transcript), line: () => "L1", node: () => productHandle, crit: () => criterionHandle }
    const items = [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 7000 1234 5678.", criterion: criterionHandle, conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [productHandle] })]
    const model = analysis([obligation({ id: "OBL-1", sources: ["L1"], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [productHandle] })], [modelRequest("Q1", "IDENTIFIED", [productHandle], items)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [productHandle], items)]))
    expect(result.criteria[0]).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
    const store = createPostgresFeedbackMemoryStore(savepointDb(client))
    const claim = await store.claimAnalysis({ organizationId: ORG, kind: "CALL_ANALYSIS", analysisKey: `proof-pr-${suffix}`, personId: operator.id, interactionId: interaction, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: null, trigger: { kind: "EVALUATION", selectionReason: "prova" }, logicVersion: result.logicVersion, asOf: new Date() }, new Date(), 300)
    if (claim.kind !== "CLAIMED") throw new Error("claim")
    await store.completeCallAnalysis(ORG, claim.runId, { snapshot: { interactionId: interaction, personId: operator.id, occurredAt: new Date(), timeZone: "America/Sao_Paulo", subjectRaw: "Segunda via", subjectCanonical: null, channel: "VOICE", teamId: team, subteamId: null, supervisorId: null, transcriptChecksum: null, selectionReason: "prova" }, analysis: result, identities: new Map(), documentVersions: new Map([[documentId, { version: 1, perspective: "RULE_IN_FORCE_AT_CALL" }]]), provenance: {}, metrics: {} }, new Date())
    const stored = (await client.query<{ id: string; product_identification: { requests: { status: string; evidence: { quote: string }[] }[]; catalog: { criteria: { criterionId: string; version: number }[] } } }>("select id, product_identification from call_assessments where analysis_run_id = $1", [claim.runId])).rows[0]!
    expect(stored.product_identification.requests[0]).toMatchObject({ status: "IDENTIFIED" })
    expect(stored.product_identification.requests[0]!.evidence[0]!.quote).toBe("A conta é 7000 •••• ••••.")
    expect(stored.product_identification.catalog.criteria).toEqual([expect.objectContaining({ criterionId: created.id, version: 1 })])
    const criterionRow = (await client.query<{ verification: { productApplicability: { effect: string } } }>("select verification from call_criterion_assessments where analysis_run_id = $1", [claim.runId])).rows[0]!
    expect(criterionRow.verification.productApplicability).toMatchObject({ effect: "ESTABLISHED" })

    // Critério usado por uma análise não pode ser excluído (só encerrado); a fotografia continua a mesma depois de renomear o produto.
    expect((await org.delete(`${base}/criteria/${created.id}`)).body.error.code).toBe("PRODUCT_CRITERION_IN_USE")
    await org.patch(`${base}/nodes/${product.id}`).send({ name: "Nome novo do produto (prova)" })
    const detail = await assessmentDetail(client, ORG, [operator.id], stored.id)
    expect(detail!.productIdentification!.requests[0]).toMatchObject({ label: "Produto identificado: Tronco de voz (prova)" })
    expect(detail!.criteria[0]!.productApplicability).toMatchObject({ effect: "ESTABLISHED" })
    // Com uma versão agendada para o futuro, encerrar é recusado (mesma regra dos argumentários): aguarde o início ou aprove outra data.
    expect((await org.post(`${base}/criteria/${created.id}/archive`).send({})).body.error.code).toBe("PRODUCT_CRITERION_NOT_STARTED")

    // Auditoria.
    const actions = (await client.query<{ action: string }>("select action from audit_logs where organization_id = $1 and entity_id = any($2::uuid[]) order by created_at", [ORG, [created.id, product.id]])).rows.map((row) => row.action)
    expect(actions).toEqual(expect.arrayContaining(["PRODUCT_NODE_CREATED", "PRODUCT_CRITERION_CREATED", "PRODUCT_CRITERION_APPROVED", "PRODUCT_NODE_UPDATED"]))
  })
})
