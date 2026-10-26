import { createHash } from "node:crypto"
import { z } from "zod"

/**
 * CORPUS SINTÉTICO — formato do `best_practice_synthetic_datasets.corpus`. Operadores, resultados por indicador × competência,
 * chamadas com transcrição e fontes de obrigação, todos FICTÍCIOS e marcados como tal. O gabarito (o que cada chamada contém de
 * fato) NUNCA fica aqui: vive só no código de teste, para que a análise leia exatamente o que leria de dados reais.
 */
export const SYNTHETIC_CORPUS_SCHEMA_VERSION = 1

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export const syntheticCorpusSchema = z.object({
  schemaVersion: z.literal(SYNTHETIC_CORPUS_SCHEMA_VERSION),
  populationLabel: z.string().min(1),
  operators: z.array(z.object({ ref: z.string().min(1), name: z.string().min(1) })).min(1),
  results: z.array(z.object({ operatorRef: z.string(), indicatorCode: z.string(), referencePeriod: periodSchema, value: z.number(), quartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).nullable() })),
  // `signals` (opcional): valor de cada sinal da chamada pelo nome do sinal (ex.: { nota_ura: 5 }) — a análise pelo sinal lê daqui.
  calls: z.array(z.object({ ref: z.string().min(1), operatorRef: z.string(), reason: z.string().min(1), subReason: z.string().nullable(), channel: z.string().nullable(), occurredAt: z.string().datetime(), durationSeconds: z.number().int().nullable(), transcript: z.string(), signals: z.record(z.string(), z.union([z.number(), z.boolean()])).optional() })),
  obligations: z.object({
    documents: z.array(z.object({ id: z.string(), title: z.string(), version: z.number().int().positive(), content: z.string() })),
    argumentScripts: z.array(z.object({ id: z.string(), name: z.string(), version: z.number().int().positive(), items: z.array(z.object({ marker: z.enum(["DEVE", "PODE", "EVITAR", "PONTO OBRIGATÓRIO", "ORIENTAÇÃO"]), text: z.string() })) })),
  }),
})
export type SyntheticCorpus = z.infer<typeof syntheticCorpusSchema>

export const syntheticCorpusHashOf = (corpus: SyntheticCorpus) => createHash("sha256").update(JSON.stringify(corpus)).digest("hex").slice(0, 32)

/**
 * GABARITO do dataset (coluna `answer_key`, separada do corpus). Diz o que cada chamada contém de fato e como um leitor correto
 * responderia a cada etapa — usado só pelo modelo SIMULADO (validação do mecanismo, zero IA) e pelos testes. Inclui, de propósito,
 * respostas de um "modelo ingênuo" (propõe obrigações, segue a instrução injetada na transcrição, propõe comportamento que exige
 * áudio): o mecanismo tem de barrar tudo isso por código.
 */
export const syntheticAnswerKeySchema = z.object({
  schemaVersion: z.literal(1),
  behaviors: z.array(
    z.object({
      key: z.string().min(1),
      scenario: z.string().min(1),
      name: z.string(),
      description: z.string(),
      observableDefinition: z.string(),
      appliesWhen: z.string(),
      notApplicableWhen: z.string(),
      guidance: z.string(),
      suggestedPhrasing: z.string(),
      requiresAudio: z.boolean(),
      obligation: z.object({
        relation: z.enum(["SAME_AS_OBLIGATION", "ADDITIONAL_TO_OBLIGATION", "CONFLICTS_WITH_OBLIGATION", "UNRELATED", "UNCERTAIN"]),
        sourceRefs: z.array(z.string()),
        ruleQuote: z.string(),
        sourceModality: z.enum(["MANDATORY", "RECOMMENDED", "INFORMATIVE"]),
        additionalBehavior: z.string(),
        recommendsOmissionOrManipulation: z.boolean(),
        rationale: z.string(),
      }),
    }),
  ),
  /** Por chamada: comportamento → trecho literal (de quem falou — a instrução injetada cita o CLIENTE de propósito); e os que não se aplicam. O resto = ausente. */
  calls: z.record(z.string(), z.object({ present: z.record(z.string(), z.string()), notApplicable: z.array(z.string()) })),
})
export type SyntheticAnswerKey = z.infer<typeof syntheticAnswerKeySchema>
