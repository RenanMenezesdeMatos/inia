import { FAKE_MODELS, startFakeOpenAiServer } from "../../src/modules/ai-management/testing/fake-openai-compatible-server.js"

/**
 * Provider de IA FALSO para QA manual no navegador (Administração › IA / Modelos): servidor
 * compatível com OpenAI em http://127.0.0.1:<porta>/v1 — nenhuma API real/paga é chamada.
 *
 *   npx tsx scripts/dev/fake-ai-provider.ts                 # porta 4599, sem credencial
 *   FAKE_AI_KEY=sk-qa-123456789012 npx tsx scripts/dev/fake-ai-provider.ts   # exige Bearer
 *
 * O backend da INIA precisa alcançar este endereço (mesma máquina) — é o mesmo cenário de um
 * modelo local (LM Studio/Ollama) servido junto do backend.
 */
const port = Number(process.env.FAKE_AI_PORT ?? 4599)
const server = await startFakeOpenAiServer({ port, apiKey: process.env.FAKE_AI_KEY ?? null })
process.stdout.write(`Provider falso em ${server.url} — modelos: ${FAKE_MODELS.join(", ")}\n`)
const shutdown = () => void server.close().then(() => process.exit(0))
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
