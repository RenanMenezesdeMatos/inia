import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { INTERVENTION_TYPE_SCHEMA_VERSION, type InterventionTypeDefinition } from "../domain/intervention-type.js"
import { applyEvaluation } from "./apply-evaluation.js"
import type { PolicyEvaluation } from "./evaluate-policy.js"

/**
 * POL-05 — "só avisar" é reconferido quando a avaliação é gravada: o tipo vale pela versão publicada mais recente, então uma
 * política publicada antes de o tipo virar avaliação de continuidade não pode mandar o aviso genérico ("fica a seu critério").
 * Continuidade nunca é só um aviso: a mesma regra da publicação (`CONTINUITY_REVIEW_NO_NOTIFY`), agora também na abertura.
 */
const ORG = "00000000-0000-4000-8000-000000000001"

const typeDefinition = (capabilities: InterventionTypeDefinition["capabilities"]): InterventionTypeDefinition => ({
  schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION,
  name: "Tipo do aviso",
  description: "Tipo (teste)",
  capabilities,
  responsibleRole: "SUPERVISOR",
  defaultDueDays: 15,
  approval: { required: false },
  evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION", "INDICATOR_RESULT", "FEEDBACK"] },
  form: [],
  completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false },
  incompatibleWith: [],
  aiDraft: false,
  script: [],
  collaboratorVisible: false,
})

function evaluationWithNotice(capabilities: InterventionTypeDefinition["capabilities"]): PolicyEvaluation {
  return {
    organizationId: ORG,
    policy: { id: "11111111-1111-4111-8111-111111111111", key: "POLITICA", name: "Política" },
    version: { id: "22222222-2222-4222-8222-222222222222", version: 1, definition: { rules: [{ key: "R1", name: "Regra" }] } },
    person: { id: "33333333-3333-4333-8333-333333333333", name: "Operadora" },
    asOf: new Date("2026-11-18T12:00:00Z"),
    timeZone: "America/Sao_Paulo",
    subjectKey: "POLICY:POLITICA",
    indicatorCode: null,
    indicatorName: null,
    rules: [],
    decisions: [{ typeKey: "T", typeName: "Tipo do aviso", status: "NOTIFIED", ruleKey: "R1", alsoRequestedBy: [], existingInterventionId: null, updated: false, note: null }],
    types: new Map([["T", { typeId: "44444444-4444-4444-8444-444444444444", versionId: "55555555-5555-4555-8555-555555555555", key: "T", version: 2, definition: typeDefinition(capabilities) }]]),
    assignments: new Map([["T", { responsible: { personId: "66666666-6666-4666-8666-666666666666", name: "Líder" }, approver: null, approvalRecipientIds: [], dueAt: "2026-12-01", problem: null }]]),
  } as unknown as PolicyEvaluation
}

function fakeDatabase() {
  const statements: string[] = []
  const query = async (sql: string) => {
    statements.push(sql.replace(/\s+/g, " ").trim())
    return { rows: [], rowCount: 0 }
  }
  return { db: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database, statements }
}

describe("só avisar × avaliação de continuidade (POL-05)", () => {
  it("tipo que virou avaliação de continuidade depois da publicação: 422 e nenhum aviso é gravado", async () => {
    const { db, statements } = fakeDatabase()
    const outcome = applyEvaluation(db, { evaluation: evaluationWithNotice(["CONTINUITY_REVIEW"]), origin: "WORKFLOW", idempotencyKey: "wf:teste:no" })
    await expect(outcome).rejects.toMatchObject({ code: "CONTINUITY_REVIEW_NO_NOTIFY", statusCode: 422 })
    // Só a conferência de idempotência rodou: nada foi lido do colaborador nem gravado (aviso, relatório, avaliação).
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain("from intervention_policy_evaluations")
  })

  it("tipo comum continua podendo só avisar (a recusa é da continuidade)", async () => {
    const { db } = fakeDatabase()
    const error = await applyEvaluation(db, { evaluation: evaluationWithNotice(["GUIDANCE"]), origin: "WORKFLOW", idempotencyKey: "wf:teste:no" }).then(() => null, (reason: unknown) => reason as { code?: string })
    expect(error?.code).not.toBe("CONTINUITY_REVIEW_NO_NOTIFY")
  })
})
