/**
 * CTE `structure_people(id, team_id, subteam_id, operating_universe)`: pessoas ATIVAS abaixo de quem lidera (`reports_to`, qualquer
 * profundidade; `union` encerra um ciclo), restritas aos Grupos de `teamsParam` quando ele não é nulo. `leaderParam`/`teamsParam` são
 * os placeholders (ex.: `$2`, `$3`) e `orgParam` o da organização.
 */
export function structurePeopleCte(orgParam: string, leaderParam: string, teamsParam: string): string {
  return `structure_below as (
       select id from people where organization_id = ${orgParam} and reports_to_id = ${leaderParam}
       union
       select p.id from people p join structure_below b on p.reports_to_id = b.id where p.organization_id = ${orgParam}
     ), structure_people as (
       select p.id, p.team_id, p.subteam_id, p.operating_universe from people p
       where p.organization_id = ${orgParam} and p.active and p.id in (select id from structure_below)
         and (${teamsParam}::uuid[] is null or p.team_id = any(${teamsParam}::uuid[]))
     )`
}
