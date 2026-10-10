import { createHash } from "node:crypto"

export const hash = (value: string) => createHash("sha256").update(value).digest("hex")
export type Candidate = {
  id: string; personId: string; subject: string; startedAt: string; transcriptHash: string
  transcriptChars: number; performance: number | null; subteamId: string | null
}
export type Selected = Candidate & { cohort: "REFERENCE_CANDIDATE" | "COMPARISON" | "TARGET" }

/** Melhor quartil do resultado oficial GERAL (só seleciona candidatos; nunca declara chamada ou prática boa). */
function cohortOf(candidates: Candidate[], target: string | null, direction: "LOWER" | "HIGHER") {
  const people = [...new Map(candidates.filter((c) => c.personId !== target && c.performance !== null).map((c) => [c.personId, c.performance!])).entries()]
    .sort((a, b) => (direction === "LOWER" ? a[1] - b[1] : b[1] - a[1]) || a[0].localeCompare(b[0]))
  const reference = new Set(people.slice(0, Math.ceil(people.length / 4)).map(([id]) => id))
  return (row: Candidate): Selected["cohort"] => row.personId === target ? "TARGET" : reference.has(row.personId) ? "REFERENCE_CANDIDATE" : "COMPARISON"
}

/** Performance only selects candidates. It never declares a call or a practice good. */
export function selectSample(candidates: Candidate[], limit: number, target: string | null, direction: "LOWER" | "HIGHER") {
  const cohort = cohortOf(candidates, target, direction)
  const groups: Record<Selected["cohort"], Candidate[]> = { TARGET: [], REFERENCE_CANDIDATE: [], COMPARISON: [] }
  for (const row of candidates) groups[cohort(row)].push(row)
  // Round-robin by person. Stable hash avoids always picking earliest/longest calls.
  const balanced = (rows: Candidate[]) => {
    const byPerson = new Map<string, Candidate[]>()
    for (const row of [...rows].sort((a, b) => hash(a.id).localeCompare(hash(b.id)))) byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row])
    const result: Candidate[] = []
    for (let index = 0; result.length < rows.length; index++) for (const list of byPerson.values()) if (list[index]) result.push(list[index]!)
    return result
  }
  const queues = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, balanced(rows)])) as typeof groups
  const picked: Selected[] = []
  const take = (cohort: Selected["cohort"], n: number) => {
    for (const row of queues[cohort].splice(0, Math.max(0, n))) picked.push({ ...row, cohort })
  }
  take("TARGET", Math.min(4, Math.floor(limit / 10)))
  take("REFERENCE_CANDIDATE", Math.ceil((limit - picked.length) / 2))
  take("COMPARISON", limit - picked.length)
  for (const cohort of ["REFERENCE_CANDIDATE", "TARGET", "COMPARISON"] as const) take(cohort, limit - picked.length)
  // Interleave strata: a budget stop must not leave only target/reference calls.
  return picked.sort((a, b) => hash(`order:${a.id}`).localeCompare(hash(`order:${b.id}`)))
}

/**
 * Amostra POR PESSOA: até `perPerson` chamadas de cada pessoa (ordem estável pelo hash, nunca as primeiras/mais longas), em rodadas
 * — 1ª chamada de todo mundo, depois a 2ª… —, para que o `limit` ou uma parada pelo orçamento deixem todos com histórico parecido.
 * Serve para alimentar o histórico de cada pessoa (reincidência na monitoria); os grupos (alvo/referência/comparação) continuam
 * marcados só para o relatório.
 */
export function selectPerPerson(candidates: Candidate[], perPerson: number, limit: number, target: string | null, direction: "LOWER" | "HIGHER") {
  const cohort = cohortOf(candidates, target, direction)
  const byPerson = new Map<string, Candidate[]>()
  for (const row of [...candidates].sort((a, b) => hash(a.id).localeCompare(hash(b.id)))) byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row])
  const people = [...byPerson.keys()].sort((a, b) => hash(`person:${a}`).localeCompare(hash(`person:${b}`)))
  const picked: Selected[] = []
  for (let round = 0; round < perPerson && picked.length < limit; round++) {
    for (const person of people) {
      const row = byPerson.get(person)![round]
      if (row && picked.length < limit) picked.push({ ...row, cohort: cohort(row) })
    }
  }
  return picked
}

export function periodWindow(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Período deve ser YYYY-MM.")
  const [y, m] = period.split("-").map(Number)
  return { from: `${period}-01`, until: `${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, "0")}-01` }
}

export function positiveNumber(value: string, label: string, integer = false) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) throw new Error(`${label} deve ser positivo${integer ? " e inteiro" : ""}.`)
  return n
}
