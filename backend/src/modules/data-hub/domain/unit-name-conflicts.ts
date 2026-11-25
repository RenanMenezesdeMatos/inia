/**
 * NOME REPETIDO de Grupo/Subgrupo numa carga. A identidade é o código externo, mas o banco também não aceita dois Grupos com o mesmo
 * nome na mesma Operação, nem dois Subgrupos com o mesmo nome no mesmo Grupo. Aqui a colisão é achada ANTES de gravar: só a linha vai
 * para a quarentena (antes, a primeira colisão derrubava a carga inteira). Nunca junta por nome e nunca renomeia o que já existe.
 *
 * Quem fica com o nome: quem já o tem na INIA; entre linhas novas da mesma carga, a primeira (a regra de `dedupeByKey`). Linha que troca
 * de nome libera o antigo para outra da mesma carga — por isso `ready` sai na ordem em que pode ser gravada. Troca em círculo (A vira B
 * e B vira A) não tem ordem possível e é recusada.
 */
export type UnitName = { externalCode: string; parentId: string; name: string }
export type ExistingUnitName = { externalCode: string | null; parentId: string; name: string }
export type UnitNameConflict<T> =
  | { row: T; kind: "EXISTING"; ownerCode: string | null }
  | { row: T; kind: "SAME_LOAD"; ownerCode: string }
  | { row: T; kind: "SWAP"; ownerCode: string }

const keyOf = (unit: { parentId: string; name: string }) => `${unit.parentId}\u0000${unit.name}`

export function resolveUnitNames<T extends UnitName>(rows: readonly T[], existing: readonly ExistingUnitName[]): { ready: T[]; conflicts: UnitNameConflict<T>[] } {
  const ownerByKey = new Map(existing.map((unit) => [keyOf(unit), unit]))
  const conflicts: UnitNameConflict<T>[] = []

  // Um dono por nome dentro da carga.
  const claimByKey = new Map<string, T>()
  for (const row of rows) {
    const current = claimByKey.get(keyOf(row))
    if (!current || ownerByKey.get(keyOf(row))?.externalCode === row.externalCode) claimByKey.set(keyOf(row), row)
  }
  const claims = new Map<string, T>()
  for (const row of rows) {
    const winner = claimByKey.get(keyOf(row))!
    if (winner === row) claims.set(row.externalCode, row)
    else if (ownerByKey.get(keyOf(row))?.externalCode === winner.externalCode) conflicts.push({ row, kind: "EXISTING", ownerCode: winner.externalCode })
    else conflicts.push({ row, kind: "SAME_LOAD", ownerCode: winner.externalCode })
  }

  // O nome está com outro? Só entra depois que esse outro, nesta mesma carga, largar o nome.
  const ready: T[] = []
  const outcome = new Map<string, "READY" | "REFUSED">()
  for (const start of claims.values()) {
    // Cadeia de dependências seguida em laço (uma carga longa não estoura a pilha): cada linha espera no máximo uma.
    const chain: T[] = []
    const inChain = new Set<string>()
    let row: T | undefined = start
    let blocked: { kind: "EXISTING" | "SWAP" } | null = null
    while (row && !outcome.has(row.externalCode)) {
      if (inChain.has(row.externalCode)) {
        blocked = { kind: "SWAP" }
        break
      }
      chain.push(row)
      inChain.add(row.externalCode)
      const owner = ownerByKey.get(keyOf(row))
      if (!owner || owner.externalCode === row.externalCode) {
        row = undefined
      } else {
        const ownerClaim: T | undefined = owner.externalCode === null ? undefined : claims.get(owner.externalCode)
        if (!ownerClaim) {
          blocked = { kind: "EXISTING" }
          break
        }
        row = ownerClaim
      }
    }
    if (!blocked && row && outcome.get(row.externalCode) === "REFUSED") blocked = { kind: "EXISTING" }
    for (const link of chain.reverse()) {
      outcome.set(link.externalCode, blocked ? "REFUSED" : "READY")
      if (!blocked) ready.push(link)
      else conflicts.push({ row: link, kind: blocked.kind, ownerCode: ownerByKey.get(keyOf(link))!.externalCode } as UnitNameConflict<T>)
    }
  }
  return { ready, conflicts }
}
