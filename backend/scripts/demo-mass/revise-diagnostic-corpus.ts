import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildDemoMass, stubIndicatorDefinitions } from "../../src/infrastructure/database/demo-mass/build-demo-mass.js"
import { DIAGNOSTIC_CALLS_DIRECTORY, parseDiagnosticCalls } from "../../src/infrastructure/database/demo-mass/diagnostic-calls.js"

/**
 * REVISÃO DETERMINÍSTICA DO CORPUS `inia_demo_90_v1` → `inia_demo_90_v3` (hotfix de homologação, 2026-09-18).
 *
 * O layout temporal V2 (diagnostic-calls-schedule.ts) moveu as chamadas de dia/mês; a fonte, escrita para
 * junho, cita datas absolutas na fala com DUAS convenções fixas (auditadas nas 90 chamadas, 33 ocorrências):
 *   - "O próximo retorno … está previsto para DD/MM/AAAA"  = data da chamada + 2 dias (25/25 na fonte);
 *   - "Encontrei o contato anterior, registrado em DD/MM"   = data da chamada anterior vinculada (8/8).
 * Depois do realinhamento, 30 dessas ocorrências ficaram incoerentes (prazo no passado; contato anterior
 * numa data em que a interação vinculada não existe) — TEMPORAL_ARTIFACT. A correção é MÍNIMA e mecânica:
 * só o token de data muda, pela MESMA convenção da fonte, aplicado tanto em `transcricao` quanto no
 * `segmentos[].texto` correspondente. Nada mais é tocado: papéis, tempos, assunto, flags, duração,
 * conversa casual, referências de protocolo (`DEMO-202606-…` é identificador, não data — preservado).
 * Nenhuma informação do gabarito de QA participa da decisão (só coerência temporal da própria chamada).
 *
 * Saída: `inia_demo_90_v3.jsonl` (dataset_id = inia_demo_90_v3; identidade lógica das chamadas — ids
 * externos `INIA-DEMO-…` e `external_id` da massa — inalterada) + `inia_demo_90_v3.revisions.json`
 * (interação, hash antes/depois, trechos antes/depois, motivo). O V1 continua no repositório para auditoria.
 *
 *   npx tsx scripts/demo-mass/revise-diagnostic-corpus.ts
 */
const SOURCE_FILE = "diagnostic-calls/inia_demo_90_v1.jsonl"
const SOURCE_SHA256 = "f55e1b254fadb6db2650bd7e4f40392d9e8000bbd05bb54ec15f2d410de8f28a"
const TARGET_CORPUS = "inia_demo_90_v3"

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const ddmmyyyy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

const raw = readFileSync(join(DIAGNOSTIC_CALLS_DIRECTORY, SOURCE_FILE), "utf8")
if (sha256(raw) !== SOURCE_SHA256) throw new Error("V1 não é o lote homologado — revisão abortada")
const calls = parseDiagnosticCalls(raw, { sha256: SOURCE_SHA256, corpus: "inia_demo_90_v1" })
const mass = buildDemoMass(stubIndicatorDefinitions(), 20260915, "2026-09-18", [], calls)
const placedDate = new Map(mass.diagnosticCalls.map((row) => [row.sourceExternalId, row.localDate]))

type Revision = { interactionId: string; operator: string; v2Date: string; before: string; after: string; reason: string }
const revisions: { interactionId: string; oldTranscriptHash: string; newTranscriptHash: string; changes: Revision[] }[] = []
// Revisão aplicada sobre os objetos BRUTOS das linhas (ordem de chaves da fonte preservada); o parse validado só serve ao layout.
const rawRecords = raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>)
const revised = calls.map((call, index) => {
  const record = rawRecords[index]!
  if (record.interacao_id_externo !== call.interacao_id_externo) throw new Error("ordem das linhas divergente do parse")
  const changes: Revision[] = []
  const own = placedDate.get(call.interacao_id_externo)!
  const rewrite = (text: string): string => {
    let out = text.replace(/previsto para (\d{2})\/(\d{2})\/(\d{4})/g, (match, dd: string, mm: string, yyyy: string) => {
      const said = `${yyyy}-${mm}-${dd}`
      const expected = addDays(own, 2)
      if (said === expected) return match
      changes.push({ interactionId: call.interacao_id_externo, operator: call.operador_nome, v2Date: own, before: match, after: `previsto para ${ddmmyyyy(expected)}`, reason: "TEMPORAL_ARTIFACT: prazo de retorno anterior/igual à data V2 da chamada; convenção da fonte = chamada + 2 dias" })
      return `previsto para ${ddmmyyyy(expected)}`
    })
    if (call.interacao_anterior_id_externo) {
      const previous = placedDate.get(call.interacao_anterior_id_externo)!
      out = out.replace(/registrado em (\d{2})\/(\d{2})/g, (match, dd: string, mm: string) => {
        if (`${dd}/${mm}` === ddmm(previous)) return match
        changes.push({ interactionId: call.interacao_id_externo, operator: call.operador_nome, v2Date: own, before: match, after: `registrado em ${ddmm(previous)}`, reason: `TEMPORAL_ARTIFACT: data citada ≠ data V2 do contato anterior vinculado (${call.interacao_anterior_id_externo})` })
        return `registrado em ${ddmm(previous)}`
      })
    }
    return out
  }
  const transcricao = rewrite(call.transcricao)
  const segmentos = (record.segmentos as { texto: string }[]).map((segment) => {
    const texto = rewrite(segment.texto)
    return texto === segment.texto ? segment : { ...segment, texto }
  })
  // As mudanças foram contadas duas vezes (transcrição + segmento espelho): dedupe por before/after.
  const unique = [...new Map(changes.map((change) => [`${change.before}→${change.after}`, change])).values()]
  if (unique.length > 0) revisions.push({ interactionId: call.interacao_id_externo, oldTranscriptHash: sha256(call.transcricao), newTranscriptHash: sha256(transcricao), changes: unique })
  return { ...record, dataset_id: TARGET_CORPUS, transcricao, segmentos }
})

/** Serialização IDÊNTICA à da fonte (json.dumps com ", " e ": "): linhas não revisadas ficam byte a byte iguais, exceto `dataset_id`. */
function sourceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sourceJson).join(", ")}]`
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).map(([key, item]) => `${JSON.stringify(key)}: ${sourceJson(item)}`).join(", ")}}`
  return JSON.stringify(value)
}
const output = `${revised.map((call) => sourceJson(call)).join("\n")}\n`
writeFileSync(join(DIAGNOSTIC_CALLS_DIRECTORY, `diagnostic-calls/${TARGET_CORPUS}.jsonl`), output)
writeFileSync(
  join(DIAGNOSTIC_CALLS_DIRECTORY, `diagnostic-calls/${TARGET_CORPUS}.revisions.json`),
  `${JSON.stringify({ source: { corpus: "inia_demo_90_v1", sha256: SOURCE_SHA256 }, target: { corpus: TARGET_CORPUS, sha256: sha256(output) }, rule: "só o token de data muda: 'previsto para' = data V2 + 2 dias; 'registrado em' = data V2 do contato anterior vinculado; protocolos preservados", revisedInteractions: revisions.length, occurrences: revisions.reduce((sum, item) => sum + item.changes.length, 0), revisions }, null, 2)}\n`,
)
process.stdout.write(`${TARGET_CORPUS}: ${revisions.length} chamada(s) revisada(s), ${revisions.reduce((sum, item) => sum + item.changes.length, 0)} ocorrência(s); sha256 ${sha256(output)}\n`)
