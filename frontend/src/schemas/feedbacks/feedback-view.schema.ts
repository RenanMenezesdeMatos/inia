import { z } from "zod"

/**
 * Feedback por Flag V2 — VIEW MODEL da apresentação de um feedback publicado (derivado do diagnóstico confiável, nunca uma
 * segunda verdade): narrativa de supervisor + card (camada 1) e os detalhes que sustentam cada ponto (camada 2, progressive
 * disclosure). Links de material já vêm resolvidos pelo backend PARA QUEM LÊ (`href: null` = sem acesso). Nenhum dado técnico
 * (status, códigos, refs, QA) chega aqui. Ausente = feedback anterior: a tela usa o texto publicado de sempre.
 */
const quoteSchema = z.object({ speaker: z.enum(["OPERATOR", "CUSTOMER", "OTHER"]), intro: z.string(), text: z.string(), truncated: z.boolean() })
const sourceSchema = z.object({ documentId: z.string(), documentTitle: z.string(), section: z.string().nullable(), href: z.string().nullable(), accessible: z.boolean().optional() })
const callSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("QUOTES"), quotes: z.array(quoteSchema) }),
  z.object({ kind: z.literal("ABSENCE"), statement: z.string(), verified: z.boolean(), context: quoteSchema.nullable() }),
  z.object({ kind: z.literal("NONE") }),
])

export const feedbackViewSchema = z.object({
  version: z.literal("FEEDBACK_VIEW_V1"),
  /** Cabeçalho do item: título = assunto do atendimento; subtítulo = metadado ("Atendimento de 29/09/2026"). Ausente = antigo. */
  heading: z.object({ title: z.string(), subtitle: z.string().nullable() }).optional(),
  card: z.string(),
  greeting: z.string().nullable(),
  narrative: z.array(z.string()),
  developments: z.array(z.object({
    key: z.string(),
    title: z.string(),
    whatHappened: z.string(),
    call: callSchema,
    adjustment: z.array(z.string()),
    guidance: z.object({ rules: z.array(z.object({ text: z.string(), section: z.string().nullable(), label: z.string().optional() })), avoid: z.array(z.string()), examples: z.array(z.string()) }),
    sources: z.array(sourceSchema),
    whyItMatters: z.array(z.string()),
    howToApply: z.string().nullable(),
    suggestedResponse: z.string().nullable(),
    suggestedResponseSource: z.object({ kind: z.literal("ARGUMENT_SCRIPT"), name: z.string() }).optional(),
    itemIndexes: z.array(z.number()),
    /** Consolidação de apresentação: os pontos que este bloco reúne (ex.: protocolo + recapitulação). */
    consolidates: z.array(z.string()).optional(),
  })),
  maintain: z.object({ summary: z.string(), evidence: z.array(z.object({ title: z.string(), statement: z.string(), quotes: z.array(quoteSchema), itemIndex: z.number(), phase: z.enum(["INVESTIGATION", "TREATMENT", "CLOSING", "OTHER"]).optional() })) }).nullable(),
  attention: z.array(z.object({ title: z.string(), markdown: z.string(), itemIndex: z.number() })),
  materials: z.array(z.object({ documentId: z.string(), title: z.string(), href: z.string().nullable(), usedIn: z.array(z.string()), sections: z.array(z.string()).optional(), accessible: z.boolean().optional() })),
  context: z.string().nullable(),
  /** Indicator Diagnosis V1 — origem do feedback (ausente = monitoria). */
  kind: z.enum(["MONITORING", "INDICATOR"]).optional(),
  /** Indicator Diagnosis V1 — rótulos das seções de detalhes quando diferem da monitoria ("Exemplos das chamadas"…). */
  sectionLabels: z.object({ developments: z.string().optional(), call: z.string().optional(), maintain: z.string().optional(), detailsHint: z.string().optional() }).optional(),
  /** Indicator Diagnosis V1 — resultado OFICIAL do ciclo por indicador (linhas prontas do sistema) + notas de contexto. */
  cycle: z.object({ title: z.string(), indicators: z.array(z.object({ name: z.string(), lines: z.array(z.object({ label: z.string(), value: z.string() })), notes: z.array(z.string()) })) }).nullable().optional(),
  /** `INDICATOR_SUBJECTS_V1` — os assuntos da pessoa nos dois períodos (texto pronto do sistema; aproximação pelas chamadas). */
  subjects: z.object({
    title: z.string(),
    note: z.string(),
    periods: z.object({ previous: z.string(), current: z.string() }),
    rows: z.array(z.object({ label: z.string(), previous: z.string().nullable(), current: z.string().nullable(), change: z.string().nullable(), trend: z.enum(["WORSE", "BETTER", "STABLE", "NOT_COMPARED"]), reading: z.string(), focus: z.boolean(), analyzed: z.string().nullable() })),
    hidden: z.number(),
  }).nullable().optional(),
})

export type FeedbackView = z.infer<typeof feedbackViewSchema>
export type FeedbackViewDevelopment = FeedbackView["developments"][number]
export type FeedbackViewQuote = z.infer<typeof quoteSchema>
export type FeedbackViewSubjects = NonNullable<FeedbackView["subjects"]>
