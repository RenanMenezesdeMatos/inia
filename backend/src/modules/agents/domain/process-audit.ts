import { z } from "zod"

/**
 * Contrato de análise de processo (conformidade) — o que um Agent especialista devolve quando
 * o Workflow pede "compare o PROCESSO OFICIAL (Base de Conhecimento) com a TRANSCRIÇÃO REAL".
 *
 * Regras aplicadas por código (não só pedidas no prompt), ver `verifyProcessAudit`:
 * - CONFORME e NAO_CONFORME exigem evidência LITERAL da transcrição. Sem citação verbatim, o
 *   status é rebaixado para NAO_FOI_POSSIVEL_CONFIRMAR — nunca aceitamos uma conclusão apoiada em
 *   texto que a IA parafraseou ou inventou.
 * - Ausência de evidência nunca vira "não conforme": "não encontrei na transcrição" ≠ "o operador
 *   não fez".
 */
export const processStepStatusSchema = z.enum(["CONFORME", "NAO_CONFORME", "NAO_FOI_POSSIVEL_CONFIRMAR", "NAO_APLICAVEL"])
export type ProcessStepStatus = z.infer<typeof processStepStatusSchema>

export const processAuditStepSchema = z.object({
  /** Etapa esperada, com o nome usado no procedimento oficial. */
  step: z.string().trim().min(1),
  status: processStepStatusSchema,
  /** Trecho LITERAL da transcrição que sustenta CONFORME/NAO_CONFORME; null nos demais casos. */
  evidence: z.string().trim().min(1).nullable(),
  /** Título exato do documento + seção da KB que descreve a etapa; null quando a KB não cobre. */
  knowledgeReference: z.string().trim().min(1).nullable(),
  /** Uma frase objetiva sobre o que foi (ou não) observado. */
  note: z.string().trim().nullable(),
})
export type ProcessAuditStep = z.infer<typeof processAuditStepSchema>

export const processAuditSchema = z.object({
  /** Documento/procedimento oficial usado como referência (título exato da KB). */
  procedureTitle: z.string().trim().min(1),
  steps: z.array(processAuditStepSchema).min(1),
})
export type ProcessAudit = z.infer<typeof processAuditSchema>

export type VerifiedProcessAuditStep = ProcessAuditStep & {
  /** true quando o status pedido pela IA foi rebaixado por falta de evidência literal. */
  downgraded: boolean
}

export type VerifiedProcessAudit = {
  procedureTitle: string
  steps: VerifiedProcessAuditStep[]
  summary: Record<ProcessStepStatus, number>
  downgradedCount: number
}

export function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function isVerbatimExcerpt(excerpt: string | null, transcript: string): boolean {
  if (!excerpt) return false
  const normalizedExcerpt = normalizeForComparison(excerpt)
  return normalizedExcerpt.length > 0 && normalizeForComparison(transcript).includes(normalizedExcerpt)
}

const STATUSES_REQUIRING_EVIDENCE: ReadonlySet<ProcessStepStatus> = new Set(["CONFORME", "NAO_CONFORME"])

export function verifyProcessAudit(audit: ProcessAudit, transcript: string): VerifiedProcessAudit {
  const summary: Record<ProcessStepStatus, number> = { CONFORME: 0, NAO_CONFORME: 0, NAO_FOI_POSSIVEL_CONFIRMAR: 0, NAO_APLICAVEL: 0 }
  const steps = audit.steps.map((step): VerifiedProcessAuditStep => {
    const needsEvidence = STATUSES_REQUIRING_EVIDENCE.has(step.status)
    const verbatim = isVerbatimExcerpt(step.evidence, transcript)
    if (needsEvidence && !verbatim) {
      return { ...step, status: "NAO_FOI_POSSIVEL_CONFIRMAR", evidence: null, downgraded: true }
    }
    return { ...step, evidence: verbatim ? step.evidence : null, downgraded: false }
  })
  for (const step of steps) summary[step.status] += 1
  return { procedureTitle: audit.procedureTitle, steps, summary, downgradedCount: steps.filter((step) => step.downgraded).length }
}
