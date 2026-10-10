/**
 * PROVA contra o banco de TESTE real (V1.5.4 → V1.5.7): o QA de feedback exige o PAPEL QA_DE_FEEDBACK (modelo geral de acesso,
 * atribuído pelo serviço de acesso com as regras de delegação e auditado); o leitor Postgres escopa pela UNIÃO das
 * atribuições (MY_STRUCTURE por reports_to, GROUP, ORGANIZATION), só itens
 * HOLD_FOR_QA, isola organização, filtra por status/colaborador/seção/período (fuso da organização) e a avaliação via
 * serviço é única (409 com estado atual) sem tocar a disposição. Tudo na transação, desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run feedback-review-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { composeInteractionFeedback } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { decideFeedbackReview, getFeedbackReview, listFeedbackReviews } from "../application/feedback-review-service.js"
import { assignRole, revokeRole } from "../../access/application/access-service.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { runInteractionFeedbackPipeline } from "../application/interaction-feedback-pipeline.js"
import { FEEDBACK_PILOT_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"
import { createPostgresFeedbackReviewReader } from "../infrastructure/postgres-feedback-review-reader.js"
import { createPostgresInteractionFeedbackStore } from "../infrastructure/postgres-interaction-feedback-store.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "x", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
function feedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "s", evidence: [unit("T4", "OPERADOR", "O prazo é de até cinco dias úteis a partir de hoje.")] }
  const statement = { id: "D1", kind: "AGENT_STATEMENT", summary: "s", evidence: [unit("T9", "OPERADOR", "É o faturamento pro rata do ciclo.")] }
  const signal = { id: "S1", kind: "CUSTOMER_SIGNAL", summary: "s", evidence: [unit("T10", "CLIENTE", "Não entendi nada disso.")] }
  const finding = (id: string, kind: string, observations: { id: string; evidence: unknown[] }[]) => ({ id, interactionRef: "I6", kind, summary: "s", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${id}`, ownership: "AGENT" })
  const frame = { interactionRef: "I6", interactionId: "x", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [statement], commitments: [], customerSignals: [signal], procedureAssertions: [], interactionEvents: [], empty: false, findings: [finding("1", "STRENGTH", [action]), finding("2", "FRICTION", [statement, signal])] }
  return composeInteractionFeedback({ subject: { collaboratorRef: "c" }, frame: frame as never, interactionLabel: "14/03/2026", sourceRun: "proof" })
}
const writer = { async write(input: FeedbackWriterInputV1) { return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "Nesta conversa você informou o prazo ao cliente.", whyItMatters: "Isso pode ajudar o cliente a se organizar.", whatYouCanDo: "Você pode manter essa prática em conversas parecidas." })) } } } }

describe.skipIf(!ENABLED)("QA de feedback — prova Postgres (capability + leitor escopado + avaliação única)", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("papel QA_DE_FEEDBACK, escopo pelas atribuições, cargo não concede, isolamento, filtros com fuso e avaliação única", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations limit 1")).rows[0]!
    const team = (await client.query<{ id: string }>("select id from teams where organization_id = $1 limit 1", [org.id])).rows[0]!
    const insertPerson = async (name: string, reportsToId: string | null) => (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [org.id, name, team.id, reportsToId])).rows[0]!.id
    const manager = await insertPerson("Proof Gerente", null)
    const supervisor = await insertPerson("Proof Supervisor", manager)
    const operator = await insertPerson("Proof Operador", supervisor)
    const outsider = await insertPerson("Proof Fora", null)
    const quality = await insertPerson("Proof Qualidade", null)
    const teamQa = await insertPerson("Proof QA do Grupo", null)
    const leaderWithoutGrant = await insertPerson("Proof Líder sem QA", null)
    // Líder acima do gerente, SEM concessão: liderar a estrutura não dá a capability.
    await client.query("update people set reports_to_id = $1 where id = $2", [leaderWithoutGrant, manager])
    const store = createPostgresInteractionFeedbackStore(client)
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store, now: () => new Date("2026-03-14T12:00:00Z"), deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), { organizationId: org.id, collaboratorId: operator, teamId: team.id, interactionId: null, occurredAt: new Date("2026-03-14T02:30:00Z") })
    if (result.status !== "RECORDED") throw new Error(result.status)
    // Papéis explícitos concedidos por um Administrador geral (auditados): supervisor e gerente = QA na própria estrutura;
    // Qualidade = organização; QA do Grupo = Grupo. Cargo (people.role) de ninguém muda.
    const insertAccount = async (personId: string, email: string) => (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id", [org.id, personId, email])).rows[0]!.id
    const tenantAdminPerson = await insertPerson("Proof Admin Geral", null)
    const tenantAdmin = await insertAccount(tenantAdminPerson, "proof-admin-geral@inia.local")
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [org.id, tenantAdmin])
    const accounts = { supervisor: await insertAccount(supervisor, "proof-sup@inia.local"), manager: await insertAccount(manager, "proof-ger@inia.local"), quality: await insertAccount(quality, "proof-qa@inia.local"), teamQa: await insertAccount(teamQa, "proof-qa-grupo@inia.local"), operator: await insertAccount(operator, "proof-op@inia.local"), leader: await insertAccount(leaderWithoutGrant, "proof-lider@inia.local") }
    const access = { repository: createPostgresAccessRepository(client), now: () => new Date("2026-09-24T11:00:00Z") }
    const actor = { organizationId: org.id, accountId: tenantAdmin, personId: tenantAdminPerson }
    const qaGrants: Record<string, string> = {}
    for (const [name, scope] of [["supervisor", { type: "MY_STRUCTURE" }], ["manager", { type: "MY_STRUCTURE" }], ["quality", { type: "ORGANIZATION" }], ["teamQa", { type: "GROUP", teamId: team.id }]] as const) {
      qaGrants[name] = (await assignRole(access, actor, { accountId: accounts[name], roleCode: "QA_DE_FEEDBACK", scope })).id
    }
    await expect(assignRole(access, actor, { accountId: accounts.quality, roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ code: "ACCESS_ROLE_ALREADY_ASSIGNED", statusCode: 409 })
    await expect(assignRole(access, { ...actor, organizationId: "00000000-0000-4000-8000-00000000beef" }, { accountId: accounts.quality, roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })).rejects.toMatchObject({ statusCode: 403 })
    expect((await client.query("select count(*)::int n from audit_logs where entity_type = 'access_role_assignment' and action = 'ACCESS_ROLE_GRANTED' and actor_id = $1", [tenantAdminPerson])).rows[0].n).toBe(4)
    const reader = createPostgresFeedbackReviewReader(client)
    const deps = { reader, store, now: () => new Date("2026-09-24T12:00:00Z") }
    const filters = { status: "PENDING_REVIEW" as const, page: 1, pageSize: 20 }
    const asSupervisor = { organizationId: org.id, personId: supervisor }
    const mine = (await listFeedbackReviews(deps, asSupervisor, filters)).items.filter((item) => item.collaborator.id === operator)
    expect(mine.map((item) => item.section).sort()).toEqual(["OPPORTUNITY", "STRENGTH"])
    // Gerente (MY_STRUCTURE, dois níveis acima), Qualidade (ORGANIZATION, sem liderar ninguém) e QA do Grupo (GROUP) veem.
    for (const personId of [manager, quality, teamQa]) expect((await listFeedbackReviews(deps, { organizationId: org.id, personId }, filters)).items.some((item) => item.collaborator.id === operator)).toBe(true)
    // SEM o papel → 403, mesmo liderando a estrutura (reports_to), sendo o próprio operador, alguém de fora ou outra organização.
    for (const viewer of [{ organizationId: org.id, personId: leaderWithoutGrant }, { organizationId: org.id, personId: operator }, { organizationId: org.id, personId: outsider }, { organizationId: "00000000-0000-4000-8000-00000000beef", personId: supervisor }]) {
      await expect(listFeedbackReviews(deps, viewer, filters)).rejects.toMatchObject({ code: "FEEDBACK_QUALITY_REVIEW_FORBIDDEN", statusCode: 403 })
      await expect(getFeedbackReview(deps, viewer, mine[0]!.reviewId)).rejects.toMatchObject({ code: "FEEDBACK_QUALITY_REVIEW_FORBIDDEN" })
    }
    // Ninguém avalia o próprio feedback: com o papel na organização inteira, o operador continua sem ver os itens dele.
    await assignRole(access, actor, { accountId: accounts.operator, roleCode: "QA_DE_FEEDBACK", scope: { type: "ORGANIZATION" } })
    expect((await listFeedbackReviews(deps, { organizationId: org.id, personId: operator }, filters)).items.filter((item) => item.collaborator.id === operator)).toEqual([])
    await expect(getFeedbackReview(deps, { organizationId: org.id, personId: operator }, mine[0]!.reviewId)).rejects.toMatchObject({ code: "FEEDBACK_REVIEW_NOT_FOUND" })
    // Filtros: seção, colaborador, período (02:30Z de 14/03 = 13/03 no fuso da organização quando for America/*).
    const tz = await resolveOrganizationTimezone(client as never, org.id)
    const localDay = new Date("2026-03-14T02:30:00Z").toLocaleDateString("sv-SE", { timeZone: tz })
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, collaboratorId: operator, section: "OPPORTUNITY" })).total).toBe(1)
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, search: "proof oper" })).total).toBe(2)
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, search: "%" })).total).toBe(0)
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, collaboratorId: operator, from: localDay, to: localDay })).total).toBe(2)
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, collaboratorId: operator, from: "2026-03-20" })).total).toBe(0)
    // Decisão única: aprovar, depois o gerente tenta rejeitar → 409 com o estado atual; nada sobrescrito.
    const strength = mine.find((item) => item.section === "STRENGTH")!.reviewId
    const dispositionBefore = (await client.query("select * from interaction_feedback_delivery_decisions where run_id = $1 order by item_index", [result.runId])).rows
    const approved = await decideFeedbackReview(deps, asSupervisor, strength, { decision: "APPROVED_UNCHANGED" })
    expect(approved).toMatchObject({ status: "APPROVED_UNCHANGED", deliveryState: "READY_FOR_DELIVERY", selection: { disposition: "HOLD_FOR_QA", policyLabel: "Política do piloto" }, decision: { reviewerName: "Proof Supervisor" } })
    const late = await decideFeedbackReview(deps, { organizationId: org.id, personId: manager }, strength, { decision: "REJECTED", reasonCategory: "TONE" }).catch((error: unknown) => error)
    expect(late).toBeInstanceOf(DomainError)
    expect(late).toMatchObject({ code: "FEEDBACK_REVIEW_ALREADY_DECIDED", statusCode: 409, details: { current: { status: "APPROVED_UNCHANGED" } } })
    const row = (await client.query("select review_status, reviewed_by from interaction_feedback_item_reviews where id = $1", [strength])).rows[0]
    expect(row).toEqual({ review_status: "APPROVED_UNCHANGED", reviewed_by: supervisor })
    // A fila padrão (PENDING) já não traz o item decidido; "ALL" traz, com o status.
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, collaboratorId: operator })).items.map((item) => item.reviewId)).not.toContain(strength)
    expect((await listFeedbackReviews(deps, asSupervisor, { ...filters, status: "ALL", collaboratorId: operator })).items.find((item) => item.reviewId === strength)?.status).toBe("APPROVED_UNCHANGED")
    // A avaliação não tocou a disposição estrutural.
    expect((await client.query("select * from interaction_feedback_delivery_decisions where run_id = $1 order by item_index", [result.runId])).rows).toEqual(dispositionBefore)
    // Revogar tira o acesso (nunca apaga a atribuição; auditado).
    await revokeRole(access, actor, { accountId: accounts.quality, assignmentId: qaGrants.quality!, reason: "fim do piloto" })
    await expect(listFeedbackReviews(deps, { organizationId: org.id, personId: quality }, filters)).rejects.toMatchObject({ code: "FEEDBACK_QUALITY_REVIEW_FORBIDDEN" })
    expect((await client.query("select revoked_at is not null revoked, revoked_by_account_id, revocation_reason from access_role_assignments where id = $1", [qaGrants.quality])).rows[0]).toEqual({ revoked: true, revoked_by_account_id: tenantAdmin, revocation_reason: "fim do piloto" })
  })
})
