/**
 * CHECAGEM SEM IA da busca na base do especialista na conversa (ASKER_QUESTION_RETRIEVAL_V1): para cada par (pergunta que o
 * roteamento escreveu, pergunta da pessoa), mostra o que a busca traz só com a do roteamento (como era) e com o complemento pela
 * da pessoa (como é na conversa), e confere uma seção esperada. Só lê; nenhuma chamada de IA.
 *
 *   DATABASE_URL=…/inia_chatbench npx tsx scripts/dev/check-asker-question-retrieval.ts [--agent <id>] [--expect "<início do título da seção>"]
 *
 * Padrão: o "Agente de Processos" do `inia_chatbench` e as reescritas vistas em 22/10/2026 para "Como faço para registrar a
 * contestação da fatura de um cliente?" (achado: "…Passo a passo e procedimentos." tirava a § 31 da busca).
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { retrieveKnowledgeForAgent, type KnowledgeRetrievalResult } from "../../src/modules/knowledge/application/retrieve-knowledge.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const agentId = option("agent") ?? "408046f1-1318-4c45-8824-c9a9883568f1"
const expected = option("expect") ?? "31. Informações obrigatórias na contestação"
const PERSON = "Como faço para registrar a contestação da fatura de um cliente?"
const PAIRS: { routing: string; person: string }[] = [
  { routing: PERSON, person: PERSON },
  { routing: "Como registrar a contestação da fatura de um cliente?", person: PERSON },
  { routing: "Como registrar a contestação da fatura de um cliente? Passo a passo e procedimentos.", person: PERSON },
  { routing: "Como registrar a contestação de fatura de um cliente? Passo a passo e procedimentos.", person: PERSON },
  { routing: "Como registrar a contestação da fatura de um cliente? Passo a passo, regras e procedimentos operacionais.", person: PERSON },
]
const db = pool as unknown as Database

const has = (result: KnowledgeRetrievalResult) => result.trace.retrieved.some((excerpt) => excerpt.heading.startsWith(expected))
const summary = (result: KnowledgeRetrievalResult) => `${result.trace.retrieved.length} trechos, ${result.trace.injectedChars} caracteres`

let missing = 0
try {
  for (const pair of PAIRS) {
    const before = await retrieveKnowledgeForAgent(db, agentId, pair.routing)
    const after = await retrieveKnowledgeForAgent(db, agentId, pair.routing, undefined, null, { askerQuestion: pair.person })
    if (!has(after)) missing += 1
    console.log(`\nRoteamento: ${pair.routing}\nPessoa:     ${pair.person}`)
    console.log(`  só roteamento: ${has(before) ? "✓" : "✗"} "${expected}" · ${summary(before)}`)
    console.log(`  com a pessoa:  ${has(after) ? "✓" : "✗"} "${expected}" · ${summary(after)} · acrescentou: ${after.trace.askerQuestion?.added.map((entry) => entry.heading).join(" | ") || "nada"}`)
  }
} finally {
  await pool.end()
}
console.log(missing === 0 ? `\nOK: "${expected}" está na busca da conversa em todas as versões.` : `\nFALHA: "${expected}" ficou fora em ${missing} versão(ões).`)
process.exitCode = missing === 0 ? 0 : 1
