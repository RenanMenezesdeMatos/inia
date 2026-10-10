import { z } from "zod"
import { CHECKPOINT_REF_PATTERN, isContractV5, validateProcessAssessmentOutput, type CoverageRepairOutcome, type PresentedExcerptForContract, type RawProcessAssessment } from "./process-assessment-contract.js"
import type { ProcessCheckpointCatalog, ProcessCheckpointEntry } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { assessConduct, CONDUCT_RELATIONS, EVIDENCE_ROLES, requiredConductOf, type ConductFailure, type RequiredConduct } from "../../reliable-feedback/domain/evidence-conduct.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { contentTerms } from "../../reliable-feedback/domain/process-assessment.js"

/**
 * V1.7.4 — REPARO SEMÂNTICO ÚNICO (`ASSESSMENT_SEMANTIC_REPAIR_V1`), no MESMO passo do reparo de cobertura (V1.7.3): no máximo
 * UMA chamada por avaliação, só com as etapas inconsistentes, a regra literal, a conduta exigida e a conversa — nunca a análise
 * inteira, nunca um laço, nunca um segundo modelo julgando o primeiro: é o MESMO especialista reavaliando a própria disposição.
 *
 * ALVOS (determinísticos, as mesmas funções da verificação):
 *   CONDUCT_NOT_EVIDENCED   a disposição afirma uma conduta que a fala citada não mostra (resultado afirmado para "verificar se…";
 *                           ponto forte de "não prometer…" sem abstenção explícita);
 *   CONDUCT_CONTRADICTED    "não cumprida", mas a fala citada é justamente a conduta (a checagem feita; a abstenção);
 *   RELATION_UNDECLARED     fala e regra com menos de 2 termos em comum e sem `conductEvidence`: o especialista precisa dizer se é
 *                           a MESMA conduta (EQUIVALENT), uma dedução (INFERRED) ou outra conduta (DIFFERENT).
 *
 * A resposta SUBSTITUI só a etapa-alvo (passa pelo mesmo validador do contrato, catálogo restrito aos alvos). Falha do reparo
 * (transporte, JSON, contrato) fica registrada e a disposição original segue para a verificação — que é a autoridade: nenhuma
 * conclusão sai daqui sem passar pelos mesmos gates.
 */
export const ASSESSMENT_SEMANTIC_REPAIR_VERSION = "ASSESSMENT_SEMANTIC_REPAIR_V1" as const
export const SEMANTIC_REPAIR_REASONS = ["CONDUCT_NOT_EVIDENCED", "CONDUCT_CONTRADICTED", "RELATION_UNDECLARED"] as const
export type SemanticRepairReason = (typeof SEMANTIC_REPAIR_REASONS)[number]

export const semanticRepairAuditSchema = z.object({
  version: z.literal(ASSESSMENT_SEMANTIC_REPAIR_VERSION),
  targets: z.array(z.object({ checkpointRef: z.string(), reason: z.enum(SEMANTIC_REPAIR_REASONS), failure: z.string().nullable() })),
  repaired: z.array(z.object({ checkpointRef: z.string(), from: z.string(), to: z.string() })),
  unchanged: z.array(z.string()),
  rejected: z.array(z.object({ checkpointRef: z.string().nullable(), code: z.string() })),
  error: z.string().nullable(),
})
export type SemanticRepairAudit = z.infer<typeof semanticRepairAuditSchema>

type RawCheckpointOf = RawProcessAssessment["processes"][number]["checkpoints"][number]
export type SemanticRepairTarget = { entry: ProcessCheckpointEntry; checkpoint: RawCheckpointOf; reason: SemanticRepairReason; failure: ConductFailure | null; required: RequiredConduct }

const SPEAKER = /^\s*[\p{L} ]{2,20}:\s*/u
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()

/** Etapas da primeira resposta (já com o reparo de cobertura, quando houve) que voltam ao especialista. Nunca num segundo reparo. */
export function semanticRepairTargetsOf(assessment: RawProcessAssessment, catalog: ProcessCheckpointCatalog | null | undefined, conversation: string): SemanticRepairTarget[] {
  if (!catalog || (assessment.validation as { semanticRepair?: unknown } | undefined)?.semanticRepair) return []
  const projection = projectTranscript(conversation)
  const operatorTurns = projection.turns.filter((turn) => turn.speaker === "OPERADOR").map((turn) => ({ turnRef: turn.handle, text: turn.text }))
  const byRef = new Map(catalog.entries.map((entry) => [entry.ref, entry]))
  // MONITORING V2 — contrato V5: o gatilho é a incoerência da conduta DECLARADA; nenhuma contagem de palavras em comum.
  const v5 = isContractV5(assessment.validation)
  const targets: SemanticRepairTarget[] = []
  for (const checkpoint of assessment.processes.flatMap((process) => process.checkpoints)) {
    const entry = checkpoint.checkpointRef ? byRef.get(checkpoint.checkpointRef) : undefined
    if (!entry || (checkpoint.status !== "FOLLOWED" && checkpoint.status !== "NOT_FOLLOWED") || checkpoint.evidenceType === "OMISSION") continue
    // Evidência citada → turnos da transcrição (a verificação literal oficial acontece depois; aqui só localiza).
    const evidence = checkpoint.transcriptEvidence.flatMap((quote) => {
      const text = fold(quote.replace(SPEAKER, ""))
      const turn = operatorTurns.find((candidate) => fold(candidate.text).includes(text.slice(0, 60)))
      return turn ? [{ turnRef: turn.turnRef, text: quote.replace(SPEAKER, "") }] : []
    })
    const conduct = assessConduct({ stepText: entry.stepText, status: checkpoint.status, evidenceType: checkpoint.evidenceType ?? null, evidence, operatorTurns, declared: checkpoint.conductEvidence ?? null, mode: v5 ? "DECLARED" : "LEXICAL" })
    const required = requiredConductOf(entry.stepText).required
    if (conduct.verdict === "MISMATCH" && conduct.failure !== "DECLARED_RELATION_INCOMPATIBLE" && conduct.failure !== "DECLARED_ROLE_INCOMPATIBLE") {
      targets.push({ entry, checkpoint, reason: checkpoint.status === "FOLLOWED" ? "CONDUCT_NOT_EVIDENCED" : "CONDUCT_CONTRADICTED", failure: conduct.failure, required })
      continue
    }
    if (v5) continue
    const stepTerms = contentTerms(entry.stepText)
    const shared = [...new Set(evidence.flatMap((unit) => [...contentTerms(unit.text)]))].filter((term) => stepTerms.has(term))
    // Só na cauda longa: comportamento canônico (protocolo, prazo, confirmação…) já tem prova estrutural própria na verificação.
    if (shared.length < 2 && !checkpoint.conductEvidence && entry.canonicalBehavior === null && !entry.composite) targets.push({ entry, checkpoint, reason: "RELATION_UNDECLARED", failure: null, required })
  }
  return targets
}

const REQUIRED_EXPLANATION: Record<RequiredConduct, string> = {
  CONDITION_CHECK: "a etapa pede um ATO de checagem do operador (ex.: “vou verificar…”, “verifiquei…”, “deixa eu consultar…”) ou uma PERGUNTA ao cliente sobre o que precisa ser checado. Afirmar o resultado (“essa opção está disponível”) NÃO é checar.",
  PROHIBITION: "a etapa proíbe uma conduta. Ela só está cumprida com abstenção EXPLÍCITA na fala (ex.: “não consigo te garantir…”); não ter feito o proibido não é ponto forte — sem abstenção explícita, NOT_OBSERVABLE. Ela só está descumprida quando a fala FAZ o que é proibido.",
  NONE: "a etapa pede a conduta descrita no texto literal dela.",
}
const REASON_EXPLANATION: Record<SemanticRepairReason, string> = {
  CONDUCT_NOT_EVIDENCED: "a disposição diz que a etapa foi cumprida, mas a fala citada não mostra a conduta exigida",
  CONDUCT_CONTRADICTED: "a disposição diz que a etapa NÃO foi cumprida, mas a fala citada parece ser justamente a conduta exigida",
  RELATION_UNDECLARED: "a fala citada tem poucas palavras em comum com a regra; diga se ela realiza a MESMA conduta com outras palavras",
}

export function renderSemanticRepairSection(targets: readonly SemanticRepairTarget[]): string {
  return targets.map((target) => [
    `[${target.entry.ref}] Documento: “${target.entry.documentTitle}”${target.entry.heading ? ` · Seção: ${target.entry.heading}` : ""}`,
    `  Etapa (texto literal da base): ${target.entry.sourceText}`,
    `  Sua disposição anterior: ${target.checkpoint.status}${target.checkpoint.transcriptEvidence.length > 0 ? ` — falas citadas: ${target.checkpoint.transcriptEvidence.map((quote) => `“${quote}”`).join(" | ")}` : ""}`,
    `  Conduta exigida: ${REQUIRED_EXPLANATION[target.required]}`,
    `  Por que voltou: ${REASON_EXPLANATION[target.reason]}.`,
  ].join("\n")).join("\n")
}

export function renderSemanticRepairRules(): string {
  return [
    "ETAPAS A REAVALIAR: reavalie SÓ estas etapas pela conversa, uma disposição por código. Se a conversa mostra a conduta exigida, cite a fala LITERAL que a mostra; se mostra o contrário, NOT_FOLLOWED com evidenceType \"OBSERVED\" e a fala do que foi feito; se não dá para afirmar, NOT_OBSERVABLE. Mudar de ideia é permitido; manter a disposição só com a fala que prova a conduta.",
    `Em cada etapa reavaliada, preencha "conductEvidence": {"role": ${EVIDENCE_ROLES.map((role) => `"${role}"`).join(" | ")}, "relation": ${CONDUCT_RELATIONS.map((relation) => `"${relation}"`).join(" | ")}} — em FOLLOWED, EQUIVALENT (a fala realiza a MESMA conduta, paráfrase fiel); em NOT_FOLLOWED, DIFFERENT (a fala mostra a conduta diferente/contrária à exigida); INFERRED quando é dedução (não sustenta nenhum status).`,
  ].join("\n")
}

/**
 * Substitui SOMENTE as etapas-alvo pela resposta do reparo (mesmo validador do contrato, catálogo restrito aos alvos); sem resposta
 * válida para um alvo, a disposição original segue (a verificação decide). Registra a auditoria em `validation.semanticRepair`.
 */
export function mergeSemanticRepair(assessment: RawProcessAssessment, catalog: ProcessCheckpointCatalog, targets: readonly SemanticRepairTarget[], outcome: CoverageRepairOutcome, presented: readonly PresentedExcerptForContract[] | null): RawProcessAssessment {
  if (targets.length === 0) return assessment
  const audit: SemanticRepairAudit = { version: ASSESSMENT_SEMANTIC_REPAIR_VERSION, targets: targets.map((target) => ({ checkpointRef: target.entry.ref, reason: target.reason, failure: target.failure })), repaired: [], unchanged: [], rejected: [], error: null }
  const replacements = new Map<string, RawCheckpointOf>()
  if (outcome.kind === "FAILED") audit.error = outcome.code
  else {
    const list = Array.isArray((outcome.value as { assessments?: unknown } | null)?.assessments) ? (outcome.value as { assessments: unknown[] }).assessments : null
    if (!list) audit.error = "REPAIR_RESPONSE_INVALID"
    else {
      const targetRefs = new Set(targets.map((target) => target.entry.ref))
      const pattern = new RegExp(CHECKPOINT_REF_PATTERN.source)
      const refOf = (raw: unknown) => { const value = (raw as { checkpointRef?: unknown } | null)?.checkpointRef; return typeof value === "string" ? pattern.exec(value)?.[0] ?? null : null }
      const mine = list.filter((raw) => { const ref = refOf(raw); return ref !== null && targetRefs.has(ref) })
      const grouped = new Map<string, unknown[]>()
      for (const raw of mine) { const entry = targets.find((target) => target.entry.ref === refOf(raw))!.entry; grouped.set(entry.documentTitle, [...(grouped.get(entry.documentTitle) ?? []), raw]) }
      if (grouped.size > 0) {
        const restricted: ProcessCheckpointCatalog = { ...catalog, entries: catalog.entries.filter((entry) => targetRefs.has(entry.ref)) }
        const validated = validateProcessAssessmentOutput({ processes: [...grouped].map(([documentTitle, checkpoints]) => ({ documentTitle, product: null, checkpoints })), applicability: [] }, { presented, catalog: restricted, referenceCatalog: catalog, modelContract: isContractV5(assessment.validation) ? "V5" : "V4" })
        if (!validated.ok) audit.error = "REPAIR_CONTRACT_INVALID"
        else {
          for (const item of validated.validation.invalidItems) audit.rejected.push({ checkpointRef: null, code: item.code })
          for (const repaired of validated.assessment.processes.flatMap((process) => process.checkpoints)) if (repaired.checkpointRef) replacements.set(repaired.checkpointRef, repaired)
        }
      }
    }
  }
  const processes = assessment.processes.map((process) => ({ ...process, checkpoints: process.checkpoints.map((checkpoint) => {
    const ref = checkpoint.checkpointRef ?? ""
    if (!targets.some((target) => target.entry.ref === ref)) return checkpoint
    const replacement = replacements.get(ref)
    if (!replacement) { audit.unchanged.push(ref); return checkpoint }
    audit.repaired.push({ checkpointRef: ref, from: checkpoint.status, to: replacement.status })
    return replacement
  }) }))
  return { ...assessment, processes, validation: { ...(assessment.validation ?? { contractVersion: "", completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] }), semanticRepair: audit } as RawProcessAssessment["validation"] }
}
