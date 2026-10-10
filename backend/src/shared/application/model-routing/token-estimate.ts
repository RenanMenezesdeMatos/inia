/** Estimativa grosseira de tokens (≈ 4 caracteres/token em pt-BR) — só para sinais de rota; o número oficial vem do provider. */
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4)
}
