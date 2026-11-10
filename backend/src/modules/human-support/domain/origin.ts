import type { RequestOrigin } from "./catalogs.js"

/**
 * ORIGEM DO PEDIDO (design_draft.md seção 7), decidida pelo servidor a partir dos fatos da cópia da troca (`buildSupportContext`):
 *  - sem `interactionId` = `BUTTON` (botão permanente "Falar com um Anjo");
 *  - descurtida da própria pessoa com "ainda preciso de ajuda" na versão informada = `DISLIKE` (vale sobre o sinal);
 *  - mensagem com sinal não vazio (resposta da INIA com sinal, ou pergunta com `NO_REPLY`) = `SIGNAL`;
 *  - nenhum deles (ou a mensagem não é da pessoa / do chat livre: `facts` nulo) = `null` → 404.
 */
export function requestOriginOf(input: { interactionId: string | null; facts: { dislikeNeedsHelp: boolean; signals: readonly string[] } | null }): RequestOrigin | null {
  if (!input.interactionId) return "BUTTON"
  if (!input.facts) return null
  if (input.facts.dislikeNeedsHelp) return "DISLIKE"
  if (input.facts.signals.length > 0) return "SIGNAL"
  return null
}
