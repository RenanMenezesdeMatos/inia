/**
 * COMPARAÇÃO SEM IA, NO HISTÓRICO REAL: para cada chamada de especialista gravada no chat (pergunta escrita pelo roteamento +
 * a pergunta da pessoa que a originou), o que a busca na base traria antes (só a do roteamento) e agora (complemento pela da pessoa).
 * Conta os casos em que o contexto do especialista NÃO muda (resposta igual por construção) e mostra os que mudam. Também simula
 * perguntas com DOIS assuntos, uma chamada por especialista, para ver o que cada um passa a receber. Só lê; nenhuma chamada de IA.
 *
 *   DATABASE_URL=…/inia_chatbench npx tsx scripts/dev/compare-asker-retrieval-history.ts
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { retrieveKnowledgeForAgent } from "../../src/modules/knowledge/application/retrieve-knowledge.js"

const db = pool as unknown as Database
const agentOf = (toolName: string) => {
  const hex = /^agent_([0-9a-f]{32})$/.exec(toolName)?.[1]
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null
}
const keyOf = (excerpt: { documentId: string; chunkIndex?: number | undefined }) => `${excerpt.documentId}#${excerpt.chunkIndex}`

type Pair = { agentId: string; routing: string; person: string }

async function historyPairs(): Promise<Pair[]> {
  const rows = await db.query<{ tool_calls: { toolName?: string; query?: string; toolTrace?: unknown }[]; person: string }>(
    `select a.tool_calls, u.content person
       from assistant_interactions a
       join lateral (select content from assistant_interactions u where u.conversation_id = a.conversation_id and u.role = 'user'
                       and (u.occurred_at, u.seq) < (a.occurred_at, a.seq) order by u.occurred_at desc, u.seq desc limit 1) u on true
      where a.role = 'assistant' and a.tool_calls is not null`,
  )
  const pairs: Pair[] = []
  for (const row of rows.rows) {
    for (const call of row.tool_calls ?? []) {
      const agentId = call.toolName ? agentOf(call.toolName) : null
      if (agentId && call.query && "toolTrace" in call) pairs.push({ agentId, routing: call.query, person: row.person })
    }
  }
  return pairs
}

async function compare(pair: Pair) {
  const before = await retrieveKnowledgeForAgent(db, pair.agentId, pair.routing)
  const after = await retrieveKnowledgeForAgent(db, pair.agentId, pair.routing, undefined, null, { askerQuestion: pair.person })
  const beforeKeys = new Set(before.trace.retrieved.map(keyOf))
  const afterKeys = new Set(after.trace.retrieved.map(keyOf))
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key))
  const added = after.trace.retrieved.filter((excerpt) => !beforeKeys.has(keyOf(excerpt)))
  return { before, after, removed, added }
}

try {
  const pairs = await historyPairs()
  let same = 0
  let onlyAdded = 0
  let lostSomething = 0
  const changed: string[] = []
  for (const pair of pairs) {
    const result = await compare(pair)
    if (result.added.length === 0 && result.removed.length === 0) same += 1
    else if (result.removed.length === 0) onlyAdded += 1
    else lostSomething += 1
    if (result.added.length > 0 || result.removed.length > 0) {
      changed.push(`- pessoa: "${pair.person.slice(0, 90)}"\n  roteamento: "${pair.routing.slice(0, 90)}"\n  ${result.before.trace.retrieved.length} → ${result.after.trace.retrieved.length} trechos (${result.before.trace.injectedChars} → ${result.after.trace.injectedChars} caracteres); acrescentou: ${result.added.map((excerpt) => excerpt.heading).join(" | ") || "—"}; tirou: ${result.removed.length}`)
    }
  }
  console.log(`HISTÓRICO: ${pairs.length} chamadas de especialista · contexto igual ${same} · só acrescentou ${onlyAdded} · tirou algo ${lostSomething}\n`)
  console.log(changed.join("\n"))

  // Perguntas com DOIS assuntos: cada especialista recebe do roteamento só o seu assunto, e a pessoa perguntou os dois.
  const processos = "408046f1-1318-4c45-8824-c9a9883568f1"
  const specialists = (await db.query<{ id: string; name: string }>(`select a.id, a.name from assistant_orchestrator_specialists s join agents a on a.id = s.agent_id join assistant_orchestrators o on o.id = s.orchestrator_id where o.name = 'ORQUESTRADOR'`)).rows
  console.log(`\nDOIS ASSUNTOS (especialistas do ORQUESTRADOR: ${specialists.map((s) => s.name).join(", ")})`)
  const rh = specialists.find((s) => /RH/i.test(s.name))?.id ?? null
  const cases: { person: string; calls: { agentId: string; routing: string }[] }[] = [
    { person: "Como faço para registrar a contestação da fatura de um cliente e quantos dias de férias eu tenho direito?", calls: [{ agentId: processos, routing: "Como registrar a contestação da fatura de um cliente?" }, ...(rh ? [{ agentId: rh, routing: "Quantos dias de férias o colaborador tem direito?" }] : [])] },
    { person: "O cliente pediu segunda via da conta e também quer abrir um reparo técnico, o que eu faço?", calls: [{ agentId: processos, routing: "Como emitir a segunda via da conta para o cliente?" }, { agentId: processos, routing: "Como abrir um reparo técnico para o cliente?" }] },
  ]
  for (const item of cases) {
    console.log(`\nPessoa: "${item.person}"`)
    for (const call of item.calls) {
      const result = await compare({ agentId: call.agentId, routing: call.routing, person: item.person })
      const name = specialists.find((s) => s.id === call.agentId)?.name ?? call.agentId
      console.log(`  ${name} ← "${call.routing}": ${result.before.trace.retrieved.length} → ${result.after.trace.retrieved.length} trechos; acrescentou: ${result.added.map((excerpt) => `${excerpt.documentTitle} › ${excerpt.heading}`).join(" | ") || "—"}; tirou: ${result.removed.length}`)
    }
  }
} finally {
  await pool.end()
}
