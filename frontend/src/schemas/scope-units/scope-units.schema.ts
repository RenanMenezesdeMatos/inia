import { z } from "zod"

/**
 * Opção de Grupo ou Subgrupo dos seletores de alcance (`GET /api/v1/admin/scope-units`). Busca, universo, permissão de quem edita e
 * elegibilidade (ao menos um operador "Em produção") vêm aplicados pelo servidor antes da paginação; `eligible: false` só aparece nas
 * escolhas já salvas que perderam a elegibilidade (resolvidas por `ids`).
 */
export const scopeUnitKindSchema = z.enum(["TEAM", "SUBTEAM"])
export type ScopeUnitKind = z.infer<typeof scopeUnitKindSchema>

export const scopeUnitOptionSchema = z.object({
  kind: scopeUnitKindSchema,
  id: z.string(),
  name: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  operatingUniverse: z.string().nullable(),
  productionOperators: z.number(),
  eligible: z.boolean(),
  manageable: z.boolean(),
})
export type ScopeUnitOption = z.infer<typeof scopeUnitOptionSchema>

export const scopeUnitPageSchema = z.object({ items: z.array(scopeUnitOptionSchema), nextCursor: z.string().nullable() })
export type ScopeUnitPage = z.infer<typeof scopeUnitPageSchema>

/** Permissão da tela que escolhe ou filtra por Grupo/Subgrupo (o servidor só aceita esta lista fechada). */
export const SCOPE_PICKER_PERMISSIONS = ["configuration.manage", "agents.manage", "workflows.manage", "knowledge.manage", "operational_alignments.manage", "communications.publish_organization", "communications.publish_team", "people.manage", "access.users.view", "access.roles.assign", "intervention_policies.edit", "human_support.manage"] as const
/** `filter`: filtro de lista (todos do escopo, com o Grupo-pai do Subgrupo administrado); `reach`: alcance/alvo de um cadastro. */
export type ScopeUnitPurpose = "reach" | "filter"
export type ScopePickerPermission = (typeof SCOPE_PICKER_PERMISSIONS)[number]
