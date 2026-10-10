import {
  STRUCTURE_ANCHOR_LABELS,
  STRUCTURE_ANCHOR_ROLE,
  structureAnchorGroupId,
  structureAnchorPersonId,
  structureAnchorSchema,
  type StructureAnchor,
  type StructureAnchorKind,
} from "./structure-anchor-schema"

/**
 * Estrutura Consolidada — QUAL estrutura organizacional é analisada como UMA única unidade,
 * quando o Workflow está em modo de avaliação Consolidado. Espelha consolidated-structure-
 * schema.ts do backend. Ausente = modo Individual — nunca existe mais um kind "OPERATOR" aqui:
 * analisar um colaborador por vez não é uma "estrutura consolidada", é a AUSÊNCIA de uma.
 */
export const consolidatedStructureSchema = structureAnchorSchema
export type ConsolidatedStructure = StructureAnchor
export type ConsolidatedStructureKind = StructureAnchorKind

export const CONSOLIDATED_STRUCTURE_LABELS = STRUCTURE_ANCHOR_LABELS
export const CONSOLIDATED_STRUCTURE_ANCHOR_ROLE = STRUCTURE_ANCHOR_ROLE
export const consolidatedStructureAnchorId = structureAnchorPersonId
export const consolidatedStructureGroupId = structureAnchorGroupId
