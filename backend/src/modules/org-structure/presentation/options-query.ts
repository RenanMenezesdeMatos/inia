import { unitFilterShape } from "../../../shared/presentation/list-query.js"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { listScopedOptions, type OptionsCursor, type OptionsReach, type ScopedOption, type ScopedOptionKind, type ScopedOptionsRequest } from "../application/scoped-options.js"

/** Contrato comum das opções em lotes (seletores e filtros pesquisáveis): busca, pais da hierarquia, cursor e resolução por `ids`. */
const uuid = z.string().uuid()
export const MAX_OPTION_IDS = 300
export const OPTIONS_PAGE_SIZE = 30

export const idListParam = z.string().optional().transform((raw, context) => {
  if (raw === undefined) return undefined
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean)
  if (values.length > MAX_OPTION_IDS || values.some((value) => !uuid.safeParse(value).success)) { context.addIssue({ code: "custom", message: "Lista de ids inválida." }); return z.NEVER }
  return values
})

/** Telas que só filtram por Grupo e Subgrupo: a rota delas nunca lista pessoas (run-13 CFA-02). */
export const UNIT_OPTION_KINDS = ["TEAM", "SUBTEAM"] as const satisfies readonly ScopedOptionKind[]
export const UNIT_AND_PERSON_OPTION_KINDS = [...UNIT_OPTION_KINDS, "PERSON"] as const satisfies readonly ScopedOptionKind[]

/** Posição, busca e resolução por `ids`: o que toda rota de opções em lotes aceita. */
export const optionsPageSchema = z.object({
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(OPTIONS_PAGE_SIZE),
  ids: idListParam,
})
const scopedOptionsQuerySchema = (kinds: readonly ScopedOptionKind[]) => optionsPageSchema.extend({ kind: z.enum(kinds), ...unitFilterShape })

export const encodeOptionsCursor = (cursor: OptionsCursor) => Buffer.from(JSON.stringify([cursor.name, cursor.id])).toString("base64url")

export function decodeOptionsCursor(raw: string | undefined): OptionsCursor | undefined {
  if (!raw) return undefined
  try {
    const [name, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as [unknown, unknown]
    if (typeof name === "string" && typeof id === "string" && uuid.safeParse(id).success) return { name, id }
  } catch { /* cai no erro abaixo */ }
  throw new DomainError("Posição da lista inválida — recarregue as opções.", "SCOPE_UNITS_CURSOR_INVALID", 400)
}

/** Resposta de uma rota de opções: valida a consulta (só os tipos que a tela oferece), carrega o lote e devolve o cursor da próxima posição. */
export async function respondOptions(rawQuery: unknown, kinds: readonly ScopedOptionKind[], load: (request: ScopedOptionsRequest) => Promise<{ items: ScopedOption[]; nextCursor: OptionsCursor | null }>) {
  const query = scopedOptionsQuerySchema(kinds).parse(rawQuery)
  const page = await load({ ...query, cursor: decodeOptionsCursor(query.cursor) })
  return { items: page.items, nextCursor: page.nextCursor ? encodeOptionsCursor(page.nextCursor) : null }
}

/** O mesmo, com o alcance da tela (quem o leitor vê) aplicado no SQL. */
export function respondScopedOptions(
  db: Pick<Database, "query">,
  organizationId: string,
  reachOf: (request: ScopedOptionsRequest) => OptionsReach | Promise<OptionsReach>,
  rawQuery: unknown,
  options: { kinds: readonly ScopedOptionKind[]; matricula?: boolean },
) {
  return respondOptions(rawQuery, options.kinds, async (request) => listScopedOptions(db, organizationId, await reachOf(request), request, { matricula: options.matricula }))
}
