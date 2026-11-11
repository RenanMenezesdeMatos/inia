import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { canAnywhere, canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"
import type { Permission } from "../../access/domain/permissions.js"
import type { Queryable, SuccessViewer } from "./success-query.js"

/**
 * QUEM VÊ CADA BLOCO da tela "Indicadores de sucesso da INIA". Nenhuma permissão nova: cada bloco usa a permissão da tela de onde os
 * dados vêm, com o mesmo alcance. A entrada no menu aparece para quem tem ao menos uma delas.
 *  - tempo de resposta e motivos de procura: `assistant_conversations.view` (Conversas com a INIA);
 *  - avaliação das respostas no chat e Apoio com Anjo: `human_support.coordinate` (painel do apoio; decisão D7);
 *  - feedbacks e contestações: `feedback_contestations.review` (Contestações de feedback);
 *  - conformidade das respostas: `configuration.manage` com escopo de ORGANIZAÇÃO (registro da Governança).
 */
export const SECTION_PERMISSIONS = {
  responseTime: { permission: "assistant_conversations.view", organizationWide: false },
  routes: { permission: "assistant_conversations.view", organizationWide: false },
  replies: { permission: "human_support.coordinate", organizationWide: false },
  support: { permission: "human_support.coordinate", organizationWide: false },
  feedback: { permission: "feedback_contestations.review", organizationWide: false },
  compliance: { permission: "configuration.manage", organizationWide: true },
} as const satisfies Record<string, { permission: Permission; organizationWide: boolean }>
export type SuccessSection = keyof typeof SECTION_PERMISSIONS
export const SUCCESS_SECTIONS = Object.keys(SECTION_PERMISSIONS) as SuccessSection[]

export const canSeeSection = (access: AccessContext, section: SuccessSection) => {
  const rule = SECTION_PERMISSIONS[section]
  return rule.organizationWide ? canOrganizationWide(access, rule.permission) : canAnywhere(access, rule.permission)
}
export const canSeeAnySection = (access: AccessContext) => SUCCESS_SECTIONS.some((section) => canSeeSection(access, section))

export type SuccessContext = {
  sections: Record<SuccessSection, boolean>
  /** Grupos e Subgrupos de quem está no alcance de ao menos um bloco permitido (nunca lista quem está fora). */
  teams: { id: string; name: string }[]
  subteams: { id: string; name: string; teamId: string | null }[]
}

export async function successContext(db: Queryable, viewer: SuccessViewer, access: AccessContext): Promise<SuccessContext> {
  const sections = Object.fromEntries(SUCCESS_SECTIONS.map((section) => [section, canSeeSection(access, section)])) as Record<SuccessSection, boolean>
  const permissions = [...new Set(SUCCESS_SECTIONS.filter((section) => sections[section]).map((section) => SECTION_PERMISSIONS[section].permission))]
  if (permissions.length === 0) return { sections, teams: [], subteams: [] }
  const p = new SqlParams()
  const reachable = permissions.map((permission) => scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission })).join(" union ")
  const rows = (
    await db.query<{ team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null; subteam_team_id: string | null }>(
      `select distinct pe.team_id, t.name team_name, pe.subteam_id, st.name subteam_name, st.team_id subteam_team_id
         from people pe
         left join teams t on t.id = pe.team_id
         left join subteams st on st.id = pe.subteam_id
        where pe.id in (${reachable})`,
      p.values,
    )
  ).rows
  const teams = new Map<string, string>()
  const subteams = new Map<string, { id: string; name: string; teamId: string | null }>()
  for (const row of rows) {
    if (row.team_id && row.team_name) teams.set(row.team_id, row.team_name)
    if (row.subteam_id && row.subteam_name) subteams.set(row.subteam_id, { id: row.subteam_id, name: row.subteam_name, teamId: row.subteam_team_id ?? row.team_id })
  }
  return {
    sections,
    teams: [...teams].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    subteams: [...subteams.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  }
}
