/**
 * PARA ONDE A INIA APONTA QUANDO AS BASES NÃO SUSTENTAM A RESPOSTA (`HELP_ROUTE_V1`, 19/11/2026 — ver
 * `docs/dev/apoio-ou-lideranca.md`). Vale só para os textos FIXOS do esclarecimento (decisão INSUFFICIENT), nunca para prompt:
 *  - `SUPPORT`: o Apoio (o Anjo, que o operador vê como "Apoio") está ligado para a pessoa e há alguém EM SERVIÇO agora no escopo
 *    dela — a mesma condição que permite pedir ajuda (sem ninguém em serviço o pedido é recusado). A sugestão "Falar com o Apoio"
 *    aparece abaixo desta resposta, porque ela grava o sinal `KNOWLEDGE_INSUFFICIENT`.
 *  - `LEADERSHIP`: todo o resto (apoio desligado, ninguém em serviço, leitura falhou, liderança, sessão de feedback): o texto de antes.
 * Quem decide a rota é o módulo do apoio (injetado no `realtime-router` pelo `createApp`); este módulo só conhece as duas palavras.
 */
export const HELP_ROUTE_VERSION = "HELP_ROUTE_V1" as const

export const HELP_ROUTES = ["SUPPORT", "LEADERSHIP"] as const
export type HelpRoute = (typeof HELP_ROUTES)[number]

/** Última frase da resposta "insuficiente". `reformulate`: a pessoa também pode reformular a pergunta. */
export function insufficientHelpSentence(route: HelpRoute, options: { reformulate: boolean }): string {
  const where = route === "SUPPORT" ? "fale com o Apoio" : "procure a sua liderança imediata"
  return options.reformulate ? `Se a dúvida continuar, reformule a pergunta ou ${where}.` : `Se a dúvida continuar, ${where}.`
}
