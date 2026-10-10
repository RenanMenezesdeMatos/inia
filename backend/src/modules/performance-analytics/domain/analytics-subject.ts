import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  structureAnchorGroupRef,
  structureAnchorPersonId,
  structureAnchorSchema,
  type StructureAnchor,
} from "../../workflows/domain/structure-anchor-schema.js"

/**
 * O "sujeito" de uma análise de Indicadores/Equipe — OU um colaborador (visão EMPLOYEE: indicadores
 * pessoais + PRV oficial) OU uma estrutura (visão STRUCTURE: agregados, histórico, agrupamentos,
 * drill-down). As 7 variantes de estrutura são exatamente as mesmas que o Workflow Engine já usa
 * (`structureAnchorSchema`) — nunca uma segunda taxonomia de "estrutura organizacional".
 */
export const employeeSubjectSchema = z.object({ kind: z.literal("EMPLOYEE"), employeeId: z.string().uuid() })
export const analyticsSubjectSchema = z.union([employeeSubjectSchema, structureAnchorSchema])
export type AnalyticsSubject = z.infer<typeof analyticsSubjectSchema>
export type AnalyticsSubjectKind = AnalyticsSubject["kind"]

export const ANALYTICS_SUBJECT_KINDS: AnalyticsSubjectKind[] = [
  "EMPLOYEE",
  "SUPERVISOR_TEAM",
  "SUBTEAM",
  "TEAM",
  "COORDINATOR_STRUCTURE",
  "MANAGER_STRUCTURE",
  "SENIOR_MANAGER_STRUCTURE",
  "DIRECTOR_STRUCTURE",
]

/** O id "chave" de um sujeito, qualquer que seja a variante — usado na serialização de URL/query
 * (`subjectKind` + `subjectId`) e como chave de cache. */
export function analyticsSubjectId(subject: AnalyticsSubject): string {
  if (subject.kind === "EMPLOYEE") return subject.employeeId
  const personId = structureAnchorPersonId(subject)
  if (personId) return personId
  const group = structureAnchorGroupRef(subject)
  return group?.teamId ?? group?.subteamId ?? ""
}

/** Reconstrói o sujeito a partir do par `kind` + `id` vindo da query string. Lança erro de domínio
 * (400) em vez de deixar um `kind` desconhecido virar um 500 genérico. */
export function buildAnalyticsSubject(kind: string, id: string): AnalyticsSubject {
  const candidate: Record<string, string> = { kind }
  switch (kind as AnalyticsSubjectKind) {
    case "EMPLOYEE":
      candidate.employeeId = id
      break
    case "SUPERVISOR_TEAM":
      candidate.supervisorId = id
      break
    case "SUBTEAM":
      candidate.subteamId = id
      break
    case "TEAM":
      candidate.teamId = id
      break
    case "COORDINATOR_STRUCTURE":
      candidate.coordinatorId = id
      break
    case "MANAGER_STRUCTURE":
      candidate.managerId = id
      break
    case "SENIOR_MANAGER_STRUCTURE":
      candidate.seniorManagerId = id
      break
    case "DIRECTOR_STRUCTURE":
      candidate.directorId = id
      break
    default:
      throw new DomainError("Tipo de estrutura desconhecido.", "INVALID_SUBJECT", 400)
  }
  const parsed = analyticsSubjectSchema.safeParse(candidate)
  if (!parsed.success) throw new DomainError("Sujeito de análise inválido.", "INVALID_SUBJECT", 400)
  return parsed.data
}

export function isStructureSubject(subject: AnalyticsSubject): subject is StructureAnchor {
  return subject.kind !== "EMPLOYEE"
}
