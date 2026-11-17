/**
 * VISÃO DA ESTRUTURA DE QUEM LIDERA (`LEADER_STRUCTURE_CONTEXT_V1`, 17/11/2026 — decisão do usuário: "o gestor deve receber
 * comunicados e alinhamentos para a(s) estrutura(s) a que ele for cadastrado").
 *
 * Quando quem conversa é um gestor e a pergunta é sobre a estrutura dele (consulta de processo de um Grupo; chat só de liderança),
 * os alinhamentos e comunicados NÃO são os do público do próprio gestor, e sim os dos públicos da estrutura:
 *   - estrutura = as pessoas ativas abaixo dele no cadastro (`reports_to`, qualquer profundidade);
 *   - `teamIds` restringe aos Grupos consultados (consulta de processo de um Grupo); null = a estrutura inteira;
 *   - públicos = cada combinação distinta de Grupo, Subgrupo e universo dessas pessoas.
 * Alinhamento: vale a mesma regra única (`resolveOperationalAlignments`) para cada público; o bloco lista cada um com o público dele.
 * Comunicado: os que chegam a alguém dessa estrutura (equipe gravada, recorte ou empresa), sempre só como informação.
 */
export const LEADER_STRUCTURE_CONTEXT_VERSION = "LEADER_STRUCTURE_CONTEXT_V1"

export type LeaderStructureScope = {
  kind: "LEADER_STRUCTURE"
  leaderPersonId: string
  /** Grupos da consulta (null = toda a estrutura de quem lidera). */
  teamIds: readonly string[] | null
  /** Nomes dos Grupos consultados, para o texto ("da Ouvidoria"); vazio = "da sua estrutura". */
  groupNames?: readonly string[]
}

export function structureLabelOf(scope: LeaderStructureScope): string {
  const names = (scope.groupNames ?? []).filter(Boolean)
  return names.length > 0 ? `do${names.length > 1 ? "s Grupos" : " Grupo"} ${names.join(", ")}` : "da estrutura de quem pergunta"
}

/** Cabeçalho do bloco de alinhamentos quando o público é a estrutura (substitui o "de quem está na conversa"). */
export function structureAlignmentHeader(scope: LeaderStructureScope): string[] {
  return [
    `ALINHAMENTOS OPERACIONAIS VIGENTES PARA OS PÚBLICOS ${structureLabelOf(scope).toUpperCase()} (orientações TEMPORÁRIAS da gestão, válidas hoje; quem pergunta é um gestor):`,
    "- Cada alinhamento vale SÓ para o público indicado nele (universo, Grupo ou Subgrupo). Ao responder, diga para qual público ele vale; não o apresente como regra de toda a estrutura nem do próprio gestor.",
  ]
}
