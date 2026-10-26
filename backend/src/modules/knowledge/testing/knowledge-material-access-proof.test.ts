import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadFeedbackSupportMaterials, persistFeedbackSupportMaterials } from "../../feedbacks/application/feedback-support-materials.js"
import { loadAccessibleKnowledgeMaterial, resolveAccessibleKnowledgeMaterials } from "../application/knowledge-material-access.js"

/**
 * PROVA no banco de TESTE real (Postgres, migrations aplicadas, inclusive 072) da regra de acesso a
 * material da Base de Conhecimento e da relação Feedback ↔ Material:
 *  - material publicado com alcance "Todos os grupos" → qualquer leitor da organização;
 *  - alcance por Grupo → só quem está no Grupo ou lidera alguém ativo do Grupo; Subgrupo idem;
 *  - rascunho, arquivado, excluído (deleted_at), sem alcance cadastrado e de OUTRA organização →
 *    invisíveis, mesmo com id válido; Admin lê o que existe na organização, nunca o de outra;
 *  - a persistência descarta o que o DESTINATÁRIO não pode abrir (cross-org, despublicado,
 *    inexistente, duplicado) e grava só o válido; reabrir depois resolve título real;
 *  - despublicar depois → o histórico continua, o material vira "indisponível" sem título.
 * Tudo dentro de uma transação revertida ao final.
 *
 *   INIA_DB_PROOF=1 npx vitest run knowledge-material-access-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATION = "00000000-0000-4000-8000-000000000010"
const OTHER_ORG = "7b0000ff-0000-4000-8000-000000000000"
const id = (n: number) => `7b000000-0000-4000-8000-${String(n).padStart(12, "0")}`

let pool: pg.Pool
let client: pg.PoolClient
const db = () => client as unknown as Database

async function insertPerson(n: number, name: string, role: string, reportsTo: number | null, teamId: string | null, subteamId: string | null = null, organizationId = ORG) {
  await client.query(`insert into people (id, organization_id, name, role, reports_to_id, team_id, subteam_id, active) values ($1, $2, $3, $4, $5, $6, $7, true)`, [id(n), organizationId, name, role, reportsTo === null ? null : id(reportsTo), teamId, subteamId])
}

async function insertMaterial(n: number, title: string, status: string, scope: { type: "ALL_TEAMS" | "TEAM" | "SUBTEAM" | "NONE"; teamId?: string; subteamId?: string }, organizationId = ORG, deleted = false) {
  await client.query(`insert into knowledge_documents (id, organization_id, title, document_type, source_type, deleted_at) values ($1, $2, $3, 'PROCEDURE', 'TEXT', $4)`, [id(n), organizationId, title, deleted ? new Date() : null])
  await client.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, $3, $4, $5)`, [organizationId, id(n), `Conteúdo publicado de ${title}`, status, `hash-${n}`])
  if (scope.type !== "NONE") {
    await client.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id, subteam_id) values ($1, $2, $3, $4)`, [id(n), scope.type, scope.teamId ?? null, scope.subteamId ?? null])
  }
}

describe.skipIf(!ENABLED)("Acesso a material da Base de Conhecimento e relação Feedback ↔ Material (banco real)", () => {
  const TEAM_A = id(900)
  const TEAM_B = id(901)
  const SUBTEAM_A1 = id(902)
  const MAT_ALL = id(1)
  const MAT_TEAM_A = id(2)
  const MAT_SUBTEAM_A1 = id(3)
  const MAT_TEAM_B = id(4)
  const MAT_DRAFT = id(5)
  const MAT_ARCHIVED = id(6)
  const MAT_DELETED = id(7)
  const MAT_NO_SCOPE = id(8)
  const MAT_OTHER_ORG = id(9)
  const OP_A = id(10) // operador do Grupo A / Subgrupo A1
  const OP_B = id(11) // operador do Grupo B
  const SUP_A = id(12) // supervisor do Grupo A (lidera OP_A)
  const DIRECTOR = id(13) // sem team_id, lidera SUP_A
  const ADMIN = id(14)
  const OUTSIDER = id(15) // pessoa da outra organização
  const LEGACY_ADMIN = id(16) // nível hierárquico legado "ADMIN", conta SEM papel
  const GROUP_A_ADMIN = id(17) // sem Grupo; papel ADMINISTRADOR com escopo GROUP A

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    await client.query("set local statement_timeout = '5s'")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await client.query(`insert into organizations (id, name, slug) values ($1, 'Prova Outra Org KB', 'prova-outra-org-kb')`, [OTHER_ORG])
    await client.query(`insert into teams (id, organization_id, operation_id, name) values ($1, $2, $3, 'Prova Grupo A'), ($4, $2, $3, 'Prova Grupo B')`, [TEAM_A, ORG, OPERATION, TEAM_B])
    await client.query(`insert into subteams (id, organization_id, team_id, name) values ($1, $2, $3, 'Prova Subgrupo A1')`, [SUBTEAM_A1, ORG, TEAM_A])

    await insertPerson(13, "Prova Diretor", "DIRECTOR", null, null)
    await insertPerson(12, "Prova Supervisor A", "SUPERVISOR", 13, TEAM_A)
    await insertPerson(10, "Prova Operador A", "OPERATOR", 12, TEAM_A, SUBTEAM_A1)
    await insertPerson(11, "Prova Operador B", "OPERATOR", null, TEAM_B)
    await insertPerson(14, "Prova Admin", "ADMIN", null, null)
    await insertPerson(15, "Prova Outsider", "OPERATOR", null, null, null, OTHER_ORG)
    await insertPerson(16, "Prova Admin Legado", "ADMIN", null, null)
    await insertPerson(17, "Prova Admin do Grupo A", "ADMIN", null, null)
    // V1.5.8: quem lê além do alcance é a CONTA com `knowledge.manage` (papéis), nunca o nível hierárquico.
    for (const [n, roleCode, scopeType, teamId] of [[14, "ADMINISTRADOR_GERAL", "ORGANIZATION", null], [16, null, null, null], [17, "ADMINISTRADOR", "GROUP", TEAM_A]] as const) {
      await client.query(`insert into user_accounts (id, organization_id, person_id, email, password_hash) values ($1, $2, $1, $3, 'x')`, [id(n), ORG, `prova-kb-${n}@inia.local`])
      if (roleCode) await client.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())`, [ORG, id(n), roleCode, scopeType, teamId])
    }

    await insertMaterial(1, "Prova — Todos os grupos", "PUBLISHED", { type: "ALL_TEAMS" })
    await insertMaterial(2, "Prova — Grupo A", "PUBLISHED", { type: "TEAM", teamId: TEAM_A })
    await insertMaterial(3, "Prova — Subgrupo A1", "PUBLISHED", { type: "SUBTEAM", subteamId: SUBTEAM_A1 })
    await insertMaterial(4, "Prova — Grupo B", "PUBLISHED", { type: "TEAM", teamId: TEAM_B })
    await insertMaterial(5, "Prova — Rascunho", "DRAFT", { type: "ALL_TEAMS" })
    await insertMaterial(6, "Prova — Arquivado", "ARCHIVED", { type: "ALL_TEAMS" })
    await insertMaterial(7, "Prova — Excluído", "PUBLISHED", { type: "ALL_TEAMS" }, ORG, true)
    await insertMaterial(8, "Prova — Sem alcance", "PUBLISHED", { type: "NONE" })
    await insertMaterial(9, "Prova — Outra organização", "PUBLISHED", { type: "ALL_TEAMS" }, OTHER_ORG)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await client.query("rollback")
    client.release()
    await pool.end()
  })

  const ALL_IDS = [MAT_ALL, MAT_TEAM_A, MAT_SUBTEAM_A1, MAT_TEAM_B, MAT_DRAFT, MAT_ARCHIVED, MAT_DELETED, MAT_NO_SCOPE, MAT_OTHER_ORG]
  // O 2º argumento documenta o nível hierárquico da pessoa — de propósito NÃO entra na decisão (V1.5.8).
  const accessibleTo = async (personId: string, level: string) => (void level, [...(await resolveAccessibleKnowledgeMaterials(db(), { organizationId: ORG, viewer: { personId }, materialIds: ALL_IDS })).keys()].sort())

  it("operador do Grupo A / Subgrupo A1: Todos os grupos + Grupo A + Subgrupo A1 — nunca rascunho, arquivado, excluído, sem alcance, Grupo B ou outra organização", async () => {
    expect(await accessibleTo(OP_A, "OPERATOR")).toEqual([MAT_ALL, MAT_TEAM_A, MAT_SUBTEAM_A1].sort())
  })

  it("operador do Grupo B: Todos os grupos + Grupo B", async () => {
    expect(await accessibleTo(OP_B, "OPERATOR")).toEqual([MAT_ALL, MAT_TEAM_B].sort())
  })

  it("supervisor do Grupo A lê o Subgrupo A1 por liderar alguém ativo dele; diretor sem Grupo lê pela cadeia abaixo", async () => {
    expect(await accessibleTo(SUP_A, "SUPERVISOR")).toEqual([MAT_ALL, MAT_TEAM_A, MAT_SUBTEAM_A1].sort())
    expect(await accessibleTo(DIRECTOR, "DIRECTOR")).toEqual([MAT_ALL, MAT_TEAM_A, MAT_SUBTEAM_A1].sort())
  })

  it("Administrador geral (knowledge.manage na organização) lê tudo que existe publicado — inclusive sem alcance —, mas nunca o de outra organização", async () => {
    expect(await accessibleTo(ADMIN, "ADMIN")).toEqual([MAT_ALL, MAT_TEAM_A, MAT_SUBTEAM_A1, MAT_TEAM_B, MAT_NO_SCOPE].sort())
  })

  it("V1.5.8: nível hierárquico legado ADMIN sem papel NÃO lê além do alcance (só 'Todos os grupos')", async () => {
    expect(await accessibleTo(LEGACY_ADMIN, "ADMIN")).toEqual([MAT_ALL])
  })

  it("V1.5.8: Administrador com escopo Grupo A lê as bases do Grupo A e dos Subgrupos dele — nunca Grupo B nem base sem alcance", async () => {
    expect(await accessibleTo(GROUP_A_ADMIN, "ADMIN")).toEqual([MAT_ALL, MAT_TEAM_A, MAT_SUBTEAM_A1].sort())
  })

  it("pessoa de outra organização não enxerga nada desta; leitor que não pertence à organização informada não enxerga nada, mesmo como ADMIN", async () => {
    expect(await accessibleTo(OUTSIDER, "OPERATOR")).toEqual([])
    const mismatched = await resolveAccessibleKnowledgeMaterials(db(), { organizationId: OTHER_ORG, viewer: { personId: OP_A }, materialIds: ALL_IDS })
    expect([...mismatched.keys()]).toEqual([])
    const outsiderAtHome = await resolveAccessibleKnowledgeMaterials(db(), { organizationId: OTHER_ORG, viewer: { personId: OUTSIDER }, materialIds: ALL_IDS })
    expect([...outsiderAtHome.keys()]).toEqual([MAT_OTHER_ORG])
  })

  it("página do material: conteúdo publicado para quem pode; null (→ 404) para quem não pode ou id inválido", async () => {
    const page = await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialId: MAT_TEAM_A })
    expect(page?.title).toBe("Prova — Grupo A")
    expect(page?.content).toContain("Conteúdo publicado")
    expect(await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_B }, materialId: MAT_TEAM_A })).toBeNull()
    expect(await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialId: "nao-e-uuid" })).toBeNull()
    expect(await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: ADMIN }, materialId: MAT_OTHER_ORG })).toBeNull()
  })

  it("vale a versão VIGENTE: rascunho pendente não tira do ar a publicada; arquivar tira, mesmo com publicada anterior; republicar devolve", async () => {
    const versions = async (n: number, title: string, list: readonly (readonly [string, string])[]) => {
      await client.query(`insert into knowledge_documents (id, organization_id, title, document_type, source_type) values ($1, $2, $3, 'PROCEDURE', 'TEXT')`, [id(n), ORG, title])
      for (const [index, [status, content]] of list.entries()) {
        await client.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, $3, $4, $5, $6)`, [ORG, id(n), index + 1, content, status, `hash-${n}-${index + 1}`])
      }
      await client.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1, 'ALL_TEAMS')`, [id(n)])
    }
    const PENDING_DRAFT = id(30)
    const ARCHIVED_OVER_PUBLISHED = id(31)
    const ARCHIVED_THEN_DRAFT = id(32)
    const REPUBLISHED = id(33)
    await versions(30, "Prova — Publicada com rascunho pendente", [["PUBLISHED", "Preço vigente R$ 139,99"], ["DRAFT", "Preço em edição R$ 999,99"]])
    await versions(31, "Prova — Arquivada sobre publicada", [["PUBLISHED", "Versão antiga"], ["ARCHIVED", "Versão arquivada"]])
    await versions(32, "Prova — Arquivada e depois rascunho", [["PUBLISHED", "Versão antiga"], ["ARCHIVED", "Versão arquivada"], ["DRAFT", "Rascunho novo"]])
    await versions(33, "Prova — Republicada", [["ARCHIVED", "Versão arquivada"], ["PUBLISHED", "Versão republicada"]])

    const accessible = await resolveAccessibleKnowledgeMaterials(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialIds: [PENDING_DRAFT, ARCHIVED_OVER_PUBLISHED, ARCHIVED_THEN_DRAFT, REPUBLISHED] })
    expect([...accessible.keys()].sort()).toEqual([PENDING_DRAFT, REPUBLISHED].sort())

    // A página do material mostra o conteúdo PUBLICADO, nunca o rascunho em edição.
    const page = await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialId: PENDING_DRAFT })
    expect(page?.content).toBe("Preço vigente R$ 139,99")
    expect(page?.version).toBe(1)
    expect((await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialId: REPUBLISHED }))?.content).toBe("Versão republicada")
    expect(await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialId: ARCHIVED_OVER_PUBLISHED })).toBeNull()
    expect(await loadAccessibleKnowledgeMaterial(db(), { organizationId: ORG, viewer: { personId: OP_A }, materialId: ARCHIVED_THEN_DRAFT })).toBeNull()
  })

  it("persistência: só o que o destinatário pode abrir entra; reabrir resolve o título real; despublicar depois vira indisponível sem título", async () => {
    await client.query(`insert into supervision_cases (id, organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, $4, 'Prova caso', 'Prova', 'DIAGNOSED', 'P2', 'X', '1', '2')`, [id(20), ORG, OP_A, TEAM_A])
    await client.query(`insert into feedbacks (id, organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation) values ($1, $2, $3, $4, 'APPROVED', 'MONITORING', 'X', 'e', 'o', 'p', 'r')`, [id(21), ORG, id(20), OP_A])
    const reason = "Este material mostra as confirmações do encerramento que faltaram nesta chamada."

    const result = await persistFeedbackSupportMaterials(db(), {
      organizationId: ORG,
      feedbackId: id(21),
      recipient: { personId: OP_A },
      recommendations: [
        { materialId: MAT_OTHER_ORG, title: "x", reason }, // cross-org: id válido, outra organização
        { materialId: MAT_DRAFT, title: "x", reason }, // não publicado
        { materialId: id(99), title: "x", reason }, // inexistente
        { materialId: MAT_TEAM_B, title: "x", reason }, // sem acesso para OP_A
        { materialId: MAT_TEAM_A, title: "título do modelo", reason },
        { materialId: MAT_TEAM_A, title: "título do modelo", reason }, // duplicado
        { materialId: MAT_ALL, title: "x", reason },
      ],
    })
    expect(result.persisted.map((item) => item.materialId)).toEqual([MAT_TEAM_A, MAT_ALL])
    expect(result.persisted[0]?.title).toBe("Prova — Grupo A")
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT",
      "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT",
      "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT",
      "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT",
      "DUPLICATE",
    ])
    const stored = await client.query<{ knowledge_document_id: string; position: number }>(`select knowledge_document_id, position from feedback_support_materials where feedback_id = $1 order by position`, [id(21)])
    expect(stored.rows).toEqual([
      { knowledge_document_id: MAT_TEAM_A, position: 0 },
      { knowledge_document_id: MAT_ALL, position: 1 },
    ])

    // Reabrir como o operador: relação continua, título real resolvido.
    const reopened = await loadFeedbackSupportMaterials(db(), { organizationId: ORG, viewer: { personId: OP_A }, feedbackIds: [id(21)] })
    expect(reopened.get(id(21))).toEqual([
      { materialId: MAT_TEAM_A, available: true, title: "Prova — Grupo A", reason },
      { materialId: MAT_ALL, available: true, title: "Prova — Todos os grupos", reason },
    ])

    // Outro leitor sem alcance ao Grupo A (operador do Grupo B) não ganha acesso pela referência.
    const otherViewer = await loadFeedbackSupportMaterials(db(), { organizationId: ORG, viewer: { personId: OP_B }, feedbackIds: [id(21)] })
    expect(otherViewer.get(id(21))).toEqual([
      { materialId: MAT_TEAM_A, available: false },
      { materialId: MAT_ALL, available: true, title: "Prova — Todos os grupos", reason },
    ])

    // Despublicar depois: histórico intacto, link some, título não vaza.
    await client.query(`update knowledge_versions set status = 'ARCHIVED' where document_id = $1`, [MAT_TEAM_A])
    const afterUnpublish = await loadFeedbackSupportMaterials(db(), { organizationId: ORG, viewer: { personId: OP_A }, feedbackIds: [id(21)] })
    expect(afterUnpublish.get(id(21))?.[0]).toEqual({ materialId: MAT_TEAM_A, available: false })
    expect(JSON.stringify(afterUnpublish.get(id(21))?.[0])).not.toContain("Prova — Grupo A")
    expect((await client.query(`select count(*)::int count from feedback_support_materials where feedback_id = $1`, [id(21)])).rows[0]?.count).toBe(2)
  })
})
