import { sectionOf, sectionsOf, type CatalogSource } from "./knowledge-catalog.js"

/**
 * BUSCA NAS BASES EM ESCALA (camada 3): dos candidatos às seções que já chegam lidas ao esclarecimento — a IA decide sobre elas e ainda
 * pode ler outras. Desenho e medição vêm do piloto de 06/11/2026 (V3). Só usa a estrutura dos documentos:
 * nenhuma palavra da pergunta entra aqui.
 *   - Limite por base: o ranking de uma pergunta com dois assuntos não pode ficar só com o assunto dominante.
 *   - Base pequena inteira: a condição que completa a resposta costuma estar noutra seção, sem as palavras da pergunta (ex.: "11. Prazo").
 *   - Sempre seção inteira, nunca pela metade, e sempre dentro do teto de caracteres.
 */
export type SectionPrefillPolicy = { maxSections: number; maxPerDocument: number; smallBaseChars: number; maxChars: number; /** Só as primeiras bases do ranking podem entrar inteiras. Ausente = todas. */ smallBaseTopDocuments?: number; /** Só base com ao menos N seções no ranking entra inteira. Ausente = 1. */ smallBaseMinRanked?: number }

/**
 * Políticas medidas no piloto (`docs/dev/piloto-busca-kb/relatorio.md`). `smallBaseChars` é o mesmo limite usado no diagnóstico de 04/11/2026 para "base pequena".
 *   - V1: toda base pequena tocada entra inteira. Levou 36 seções a uma decisão (32 s e pergunta de volta).
 *   - V2: só a primeira base do ranking. Corrige o caso acima, mas deixou de avisar uma divergência entre bases nas 2 amostras.
 *   - V3: só base com ao menos 2 seções no ranking. Cumpriu os critérios de qualidade nas 16 perguntas e nos 14 funis do piloto (empate com o
 *     fluxo de então); é a política da busca em escala (ligada em 16/11/2026 por decisão do responsável).
 */
const BASE_POLICY = { maxSections: 8, maxPerDocument: 3, smallBaseChars: 8_000, maxChars: 14_000 } as const
export const SECTION_PREFILL_POLICIES = { v1: BASE_POLICY, v2: { ...BASE_POLICY, smallBaseTopDocuments: 1 }, v3: { ...BASE_POLICY, smallBaseMinRanked: 2 } } as const satisfies Record<string, SectionPrefillPolicy>
export type SectionPrefillPolicyName = keyof typeof SECTION_PREFILL_POLICIES
export const DEFAULT_SECTION_PREFILL_POLICY: SectionPrefillPolicy = SECTION_PREFILL_POLICIES.v3

export type PrefillHit = { documentId: string; chunkIndex: number }
export type PlannedSection = PrefillHit & { reason: "RANKED" | "SMALL_BASE"; chars: number }

export function planSectionPrefill(hits: readonly PrefillHit[], sources: ReadonlyMap<string, CatalogSource>, policy: SectionPrefillPolicy = DEFAULT_SECTION_PREFILL_POLICY): PlannedSection[] {
  const planned = new Map<string, PlannedSection>()
  let chars = 0
  const add = (documentId: string, chunkIndex: number, reason: PlannedSection["reason"]): boolean => {
    const source = sources.get(documentId)
    const section = source ? sectionOf(source, chunkIndex) : null
    if (!section) return false
    const start = section.chunkIndexes[0] ?? chunkIndex
    const key = `${documentId}#${start}`
    if (planned.has(key)) return false
    if (chars + section.text.length > policy.maxChars) return false
    planned.set(key, { documentId, chunkIndex: start, reason, chars: section.text.length })
    chars += section.text.length
    return true
  }

  // 1ª passada respeita o limite por base; o que sobrar de vaga volta para quem ficou de fora, na ordem do ranking.
  const perDocument = new Map<string, number>()
  const deferred: PrefillHit[] = []
  let ranked = 0
  for (const hit of hits) {
    if (ranked >= policy.maxSections) break
    if ((perDocument.get(hit.documentId) ?? 0) >= policy.maxPerDocument) {
      deferred.push(hit)
      continue
    }
    if (add(hit.documentId, hit.chunkIndex, "RANKED")) {
      ranked += 1
      perDocument.set(hit.documentId, (perDocument.get(hit.documentId) ?? 0) + 1)
    }
  }
  for (const hit of deferred) {
    if (ranked >= policy.maxSections) break
    if (add(hit.documentId, hit.chunkIndex, "RANKED")) ranked += 1
  }

  // As primeiras bases do ranking, se pequenas, entram inteiras, enquanto couberem.
  const touched = [...new Set([...planned.values()].map((section) => section.documentId))]
  const rankedCount = (documentId: string) => [...planned.values()].filter((section) => section.documentId === documentId && section.reason === "RANKED").length
  for (const documentId of touched.slice(0, policy.smallBaseTopDocuments ?? touched.length)) {
    const source = sources.get(documentId)
    if (!source || rankedCount(documentId) < (policy.smallBaseMinRanked ?? 1)) continue
    const size = source.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
    if (size > policy.smallBaseChars) continue
    for (const section of sectionsOf(source)) add(documentId, section.chunkIndex, "SMALL_BASE")
  }
  return [...planned.values()]
}
