import { isExecutableSectionRole, SECTION_PROCESS_ROLE_VERSION, sectionProcessRoleIn, type SectionProcessRole } from "../../knowledge/domain/section-roles.js"
import type { KnowledgeContentKind } from "./suggested-response.js"

/**
 * V1.7.1l — ELEGIBILIDADE DE ETAPA EXECUTÁVEL (`CHECKPOINT_ELIGIBILITY_V1`, domínio puro, sem LLM). Função ÚNICA.
 *
 * Duas dimensões que não se confundem:
 *   PAPEL DO SEGMENTO   o que o trecho É no documento (regra, exemplo, evitar — `knowledgeContentKindOf` / segmentos);
 *   PAPEL DA SEÇÃO      para que a seção SERVE no processo (objetivo, abrangência, etapa, checklist… — `section-roles.ts`).
 *
 * "É uma regra do documento" ≠ "é uma etapa que o operador precisa executar". Uma linha da seção "1. Objetivo" pode ser
 * linguisticamente normativa ("Informação sobre valores, prazos e canais de acompanhamento") e mesmo assim nunca é um checkpoint:
 * ela descreve o que o PROCEDIMENTO garante, não o que o operador faz num momento da chamada. Por isso:
 *
 *   seção OBJECTIVE, SCOPE, CONTEXT, RESULT_EXPECTATION, REFERENCE ou EXAMPLE_SECTION → não elegível (NON_EXECUTABLE_SECTION);
 *   seção executável (PROCEDURE_STEP, CHECKLIST, DECISION_RULE, CONDITION, WARNING) ou sem papel reconhecido (UNKNOWN) → elegível.
 *
 * O tipo do segmento continua com as regras próprias (exemplo → QA/NEEDS_REVIEW, evitar → só descumprimento observado): esta
 * função não muda esse tratamento. Não existe vínculo explícito etapa ↔ objetivo no modelo de dados hoje; quando existir, é aqui
 * que ele entra. O conteúdo não elegível continua disponível como CONTEXTO do procedimento — só não vira acusação nem elogio.
 */
export const CHECKPOINT_ELIGIBILITY_VERSION = "CHECKPOINT_ELIGIBILITY_V1" as const

export type SegmentProcessRole = "RULE" | "EXAMPLE" | "AVOID"
export type CheckpointEligibility = {
  version: typeof CHECKPOINT_ELIGIBILITY_VERSION
  eligible: boolean
  reason: "NON_EXECUTABLE_SECTION" | null
  sectionRole: SectionProcessRole
  sectionRoleVersion: typeof SECTION_PROCESS_ROLE_VERSION
  segmentRole: SegmentProcessRole
  /** Proveniência: documento/versão/seção onde o papel foi lido. */
  documentId: string | null
  documentVersion: number | null
  heading: string | null
  listKind: string | null
}

const segmentRoleOf = (kind: KnowledgeContentKind | null | undefined): SegmentProcessRole => (kind === "EXAMPLE_CONTENT" ? "EXAMPLE" : kind === "DO_NOT_CONTENT" ? "AVOID" : "RULE")

export function isEligibleProcessCheckpoint(input: {
  /** Conteúdo PUBLICADO (mesma versão da verificação); null = só o título da seção decide. */
  content: string | null
  heading: string | null
  documentTitle: string
  documentId?: string | null
  version?: number | null
  contentKind: KnowledgeContentKind | null | undefined
  /** Estrutura da lista em que a etapa está (auditoria). */
  listKind?: string | null
}): CheckpointEligibility {
  const sectionRole = sectionProcessRoleIn(input.content ?? "", input.heading, input.documentTitle)
  const eligible = isExecutableSectionRole(sectionRole)
  return {
    version: CHECKPOINT_ELIGIBILITY_VERSION,
    eligible,
    reason: eligible ? null : "NON_EXECUTABLE_SECTION",
    sectionRole,
    sectionRoleVersion: SECTION_PROCESS_ROLE_VERSION,
    segmentRole: segmentRoleOf(input.contentKind),
    documentId: input.documentId ?? null,
    documentVersion: input.version ?? null,
    heading: input.heading,
    listKind: input.listKind ?? null,
  }
}
