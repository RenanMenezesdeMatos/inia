/**
 * Trava final dos trechos exibidos na base: depois da máscara (nomes de operador, CPF, telefone, e-mail, protocolo), sobrou uma
 * sequência de 8+ dígitos fora de data/hora? Então o trecho NÃO é exibido (fail-closed). Mesma régua da evidência exibível do
 * feedback; implementada aqui porque o compositor do feedback é isolado por regra (só o pipeline de feedback o importa).
 */
export const EXCERPT_MAX_DIGITS = 8

const NUMERIC_RUN = /\d(?:[\d.\-/ ]*\d)?/g
const DATE_OR_TIME = /(?<!\d)(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}h\d{0,2})(?!\d)/g

export function hasUnmaskedLongNumber(text: string): boolean {
  const withoutDates = text.replace(DATE_OR_TIME, " ")
  return (withoutDates.match(NUMERIC_RUN) ?? []).some((run) => run.replace(/\D/g, "").length >= EXCERPT_MAX_DIGITS)
}
