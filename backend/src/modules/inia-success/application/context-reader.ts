import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { canAnywhere, canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"
import type { Permission } from "../../access/domain/permissions.js"
import type { OptionsReach } from "../../org-structure/application/scoped-options.js"
import type { SuccessViewer } from "./success-query.js"

/**
 * QUEM VÊ CADA BLOCO da tela "Indicadores de sucesso da INIA". Nenhuma permissão nova: cada bloco usa a permissão da tela de onde os
 * dados vêm, com o mesmo alcance. A entrada no menu aparece para quem tem ao menos uma delas.
 *  - tempo de resposta e motivos de procura: `assistant_conversations.view` (Conversas com a INIA);
 *  - avaliação das respostas no chat e Apoio com Anjo: `human_support.coordinate` (painel do apoio; decisão D7);
 *  - feedbacks e contestações: `feedback_contestations.review` (Contestações de feedback);
 *  - conformidade das respostas: `configuration.manage` com escopo de ORGANIZAÇÃO (registro da Governança);
 *  - alinhamentos operacionais: `operational_alignments.manage` (tela de Alinhamentos operacionais), com o alcance dela.
 */
export const SECTION_PERMISSIONS = {
  responseTime: { permission: "assistant_conversations.view", organizationWide: false },
  routes: { permission: "assistant_conversations.view", organizationWide: false },
  replies: { permission: "human_support.coordinate", organizationWide: false },
  support: { permission: "human_support.coordinate", organizationWide: false },
  feedback: { permission: "feedback_contestations.review", organizationWide: false },
  compliance: { permission: "configuration.manage", organizationWide: true },
  alignments: { permission: "operational_alignments.manage", organizationWide: false },
} as const satisfies Record<string, { permission: Permission; organizationWide: boolean }>
export type SuccessSection = keyof typeof SECTION_PERMISSIONS
export const SUCCESS_SECTIONS = Object.keys(SECTION_PERMISSIONS) as SuccessSection[]

export const canSeeSection = (access: AccessContext, section: SuccessSection) => {
  const rule = SECTION_PERMISSIONS[section]
  return rule.organizationWide ? canOrganizationWide(access, rule.permission) : canAnywhere(access, rule.permission)
}
export const canSeeAnySection = (access: AccessContext) => SUCCESS_SECTIONS.some((section) => canSeeSection(access, section))

export type SuccessContext = { sections: Record<SuccessSection, boolean> }

const visiblePermissions = (access: AccessContext) => [...new Set(SUCCESS_SECTIONS.filter((section) => canSeeSection(access, section)).map((section) => SECTION_PERMISSIONS[section].permission))]

export function successContext(access: AccessContext): SuccessContext {
  return { sections: Object.fromEntries(SUCCESS_SECTIONS.map((section) => [section, canSeeSection(access, section)])) as Record<SuccessSection, boolean> }
}

/** Grupos e Subgrupos de quem está no alcance de ao menos um bloco permitido (nunca lista quem está fora). */
export function successOptionsReach(viewer: SuccessViewer, access: AccessContext): OptionsReach {
  const permissions = visiblePermissions(access)
  if (permissions.length === 0) return { select: "select null::uuid person_id, null::uuid team_id, null::uuid subteam_id where false", params: [] }
  const p = new SqlParams()
  const reachable = permissions.map((permission) => scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission })).join(" union ")
  return { select: `select distinct null::uuid person_id, pe.team_id, pe.subteam_id from people pe where pe.id in (${reachable})`, params: p.values }
}
