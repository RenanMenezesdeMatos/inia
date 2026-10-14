// Gancho de resolução de módulos do teste de carga (registrado por fake-ai.mjs): o adapter do motor de feedback
// (`feedback-engine/infrastructure/gateway-engine-model.js`) é trocado por `fake-engine-gateway.mjs`, que usa o adapter REAL
// por dentro e só marca o contexto da chamada para a IA falsa responder pelo modelo falso dos testes.
const TARGET = /\/feedback-engine\/infrastructure\/gateway-engine-model\.js$/

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context)
  if (!TARGET.test(resolved.url) || context.parentURL?.includes("fake-engine-gateway.mjs")) return resolved
  const wrapper = new URL("./fake-engine-gateway.mjs", import.meta.url)
  wrapper.searchParams.set("real", resolved.url)
  wrapper.searchParams.set("fake", resolved.url.replace("/infrastructure/gateway-engine-model.js", "/testing/fake-engine-model.js"))
  return { url: wrapper.href, shortCircuit: true }
}
