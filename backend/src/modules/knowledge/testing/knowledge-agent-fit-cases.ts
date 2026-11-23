/**
 * CADERNO ÚNICO da regra "a base cabe no agente" (`knowledge/application/knowledge-agent-fit.ts`; run-8, ARQ-03). Os mesmos casos rodam
 * contra a SQL do servidor (prova de banco `knowledge-agent-fit-proof.test.ts`) e contra a cópia da tela (`picker-rules.ts`,
 * `knowledge-agent-fit.parity.test.ts`): mudar a regra de um lado e esquecer o outro derruba um dos dois.
 *
 * Grupos e Subgrupos são símbolos: A tem os Subgrupos a1 e a2; B tem b1. Cada prova troca os símbolos por ids reais.
 */
export type FitTeam = "A" | "B"
export type FitSubteam = "a1" | "a2" | "b1"
export const FIT_SUBTEAM_PARENT: Record<FitSubteam, FitTeam> = { a1: "A", a2: "A", b1: "B" }

export type FitDocumentScope = { scopeType: "ALL_TEAMS" } | { scopeType: "TEAM"; team: FitTeam } | { scopeType: "SUBTEAM"; subteam: FitSubteam }
/** Alcance do agente: o legado de vínculo único (TEAM/SUBTEAM) ou os vários vínculos da 249 (`GROUPS`: Grupo inteiro ou Subgrupo). */
export type FitAgentScope = { scopeType: "ALL_TEAMS" } | { scopeType: "TEAM"; team: FitTeam } | { scopeType: "SUBTEAM"; subteam: FitSubteam } | { scopeType: "GROUPS"; links: (FitTeam | FitSubteam)[] }

/** Grupos efetivos do agente (Subgrupo → Grupo-pai): o que a SQL recebe em `teamIds`. */
export function fitAgentTeams(scope: FitAgentScope): FitTeam[] {
  if (scope.scopeType === "ALL_TEAMS") return []
  if (scope.scopeType === "TEAM") return [scope.team]
  if (scope.scopeType === "SUBTEAM") return [FIT_SUBTEAM_PARENT[scope.subteam]]
  return [...new Set(scope.links.map((link) => (link === "A" || link === "B" ? link : FIT_SUBTEAM_PARENT[link])))]
}
export type FitCase = { name: string; document: FitDocumentScope[]; agent: FitAgentScope; fits: boolean }

const GLOBAL: FitDocumentScope = { scopeType: "ALL_TEAMS" }
const team = (value: FitTeam) => ({ scopeType: "TEAM" as const, team: value })
const subteam = (value: FitSubteam) => ({ scopeType: "SUBTEAM" as const, subteam: value })

export const KNOWLEDGE_AGENT_FIT_CASES: readonly FitCase[] = [
  { name: "agente de todos os Grupos aceita base de qualquer Grupo", document: [team("B")], agent: { scopeType: "ALL_TEAMS" }, fits: true },
  { name: "agente de todos os Grupos aceita base de Subgrupo", document: [subteam("b1")], agent: { scopeType: "ALL_TEAMS" }, fits: true },
  { name: "agente de Grupo aceita base global", document: [GLOBAL], agent: team("A"), fits: true },
  { name: "agente de Grupo aceita base do mesmo Grupo", document: [team("A")], agent: team("A"), fits: true },
  { name: "agente de Grupo aceita base de Subgrupo do mesmo Grupo", document: [subteam("a1")], agent: team("A"), fits: true },
  { name: "agente de Grupo recusa base de outro Grupo", document: [team("B")], agent: team("A"), fits: false },
  { name: "agente de Grupo recusa base de Subgrupo de outro Grupo", document: [subteam("b1")], agent: team("A"), fits: false },
  { name: "base de vários Grupos cabe se um deles é o do agente", document: [team("B"), subteam("a2")], agent: team("A"), fits: true },
  { name: "agente de Subgrupo conta pelo Grupo-pai: base do Grupo", document: [team("A")], agent: subteam("a1"), fits: true },
  { name: "agente de Subgrupo aceita base de Subgrupo irmão", document: [subteam("a2")], agent: subteam("a1"), fits: true },
  { name: "agente de Subgrupo aceita base global", document: [GLOBAL], agent: subteam("a1"), fits: true },
  { name: "agente de Subgrupo recusa base de outro Grupo", document: [team("B")], agent: subteam("a1"), fits: false },
  // Vários vínculos (249): a base cabe se for global ou valer para CADA Grupo efetivo do agente (Subgrupo leva o Grupo-pai) — run-10 QA-01.
  { name: "agente de vários Grupos recusa base de só um deles", document: [team("B")], agent: { scopeType: "GROUPS", links: ["A", "b1"] }, fits: false },
  { name: "agente de vários Grupos recusa base de Subgrupo de só um deles", document: [subteam("a2")], agent: { scopeType: "GROUPS", links: ["a1", "b1"] }, fits: false },
  { name: "agente de vários Grupos aceita base de todos eles", document: [team("A"), team("B")], agent: { scopeType: "GROUPS", links: ["A", "b1"] }, fits: true },
  { name: "agente de vários Grupos aceita base de Subgrupos que cobrem cada Grupo dele", document: [subteam("a2"), subteam("b1")], agent: { scopeType: "GROUPS", links: ["a1", "B"] }, fits: true },
  { name: "agente de vários Subgrupos do mesmo Grupo aceita base desse Grupo", document: [team("A")], agent: { scopeType: "GROUPS", links: ["a1", "a2"] }, fits: true },
  { name: "agente de vários Subgrupos do mesmo Grupo recusa base de outro Grupo", document: [subteam("b1")], agent: { scopeType: "GROUPS", links: ["a1", "a2"] }, fits: false },
  { name: "agente de vários Grupos aceita base global", document: [GLOBAL], agent: { scopeType: "GROUPS", links: ["A", "B"] }, fits: true },
  { name: "agente sem vínculo nenhum nunca vira global: só base global", document: [team("A")], agent: { scopeType: "GROUPS", links: [] }, fits: false },
  { name: "agente sem vínculo nenhum aceita base global", document: [GLOBAL], agent: { scopeType: "GROUPS", links: [] }, fits: true },
]
