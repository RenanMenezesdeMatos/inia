import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import {
  PRACTICE_THEMES_PROMPT_VERSION,
  PRACTICE_THEMES_SYSTEM_PROMPT,
  PRACTICE_THEMES_VERSION,
  PRACTICES_PER_THEME_REQUEST,
  parsePracticeThemes,
  practiceThemesSchemaFor,
  renderPracticeThemesTurn,
} from "../domain/practice-themes.js"
import { EngineBudgetExhaustedError } from "./engine-meter.js"
import type { EngineModelRequest, EngineModelResponse, FeedbackMemoryStore } from "./ports.js"

/**
 * AGRUPAR AS PRÁTICAS EM TEMAS (`PRACTICE_THEMES_V1`) — só as práticas que ainda não têm tema (uma vez por prática). Lotes de até
 * `PRACTICES_PER_THEME_REQUEST`; cada lote vê os temas que os anteriores criaram. Nunca derruba quem chamou: sem orçamento, falha do
 * provedor ou resposta fora do contrato, as práticas ficam sem tema (a tela as mostra à parte) e voltam na próxima vez.
 */
export type PracticeThemeResolution = {
  version: typeof PRACTICE_THEMES_VERSION
  status: "UP_TO_DATE" | "ORGANIZED" | "PARTIAL" | "SKIPPED"
  pending: number
  themed: number
  newThemes: number
  unassigned: number
  requests: number
  stopReason: "BUDGET" | "CONTRACT" | "PROVIDER" | "STORE" | null
  failure?: { error: string; finishReason: string | null; outputTokens: number | null; responseChars: number | null }
}

export async function resolvePracticeThemes(
  deps: { memory: Pick<FeedbackMemoryStore, "practicesWithoutTheme" | "practiceThemeCatalog" | "savePracticeThemes">; call: (request: EngineModelRequest) => Promise<EngineModelResponse>; now: () => Date; onResponse?: (request: EngineModelRequest, response: EngineModelResponse) => void },
  organizationId: string,
  /** Só estas práticas (as desta análise); null = todas as que estão sem tema (carga). */
  practiceKeys: readonly string[] | null,
): Promise<PracticeThemeResolution> {
  const pending = practiceKeys !== null && practiceKeys.length === 0 ? [] : await deps.memory.practicesWithoutTheme(organizationId, practiceKeys)
  const resolution: PracticeThemeResolution = { version: PRACTICE_THEMES_VERSION, status: "UP_TO_DATE", pending: pending.length, themed: 0, newThemes: 0, unassigned: 0, requests: 0, stopReason: null }
  if (pending.length === 0) return resolution
  let catalog = await deps.memory.practiceThemeCatalog(organizationId)
  for (let start = 0; start < pending.length; start += PRACTICES_PER_THEME_REQUEST) {
    const batch = pending.slice(start, start + PRACTICES_PER_THEME_REQUEST)
    const request: EngineModelRequest = {
      stage: "PRACTICE_THEMES",
      systemPrompt: PRACTICE_THEMES_SYSTEM_PROMPT,
      contents: [{ role: "user", text: renderPracticeThemesTurn(catalog, batch) }],
      responseSchema: practiceThemesSchemaFor(catalog.length, batch.length),
      tag: `theme:${PRACTICE_THEMES_PROMPT_VERSION}`,
    }
    let response: EngineModelResponse
    try {
      resolution.requests += 1
      response = await deps.call(request)
    } catch (error) {
      resolution.stopReason = error instanceof EngineBudgetExhaustedError ? "BUDGET" : error instanceof ModelOutputContractError ? "CONTRACT" : "PROVIDER"
      resolution.failure = { error: error instanceof Error ? error.message.slice(0, 200) : "erro", finishReason: null, outputTokens: null, responseChars: null }
      break
    }
    deps.onResponse?.(request, response)
    const parsed = parsePracticeThemes(response.text, catalog, batch)
    if (!parsed.ok) {
      resolution.stopReason = "CONTRACT"
      resolution.failure = { error: parsed.error, finishReason: response.finishReason, outputTokens: response.usage?.outputTokens ?? null, responseChars: response.text.length }
      break
    }
    try {
      const saved = await deps.memory.savePracticeThemes(organizationId, parsed.result, { themeVersion: PRACTICE_THEMES_VERSION, model: response.model }, deps.now())
      resolution.themed += saved.practices
      resolution.newThemes += saved.themes
      resolution.unassigned += parsed.result.unassigned.length
    } catch {
      resolution.stopReason = "STORE"
      break
    }
    // O próximo lote vê o que ficou REGISTRADO (inclusive o que outra execução agrupou ao mesmo tempo).
    catalog = await deps.memory.practiceThemeCatalog(organizationId)
  }
  resolution.status = resolution.themed === 0 && resolution.stopReason ? "SKIPPED" : resolution.stopReason || resolution.unassigned > 0 ? "PARTIAL" : "ORGANIZED"
  return resolution
}
