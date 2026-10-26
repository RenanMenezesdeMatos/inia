// TURNOS DO CHAT, UM DE CADA VEZ — mede o que a pessoa vê numa API que já está no ar (IA real ou falsa), com as MESMAS perguntas
// para comparar versões. Cada pergunta numa conversa nova (o histórico não cresce entre as medições).
//
//   LT_API=http://127.0.0.1:3451 LT_LABEL=depois LT_REPEAT=1 node tools/loadtest/chat-turns.mjs
//
// Saída: tools/loadtest/out/turns-<rótulo>-<data>.json (tempos por pergunta, sem conteúdo) + resumo no terminal.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ChatSession, demoPassword, percentile } from "./chat-client.mjs"

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out")
mkdirSync(OUT, { recursive: true })
const cfg = {
  api: process.env.LT_API ?? "http://127.0.0.1:3451",
  origin: process.env.LT_ORIGIN ?? "http://127.0.0.1:3110",
  email: process.env.LT_EMAIL ?? "operador0001.demo@inia.local",
  label: process.env.LT_LABEL ?? "turnos",
  repeat: Number(process.env.LT_REPEAT ?? 1),
}
// Perguntas de quem atende: processo (especialista), saudação (resposta direta) e os próprios resultados (ferramenta de dados).
const QUESTIONS = (process.env.LT_QUESTIONS ? process.env.LT_QUESTIONS.split("|") : [
  "Como faço para registrar a contestação da fatura de um cliente?",
  "Oi, INIA! Tudo bem?",
  "Qual é o prazo para responder uma reclamação de cobrança indevida?",
  "Como estão os meus resultados este mês?",
  "O que devo fazer quando o cliente pede segunda via da conta?",
  "Quais são os passos para um reparo técnico na casa do cliente?",
]).map((text) => text.trim()).filter(Boolean)

const session = new ChatSession({ api: cfg.api, origin: cfg.origin, email: cfg.email })
if (!(await session.login(demoPassword()))) throw new Error("login recusado")
const turns = []
for (let round = 0; round < cfg.repeat; round += 1) {
  for (const [index, question] of QUESTIONS.entries()) {
    await session.newConversation()
    const result = await session.ask(question)
    const { conversationId: _ignored, ...timing } = result
    turns.push({ question: index, round, ...timing })
    process.stdout.write(`[${cfg.label}] p${index} ${result.ok ? "ok " : "ERR"} 1º texto ${String(result.firstTextMs).padStart(6)} ms · progresso ${String(result.firstStatusMs ?? "—").padStart(6)} · total ${String(result.totalMs).padStart(6)} ms · ${result.events.join(">")}${result.error ? ` (${result.error})` : ""}\n`)
  }
}
const ok = turns.filter((turn) => turn.ok)
const summary = { label: cfg.label, api: cfg.api, n: turns.length, failed: turns.length - ok.length, firstText: { p50: percentile(ok.map((t) => t.firstTextMs), 50), p95: percentile(ok.map((t) => t.firstTextMs), 95), max: Math.max(...ok.map((t) => t.firstTextMs)) }, total: { p50: percentile(ok.map((t) => t.totalMs), 50), p95: percentile(ok.map((t) => t.totalMs), 95), max: Math.max(...ok.map((t) => t.totalMs)) } }
const file = path.join(OUT, `turns-${cfg.label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(file, JSON.stringify({ summary, turns }, null, 1))
process.stdout.write(`\n${JSON.stringify(summary)}\n${file}\n`)
