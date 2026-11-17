import { personIdsWithPermissionCovering } from "../../access/application/permission-holders.js"
import { ALL_UNIVERSES_PERMISSION, isUniverseEnforced } from "../../operating-universe/application/universe-access.js"
import { isOperatingUniverse, type OperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { anjoServesOperatorUniverse } from "../domain/universe.js"
import type { Queryable } from "./locks.js"

/**
 * FILTRO DE UNIVERSO DOS ANJOS (regra em `domain/universe.ts`). Uma leitura de "a organização ativou?" por gate; com a exigência, o
 * universo das pessoas e quem tem `operating_universes.all` cobrindo cada lugar ficam em cache enquanto o gate vive (a distribuição usa
 * um gate por rodada para a fila inteira). Desligada, devolve a lista como veio — comportamento anterior intacto.
 */
type Place = { teamId: string | null; subteamId: string | null }

export type AnjoUniverseGate = {
  enforced: boolean
  /** Dos `anjoIds`, os que podem atender o operador neste lugar (ordem preservada). */
  allowed: (place: Place, operatorPersonId: string, anjoIds: readonly string[]) => Promise<string[]>
}

export async function loadAnjoUniverseGate(db: Queryable, organizationId: string): Promise<AnjoUniverseGate> {
  if (!(await isUniverseEnforced(db, organizationId))) return { enforced: false, allowed: async (_place, _operator, anjoIds) => [...anjoIds] }
  const universes = new Map<string, OperatingUniverse | null>()
  const allHolders = new Map<string, Promise<Set<string>>>()
  const loadUniverses = async (personIds: readonly string[]) => {
    const missing = [...new Set(personIds)].filter((id) => !universes.has(id))
    if (missing.length === 0) return
    const rows = (await db.query<{ id: string; operating_universe: string | null }>(`select id, operating_universe from people where organization_id = $1 and id = any($2::uuid[])`, [organizationId, missing])).rows
    for (const id of missing) universes.set(id, null)
    for (const row of rows) universes.set(row.id, isOperatingUniverse(row.operating_universe) ? row.operating_universe : null)
  }
  const holdersFor = (place: Place) => {
    const key = `${place.teamId ?? ""}:${place.subteamId ?? ""}`
    let holders = allHolders.get(key)
    if (!holders) {
      holders = personIdsWithPermissionCovering(db, organizationId, ALL_UNIVERSES_PERMISSION, place).then((ids) => new Set(ids))
      allHolders.set(key, holders)
    }
    return holders
  }
  return {
    enforced: true,
    allowed: async (place, operatorPersonId, anjoIds) => {
      if (anjoIds.length === 0) return []
      await loadUniverses([operatorPersonId, ...anjoIds])
      const holders = await holdersFor(place)
      const operatorUniverse = universes.get(operatorPersonId) ?? null
      return anjoIds.filter((anjoId) => anjoServesOperatorUniverse({ enforced: true, operatorUniverse, anjoUniverse: universes.get(anjoId) ?? null, anjoAllUniversesOnPlace: holders.has(anjoId) }))
    },
  }
}
