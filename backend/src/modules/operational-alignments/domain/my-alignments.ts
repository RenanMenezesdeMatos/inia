import { linksReach } from "../../../shared/domain/scope-links/scope-links.js"
import type { AlignmentLink, AlignmentSubject } from "./operational-alignment.js"
import { audienceReasonOf } from "./operational-alignment.js"

/**
 * ALINHAMENTO NO ACOMPANHAMENTO DO OPERADOR (`MY_OPERATIONAL_ALIGNMENTS_V1`, 18/11/2026, desenho aprovado pelo usuário — memória
 * `alinhamentos-operacionais.md`): um item por alinhamento, sempre a versão que importa para quem lê agora, com o estado decidido no
 * servidor. Puro: a leitura do banco fica em `application/my-alignments.ts`.
 */
export const MY_OPERATIONAL_ALIGNMENTS_VERSION = "MY_OPERATIONAL_ALIGNMENTS_V1" as const
/** Encerrados ficam no Acompanhamento como histórico por 12 meses (o mesmo prazo do `alinhamentos_anteriores` do chat). */
export const MY_ALIGNMENTS_HISTORY_MONTHS = 12
/** Teto de alinhamentos devolvidos (os mais recentes pela publicação da versão mostrada). */
export const MY_ALIGNMENTS_LIMIT = 100

export type MyAlignmentState = "UPCOMING" | "IN_FORCE" | "ENDED"

export type MyAlignmentVersionRow = {
  alignmentId: string
  versionId: string
  version: number
  effectiveFrom: Date
  effectiveUntil: Date
  publishedAt: Date
  operatingUniverse: string
  scopeType: "UNIVERSE" | "GROUPS"
  links: AlignmentLink[]
}

export function myAlignmentStateOf(row: Pick<MyAlignmentVersionRow, "effectiveFrom" | "effectiveUntil">, now: Date): MyAlignmentState {
  if (now.getTime() < row.effectiveFrom.getTime()) return "UPCOMING"
  return now.getTime() < row.effectiveUntil.getTime() ? "IN_FORCE" : "ENDED"
}

/**
 * Versão mostrada de cada alinhamento: a que vale AGORA; sem nenhuma, a próxima a começar (o operador se prepara); sem nenhuma das
 * duas, a última que valeu (histórico). Só versões cujo público alcança a pessoa HOJE — quem entra no Grupo durante a vigência passa
 * a ver; quem sai deixa de ver. Ordem: publicação da versão mostrada, mais recente primeiro (nova versão "sobe" no feed).
 */
export function pickMyAlignmentVersions<T extends MyAlignmentVersionRow>(rows: readonly T[], subject: AlignmentSubject, now: Date): T[] {
  return pickDisplayVersions(rows.filter((row) => audienceReasonOf({ operatingUniverse: row.operatingUniverse as never, scopeType: row.scopeType, links: row.links }, subject) === null), now)
}

/** A mesma escolha, sem filtro de público (o chamador já filtrou — ex.: alinhamentos que alcançam alguém da estrutura de quem lidera). */
export function pickDisplayVersions<T extends MyAlignmentVersionRow>(rows: readonly T[], now: Date): T[] {
  const byAlignment = new Map<string, T[]>()
  for (const row of rows) {
    if (row.effectiveUntil.getTime() <= row.effectiveFrom.getTime()) continue
    byAlignment.set(row.alignmentId, [...(byAlignment.get(row.alignmentId) ?? []), row])
  }
  const picked: T[] = []
  for (const versions of byAlignment.values()) {
    const current = versions.find((row) => myAlignmentStateOf(row, now) === "IN_FORCE")
    const upcoming = versions.filter((row) => myAlignmentStateOf(row, now) === "UPCOMING").sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0]
    const last = versions.filter((row) => myAlignmentStateOf(row, now) === "ENDED").sort((a, b) => b.effectiveUntil.getTime() - a.effectiveUntil.getTime() || b.version - a.version)[0]
    const chosen = current ?? upcoming ?? last
    if (chosen) picked.push(chosen)
  }
  return picked.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || (a.alignmentId < b.alignmentId ? -1 : 1))
}

/**
 * Para quem é, em poucas palavras, do ponto de vista de quem lê: o vínculo que o alcança ("Ouvidoria", "Ouvidoria › Retenção") ou
 * "Todo o B2C". Nunca a lista inteira de Grupos — o operador só precisa saber que é para ele.
 */
export function myAudienceLabelOf(row: Pick<MyAlignmentVersionRow, "operatingUniverse" | "scopeType" | "links">, subject: Pick<AlignmentSubject, "teamId" | "subteamId">): string {
  if (row.scopeType === "UNIVERSE") return `Todo o ${row.operatingUniverse}`
  const reaching = row.links.filter((link) => linksReach([link], subject))
  const link = reaching.find((candidate) => candidate.subteamId) ?? reaching[0] ?? row.links[0]
  if (!link) return row.operatingUniverse
  return link.subteamId ? `${link.teamName ?? "Grupo"} › ${link.subteamName ?? "Subgrupo"}` : (link.teamName ?? "Grupo")
}

/** Para quem, do ponto de vista de quem lidera: os vínculos do público ("Ouvidoria; Retenção › Nível 2") ou "Todo o B2C". */
export function audienceSummaryOf(row: Pick<MyAlignmentVersionRow, "operatingUniverse" | "scopeType" | "links">): string {
  if (row.scopeType === "UNIVERSE") return `Todo o ${row.operatingUniverse}`
  if (row.links.length === 0) return row.operatingUniverse
  return row.links.map((link) => (link.subteamId ? `${link.teamName ?? "Grupo"} › ${link.subteamName ?? "Subgrupo"}` : (link.teamName ?? "Grupo"))).join("; ")
}

/** Data civil (fuso da organização) de um instante — "não vale mais desde" é o dia em que deixou de valer. */
export function civilDateOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
