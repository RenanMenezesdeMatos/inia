// Substituto do adapter de modelo do motor de feedback no teste de carga: o adapter REAL roda (gateway, limitador de vagas,
// registro de uso e custo) e a IA falsa (fake-ai.mjs) responde ao fetch com o conteúdo do modelo falso dos testes.
import { AsyncLocalStorage } from "node:async_hooks"

const params = new URL(import.meta.url).searchParams
const real = await import(params.get("real"))
const { fakeEngineModel } = await import(params.get("fake"))
const engineContext = (globalThis.__iniaLoadtestEngine ??= new AsyncLocalStorage())

export const ENGINE_MODEL = real.ENGINE_MODEL

export function createGatewayEngineModel(deps) {
  const inner = real.createGatewayEngineModel(deps)
  return {
    generate(request) {
      // Um modelo falso por chamada: o estado dele (rótulos da análise para a revisão) é só da execução que está pedindo.
      const fake = fakeEngineModel()
      return engineContext.run({ request, fake: fake.model, reset: () => (fake.calls.length = 0) }, () => inner.generate(request))
    },
  }
}
