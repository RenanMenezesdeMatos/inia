import { z } from "zod"
import { listParam, type SqlFilter } from "../../../shared/presentation/list-query.js"
import { OPERATING_UNIVERSES } from "../domain/operating-universe.js"

/**
 * Filtro "Universo" das listagens administrativas (`?operatingUniverse=B2B,PENDING`). `PENDING` = ainda sem classificação. Mesmo
 * formato do filtro de Pessoas; só UX de lista — quem pode ver o quê continua decidido pelo escopo de cada rota.
 */
export const universeListParam = listParam(z.enum([...OPERATING_UNIVERSES, "PENDING"]))

export function applyUniverseListFilter(filter: SqlFilter, column: string, values: readonly string[] | undefined) {
  if (!values?.length) return filter
  const universes = values.filter((value) => value !== "PENDING")
  const pending = values.includes("PENDING")
  const clauses = [...(universes.length ? [`${column} = any(${filter.param(universes)}::text[])`] : []), ...(pending ? [`${column} is null`] : [])]
  return filter.add(`(${clauses.join(" or ")})`)
}
