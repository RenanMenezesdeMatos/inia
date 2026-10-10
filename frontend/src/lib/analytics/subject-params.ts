import type { AnalyticsSubject, AnalyticsSubjectKind, BreadcrumbEntry } from "@/schemas/analytics/analytics.schema"

/** Referência serializável de um sujeito (o par que vai na URL e na query da API). */
export type SubjectRef = { kind: AnalyticsSubjectKind; id: string }

export function subjectToRef(subject: AnalyticsSubject): SubjectRef {
  switch (subject.kind) {
    case "EMPLOYEE":
      return { kind: subject.kind, id: subject.employeeId }
    case "SUPERVISOR_TEAM":
      return { kind: subject.kind, id: subject.supervisorId }
    case "SUBTEAM":
      return { kind: subject.kind, id: subject.subteamId }
    case "TEAM":
      return { kind: subject.kind, id: subject.teamId }
    case "COORDINATOR_STRUCTURE":
      return { kind: subject.kind, id: subject.coordinatorId }
    case "MANAGER_STRUCTURE":
      return { kind: subject.kind, id: subject.managerId }
    case "SENIOR_MANAGER_STRUCTURE":
      return { kind: subject.kind, id: subject.seniorManagerId }
    case "DIRECTOR_STRUCTURE":
      return { kind: subject.kind, id: subject.directorId }
  }
}

export function breadcrumbToRef(entry: BreadcrumbEntry): SubjectRef {
  return { kind: entry.kind, id: entry.id }
}

export function subjectQuery(ref: SubjectRef | null): { subjectKind?: string; subjectId?: string } {
  return ref ? { subjectKind: ref.kind, subjectId: ref.id } : {}
}
