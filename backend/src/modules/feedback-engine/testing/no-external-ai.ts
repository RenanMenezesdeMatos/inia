import { afterAll, beforeAll, expect } from "vitest"

/**
 * GUARDA DOS TESTES DO MOTOR: nenhuma chamada externa de IA — nem direta, nem indireta (ferramenta, retry, reparo). Importar este
 * módulo num arquivo de teste troca `fetch` por um bloqueio para os provedores de IA conhecidos e, ao final, falha o arquivo se
 * alguma tentativa tiver acontecido. Os testes usam o modelo FALSO; isto garante que nenhum caminho escapou dele.
 */
const AI_HOSTS = /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.x\.ai|localhost:11434/i
export const externalAiAttempts: string[] = []
let original: typeof fetch | undefined

beforeAll(() => {
  original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (AI_HOSTS.test(url)) {
      externalAiAttempts.push(url)
      throw new Error(`Chamada externa de IA bloqueada nos testes do motor: ${url}`)
    }
    return original!(input, init)
  }) as typeof fetch
})

afterAll(() => {
  if (original) globalThis.fetch = original
  expect(externalAiAttempts).toEqual([])
})
