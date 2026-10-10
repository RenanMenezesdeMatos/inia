import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadFeedbackSupportMaterials, persistFeedbackSupportMaterials, persistSupportMaterialsWithSnapshot } from "./feedback-support-materials.js"

/**
 * Banco falso: a consulta de acesso (`knowledge-material-access.ts`) devolve o que `accessible`
 * disser — o teste controla "existe/publicado/org/alcance" por id e verifica o que a camada de
 * aplicação faz com cada resposta. A regra SQL em si é provada contra o banco real em
 * knowledge-material-access-proof.test.ts.
 */
type Call = { sql: string; params: unknown[] }

const ORG = "00000000-0000-4000-8000-000000000001"
const FEEDBACK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const C = "33333333-3333-4333-8333-333333333333"
const D = "44444444-4444-4444-8444-444444444444"
const OTHER_ORG_MATERIAL = "55555555-5555-4555-8555-555555555555"

function fakeDb(accessible: Record<string, string>, stored: { feedback_id: string; knowledge_document_id: string; reason: string; position: number }[] = []) {
  const calls: Call[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes("from knowledge_documents d")) {
        const requested = params[3] as string[]
        return { rows: requested.filter((id) => accessible[id]).map((id) => ({ id, title: accessible[id], documentType: "PROCEDURE", sourceType: "TEXT" })) }
      }
      if (sql.includes("from feedback_support_materials")) return { rows: stored }
      return { rows: [] }
    },
  } as unknown as Pick<Database, "query">
  return { db, calls }
}

const recipient = { personId: "op-1", role: "OPERATOR" as const }
const reason = "Este checklist lista as quatro confirmações do encerramento que sustentam a queda de TMA."

describe("persistFeedbackSupportMaterials — validação contra o banco e o destinatário", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it("material real, publicado e acessível ao destinatário é persistido com o título do banco", async () => {
    const { db, calls } = fakeDb({ [A]: "Checklist de Encerramento de Chamada" })
    const result = await persistFeedbackSupportMaterials(db, { organizationId: ORG, feedbackId: FEEDBACK, recipient, recommendations: [{ materialId: A, title: "título do modelo", reason }] })
    expect(result.persisted).toEqual([{ materialId: A, title: "Checklist de Encerramento de Chamada", reason }])
    expect(result.warnings).toEqual([])
    const insert = calls.find((call) => call.sql.includes("insert into feedback_support_materials"))
    expect(insert?.params).toEqual([ORG, FEEDBACK, A, reason, 0])
    // A consulta de acesso roda como o DESTINATÁRIO (operador), nunca como quem publicou. V1.5.8: o 3º parâmetro é
    // "administra bases na organização inteira?" (papéis da conta dele) — o operador não tem `knowledge.manage`.
    const access = calls.find((call) => call.sql.includes("from knowledge_documents d"))
    expect(access?.params.slice(0, 3)).toEqual([ORG, "op-1", false])
  })

  it("id inexistente, de outra organização, despublicado, excluído ou fora do alcance → descartado com aviso; o Feedback continua", async () => {
    const { db, calls } = fakeDb({ [A]: "Material A" })
    const result = await persistFeedbackSupportMaterials(db, {
      organizationId: ORG,
      feedbackId: FEEDBACK,
      recipient,
      recommendations: [
        { materialId: OTHER_ORG_MATERIAL, title: "x", reason },
        { materialId: B, title: "x", reason },
        { materialId: A, title: "x", reason },
      ],
    })
    expect(result.persisted.map((item) => item.materialId)).toEqual([A])
    expect(result.warnings).toEqual([
      { materialId: OTHER_ORG_MATERIAL, code: "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT" },
      { materialId: B, code: "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT" },
    ])
    expect(calls.filter((call) => call.sql.includes("insert into feedback_support_materials"))).toHaveLength(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it("id malformado nunca chega ao banco", async () => {
    const { db, calls } = fakeDb({})
    const result = await persistFeedbackSupportMaterials(db, { organizationId: ORG, feedbackId: FEEDBACK, recipient, recommendations: [{ materialId: "mat_123", title: "x", reason }] })
    expect(result.warnings).toEqual([{ materialId: "mat_123", code: "INVALID_ID" }])
    expect(calls).toHaveLength(0)
  })

  it("todos inválidos → Feedback sem materiais, sem erro", async () => {
    const { db } = fakeDb({})
    const result = await persistFeedbackSupportMaterials(db, { organizationId: ORG, feedbackId: FEEDBACK, recipient, recommendations: [{ materialId: B, title: "x", reason }] })
    expect(result.persisted).toEqual([])
  })

  it("duplicata e excedente do limite são descartados; posição segue a ordem de relevância", async () => {
    const { db, calls } = fakeDb({ [A]: "A", [B]: "B", [C]: "C", [D]: "D" })
    const result = await persistFeedbackSupportMaterials(db, {
      organizationId: ORG,
      feedbackId: FEEDBACK,
      recipient,
      recommendations: [
        { materialId: A, title: "A", reason },
        { materialId: A, title: "A", reason },
        { materialId: B, title: "B", reason },
        { materialId: C, title: "C", reason },
        { materialId: D, title: "D", reason },
      ],
    })
    expect(result.persisted.map((item) => item.materialId)).toEqual([A, B, C])
    expect(result.warnings).toEqual([
      { materialId: A, code: "DUPLICATE" },
      { materialId: D, code: "LIMIT_EXCEEDED" },
    ])
    const positions = calls.filter((call) => call.sql.includes("insert into feedback_support_materials")).map((call) => call.params[4])
    expect(positions).toEqual([0, 1, 2])
  })

  it("sem recomendações não consulta nada", async () => {
    const { db, calls } = fakeDb({})
    await persistFeedbackSupportMaterials(db, { organizationId: ORG, feedbackId: FEEDBACK, recipient, recommendations: undefined })
    expect(calls).toHaveLength(0)
  })

  it("snapshot: registra persistidos, rejeitados na execução e na persistência no context_snapshot", async () => {
    const { db, calls } = fakeDb({ [A]: "A" })
    await persistSupportMaterialsWithSnapshot(db, {
      organizationId: ORG,
      feedbackId: FEEDBACK,
      operatorId: "op-1",
      supportMaterials: [{ materialId: A, title: "A", reason }, { materialId: B, title: "B", reason }],
      supportMaterialsRejected: [{ materialId: "mat_x", code: "MATERIAL_NOT_IN_CANDIDATES" }],
    })
    const update = calls.find((call) => call.sql.includes("update feedbacks set context_snapshot"))
    expect(update).toBeDefined()
    const snapshot = JSON.parse(update!.params[1] as string) as { supportMaterials: { persisted: string[]; rejectedAtRun: unknown[]; rejectedAtPersistence: unknown[] } }
    expect(snapshot.supportMaterials.persisted).toEqual([A])
    expect(snapshot.supportMaterials.rejectedAtRun).toEqual([{ materialId: "mat_x", code: "MATERIAL_NOT_IN_CANDIDATES" }])
    expect(snapshot.supportMaterials.rejectedAtPersistence).toEqual([{ materialId: B, code: "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT" }])
  })
})

describe("loadFeedbackSupportMaterials — resolução por leitor a cada leitura", () => {
  it("feedback histórico sem linhas → [] (mapa vazio, sem consulta de acesso)", async () => {
    const { db, calls } = fakeDb({})
    const result = await loadFeedbackSupportMaterials(db, { organizationId: ORG, viewer: recipient, feedbackIds: [FEEDBACK] })
    expect(result.get(FEEDBACK)).toBeUndefined()
    expect(calls.filter((call) => call.sql.includes("from knowledge_documents d"))).toHaveLength(0)
  })

  it("material acessível vem com título real + motivo; despublicado/removido/sem alcance vem como indisponível SEM título nem motivo", async () => {
    const { db } = fakeDb(
      { [A]: "Checklist de Encerramento de Chamada" },
      [
        { feedback_id: FEEDBACK, knowledge_document_id: A, reason, position: 0 },
        { feedback_id: FEEDBACK, knowledge_document_id: B, reason: "motivo do material B", position: 1 },
      ],
    )
    const result = await loadFeedbackSupportMaterials(db, { organizationId: ORG, viewer: recipient, feedbackIds: [FEEDBACK] })
    expect(result.get(FEEDBACK)).toEqual([
      { materialId: A, available: true, title: "Checklist de Encerramento de Chamada", reason },
      { materialId: B, available: false },
    ])
  })

  it("ids de feedback malformados são ignorados", async () => {
    const { db, calls } = fakeDb({})
    await loadFeedbackSupportMaterials(db, { organizationId: ORG, viewer: recipient, feedbackIds: ["nope"] })
    expect(calls).toHaveLength(0)
  })
})
