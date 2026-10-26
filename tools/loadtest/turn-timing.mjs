// RESUMO POR TURNO a partir do log de uma API de medição (linhas `chat_turn_timing`, sem conteúdo): caminho, primeiro texto, total
// e, no esclarecimento pelas bases, as rodadas do planejador e a redação (duração e primeiro pedaço quando em fluxo).
//
//   node tools/loadtest/turn-timing.mjs tools/loadtest/out/bench-<rótulo>-api.log
import { readFileSync } from "node:fs"

const file = process.argv[2]
if (!file) throw new Error("uso: node tools/loadtest/turn-timing.mjs <log da API>")
const seconds = (ms) => (ms === null || ms === undefined ? "    —" : `${(ms / 1000).toFixed(1).padStart(5)}s`)
const rows = []
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.includes('"chat_turn_timing"')) continue
  const turn = JSON.parse(line)
  // `clarificationCalls` = uma etiqueta por chamada do esclarecimento, na ordem das chamadas KNOWLEDGE_CLARIFICATION do turno.
  const labels = String(turn.notes?.clarificationCalls ?? "").split(">").map((label) => label.trim()).filter(Boolean)
  const calls = turn.llm.filter((call) => call.purpose === "KNOWLEDGE_CLARIFICATION")
  const planner = calls.filter((_call, index) => !labels[index]?.startsWith("ANSWER"))
  const answer = calls.filter((_call, index) => labels[index]?.startsWith("ANSWER")).at(-1) ?? null
  const row = { path: turn.path, firstMs: turn.firstContentMs, totalMs: turn.totalMs, plannerCalls: planner.length, plannerMs: planner.reduce((sum, call) => sum + call.ms, 0), answerMs: answer?.ms ?? null, answerFirstTokenMs: answer?.firstTokenMs ?? null, failedCalls: calls.filter((call) => call.status !== "OK").length, calls: labels.join(" > ") }
  rows.push(row)
  process.stdout.write(`${row.path.padEnd(14)} 1º texto ${seconds(row.firstMs)} · total ${seconds(row.totalMs)} | planejador ${row.plannerCalls}× ${seconds(row.plannerMs)} | redação ${seconds(row.answerMs)} (1º pedaço ${seconds(row.answerFirstTokenMs)}) | falhas ${row.failedCalls} | ${row.calls}\n`)
}
const answered = rows.filter((row) => row.answerMs !== null)
const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)]
}
process.stdout.write(`\n${JSON.stringify({ turns: rows.length, answered: answered.length, median: { firstMs: median(answered.map((row) => row.firstMs)), totalMs: median(answered.map((row) => row.totalMs)), plannerMs: median(answered.map((row) => row.plannerMs)), answerMs: median(answered.map((row) => row.answerMs)) } })}\n`)
