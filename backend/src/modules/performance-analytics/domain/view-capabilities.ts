import type { PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { AnalyticsSubjectKind } from "./analytics-subject.js"
import { groupingOptionsBelow, isHierarchyRole, type GroupingDimension } from "./hierarchy-levels.js"

/**
 * Política ÚNICA de "o que este papel/sujeito pode ver" nas áreas de Indicadores e Equipe. O
 * backend calcula e devolve junto com o contexto; o frontend só lê flags — nunca decide por conta
 * própria a partir da role (frontend não é autoridade, e assim nenhum `if supervisor/manager/
 * director` precisa existir espalhado por componentes).
 */
export type IndicatorViewCapabilities = {
  /** Visão pessoal (PRV oficial + composição) x visão de estrutura (consolidado + agrupamentos). */
  mode: "EMPLOYEE" | "STRUCTURE"
  /** PRV só existe oficialmente por colaborador — nunca pra Supervisor/estrutura. */
  canSeePrv: boolean
  canSeeStructureSummary: boolean
  canSeeDistribution: boolean
  canSeeMembers: boolean
  canDrillDown: boolean
  groupingOptions: GroupingDimension[]
  /** Rótulo da aba de pessoas: "Equipe" pra quem lidera operadores direto, "Estrutura" acima disso. */
  peopleTabLabel: "Equipe" | "Estrutura" | null
  /** Quais abas o perfil mostra — Operador não tem aba de pessoas; PENDING (Pendências: "tenho
   * algo para decidir") existe para quem pode ser alvo de Revisão Humana/Escalonamento
   * (cargos da cadeia hierárquica) e, para os demais, só enquanto houver pendência real.
   * STRUCTURE ("Minha estrutura": onde estou na hierarquia real) existe para todo papel — é
   * visualização organizacional, nunca performance nem gestão. CALENDAR ("Calendário da equipe":
   * provisionar/corrigir exceções, ver planejado × observado) existe para quem lidera estrutura ou tem `calendar.manage`. */
  tabs: ProfileTab[]
}

export type ProfileTab = "FOLLOW_UP" | "INDICATORS" | "PEOPLE" | "PENDING" | "STRUCTURE" | "CALENDAR"

/**
 * `canManageCalendar` = a CONTA tem `calendar.manage` em algum escopo (atribuição de papel). V1.5.8: o nível hierárquico
 * legado "ADMIN" não abre aba nenhuma — só a regra operacional (lidera estrutura) ou a permissão.
 */
export type CapabilityContext = { hasPendingActions?: boolean; canManageCalendar?: boolean }

export function buildIndicatorViewCapabilities(viewerRole: PlatformRole, subjectKind: AnalyticsSubjectKind, context: CapabilityContext = {}): IndicatorViewCapabilities {
  const viewerLeadsStructure = isHierarchyRole(viewerRole)
  const peopleTabLabel: IndicatorViewCapabilities["peopleTabLabel"] = !viewerLeadsStructure ? null : viewerRole === "SUPERVISOR" ? "Equipe" : "Estrutura"
  const canReceivePendingActions = viewerLeadsStructure || context.hasPendingActions === true
  const canManageCalendar = viewerLeadsStructure || context.canManageCalendar === true
  const tabs: ProfileTab[] = ["FOLLOW_UP", "INDICATORS", ...(peopleTabLabel ? ["PEOPLE" as const] : []), ...(canManageCalendar ? ["CALENDAR" as const] : []), ...(canReceivePendingActions ? ["PENDING" as const] : []), "STRUCTURE"]

  if (subjectKind === "EMPLOYEE") {
    return {
      mode: "EMPLOYEE",
      canSeePrv: true,
      canSeeStructureSummary: false,
      canSeeDistribution: false,
      canSeeMembers: false,
      canDrillDown: false,
      groupingOptions: [],
      peopleTabLabel,
      tabs,
    }
  }

  // Sujeito de estrutura: os agrupamentos vêm do papel de QUEM OLHA quando o sujeito é um
  // Grupo/Subgrupo (não têm cargo próprio), e do cargo âncora quando é uma estrutura de pessoa.
  const anchorRole = structureRole(subjectKind) ?? (viewerLeadsStructure ? viewerRole : null)
  const groupingOptions = anchorRole && isHierarchyRole(anchorRole) ? groupingOptionsBelow(anchorRole) : []
  return {
    mode: "STRUCTURE",
    canSeePrv: false,
    canSeeStructureSummary: true,
    canSeeDistribution: true,
    canSeeMembers: true,
    canDrillDown: true,
    groupingOptions,
    peopleTabLabel,
    tabs,
  }
}

function structureRole(kind: AnalyticsSubjectKind): PlatformRole | null {
  switch (kind) {
    case "SUPERVISOR_TEAM":
      return "SUPERVISOR"
    case "COORDINATOR_STRUCTURE":
      return "COORDINATOR"
    case "MANAGER_STRUCTURE":
      return "MANAGER"
    case "SENIOR_MANAGER_STRUCTURE":
      return "SENIOR_MANAGER"
    case "DIRECTOR_STRUCTURE":
      return "DIRECTOR"
    default:
      return null
  }
}
