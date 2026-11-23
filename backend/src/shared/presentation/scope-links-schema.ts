import { z } from "zod"

/**
 * Vínculo de alcance recebido da API (multi-grupo, 223): Grupo inteiro (`subteamId` vazio) ou um Subgrupo daquele Grupo. O `teamId` de
 * um Subgrupo é opcional e, se vier, precisa ser o pai real (conferido no servidor por `normalizeScopeLinks`).
 */
export const scopeLinkInputSchema = z
  .object({
    teamId: z.string().uuid().nullish().transform((value) => value ?? null),
    subteamId: z.string().uuid().nullish().transform((value) => value ?? null),
  })
  .strict()
  .refine((link) => link.teamId !== null || link.subteamId !== null, "Informe o Grupo ou o Subgrupo.")

/** Até 300 vínculos por conteúdo (a estrutura de uma operação grande cabe com folga). */
export const scopeLinksInputSchema = z.array(scopeLinkInputSchema).max(300, "Até 300 Grupos/Subgrupos por conteúdo.")
export type ScopeLinkInput = z.infer<typeof scopeLinkInputSchema>

/**
 * Alcance de Agente/Orquestrador/Workflow/Indicador/Produto na API (249/250): `ALL_TEAMS` ou `GROUPS` + `scopeLinks`. O formato antigo
 * (`TEAM`/`SUBTEAM` + `teamId`/`subteamId`) continua aceito e vira um vínculo (`resolveResourceScopeForWrite`).
 */
export const resourceScopeTypeSchema = z.enum(["ALL_TEAMS", "GROUPS", "TEAM", "SUBTEAM"])
export const resourceScopeFields = {
  scopeType: resourceScopeTypeSchema,
  teamId: z.string().uuid().nullish(),
  subteamId: z.string().uuid().nullish(),
  scopeLinks: scopeLinksInputSchema.optional(),
}
