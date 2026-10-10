import { describe, expect, it } from "vitest"

import { NODE_TYPE_LABELS, OUTPUT_SURFACE_LABELS, OUTPUT_TARGET_LABELS, VISIBLE_OUTPUT_SURFACES, outputSurfaceSchema, outputTargetSchema } from "@/schemas/admin/workflow-graph.schema"
import { workflowTriggerSchema } from "@/schemas/admin/workflow.schema"
import { notificationKindSchema } from "@/schemas/notifications/notifications.schema"
import { platformRoleSchema } from "@/schemas/auth/auth.schema"
import { WIKI_NODES, WIKI_NODE_ORDER, WIKI_NOTIFICATIONS, WIKI_OUTPUT_TARGETS, WIKI_ROLES, WIKI_ROLE_ORDER, WIKI_SURFACES, WIKI_TRIGGERS } from "./wiki-reference"

/**
 * Consistência das fontes de dados da Wiki (regra 136): a Wiki não documenta node, surface, tipo
 * de aviso ou papel inexistente — e não esquece nenhum que exista. O typecheck já garante o
 * `Record` completo; estes testes cobrem ordem de exibição, rótulos iguais aos das telas e
 * conteúdo mínimo de cada verbete.
 */
describe("Wiki — nodes documentados = nodes reais do Builder", () => {
  it("documenta exatamente os tipos de node do schema, com o mesmo rótulo do editor", () => {
    const real = Object.keys(NODE_TYPE_LABELS).sort()
    expect(Object.keys(WIKI_NODES).sort()).toEqual(real)
    expect([...WIKI_NODE_ORDER].sort()).toEqual(real)
    for (const type of real as (keyof typeof NODE_TYPE_LABELS)[]) {
      expect(WIKI_NODES[type].label).toBe(NODE_TYPE_LABELS[type])
    }
  })

  it("cada node tem finalidade, quando usar, entrada, saída, configuração e exemplo", () => {
    for (const node of Object.values(WIKI_NODES)) {
      for (const field of ["summary", "purpose", "whenToUse", "input", "output", "example"] as const) {
        expect(node[field].length, `${node.type}.${field}`).toBeGreaterThan(5)
      }
      expect(node.settings.length, `${node.type}.settings`).toBeGreaterThan(0)
      expect(node.acceptedIn.length, `${node.type}.acceptedIn`).toBeGreaterThan(0)
    }
  })

  it("só os três nodes de coleção são exclusivos do modo Consolidado", () => {
    const consolidatedOnly = Object.values(WIKI_NODES).filter((node) => node.consolidatedOnly).map((node) => node.type).sort()
    expect(consolidatedOnly).toEqual(["apply_individually", "consolidate_results", "select_employees"])
  })

  it("regras de contexto espelham o validador: individual-only e a exceção do Orquestrador pós-JOIN", () => {
    expect(WIKI_NODES.human_review.acceptedIn).toEqual(["EMPLOYEE"])
    expect(WIKI_NODES.action.acceptedIn).toEqual(["EMPLOYEE"])
    expect(WIKI_NODES.orchestrator.acceptedIn).toEqual(["EMPLOYEE", "CONSOLIDATED_RESULT"])
    expect(WIKI_NODES.apply_individually.acceptedIn).toEqual(["EMPLOYEE_COLLECTION"])
    expect(WIKI_NODES.consolidate_results.acceptedIn).toEqual(["EMPLOYEE"])
    expect(WIKI_NODES.select_employees.acceptedIn).not.toContain("EMPLOYEE")
  })
})

describe("Wiki — surfaces, destinatários, triggers, notificações e papéis", () => {
  it("documenta todas as surfaces do enum, com o rótulo das telas, e marca só as com leitor real", () => {
    expect(Object.keys(WIKI_SURFACES).sort()).toEqual([...outputSurfaceSchema.options].sort())
    for (const surface of outputSurfaceSchema.options) expect(WIKI_SURFACES[surface].label).toBe(OUTPUT_SURFACE_LABELS[surface])
    const withReader = outputSurfaceSchema.options.filter((surface) => WIKI_SURFACES[surface].status === "reader").sort()
    // Workflow Outputs V1: Chat e Avatar ganharam consumidor real (conversa nova da INIA; recado de voz com aceite).
    expect(withReader).toEqual(["AVATAR", "CHAT", "FOLLOW_UP", "NOTIFICATION"])
    // CUSTOM_SURFACE não aparece no Builder — e é a única marcada como oculta.
    const hidden = outputSurfaceSchema.options.filter((surface) => WIKI_SURFACES[surface].status === "hidden")
    expect(hidden).toEqual(outputSurfaceSchema.options.filter((surface) => !VISIBLE_OUTPUT_SURFACES.includes(surface)))
  })

  it("documenta todos os destinatários de Output; 'O próprio operador' só em contexto individual", () => {
    const real = outputTargetSchema.options.map((option) => option.shape.type.value).sort()
    expect(Object.keys(WIKI_OUTPUT_TARGETS).sort()).toEqual(real)
    for (const type of real) expect(WIKI_OUTPUT_TARGETS[type].label).toBe(OUTPUT_TARGET_LABELS[type])
    expect(WIKI_OUTPUT_TARGETS.CURRENT_OPERATOR.contexts).toEqual(["EMPLOYEE"])
  })

  it("documenta as quatro famílias de trigger — e só elas", () => {
    const real = workflowTriggerSchema.options.map((option) => option.shape.kind.value).sort()
    expect(Object.keys(WIKI_TRIGGERS).sort()).toEqual(real)
    expect(real).toEqual(["channel_flag", "indicator", "manual", "schedule"])
  })

  it("documenta todos os tipos de aviso do sino", () => {
    expect(Object.keys(WIKI_NOTIFICATIONS).sort()).toEqual([...notificationKindSchema.options].sort())
  })

  it("documenta os sete papéis, na ordem da cadeia + Administrador", () => {
    expect([...WIKI_ROLE_ORDER].sort()).toEqual([...platformRoleSchema.options].sort())
    expect(Object.keys(WIKI_ROLES).sort()).toEqual([...platformRoleSchema.options].sort())
    expect(WIKI_ROLES.SUPERVISOR.peopleTab).toBe("Equipe")
    expect(WIKI_ROLES.MANAGER.peopleTab).toBe("Estrutura")
    expect(WIKI_ROLES.OPERATOR.peopleTab).toBeNull()
  })
})
