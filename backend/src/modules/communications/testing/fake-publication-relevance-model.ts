import type { PublicationRelevanceModel } from "../application/publication-relevance-model.js"
import { PUBLICATION_RELEVANCE_VERSION } from "../domain/publication-relevance.js"

/**
 * Modelo de relevância FALSO para provas e testes (nunca chama IA): escolhe os comunicados/alinhamentos do catálogo cujo título contém
 * `titleIncludes` quando a pergunta contém `whenQuestionIncludes`; senão, nada. Serve para provar visibilidade e encaminhamento — a
 * qualidade da decisão de verdade é medida na bateria paga.
 */
export function fakePublicationRelevanceModel(rules: readonly { whenQuestionIncludes: string; titleIncludes: string }[]): PublicationRelevanceModel & { calls: string[] } {
  const calls: string[] = []
  const model = (async ({ user }) => {
    calls.push(user)
    const question = /PERGUNTA[^:]*: «([^»]*)»/.exec(user)?.[1]?.toLowerCase() ?? ""
    const picked = { communications: [] as string[], alignments: [] as string[] }
    for (const line of user.split("\n")) {
      const match = /^([CA])(\d+) · .*?título «([^»]*)»/.exec(line)
      if (!match) continue
      const title = match[3]!.toLowerCase()
      if (rules.some((rule) => question.includes(rule.whenQuestionIncludes.toLowerCase()) && title.includes(rule.titleIncludes.toLowerCase()))) (match[1] === "C" ? picked.communications : picked.alignments).push(`${match[1]}${match[2]}`)
    }
    return JSON.stringify({ contract: PUBLICATION_RELEVANCE_VERSION, ...picked })
  }) as PublicationRelevanceModel & { calls: string[] }
  model.calls = calls
  return model
}
