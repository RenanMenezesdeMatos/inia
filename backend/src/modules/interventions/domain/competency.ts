import { z } from "zod"
import { stableKeySchema } from "./intervention-type.js"

/**
 * COMPETÊNCIA — dado administrável que liga o diagnóstico ao treinamento: indicador → padrão sustentado do diagnóstico
 * (chaves de prática/critério/comportamento) → competência → conteúdo APROVADO da base → atividade. Os vínculos são explícitos
 * (escolhidos por uma pessoa); nada é inferido do nome do indicador.
 */
export const ACTIVITY_KINDS = ["STUDY", "PRACTICE", "SHADOWING", "ROLE_PLAY", "ASSESSMENT", "OTHER"] as const
export const ACTIVITY_KIND_LABELS: Record<(typeof ACTIVITY_KINDS)[number], string> = { STUDY: "Estudo", PRACTICE: "Prática", SHADOWING: "Acompanhar um colega", ROLE_PLAY: "Simulação", ASSESSMENT: "Avaliação", OTHER: "Outra" }

export const competencyActivitySchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,39}$/, "Chave da atividade: letras minúsculas, números, _ ou -."),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000),
    kind: z.enum(ACTIVITY_KINDS),
    documentId: z.string().uuid().nullable(),
    estimatedMinutes: z.number().int().min(1).max(2400).nullable(),
  })
  .strict()
export type CompetencyActivity = z.infer<typeof competencyActivitySchema>

/** Chaves de padrão aceitas: prática da base (KP-…), critério (KC-…) ou comportamento de estratégia de diagnóstico (BEHAVIOR:…). */
export const PATTERN_KEY = /^(KP-[A-Za-z0-9]{4,40}|KC-[A-Za-z0-9_-]{2,60}|[A-Z][A-Z_]{1,30}:[A-Z0-9_]{1,60})$/

export const competencyInputSchema = z
  .object({
    key: stableKeySchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    knowledgeDocumentIds: z.array(z.string().uuid()).max(30),
    practiceKeys: z.array(z.string().trim().regex(PATTERN_KEY, "Chave de prática ou comportamento inválida.")).max(50),
    criterionKeys: z.array(z.string().trim().regex(/^KC-[A-Za-z0-9_-]{2,60}$/, "Chave de critério inválida.")).max(50),
    indicatorCodes: z.array(z.string().trim().min(1).max(40)).max(20),
    activities: z.array(competencyActivitySchema).max(20),
  })
  .strict()
export type CompetencyInput = z.infer<typeof competencyInputSchema>
