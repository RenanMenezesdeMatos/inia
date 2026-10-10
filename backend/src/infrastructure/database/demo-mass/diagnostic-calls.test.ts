import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildDemoMass, stubIndicatorDefinitions } from "./build-demo-mass.js"
import { demoId } from "./demo-ids.js"
import { shiftFor } from "./interaction-generator.js"
import {
  DIAGNOSTIC_CALL_OPERATORS,
  DIAGNOSTIC_CALLS_DATASET,
  DIAGNOSTIC_CALLS_DIRECTORY,
  DiagnosticCallsDatasetError,
  diagnosticCallExternalId,
  diagnosticCallFlags,
  diagnosticCallId,
  loadDiagnosticCalls,
  mapDiagnosticCalls,
  parseDiagnosticCalls,
  sha256Of,
  type DiagnosticCall,
} from "./diagnostic-calls.js"

/**
 * O lote REAL do repositório (seeds/demo/diagnostic-calls) é a fixture: o teste prova que o que
 * chega às tabelas é exatamente o que o arquivo diz — assunto, duração, transcrição, papéis, flags —
 * e que nada é inferido, resumido ou reclassificado no caminho.
 */
const raw = await readFile(join(DIAGNOSTIC_CALLS_DIRECTORY, DIAGNOSTIC_CALLS_DATASET.file), "utf8")
const calls = await loadDiagnosticCalls()
const source = new Map(raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>).map((record) => [record.interacao_id_externo as string, record]))
const mass = buildDemoMass(stubIndicatorDefinitions(), 20260915, "2026-09-15", [], calls)
const byOperator = (key: string) => mass.diagnosticCalls.filter((row) => row.operatorKey === key)

describe("lote de chamadas de diagnóstico — contrato do arquivo", () => {
  it("é o lote homologado: 90 chamadas, 30 por operador, SHA-256 conferido, ids únicos", () => {
    expect(sha256Of(raw)).toBe(DIAGNOSTIC_CALLS_DATASET.sha256)
    expect(calls).toHaveLength(90)
    expect(new Set(calls.map((call) => call.interacao_id_externo)).size).toBe(90)
    const perOperator = new Map<string, number>()
    for (const call of calls) perOperator.set(call.operador_nome, (perOperator.get(call.operador_nome) ?? 0) + 1)
    expect(Object.fromEntries(perOperator)).toEqual({ "Mariana Alves": 30, "Rafael Cardoso": 30, "Camila Fonseca": 30 })
    expect(calls.every((call) => call.sintetico && call.assunto_origem === "cadastro_da_interacao" && call.canal === "voz")).toBe(true)
  })

  it("recusa lote adulterado: hash diferente, campo desconhecido, contagem errada, chamada sem operador mapeado", () => {
    expect(() => parseDiagnosticCalls(raw, { sha256: "0".repeat(64) })).toThrow(/SHA-256 diferente/)
    const lines = raw.split("\n").filter((line) => line.trim())
    const withExtraField = lines.map((line, index) => (index === 0 ? line.replace(/}$/, ',"rotulo_qa":"x"}') : line)).join("\n")
    expect(() => parseDiagnosticCalls(withExtraField)).toThrow(DiagnosticCallsDatasetError)
    expect(() => parseDiagnosticCalls(lines.slice(1).join("\n"))).toThrow(/89 chamadas|29 chamadas/)
    const foreignOperator = lines.map((line, index) => (index === 0 ? line.replace('"operador_id_externo": "OP-DEMO-M"', '"operador_id_externo": "OP-DEMO-X"') : line)).join("\n")
    expect(() => parseDiagnosticCalls(foreignOperator)).toThrow(/não mapeado/)
    const renamed = lines.map((line, index) => (index === 0 ? line.replace('"operador_nome": "Mariana Alves"', '"operador_nome": "Mariana Alvez"') : line)).join("\n")
    expect(() => parseDiagnosticCalls(renamed)).toThrow(/esperado "Mariana Alves"/)
    const wrongDuration = lines.map((line, index) => (index === 0 ? line.replace('"duracao_s": 431', '"duracao_s": 430') : line)).join("\n")
    expect(() => parseDiagnosticCalls(wrongDuration)).toThrow(/duracao_s/)
  })
})

describe("lote de chamadas de diagnóstico — resolução contra a massa demo", () => {
  it("90 linhas, 30 por persona canônica, com o id CANÔNICO da pessoa (nunca outra Mariana/Rafael/Camila)", () => {
    expect(mass.diagnosticCalls).toHaveLength(90)
    expect(byOperator("operator:0002")).toHaveLength(30)
    expect(byOperator("operator:0004")).toHaveLength(30)
    expect(byOperator("operator:0005")).toHaveLength(30)
    for (const [external, operator] of Object.entries(DIAGNOSTIC_CALL_OPERATORS)) {
      const person = mass.structure.byKey.get(operator.operatorKey)!
      expect(person.name).toBe(operator.name)
      expect(person.id).toBe(demoId(`person:${operator.operatorKey}`))
      const rows = mass.diagnosticCalls.filter((row) => row.sourceExternalId.includes(`-${external.slice(-1)}-`))
      expect(rows).toHaveLength(30)
      expect(rows.every((row) => row.operatorId === person.id)).toBe(true)
    }
    // Todos no Subgrupo de diagnóstico, mesmo Grupo, mesma supervisora.
    const people = [...new Set(mass.diagnosticCalls.map((row) => row.operatorKey))].map((key) => mass.structure.byKey.get(key)!)
    expect(people.every((person) => person.subteamKey === "b2c-atendimento-geral/Diagnóstico IA — Operadores com gravações" && person.teamKey === "b2c-atendimento-geral" && person.reportsToKey === "supervisor:01")).toBe(true)
  })

  it("ids/chaves naturais determinísticos: mesmo arquivo → mesmos ids; chave natural = dataset + id externo", () => {
    const again = buildDemoMass(stubIndicatorDefinitions(), 20260915, "2026-09-15", [], calls)
    expect(again.diagnosticCalls.map((row) => row.id)).toEqual(mass.diagnosticCalls.map((row) => row.id))
    expect(new Set(mass.diagnosticCalls.map((row) => row.id)).size).toBe(90)
    expect(new Set(mass.diagnosticCalls.map((row) => row.externalId)).size).toBe(90)
    expect(diagnosticCallExternalId("INIA-DEMO-M-001")).toBe("DEMO-inia_demo_90_v1:INIA-DEMO-M-001")
    expect(diagnosticCallId("INIA-DEMO-M-001")).toMatch(/^de00[0-9a-f]{4}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    // Nenhum id colide com as 10 chamadas geradas da própria persona.
    const generated = new Set(mass.interactionsOf(mass.structure.byKey.get("operator:0002")!).map((row) => row.id))
    expect(mass.diagnosticCalls.some((row) => generated.has(row.id))).toBe(false)
  })

  it("assunto, canal e duração são os da FONTE — nada reclassificado nem recalculado; a data da fonte fica em sourceStartedAt", () => {
    for (const row of mass.diagnosticCalls) {
      const record = source.get(row.sourceExternalId)!
      expect(row.reason).toBe(record.assunto)
      expect(row.channel).toBe("VOICE")
      expect(row.sourceStartedAt).toBe(record.inicio_em)
      expect((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000).toBe(record.duracao_s)
      expect(row.durationSeconds).toBe(record.duracao_s)
    }
    const subjects = new Set(mass.diagnosticCalls.map((row) => row.reason))
    expect(subjects.size).toBe(17)
    expect([...subjects].sort()).toEqual(["alteracao_cadastral", "bloqueio", "cancelamento", "cobertura", "contestacao", "desbloqueio", "esim", "fatura", "internet_movel", "pagamento", "plano", "portabilidade", "roaming", "segunda_via", "servico_adicional", "troca_chip", "troca_titularidade"])
    const durations = mass.diagnosticCalls.map((row) => row.durationSeconds)
    expect(Math.min(...durations)).toBe(221)
    expect(Math.max(...durations)).toBe(508)
  })

  it("layout temporal V2: 10/10/10 por persona em jun/jul/ago 2026, bloco = sufixo (001–010/011–020/021–030), só dia útil, dentro da jornada, sem sobreposição com NENHUMA chamada da pessoa; toda rechamada depois da original", () => {
    const month = (row: { localDate: string }) => row.localDate.slice(0, 7)
    for (const key of ["operator:0002", "operator:0004", "operator:0005"]) {
      const person = mass.structure.byKey.get(key)!
      const rows = byOperator(key)
      const byMonth = new Map<string, number>()
      for (const row of rows) byMonth.set(month(row), (byMonth.get(month(row)) ?? 0) + 1)
      expect(Object.fromEntries(byMonth)).toEqual({ "2026-06": 10, "2026-07": 10, "2026-08": 10 })
      for (const row of rows) {
        const sequence = Number(row.sourceExternalId.slice(-3))
        expect(month(row)).toBe(["2026-06", "2026-07", "2026-08"][Math.floor((sequence - 1) / 10)])
        const weekday = new Date(`${row.localDate}T12:00:00Z`).getUTCDay()
        expect(weekday, `${row.sourceExternalId} em fim de semana`).not.toBe(0)
        expect(weekday).not.toBe(6)
        expect(row.startedAt.startsWith(row.localDate)).toBe(true)
      }
      // Jornada da pessoa (employee_work_shifts da massa): início ≥ início do turno, fim ≤ fim do turno.
      const shift = shiftFor(person)
      const [hour, minute] = shift.startTime.split(":").map(Number) as [number, number]
      const shiftStart = hour * 60 + minute
      for (const row of rows) {
        const started = Number(row.startedAt.slice(11, 13)) * 60 + Number(row.startedAt.slice(14, 16))
        const ended = started + row.durationSeconds / 60
        expect(started).toBeGreaterThanOrEqual(shiftStart)
        expect(ended).toBeLessThanOrEqual(shiftStart + shift.workMinutes)
      }
      // Nenhuma sobreposição: entre as 30 do lote e com as 10 geradas.
      const intervals = [...rows.map((row) => ({ id: row.sourceExternalId, s: Date.parse(row.startedAt), e: Date.parse(row.endedAt) })), ...mass.interactionsOf(person).map((row) => ({ id: row.externalId, s: Date.parse(row.startedAt), e: Date.parse(row.endedAt) }))]
      for (const a of intervals) for (const b of intervals) if (a.id !== b.id) expect(a.s < b.e && b.s < a.e, `${a.id} sobrepõe ${b.id}`).toBe(false)
      // Dias distintos por mês (uma chamada do lote por dia) e ordem cronológica = ordem do sufixo.
      expect(new Set(rows.map((row) => row.localDate)).size).toBe(30)
      const sorted = [...rows].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map((row) => Number(row.sourceExternalId.slice(-3)))
      expect(sorted).toEqual([...sorted].sort((a, b) => a - b))
    }
    // Rechamadas do lote (8) continuam DEPOIS da chamada original.
    const startedOf = new Map(mass.diagnosticCalls.map((row) => [row.sourceExternalId, Date.parse(row.startedAt)]))
    const recalls = calls.filter((call) => call.interacao_anterior_id_externo !== null)
    expect(recalls).toHaveLength(8)
    for (const recall of recalls) expect(startedOf.get(recall.interacao_id_externo)!).toBeGreaterThan(startedOf.get(recall.interacao_anterior_id_externo!)!)
    // Determinístico.
    const again = buildDemoMass(stubIndicatorDefinitions(), 20260915, "2026-09-15", [], calls)
    expect(again.diagnosticCalls.map((row) => [row.id, row.startedAt, row.endedAt])).toEqual(mass.diagnosticCalls.map((row) => [row.id, row.startedAt, row.endedAt]))
  })

  it("transcrição integral, byte a byte, com papéis e tempos da fonte (OPERADOR/CLIENTE/SUPORTE/EVENTO) — conversa casual e silêncios inclusive", () => {
    for (const row of mass.diagnosticCalls) {
      const record = source.get(row.sourceExternalId)!
      expect(row.transcript).toBe(record.transcricao)
      const segments = record.segmentos as { papel: string; texto: string }[]
      const lines = row.transcript.split("\n")
      expect(lines).toHaveLength(segments.length)
      segments.forEach((segment, index) => {
        expect(lines[index]).toMatch(new RegExp(`^\\[\\d{2}:\\d{2}–\\d{2}:\\d{2}\\] ${segment.papel.toUpperCase()}: `))
        expect(lines[index]!.endsWith(segment.texto)).toBe(true)
      })
    }
    const all = mass.diagnosticCalls.map((row) => row.transcript).join("\n")
    expect(all).toContain("Japão")
    expect(all.match(/EVENTO: \[Intervalo sem fala/g)?.length).toBe(90)
    expect(all.match(/^\[[^\]]+\] SUPORTE: /gm)?.length).toBe(7)
    expect(new Set(mass.diagnosticCalls.map((row) => row.transcript)).size).toBe(90)
  })

  it("flags = só as estruturadas da fonte (nada lido da transcrição): booleanos explícitos, nota/detrator só com resposta, tempo_silencio medido", () => {
    const counts = { rechamada: 0, transferencia: 0, contestacao: 0, cancelamento: 0, detrator: 0, nota: 0 }
    for (const row of mass.diagnosticCalls) {
      const record = source.get(row.sourceExternalId)! as unknown as DiagnosticCall
      expect(row.flags).toEqual(diagnosticCallFlags(record))
      expect(row.flags.rechamada).toBe(record.rechamada)
      expect(row.flags.transferencia).toBe(record.transferencia)
      expect(row.flags.contestacao).toBe(record.contestacao)
      expect(row.flags.cancelamento).toBe(record.cancelamento)
      expect(row.flags.tempo_silencio).toBe(record.tempo_silencio_s)
      expect("nota_ura" in row.flags).toBe(record.nota_ura !== null)
      expect("detrator" in row.flags).toBe(record.detrator !== null)
      if (record.nota_ura !== null) expect(row.flags.nota_ura).toBe(record.nota_ura)
      if (record.rechamada) counts.rechamada += 1
      if (record.transferencia) counts.transferencia += 1
      if (record.contestacao) counts.contestacao += 1
      if (record.cancelamento) counts.cancelamento += 1
      if (record.detrator) counts.detrator += 1
      if (record.nota_ura !== null) counts.nota += 1
      expect(Object.keys(row.flags).every((name) => ["rechamada", "transferencia", "contestacao", "cancelamento", "detrator", "nota_ura", "tempo_silencio"].includes(name))).toBe(true)
    }
    expect(counts).toEqual({ rechamada: 8, transferencia: 7, contestacao: 11, cancelamento: 10, detrator: 17, nota: 80 })
    // Silêncio existe em todas as chamadas, mas nunca com o mesmo valor em todas (persona não caricata).
    expect(new Set(mass.diagnosticCalls.map((row) => row.flags.tempo_silencio)).size).toBeGreaterThan(20)
  })

  it("coerência temporal do corpus v3: 0 artefatos — 'previsto para' = data V2 + 2 dias e 'registrado em' = data V2 do contato anterior, em TODAS as ocorrências", () => {
    const placed = new Map(mass.diagnosticCalls.map((row) => [row.sourceExternalId, row.localDate]))
    const addDays = (day: string, days: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
    let occurrences = 0
    const artifacts: string[] = []
    for (const call of calls) {
      const own = placed.get(call.interacao_id_externo)!
      for (const match of call.transcricao.matchAll(/previsto para (\d{2})\/(\d{2})\/(\d{4})/g)) {
        occurrences += 1
        const said = `${match[3]}-${match[2]}-${match[1]}`
        if (said !== addDays(own, 2)) artifacts.push(`${call.interacao_id_externo}: ${match[0]} (chamada em ${own})`)
      }
      for (const match of call.transcricao.matchAll(/registrado em (\d{2})\/(\d{2})/g)) {
        occurrences += 1
        const previous = placed.get(call.interacao_anterior_id_externo ?? "")
        if (!previous || `${match[1]}/${match[2]}` !== `${previous.slice(8, 10)}/${previous.slice(5, 7)}`) artifacts.push(`${call.interacao_id_externo}: ${match[0]} (anterior em ${previous})`)
      }
      // Toda data absoluta citada na fala é igual ou posterior ao dia da chamada, exceto o contato anterior (histórico válido).
      for (const match of call.transcricao.matchAll(/(\d{2})\/(\d{2})\/2026/g)) {
        const said = `2026-${match[2]}-${match[1]}`
        if (said < own) artifacts.push(`${call.interacao_id_externo}: data ${match[0]} anterior à chamada (${own})`)
      }
    }
    expect(occurrences).toBe(33)
    expect(artifacts).toEqual([])
  })

  it("corpus v3 = v1 + revisão mínima auditável: 26 chamadas / 30 tokens de data; 64 linhas byte a byte iguais; v1 continua parseável para auditoria; nada além de transcrição/segmentos/dataset_id mudou", async () => {
    const v1Raw = await readFile(join(DIAGNOSTIC_CALLS_DIRECTORY, "diagnostic-calls/inia_demo_90_v1.jsonl"), "utf8")
    const v1 = parseDiagnosticCalls(v1Raw, { sha256: "f55e1b254fadb6db2650bd7e4f40392d9e8000bbd05bb54ec15f2d410de8f28a", corpus: "inia_demo_90_v1" })
    const revisions = JSON.parse(await readFile(join(DIAGNOSTIC_CALLS_DIRECTORY, "diagnostic-calls/inia_demo_90_v3.revisions.json"), "utf8")) as { source: { sha256: string }; target: { corpus: string; sha256: string }; revisedInteractions: number; occurrences: number; revisions: { interactionId: string; oldTranscriptHash: string; newTranscriptHash: string; changes: { before: string; after: string }[] }[] }
    expect(revisions.target).toEqual({ corpus: DIAGNOSTIC_CALLS_DATASET.corpus, sha256: DIAGNOSTIC_CALLS_DATASET.sha256 })
    expect(revisions.revisedInteractions).toBe(26)
    expect(revisions.occurrences).toBe(30)
    const byId = new Map(revisions.revisions.map((item) => [item.interactionId, item]))
    const v3ById = new Map(calls.map((call) => [call.interacao_id_externo, call]))
    let untouched = 0
    for (const before of v1) {
      const after = v3ById.get(before.interacao_id_externo)!
      const { transcricao: t1, segmentos: s1, dataset_id: d1, ...meta1 } = before
      const { transcricao: t2, segmentos: s2, dataset_id: d2, ...meta2 } = after
      expect(meta2).toEqual(meta1)
      expect(d1).toBe("inia_demo_90_v1")
      expect(d2).toBe("inia_demo_90_v3")
      const revision = byId.get(before.interacao_id_externo)
      if (!revision) {
        expect(t2).toBe(t1)
        expect(s2).toEqual(s1)
        untouched += 1
        continue
      }
      expect(sha256Of(t1)).toBe(revision.oldTranscriptHash)
      expect(sha256Of(t2)).toBe(revision.newTranscriptHash)
      // Só tokens de data mudam; papéis/tempos idênticos; cada mudança listada aparece no texto novo e a anterior no antigo.
      const mask = (text: string) => text.replace(/\d{2}\/\d{2}(\/\d{4})?/g, "#")
      expect(mask(t2)).toBe(mask(t1))
      expect(s2.map((segment) => [segment.papel, segment.inicio_s, segment.fim_s])).toEqual(s1.map((segment) => [segment.papel, segment.inicio_s, segment.fim_s]))
      for (const change of revision.changes) {
        expect(t1).toContain(change.before)
        expect(t2).toContain(change.after)
      }
    }
    expect(untouched).toBe(64)
  })

  it("falha alto quando a persona canônica não bate (nome/papel) em vez de criar outra pessoa", () => {
    const tampered = buildDemoMass(stubIndicatorDefinitions(), 20260915, "2026-09-15")
    const mariana = tampered.structure.byKey.get("operator:0002")!
    mariana.name = "Outra Pessoa"
    expect(() => mapDiagnosticCalls(calls, tampered.structure)).toThrow(/o lote espera "Mariana Alves"/)
  })
})
