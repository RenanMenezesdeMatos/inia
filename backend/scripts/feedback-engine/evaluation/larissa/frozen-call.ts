/**
 * CHAMADA CONGELADA da Larissa (selection.json + artefato pago de 30/09): identidade conferida, contexto reconstruído exatamente
 * como a análise do motor o monta, e as PROPOSTAS gravadas pelo analisador na rodada paga no formato do contrato do modelo.
 * Somente leitura; nenhuma chamada de modelo. Usado pelo replay sem custo e pela validação mínima (C07).
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { projectTranscript } from "../../../../src/modules/investigation/domain/transcript-projection.js"
import { TRANSCRIPT_MAX_CHARS } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import type { ModelCallAnalysis, ModelCriterion, VerifiedCallAnalysis } from "../../../../src/modules/feedback-engine/domain/call-analysis.js"
import { selectDocumentsForCall } from "../../../../src/modules/feedback-engine/domain/document-selection.js"
import { buildProcedureContext, transcriptStatusOf } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { loadAgentDocumentsAt, loadAgentProfile, loadInteractionForAnalysis } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import type { Database } from "../../../../src/infrastructure/database/pool.js"

type Queryable = Pick<Database, "query">

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PAID_ARTIFACT = "results/paid-2026-09-30T21-55-34-903Z.json"
export type Selection = { person: { id: string; name: string; matricula: string; organizationId: string }; agent: { id: string; name: string }; calls: { key: string; externalId: string; interactionId: string; transcriptSha256: string }[]; knowledge: { documentId: string; version: number; contentHash: string }[]; indicator: { code: string; referencePeriod: string; value: number; target: number | null } }
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

export const readSelection = () => JSON.parse(readFileSync(join(here, "selection.json"), "utf8")) as Selection
export const readPaidArtifact = (path = DEFAULT_PAID_ARTIFACT) => JSON.parse(readFileSync(join(here, path), "utf8")) as { steps: Record<string, { status: string; result?: { analysis?: VerifiedCallAnalysis } }> }

/** A proposta do analisador da rodada paga, de volta ao formato do contrato do modelo (só o que ele disse e passou pela integridade da época). */
export function proposalOf(stored: VerifiedCallAnalysis, remap: ReadonlyMap<string, string>): ModelCallAnalysis {
  const handle = (value: string) => remap.get(value) ?? value
  const quotes = (list: readonly { turn: string; speaker: string | null; quote: string }[]) => list.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote }))
  const criteria: ModelCriterion[] = stored.criteria
    .filter((criterion) => criterion.status !== "NOT_ASSESSED" && (criterion.declaredStatus as string) !== "NOT_ASSESSED")
    .map((criterion) => ({ line: handle(criterion.lineHandle), status: criterion.declaredStatus, evidenceKind: criterion.evidenceKind === "NONE" ? null : criterion.evidenceKind, declaredActionTense: criterion.declaredActionTense, evidence: quotes(criterion.evidence), opportunityTurn: criterion.opportunityTurn, rationale: criterion.rationale, materiality: criterion.materiality, guidance: criterion.guidance ? { moment: criterion.guidance.moment, condition: criterion.guidance.condition, action: criterion.guidance.action, ruleLines: criterion.guidance.ruleLines.map((line) => handle(line.handle)) } : null, whyItMatters: criterion.whyItMatters }))
  return {
    scenario: { customerNeed: stored.scenario.customerNeed, conditions: stored.scenario.conditions.map((condition) => ({ text: condition.text, evidence: quotes(condition.evidence) })), procedure: stored.scenario.procedureHandle, procedureRationale: stored.scenario.procedureRationale, pathSections: stored.scenario.pathSections.map((section) => section.handle), correctPath: stored.scenario.correctPath, pathTaken: stored.scenario.pathTaken, pathAssessment: stored.scenario.declaredPathAssessment as ModelCallAnalysis["scenario"]["pathAssessment"], pathRationale: stored.scenario.pathRationale, pathEvidence: quotes(stored.scenario.pathEvidence) },
    criteria,
    sectionDispositions: stored.sectionDispositions.map((entry) => ({ section: entry.section, status: entry.status, rationale: entry.rationale })),
    // "Não é exigência" fica só como lista de handles na análise gravada: volta como disposição de grupo.
    groupDispositions: stored.notRequirements.length > 0 ? [{ lines: stored.notRequirements.map(handle), status: "NOT_A_REQUIREMENT", rationale: "Registrado como não exigência na análise gravada." }] : [],
    sourceConflicts: stored.sourceConflicts.map((conflict) => ({ lines: conflict.lines.map(handle), description: conflict.description })),
    limitations: [],
    contractViolations: [],
  }
}

/** Identidade e fontes conferidas contra o congelado; contexto como o motor monta. Lança se algo mudou. Nenhuma proposta anterior é
 * lida — é a base da rodada com análise inicial NOVA e do carregamento com propostas abaixo. */
export async function loadFrozenSources(db: Queryable, key: string) {
  const selection = readSelection()
  const org = selection.person.organizationId
  const person = (await db.query<{ id: string; name: string; matricula: string }>(`select id, name, matricula from people where id = $1 and organization_id = $2`, [selection.person.id, org])).rows[0]
  if (!person || person.name !== selection.person.name || person.matricula !== selection.person.matricula) throw new Error("Identidade congelada não confere — nada foi executado.")
  const call = selection.calls.find((entry) => entry.key === key)
  if (!call) throw new Error(`Chamada ${key} fora da seleção congelada.`)
  const interaction = await loadInteractionForAnalysis(db, org, call.interactionId)
  if (!interaction || interaction.operatorId !== person.id || !interaction.transcript || sha(interaction.transcript.content) !== call.transcriptSha256) throw new Error(`Chamada ${key} não confere com o congelado (pessoa ou transcrição).`)
  const agent = await loadAgentProfile(db, org, selection.agent.id)
  if (!agent) throw new Error("Especialista congelado indisponível.")
  const subject = interaction.subjectCanonical?.name ?? interaction.reason
  const candidates = await loadAgentDocumentsAt(db, org, selection.agent.id, interaction.startedAt)
  for (const frozen of selection.knowledge) if (!candidates.some((document) => document.documentId === frozen.documentId && document.version === frozen.version && document.contentHash === frozen.contentHash)) throw new Error(`Base ${frozen.documentId} mudou desde o congelamento — nada foi executado.`)
  const chosen = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript.content })
  const context = buildProcedureContext(chosen.selected)
  context.omitted = chosen.omitted
  const projection = projectTranscript(interaction.transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
  const transcriptStatus = transcriptStatusOf(projection)
  return { selection, org, person, call, interaction, agent, subject, chosen, context, projection, transcriptStatus }
}

/** Fontes congeladas + as PROPOSTAS gravadas pelo analisador na rodada paga de 30/09 (replays e retomada da revisão). */
export async function loadFrozenCall(db: Queryable, key: string, artifactPath?: string) {
  const stored = readPaidArtifact(artifactPath).steps[`analysis:${key}`]?.result?.analysis
  if (!stored) throw new Error(`Artefato pago sem a análise de ${key}.`)
  const sources = await loadFrozenSources(db, key)
  const { context } = sources
  // Os handles da execução dependem só da ordem dos documentos e das linhas: conferidos pelo texto (documento + seção + linha).
  const remap = new Map<string, string>()
  let notFound = 0
  for (const criterion of stored.criteria) {
    const line = [...context.lines.values()].find((entry) => entry.documentId === criterion.documentId && entry.heading === criterion.heading && entry.text === criterion.text)
    if (!line) notFound += 1
    else remap.set(criterion.lineHandle, line.handle)
  }
  for (const document of context.documents) if (stored.scenario.procedureDocumentId === document.documentId && stored.scenario.procedureHandle) remap.set(stored.scenario.procedureHandle, document.handle)
  for (const section of [...stored.scenario.pathSections, ...stored.sectionDispositions.map((entry) => ({ handle: entry.section, heading: entry.heading }))]) {
    const current = [...context.sections.values()].find((entry) => entry.documentId === stored.scenario.procedureDocumentId && entry.heading === section.heading)
    if (current) remap.set(section.handle, current.handle)
    else notFound += 1
  }
  if (notFound > 0 || [...remap.entries()].some(([from, to]) => from !== to)) throw new Error(`Handles de ${key} mudaram (${notFound} não encontrados) — as propostas gravadas não podem ser reaproveitadas.`)
  return { ...sources, stored, proposals: proposalOf(stored, remap), remapped: remap.size }
}
