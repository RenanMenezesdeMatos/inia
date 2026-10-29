import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createIndicatorFeedback } from "./create-indicator-feedback.js"
import { createMonitoringFeedback } from "./create-monitoring-feedback.js"
import { createOrchestratorFeedback } from "./create-orchestrator-feedback.js"

vi.mock("./publish-feedback.js", () => ({
  PublishFeedback: class {
    async execute() {
      return undefined
    }
  },
}))

/**
 * Caracterização dos três criadores de feedback do caminho Agent/Orquestrador → Output: o que
 * cada um GRAVA (tabela × coluna × valor), independente de como o SQL é escrito. Protege a
 * extração da sequência comum (caso → evidência → feedback → materiais → investigação → publicação).
 */
type Row = { table: string; values: Record<string, unknown> }

function rowOf(sql: string, params: unknown[]): Row | null {
  const match = /insert into\s+(\w+)\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/is.exec(sql)
  if (!match) return null
  const columns = match[2]!.split(",").map((column) => column.trim())
  const values = match[3]!.split(",").map((value) => value.trim())
  const record: Record<string, unknown> = {}
  columns.forEach((column, index) => {
    const value = values[index]!
    const placeholder = /^\$(\d+)$/.exec(value)
    // literal SQL ('P2') e parâmetro ($n) com o mesmo conteúdo são a mesma gravação
    record[column] = placeholder ? params[Number(placeholder[1]) - 1] : value.replace(/^'(.*)'$/, "$1")
  })
  return { table: match[1]!, values: record }
}

function recordingDb(): { db: Database; rows: Row[]; statements: string[] } {
  const rows: Row[] = []
  const statements: string[] = []
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      const row = rowOf(sql, params)
      if (row) rows.push(row)
      else statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "))
      if (sql.includes("as owned")) return { rows: [{ owned: 1 }] }
      if (sql.includes("insert into supervision_cases")) return { rows: [{ id: "case-1" }] }
      if (sql.includes("insert into feedbacks")) return { rows: [{ id: "feedback-1" }] }
      return { rows: [] }
    },
    release: () => {},
  }
  return { db: { connect: async () => client } as unknown as Database, rows, statements }
}

describe("criadores de feedback — linhas gravadas", () => {
  it("monitoria: caso pela flag, evidência TRANSCRIPT da interação, feedback MONITORING aprovado", async () => {
    const { db, rows, statements } = recordingDb()
    const result = await createMonitoringFeedback(db, {
      organizationId: "org-1",
      operatorId: "op-1",
      teamId: "team-1",
      interactionId: "int-1",
      interactionOccurredAt: "2026-09-14T12:00:00.000Z",
      flagName: "rechamada",
      matchedValueText: "true",
      thresholdText: "true",
      structured: {
        title: "Título",
        summary: "Resumo",
        impactedIndicator: "FCR",
        evidenceFound: "Cliente: eu já liguei ontem",
        observedBehavior: "Não confirmou o protocolo",
        relatedProcedure: "Procedimento X",
        recommendation: "Confirme o protocolo",
      },
    })
    expect(result).toEqual({ caseId: "case-1", feedbackId: "feedback-1" })
    expect(statements[0]).toBe("begin")
    expect(statements).toContain("commit")
    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "table": "supervision_cases",
          "values": {
            "indicator_code": "rechamada",
            "indicator_target": "true",
            "indicator_value": "true",
            "operator_id": "op-1",
            "organization_id": "org-1",
            "priority": "P2",
            "status": "DIAGNOSED",
            "summary": "Resumo",
            "team_id": "team-1",
            "title": "Título",
          },
        },
        {
          "table": "evidences",
          "values": {
            "case_id": "case-1",
            "checksum": "ab61749972efd9a5bf35f0be11c8c9918507921c6d1b4fcaf7704a444bf9f1bc",
            "description": "Cliente: eu já liguei ontem",
            "evidence_type": "TRANSCRIPT",
            "occurred_at": "2026-09-14T12:00:00.000Z",
            "organization_id": "org-1",
            "source_id": "int-1",
            "source_type": "interaction",
            "title": "Trecho da transcrição — rechamada",
          },
        },
        {
          "table": "feedbacks",
          "values": {
            "case_id": "case-1",
            "context_snapshot": "{"interactionId":"int-1"}",
            "evidence_found": "Cliente: eu já liguei ontem",
            "feedback_kind": "MONITORING",
            "impacted_indicator": "FCR",
            "observed_behavior": "Não confirmou o protocolo",
            "operator_id": "op-1",
            "organization_id": "org-1",
            "recommendation": "Confirme o protocolo",
            "related_procedure": "Procedimento X",
            "status": "APPROVED",
          },
        },
      ]
    `)
  })

  it("indicador: evidência INDICATOR da medição e snapshot de contexto recebido", async () => {
    const { db, rows } = recordingDb()
    await createIndicatorFeedback(db, {
      organizationId: "org-1",
      operatorId: "op-1",
      teamId: "team-1",
      indicatorCode: "TMA",
      indicatorName: "Tempo médio de atendimento",
      evidenceFound: "TMA 420 s (meta 360 s)",
      impactedIndicator: "TMA",
      observedBehavior: "Acima da meta",
      evidenceSourceType: "indicator_measurement",
      evidenceSourceId: "m-1",
      measuredAt: "2026-09-30T00:00:00.000Z",
      contextSnapshot: { measurementId: "m-1" },
      structured: { title: "TMA", summary: "Resumo TMA", relatedProcedure: "Proc", recommendation: "Rec" },
    } as Parameters<typeof createIndicatorFeedback>[1])
    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "table": "supervision_cases",
          "values": {
            "indicator_code": "TMA",
            "indicator_target": "TMA",
            "indicator_value": "TMA 420 s (meta 360 s)",
            "operator_id": "op-1",
            "organization_id": "org-1",
            "priority": "P2",
            "status": "DIAGNOSED",
            "summary": "Resumo TMA",
            "team_id": "team-1",
            "title": "TMA",
          },
        },
        {
          "table": "evidences",
          "values": {
            "case_id": "case-1",
            "checksum": "ff3ac49e011ccefa3fc56029bb34dc51d5268e0a7c3ece5dbd3e57c93bbfa14f",
            "description": "TMA 420 s (meta 360 s)",
            "evidence_type": "INDICATOR",
            "occurred_at": "2026-09-30T00:00:00.000Z",
            "organization_id": "org-1",
            "source_id": "m-1",
            "source_type": "indicator_measurement",
            "title": "Medição — Tempo médio de atendimento",
          },
        },
        {
          "table": "feedbacks",
          "values": {
            "case_id": "case-1",
            "context_snapshot": "{"measurementId":"m-1"}",
            "evidence_found": "TMA 420 s (meta 360 s)",
            "feedback_kind": "INDICATOR",
            "impacted_indicator": "TMA",
            "observed_behavior": "Acima da meta",
            "operator_id": "op-1",
            "organization_id": "org-1",
            "recommendation": "Rec",
            "related_procedure": "Proc",
            "status": "APPROVED",
          },
        },
      ]
    `)
  })

  it("orquestrador: síntese como recomendação, evidência sem trecho verificado (nunca o texto da IA) e caso identificado pelo Orquestrador", async () => {
    const { db, rows } = recordingDb()
    await createOrchestratorFeedback(db, {
      organizationId: "org-1",
      operatorId: "op-1",
      teamId: "team-1",
      sourceType: "scheduled_subject",
      sourceId: "person-1",
      occurredAt: "2026-09-14T12:00:00.000Z",
      orchestratorName: "Orquestrador X",
      reply: { text: "texto livre", structuredResult: { feedback: { text: "síntese estruturada" } } },
    })
    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "table": "supervision_cases",
          "values": {
            "indicator_code": "Orquestrador X",
            "indicator_target": "Síntese de Orchestrator — sem indicador único",
            "indicator_value": "—",
            "operator_id": "op-1",
            "organization_id": "org-1",
            "priority": "P2",
            "status": "DIAGNOSED",
            "summary": "síntese estruturada",
            "team_id": "team-1",
            "title": "Análise de Orquestrador X",
          },
        },
        {
          "table": "evidences",
          "values": {
            "case_id": "case-1",
            "checksum": "f246bd7925b291be082ffbd7f943d9a682e8fc9cdce8821b5fc593b835cce8f8",
            "description": "Sem trecho literal verificado: a análise é uma síntese de Orquestrador X gerada por IA. Confira a interação de origem antes de tratar como evidência.",
            "evidence_type": "FEEDBACK",
            "occurred_at": "2026-09-14T12:00:00.000Z",
            "organization_id": "org-1",
            "source_id": "person-1",
            "source_type": "scheduled_subject",
            "title": "Síntese — Orquestrador X",
          },
        },
        {
          "table": "feedbacks",
          "values": {
            "case_id": "case-1",
            "context_snapshot": "{"orchestratorName":"Orquestrador X","structuredResult":{"feedback":{"text":"síntese estruturada"}},"evidenceVerified":false}",
            "evidence_found": "Sem trecho literal verificado: a análise é uma síntese de Orquestrador X gerada por IA. Confira a interação de origem antes de tratar como evidência.",
            "feedback_kind": "MONITORING",
            "impacted_indicator": "Orquestrador X",
            "observed_behavior": "Ver recomendação.",
            "operator_id": "op-1",
            "organization_id": "org-1",
            "recommendation": "síntese estruturada",
            "related_procedure": "Síntese de Orquestrador X",
            "status": "APPROVED",
          },
        },
      ]
    `)
  })
})
