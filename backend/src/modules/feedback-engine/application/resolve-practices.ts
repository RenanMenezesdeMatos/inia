import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import {
  PRACTICE_IDENTITY_PROMPT_VERSION,
  PRACTICE_IDENTITY_SYSTEM_PROMPT,
  PRACTICE_IDENTITY_VERSION,
  PRACTICE_LINES_PER_REQUEST,
  parsePracticeIdentity,
  practiceIdentitySchemaFor,
  renderPracticeIdentityTurn,
  type PracticeLine,
} from "../domain/practice-identity.js"
import { EngineBudgetExhaustedError } from "./engine-meter.js"
import type { EngineModelRequest, EngineModelResponse, FeedbackMemoryStore } from "./ports.js"

/**
 * ORGANIZAR AS REGRAS EM PRÁTICAS (`PRACTICE_IDENTITY_V1`) — só as linhas que ainda não têm decisão (uma vez por linha: texto igual
 * em outra versão do documento mantém a chave e a decisão). Lotes de até `PRACTICE_LINES_PER_REQUEST` regras; cada lote vê as
 * práticas que os anteriores criaram. Nunca derruba quem chamou: sem orçamento, falha do provedor ou resposta fora do contrato, as
 * linhas ficam como estão (as consultas usam a identidade da própria linha) e voltam na próxima vez.
 */
export type PracticeResolution = {
  version: typeof PRACTICE_IDENTITY_VERSION
  status: "UP_TO_DATE" | "ORGANIZED" | "PARTIAL" | "SKIPPED"
  lines: number
  pending: number
  organized: number
  newPractices: number
  unassigned: number
  requests: number
  stopReason: "BUDGET" | "CONTRACT" | "PROVIDER" | "STORE" | null
  /** Por que parou (diagnóstico — nunca o texto da resposta): término informado pelo provedor, tamanho e erro de leitura. */
  failure?: { error: string; finishReason: string | null; outputTokens: number | null; responseChars: number | null }
}

export async function resolvePractices(
  deps: { memory: Pick<FeedbackMemoryStore, "practiceMemberships" | "practiceCatalog" | "savePracticeAssignments">; call: (request: EngineModelRequest) => Promise<EngineModelResponse>; now: () => Date; onResponse?: (request: EngineModelRequest, response: EngineModelResponse) => void },
  organizationId: string,
  lines: readonly PracticeLine[],
): Promise<PracticeResolution> {
  const unique = [...new Map(lines.map((line) => [line.lineKey, line])).values()]
  const known = await deps.memory.practiceMemberships(organizationId, unique.map((line) => line.lineKey))
  const pending = unique.filter((line) => !known.has(line.lineKey))
  const resolution: PracticeResolution = { version: PRACTICE_IDENTITY_VERSION, status: "UP_TO_DATE", lines: unique.length, pending: pending.length, organized: 0, newPractices: 0, unassigned: 0, requests: 0, stopReason: null }
  if (pending.length === 0) return resolution
  let catalog = await deps.memory.practiceCatalog(organizationId)
  for (let start = 0; start < pending.length; start += PRACTICE_LINES_PER_REQUEST) {
    const batch = pending.slice(start, start + PRACTICE_LINES_PER_REQUEST)
    const request: EngineModelRequest = {
      stage: "PRACTICE_IDENTITY",
      systemPrompt: PRACTICE_IDENTITY_SYSTEM_PROMPT,
      contents: [{ role: "user", text: renderPracticeIdentityTurn(catalog, batch) }],
      responseSchema: practiceIdentitySchemaFor(catalog.length, batch.length),
      tag: `practice:${PRACTICE_IDENTITY_PROMPT_VERSION}`,
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
    const parsed = parsePracticeIdentity(response.text, catalog, batch)
    if (!parsed.ok) {
      resolution.stopReason = "CONTRACT"
      resolution.failure = { error: parsed.error, finishReason: response.finishReason, outputTokens: response.usage?.outputTokens ?? null, responseChars: response.text.length }
      break
    }
    try {
      const saved = await deps.memory.savePracticeAssignments(organizationId, parsed.result, { identityVersion: PRACTICE_IDENTITY_VERSION, model: response.model }, deps.now())
      resolution.organized += saved.members
      resolution.newPractices += saved.practices
      resolution.unassigned += parsed.result.unassigned.length
    } catch {
      resolution.stopReason = "STORE"
      break
    }
    // O próximo lote vê o que ficou REGISTRADO (inclusive o que outra execução organizou ao mesmo tempo).
    catalog = await deps.memory.practiceCatalog(organizationId)
  }
  resolution.status = resolution.organized === 0 && resolution.stopReason ? "SKIPPED" : resolution.stopReason || resolution.unassigned > 0 ? "PARTIAL" : "ORGANIZED"
  return resolution
}
