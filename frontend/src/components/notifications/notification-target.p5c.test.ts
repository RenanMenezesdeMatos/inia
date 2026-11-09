import { describe, expect, it } from "vitest"

import { notificationTargetSchema } from "@/schemas/notifications/notifications.schema"
import { workflowSchema } from "@/schemas/admin/workflow.schema"

import { notificationHref } from "./notification-bell"

/**
 * P5c, decisão D1 (`docs/qa/workflows/propostas.md`): o aviso a quem publicou leva à aba Execuções do workflow. Quem decide o destino
 * continua sendo o backend, e quem perdeu o acesso nem recebe o aviso.
 */

describe("P5c · destino do aviso de execução bloqueada", () => {
  const target = { type: "ADMIN_WORKFLOW_EXECUTIONS", workflowId: "wf-1" }

  it("o contrato aceita o destino novo", () => {
    expect(notificationTargetSchema.safeParse(target).success).toBe(true)
  })

  it("leva à aba Execuções do workflow", () => {
    expect(notificationHref(target as never, "/supervisor")).toBe("/admin/workflows/wf-1?tab=enrollments")
  })

})

describe("P5c · contagem de bloqueadas na lista", () => {
  it("o contrato do workflow traz a contagem", () => {
    expect(Object.keys(workflowSchema.shape)).toContain("blockedEnrollments")
  })
})
