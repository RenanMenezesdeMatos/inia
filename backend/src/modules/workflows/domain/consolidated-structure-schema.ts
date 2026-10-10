import { structureAnchorPersonId, structureAnchorSchema, type StructureAnchor } from "./structure-anchor-schema.js"

/**
 * Estrutura Consolidada — QUAL estrutura organizacional é analisada como UMA única unidade,
 * quando o Workflow está em modo de avaliação Consolidado (`workflows.consolidated_structure`
 * não nulo). Um conceito deliberadamente separado de Abrangência (ONDE o Workflow pode atuar),
 * de Escopo Administrativo (quem pode configurar), de Filtro Populacional (QUAIS colaboradores
 * entram numa avaliação Individual — ver population-filter-schema.ts) e de Destinatário/Target
 * (quem recebe o resultado).
 *
 * Ausente (`null`) = modo Individual — não existe mais uma variante "OPERATOR" aqui: analisar um
 * colaborador por vez não é uma "estrutura consolidada", é a AUSÊNCIA de uma. Só faz sentido com
 * Agenda de calendário — nunca com Agenda relativa ao expediente (por definição individual, uma
 * jornada é de uma pessoa só) nem com Flag/Indicador (o sujeito já vem do próprio evento).
 */
export const consolidatedStructureSchema = structureAnchorSchema
export type ConsolidatedStructure = StructureAnchor

/** Extrai o id da pessoa-âncora, quando a estrutura é ancorada numa pessoa — usado pra validar
 * Abrangência e pra resolver o `scheduled_subject_id` da matrícula agregada. */
export const consolidatedStructureAnchorId = structureAnchorPersonId
