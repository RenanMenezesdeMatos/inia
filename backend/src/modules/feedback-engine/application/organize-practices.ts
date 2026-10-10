import { anchorLineKeysOf, combinedObligationLinesOf, practiceLinesOf, type PracticeLine } from "../domain/practice-identity.js"
import type { ProcedureContext } from "../domain/procedure.js"
import type { EngineModelRequest, EngineModelResponse, FeedbackMemoryStore } from "./ports.js"
import { resolvePracticeThemes, type PracticeThemeResolution } from "./resolve-practice-themes.js"
import { resolvePractices, type PracticeResolution } from "./resolve-practices.js"

/**
 * ORGANIZAÇÃO DO QUE UMA ANÁLISE AVALIOU, no dia a dia (sem script, sem aprovação), em três passos — cada um só quando há o que fazer:
 *   1. as LINHAS das regras avaliadas que ainda não têm prática (`PRACTICE_IDENTITY_V1`);
 *   2. as obrigações de várias linhas em que nenhuma linha pede conduta sozinha, como regra COMPOSTA — sem isso a avaliação ficaria sem
 *      ponto e o Diagnóstico mostraria o texto cru das linhas;
 *   3. o TEMA e o nome curto das práticas desta análise que ainda não têm (`PRACTICE_THEMES_V1`).
 * Nunca derruba a análise: sem orçamento ou com falha, o que faltou fica como está e volta na próxima vez.
 */
export type PracticeOrganization = { lines: PracticeResolution; combined: PracticeResolution | null; themes: PracticeThemeResolution | null }
type Deps = { memory: Pick<FeedbackMemoryStore, "practiceMemberships" | "practiceCatalog" | "savePracticeAssignments" | "practicesWithoutTheme" | "practiceThemeCatalog" | "savePracticeThemes">; call: (request: EngineModelRequest) => Promise<EngineModelResponse>; now: () => Date }
export type AssessedObligation = { lineKey: string; sources?: readonly { lineKey: string }[]; text: string; heading: string | null; documentId: string }

export async function organizePracticesOfAnalysis(deps: Deps, organizationId: string, context: Pick<ProcedureContext, "documents" | "lines">, criteria: readonly AssessedObligation[]): Promise<PracticeOrganization> {
  const lines = await resolvePractices(deps, organizationId, practiceLinesOf(context, anchorLineKeysOf(criteria)))
  const documents = new Map(context.documents.map((document) => [document.documentId, document]))
  const sourceOf = (documentId: string): Pick<PracticeLine, "sourceKind" | "sourceId" | "sourceVersion" | "sourceTitle"> | null => {
    const document = documents.get(documentId)
    return document ? { sourceKind: document.kind === "ARGUMENT_SCRIPT" ? "ARGUMENT_SCRIPT" : "KNOWLEDGE", sourceId: document.documentId, sourceVersion: document.version, sourceTitle: document.title } : null
  }
  const obligations = criteria.map((criterion) => ({ lineKey: criterion.lineKey, lineKeys: [...new Set([criterion.lineKey.split("#")[0]!, ...(criterion.sources ?? []).map((source) => source.lineKey)])], text: criterion.text, heading: criterion.heading, source: sourceOf(criterion.documentId) }))
  const keys = [...new Set(obligations.flatMap((obligation) => [...obligation.lineKeys, obligation.lineKey]))]
  const decided = await deps.memory.practiceMemberships(organizationId, keys)
  const combinedLines = combinedObligationLinesOf(obligations, decided)
  const combined = combinedLines.length > 0 ? await resolvePractices(deps, organizationId, combinedLines) : null
  const after = combined ? await deps.memory.practiceMemberships(organizationId, keys) : decided
  const practiceKeys = [...new Set([...after.values()].flatMap((entry) => (entry.practiceKey ? [entry.practiceKey] : [])))]
  const themes = practiceKeys.length > 0 ? await resolvePracticeThemes(deps, organizationId, practiceKeys) : null
  return { lines, combined, themes }
}
