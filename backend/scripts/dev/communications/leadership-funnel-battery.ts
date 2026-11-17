/**
 * TESTE PAGO — "Reparo" de um GERENTE SÊNIOR com Grupos em Orquestradores diferentes (17/11/2026, teto US$ 0,15).
 *
 *   npx tsx scripts/dev/communications/leadership-funnel-battery.ts [--teto 0.15]
 *
 * Custo medido em 17/11: um turno da liderança ≈ US$ 0,14 (7 chamadas: o modelo da liderança decide em várias rodadas).
 * A ROTA REAL do chat (`createRealtimeRouter`, POST /messages) com o modelo, as bases e a sessão de liderança REAIS do gerente
 * (`--pessoa`/`--conta`, padrão Ricardo Henriques, Gerente Sênior B2C, 4 Grupos). Só duas coisas ficam em memória:
 *   - a conversa (nada gravado no banco);
 *   - no cenário MULTI, a lista de Orquestradores do chat: dois Grupos dele ganham Orquestradores REAIS diferentes (no dev todos caem no
 *     de "Todos os grupos", então o caso não existe sem mudar a configuração). Cada Orquestrador continua resolvido pelo id, de verdade.
 * Cenários: MESMO (configuração real: um Orquestrador para todos) → "Reparo" vai direto ao funil; MULTI → "Reparo" pergunta o Grupo
 * (texto do sistema, nada consultado) e "Reparo no B2C · Suporte Técnico" abre o funil nas bases daquele Grupo.
 */
import express from "express"
import request from "supertest"
import "../../../src/config/env.js"
import { pool } from "../../../src/infrastructure/database/pool.js"
import { listInteractiveOrchestratorScopes, type InteractiveOrchestratorScope } from "../../../src/modules/assistant/application/resolve-orchestrator.js"
import { createMemoryConversationStore } from "../../../src/modules/assistant/testing/memory-conversation-store.js"
import type { AuthTokenPayload } from "../../../src/modules/auth/infrastructure/jwt.js"
import { streamTextReply } from "../../../src/modules/realtime/infrastructure/gemini-text-client.js"
import { createRealtimeRouter } from "../../../src/modules/realtime/presentation/realtime-router.js"
import { createChatStreamer } from "../../../src/shared/application/model-routing/llm-gateway.js"
import { createLlmTelemetryStore, runWithLlmTelemetry } from "../../../src/shared/application/llm-telemetry.js"
import { costTotal } from "../../../src/shared/application/model-routing/model-pricing.js"

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null)
const CAP_USD = Number(option("--teto") ?? 0.15)
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = option("--pessoa") ?? "de006028-5a7e-458b-850f-9cc8c5b1aeea"
const ACCOUNT = option("--conta") ?? "de00f355-8206-4c2c-8c56-27508f442675"
const SUPORTE = "de001384-7932-436c-80c7-ec9543d4cae9" // B2C · Suporte Técnico
const DIGITAL = "de00f339-c482-474c-8584-b9598b7c2fc8" // B2C · Digital
const INIA = "d027660b-fa7e-4790-aa1e-3cd85005c30f"
const PINDORAMA = "075b0df5-c014-4fe2-9305-ba43e269b3f7"

const telemetry = createLlmTelemetryStore({ policy: "REAL" })
const spent = () => telemetry.calls.reduce((sum, call) => sum + (costTotal(call.cost) ?? ((call.promptTokens ?? 0) * 2 + ((call.outputTokens ?? 0) + (call.reasoningTokens ?? 0)) * 12) / 1_000_000), 0)

const person = (await pool.query<{ name: string; job_title: string | null; team_id: string | null }>(`select name, job_title, team_id from people where id = $1`, [PERSON])).rows[0]!
const user: AuthTokenPayload = { sub: ACCOUNT, personId: PERSON, organizationId: ORG, role: "SENIOR_MANAGER", name: person.name, email: "gerente@inia.local", avatarUrl: null, jobTitle: person.job_title, teamId: person.team_id, teamName: null }

function app(multi: boolean) {
  const conversations = createMemoryConversationStore().store
  const processOrchestrators = async (organizationId: string, universes: readonly string[] | null = null): Promise<InteractiveOrchestratorScope[]> => {
    const real = await listInteractiveOrchestratorScopes(pool, organizationId, universes)
    if (!multi) return real
    const named = (id: string) => real.find((scope) => scope.id === id)?.name ?? id
    return [...real.filter((scope) => scope.id !== INIA && scope.id !== PINDORAMA), { id: INIA, name: named(INIA), scopeType: "TEAM", teamId: SUPORTE }, { id: PINDORAMA, name: named(PINDORAMA), scopeType: "TEAM", teamId: DIGITAL }] as InteractiveOrchestratorScope[]
  }
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    ;(req as unknown as { user: AuthTokenPayload }).user = user
    void runWithLlmTelemetry(telemetry, async () => next())
  })
  // Voz fora do teste; texto pelo streamer real; conversa e sugestão de apoio em memória (nada gravado).
  server.use(createRealtimeRouter(pool, async () => { throw new Error("voz fora do teste") }, createChatStreamer(streamTextReply), { conversations, processOrchestrators, recordSuggestion: async () => undefined } as never))
  return server
}

function events(text: string) {
  return text.split("\n\n").filter(Boolean).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : []
  })
}

async function ask(server: express.Express, label: string, text: string, conversationId: string | null): Promise<string | null> {
  if (spent() + 0.15 > CAP_USD) {
    console.log(`PAROU antes de ${label}: gasto US$ ${spent().toFixed(4)} + reserva US$ 0,15 > teto US$ ${CAP_USD}`)
    return conversationId
  }
  const response = await request(server).post("/messages").send({ conversationId, text, clientMessageId: `bateria-${label}-${Date.now()}` })
  const list = events(response.text)
  const final = list.filter((item) => item.event === "message" || item.event === "done" || item.event === "final")
  const chunks = list.filter((item) => item.event === "chunk").map((item) => String(item.data.text ?? "")).join("")
  const reply = (final.find((item) => typeof item.data.text === "string")?.data.text as string | undefined) ?? chunks
  const clarification = list.find((item) => item.data.clarification)?.data.clarification as { question?: string; options?: { label: string }[] } | undefined
  const conversation = (list.find((item) => typeof item.data.conversationId === "string")?.data.conversationId as string | undefined) ?? conversationId
  console.log(`\n[${label}] «${text}» (HTTP ${response.status})`)
  console.log(`  resposta: ${reply.replace(/\s+/g, " ").slice(0, 700) || "(sem texto)"}`)
  if (clarification) console.log(`  formulário: ${clarification.question ?? ""} → ${(clarification.options ?? []).map((option) => option.label).join(" · ")}`)
  const errors = list.filter((item) => item.event === "error")
  if (errors.length) console.log(`  ERRO: ${JSON.stringify(errors.map((item) => item.data))}`)
  console.log(`  eventos: ${[...new Set(list.map((item) => item.event))].join(", ")} · gasto acumulado US$ ${spent().toFixed(4)}`)
  return conversation
}

try {
  console.log(`Gerente: ${person.name} (${person.job_title}) · teto US$ ${CAP_USD}`)
  if (!args.includes("--so-multi")) await ask(app(false), "MESMO", "Reparo", null)
  const multi = app(true)
  await ask(multi, "MULTI-1", "Reparo", null)
  await ask(multi, "MULTI-2", "Reparo no B2C · Suporte Técnico", null)
} finally {
  console.log(`\n${telemetry.calls.length} chamadas de IA · gasto US$ ${spent().toFixed(4)}`)
  await pool.end()
}
