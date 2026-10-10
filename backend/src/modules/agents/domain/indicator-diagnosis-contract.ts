import { z } from "zod"
import { CHECKPOINT_STATUSES, EVIDENCE_TYPE_MATRIX, rawProcessAssessmentSchema, renderCheckpointFormatRules, validateProcessAssessmentOutput, type ContractIssue, type PresentedExcerptForContract, type RawProcessAssessment } from "./process-assessment-contract.js"
import type { ProcessCheckpointCatalog } from "../../reliable-feedback/domain/checkpoint-catalog.js"

/**
 * V1.6.1 — CONTRATO DO AGENT NO DIAGNÓSTICO DE INDICADOR ("Chamar agente" com gatilho por Indicador e formato
 * `INDICATOR_DIAGNOSIS`). O SISTEMA já decidiu tudo o que é número e escolha: o resultado oficial, o motivo investigado e
 * QUAIS atendimentos entram (amostra determinística, identificados por I1…In). O Agent faz UMA coisa: avaliar cada
 * atendimento pelos processos da base — o MESMO contrato PROCESS_ASSESSMENT_V1 da monitoria, por atendimento. Nada disso é
 * confiável por si: a camada de confiabilidade recalcula o plano e verifica fala, falante, dono e regra da base.
 */
export const INDICATOR_DIAGNOSIS_AGENT_CONTRACT = "INDICATOR_DIAGNOSIS_ASSESSMENTS_V1" as const

export const interactionAssessmentSchema = z.object({ interactionRef: z.string().trim().regex(/^I\d{1,2}$/), processAssessment: rawProcessAssessmentSchema })
export const interactionAssessmentsSchema = z.array(interactionAssessmentSchema).max(10)
export type InteractionAssessment = { interactionRef: string; processAssessment: RawProcessAssessment }

const matrixText = CHECKPOINT_STATUSES.map((status) => `${status} → ${EVIDENCE_TYPE_MATRIX[status].map((value) => (value === null ? "null" : `"${value}"`)).join(" ou ")}`).join("; ")

export const INDICATOR_DIAGNOSIS_INSTRUCTIONS = `
Os atendimentos da amostra aparecem acima identificados por I1, I2, … (escolhidos pelo sistema; não escolha outros). Além dos campos acima, inclua no MESMO JSON o campo "interactionAssessments" — UMA avaliação por atendimento da amostra, pelos PROCESSOS oficiais aplicáveis:
"interactionAssessments": [
  {
    "interactionRef": "<INTERACTION_REF da amostra>",
    "processAssessment": {
      "processes": [
        {
          "documentTitle": "o TÍTULO EXATO de um documento que aparece depois de ### em 'Bases de conhecimento disponíveis' e que se aplica ao MOTIVO deste atendimento",
          "checkpoints": [
            {
              "checkpointRef": "o código [CP-…] que marca a etapa no trecho apresentado — copie exatamente; a mesma etapa tem o mesmo código em todos os atendimentos",
              "requirement": "a etapa ou regra, com as palavras do documento — use EXATAMENTE o mesmo texto para a mesma etapa em todos os atendimentos",
              "status": "FOLLOWED | NOT_FOLLOWED | NOT_OBSERVABLE | NOT_APPLICABLE",
              "evidenceType": "${matrixText}",
              "transcriptEvidence": ["trecho LITERAL da transcrição DESTE atendimento, UMA fala por item, copiado exatamente — com o rótulo de quem fala quando houver"],
              "knowledgeQuote": "trecho LITERAL e curto do documento que estabelece esta etapa (copiado exatamente) ou null",
              "guidance": { "source": "OFFICIAL_PROCEDURE | OFFICIAL_SERVICE_GUIDELINE | NO_GROUNDED_GUIDANCE", "text": "como fazer, SOMENTE conforme o documento, ou null" },
              "uncertainty": "o que limita esta conclusão, ou null"
            }
          ]
        }
      ]
    }
  }
]
${renderCheckpointFormatRules()}
Regras: (1) Uma entrada por atendimento da amostra; atendimento sem processo aplicável = "processes": []. Nunca use um documento só porque ele foi apresentado. (2) FOLLOWED exige fala LITERAL do operador mostrando a etapa cumprida; NOT_FOLLOWED exige que a etapa se aplicasse E evidência literal do que aconteceu no lugar dela; etapa que simplesmente não aparece = NOT_OBSERVABLE. (3) Cada trecho de transcriptEvidence vem do PRÓPRIO atendimento avaliado. (4) knowledgeQuote é cópia exata de um trecho do documento apresentado; nunca parafraseie. (5) Sem orientação no documento: NO_GROUNDED_GUIDANCE e text null — nunca dica genérica. (6) Registre etapas cumpridas com o mesmo rigor das não cumpridas. (7) Você NÃO calcula nada e NÃO relaciona etapas ao resultado do indicador: a contagem e as conclusões são feitas depois, pelo sistema.`

export type DiagnosisSampleForPrompt = { handle: string; localDate: string; transcript: string }

/** Bloco da amostra no contexto do Agent: só handle, data local e transcrição — nunca id, nome de colega ou número de outro. */
export function renderDiagnosisSampleForAgent(input: { segmentText: string | null; periodLabel: string; sample: readonly DiagnosisSampleForPrompt[] }): string {
  const header = [`DIAGNÓSTICO DO INDICADOR (período ${input.periodLabel})`, input.segmentText ?? "Nenhum motivo investigável no período."].join("\n")
  if (input.sample.length === 0) return `${header}\nNenhum atendimento selecionado para avaliação.`
  return [header, ...input.sample.map((entry) => `=== ${entry.handle} · ${entry.localDate} ===\n${entry.transcript}`)].join("\n\n")
}

const rawInteractionAssessmentsSchema = z.array(z.object({ interactionRef: z.string().trim().regex(/^I\d{1,2}$/), processAssessment: z.unknown() })).max(10)

/** Orientação ausente (`"guidance": null`) = a leitura mais conservadora: sem orientação fundamentada (nunca uma orientação). */
function withNullGuidanceAsNone(assessment: unknown): unknown {
  if (!assessment || typeof assessment !== "object") return assessment
  const processes = (assessment as { processes?: unknown }).processes
  if (!Array.isArray(processes)) return assessment
  return {
    ...(assessment as object),
    processes: processes.map((process) => {
      const checkpoints = process && typeof process === "object" ? (process as { checkpoints?: unknown }).checkpoints : undefined
      if (!Array.isArray(checkpoints)) return process
      return { ...(process as object), checkpoints: checkpoints.map((checkpoint) => (checkpoint && typeof checkpoint === "object" && (checkpoint as { guidance?: unknown }).guidance === null ? { ...(checkpoint as object), guidance: { source: "NO_GROUNDED_GUIDANCE", text: null } } : checkpoint)) }
    }),
  }
}

/**
 * Formato conferido (conteúdo NÃO verificado); refs fora da amostra e repetidas são descartadas. V1.7.1c — cada avaliação
 * passa pelo MESMO validador do contrato da monitoria (`validateProcessAssessmentOutput`): etapa inválida deixa a avaliação
 * daquele atendimento PARTIAL.
 *
 * Indicator Diagnosis V1 — ISOLAMENTO POR ATENDIMENTO: a avaliação inválida de UM atendimento sai sozinha (`rejected`, com as
 * violações) e as outras seguem para a verificação — antes, um único atendimento malformado derrubava o diagnóstico inteiro
 * (e o nó ia a `dead`, sem retry). Fail-closed continua quando NENHUMA avaliação é válida (envelope inválido ou todas rejeitadas).
 */
export function parseInteractionAssessments(value: unknown, allowedRefs: readonly string[], presented: readonly PresentedExcerptForContract[] | null = null, catalog: ProcessCheckpointCatalog | null = null): { accepted: InteractionAssessment[]; valid: boolean; issues: ContractIssue[]; rejected: { interactionRef: string; issues: ContractIssue[] }[] } {
  const parsed = rawInteractionAssessmentsSchema.safeParse(value)
  if (!parsed.success) return { accepted: [], valid: false, rejected: [], issues: parsed.error.issues.slice(0, 50).map((issue) => ({ path: ["interactionAssessments", ...issue.path.map(String)].join("."), code: issue.code.toUpperCase(), message: issue.message })) }
  const seen = new Set<string>()
  const accepted: InteractionAssessment[] = []
  const rejected: { interactionRef: string; issues: ContractIssue[] }[] = []
  for (const [index, entry] of parsed.data.entries()) {
    if (!allowedRefs.includes(entry.interactionRef) || seen.has(entry.interactionRef)) continue
    seen.add(entry.interactionRef)
    const validated = validateProcessAssessmentOutput(withNullGuidanceAsNone(entry.processAssessment), { presented, catalog })
    if (!validated.ok) {
      rejected.push({ interactionRef: entry.interactionRef, issues: validated.issues.map((issue) => ({ ...issue, path: issue.path.replace(/^processAssessment/, `interactionAssessments.${index}.processAssessment`) })) })
      continue
    }
    accepted.push({ interactionRef: entry.interactionRef, processAssessment: validated.assessment })
  }
  if (accepted.length === 0 && rejected.length > 0) return { accepted: [], valid: false, rejected, issues: rejected.flatMap((entry) => entry.issues) }
  return { accepted, valid: true, rejected, issues: [] }
}
