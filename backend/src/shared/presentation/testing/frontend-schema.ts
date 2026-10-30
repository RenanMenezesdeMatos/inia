/**
 * CONTRATO FRONTEND × BACKEND nas provas: carrega o schema zod que a TELA usa para ler uma resposta — do código-fonte do
 * frontend, pelo caminho, sem cópia (mesmo mecanismo da paridade da validação de Workflow) — para a prova validar a resposta
 * REAL da rota com ele. Um campo que o backend deixa de mandar, ou manda com outro tipo, quebra a prova em vez da tela.
 * O alias `@/` que os schemas do frontend usam está no `vitest.config.ts` do backend.
 */
export type FrontendSchema = { parse: (value: unknown) => unknown }

export async function frontendSchema(pathInFrontendSrc: string, exportName: string): Promise<FrontendSchema> {
  const url = new URL(`../../../../../frontend/src/${pathInFrontendSrc}`, import.meta.url)
  const module = (await import(url.href)) as Record<string, unknown>
  const schema = module[exportName] as FrontendSchema | undefined
  if (typeof schema?.parse !== "function") throw new Error(`Schema "${exportName}" não encontrado em frontend/src/${pathInFrontendSrc}.`)
  return schema
}
