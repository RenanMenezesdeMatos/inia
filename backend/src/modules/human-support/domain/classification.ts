import { z } from "zod"
import { CLASSIFICATION_OUTCOMES, CLASSIFICATION_REASONS, TOOL_IMPEDIMENT_REASONS, type ClassificationOutcome, type ClassificationReason } from "./catalogs.js"

/**
 * CLASSIFICAÇÃO DO ATENDIMENTO PELO ANJO (design_draft.md seção 12; `CLASSIFICATION_CATALOG_V2`). Uma por atendimento, definitiva
 * depois de enviada; pendente até ser enviada, sem impedir atribuições; vale também para atendimento Interrompido.
 *  - motivo do encaminhamento e resultado: obrigatórios e independentes (o motivo nunca define o resultado);
 *  - título do processo, sistema ou IA (3–200): obrigatório em FOUND_IN_PROCESS e AVAILABLE_ELSEWHERE, opcional em QUESTION_UNCLEAR e
 *    nos impedimentos operacionais (NO_TOOL_ACCESS, TOOL_UNAVAILABLE: a ferramenta ou o sistema afetado), não pedido nos demais
 *    (descartado);
 *  - link: opcional, só http(s), até 500 caracteres (a tela o mostra como texto, com aviso de link externo);
 *  - descrição (3–1000): obrigatória em OTHER, opcional nos impedimentos operacionais (detalhes), descartada nos demais.
 */
const TITLE_REQUIRED: readonly ClassificationReason[] = ["FOUND_IN_PROCESS", "AVAILABLE_ELSEWHERE"]
const TITLE_ALLOWED: readonly ClassificationReason[] = [...TITLE_REQUIRED, "QUESTION_UNCLEAR", ...TOOL_IMPEDIMENT_REASONS]
const DESCRIPTION_ALLOWED: readonly ClassificationReason[] = ["OTHER", ...TOOL_IMPEDIMENT_REASONS]

const optionalText = (min: number, max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((value) => value.trim())
    .pipe(z.union([z.literal(""), z.string().min(min).max(max)]))
    .optional()

export const classificationInputSchema = z
  .object({
    reason: z.enum(CLASSIFICATION_REASONS),
    referenceTitle: optionalText(3, 200),
    referenceUrl: z
      .string()
      .max(1_000)
      .transform((value) => value.trim())
      .pipe(z.union([z.literal(""), z.string().max(500).regex(/^https?:\/\/\S+$/i, "Use um endereço que comece com http:// ou https://.")]))
      .optional(),
    otherDescription: optionalText(3, 1000),
    outcome: z.enum(CLASSIFICATION_OUTCOMES),
  })
  .strict()
  .superRefine((input, context) => {
    if (TITLE_REQUIRED.includes(input.reason) && !input.referenceTitle) context.addIssue({ code: "custom", path: ["referenceTitle"], message: "Informe o título do processo, sistema ou IA." })
    if (input.reason === "OTHER" && !input.otherDescription) context.addIssue({ code: "custom", path: ["otherDescription"], message: "Descreva o motivo." })
  })
  .transform((input): Classification => ({
    reason: input.reason,
    referenceTitle: TITLE_ALLOWED.includes(input.reason) && input.referenceTitle ? input.referenceTitle : null,
    referenceUrl: input.referenceUrl ? input.referenceUrl : null,
    otherDescription: DESCRIPTION_ALLOWED.includes(input.reason) && input.otherDescription ? input.otherDescription : null,
    outcome: input.outcome,
  }))

export type Classification = { reason: ClassificationReason; referenceTitle: string | null; referenceUrl: string | null; otherDescription: string | null; outcome: ClassificationOutcome }
