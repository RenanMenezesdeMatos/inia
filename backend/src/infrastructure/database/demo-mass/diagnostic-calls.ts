import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type pg from "pg"
import { z } from "zod"
import { DEMO_ORGANIZATION_ID } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { DEMO_CHANNEL } from "./flag-catalog.js"
import { DIAGNOSTIC_CALLS_TEMPORAL_LAYOUT, scheduleDiagnosticCalls, type PlacedInterval } from "./diagnostic-calls-schedule.js"
import type { DemoPerson, DemoStructure } from "./structure-generator.js"

/**
 * CHAMADAS DE DIAGNÓSTICO — massa sintética externa de 90 atendimentos (30 × 3 operadoras/es
 * canônicos do Subgrupo "Diagnóstico IA — Operadores com gravações"), importada de um arquivo
 * JSONL versionado em `backend/seeds/demo/diagnostic-calls/` (contrato em `SOURCE_README.md`).
 *
 * Regras que ESTE módulo aplica, não só pede:
 *   - o arquivo é lido por LISTA EXPLÍCITA (nunca varredura de pasta) e o SHA-256 é conferido: um
 *     byte diferente do lote homologado = carga recusada (nada é "adaptado" em silêncio);
 *   - `assunto` é DADO DE ORIGEM (`assunto_origem = cadastro_da_interacao`): vira `interactions.reason`
 *     literalmente — nenhuma IA classifica, resume ou "melhora" nada durante o seed;
 *   - a transcrição entra INTEGRAL (`transcricao`, com marcação de tempo e papéis OPERADOR/CLIENTE/
 *     SUPORTE/EVENTO exatamente como na fonte) — conversa casual e trechos de silêncio inclusive;
 *   - duração = `duracao_s` da fonte (validada contra `inicio_em`/`fim_em`); nunca recalculada do texto.
 *     POSIÇÃO NO CALENDÁRIO: a fonte declara junho/2026 inteiro; a massa aplica o layout temporal V2
 *     (diagnostic-calls-schedule.ts — jun/jul/ago, dia útil, dentro da jornada, sem sobreposição) e guarda a
 *     data de origem em `sourceStartedAt`; conteúdo, assunto, flags e duração não mudam;
 *   - flags = só as que a fonte traz de forma estruturada (rechamada, transferencia, contestacao,
 *     cancelamento, detrator quando há nota, nota_ura quando respondida, tempo_silencio medido) — nada é
 *     inferido da leitura da transcrição;
 *   - identidade das pessoas = ids canônicos da massa (operador 0002/0004/0005), com o NOME conferido
 *     na carga — nunca se cria outra "Mariana Alves";
 *   - idempotente por chave natural (`dataset_id` + `interacao_id_externo`): rodar duas vezes não
 *     duplica; chave natural já ocupada por OUTRA interação = conflito reportado, nunca sobrescrito.
 *
 * O GABARITO de QA do mesmo lote (padrões plantados, controles, métricas esperadas) NÃO passa por
 * aqui: vive em `backend/scripts/poc-tools/ground-truth/` e nunca é importado por `src/` — teste
 * `ground-truth-isolation.test.ts`.
 */
/**
 * LOTE ≠ CORPUS. O lote (`lot`) é a identidade lógica das 90 chamadas — os ids determinísticos, o
 * `external_id` (`DEMO-<lot>:<id externo>`) e o gabarito de QA são do lote e nunca mudam. O corpus é a
 * REVISÃO do arquivo homologado (v1 = entrega original; v3 = hotfix de coerência temporal, só tokens de
 * data — `scripts/demo-mass/revise-diagnostic-corpus.ts`). Trocar de corpus = novo SHA-256 pinado + nova
 * versão conceitual do dataset (diagnostic-dataset.ts); o corpus anterior fica no repositório para auditoria.
 */
export const DIAGNOSTIC_CALLS_LOT = "inia_demo_90_v1"
export const DIAGNOSTIC_CALLS_DATASET = {
  lot: DIAGNOSTIC_CALLS_LOT,
  corpus: "inia_demo_90_v3",
  schemaVersion: "1.0",
  /** Relativo a `backend/seeds/demo` (o mesmo diretório dos SQL de demo; o runner só executa `*.sql`). */
  file: "diagnostic-calls/inia_demo_90_v3.jsonl",
  sha256: "57a380da6d9dcc835ed4bb493968cbb39dbcde454a5009196866e2b28658f532",
  expectedCalls: 90,
  expectedCallsPerOperator: 30,
} as const

export const DIAGNOSTIC_CALLS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "../../../../seeds/demo")

/** `operador_id_externo` da fonte → operador CANÔNICO da massa (chave da estrutura) + nome esperado (conferido na carga). */
export const DIAGNOSTIC_CALL_OPERATORS: Readonly<Record<string, { operatorKey: string; name: string }>> = {
  "OP-DEMO-M": { operatorKey: "operator:0002", name: "Mariana Alves" },
  "OP-DEMO-R": { operatorKey: "operator:0004", name: "Rafael Cardoso" },
  "OP-DEMO-C": { operatorKey: "operator:0005", name: "Camila Fonseca" },
}

/** Canal da fonte → canal do catálogo (`channel_flags.channel`); só VOICE existe hoje. */
export const DIAGNOSTIC_CALL_CHANNELS: Readonly<Record<string, string>> = { voz: DEMO_CHANNEL }

const isoWithOffset = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/, "data ISO 8601 com deslocamento -03:00")
const segmentSchema = z
  .object({
    segmento_id: z.string().min(1),
    papel: z.enum(["operador", "cliente", "suporte", "evento"]),
    texto: z.string().min(1),
    inicio_s: z.number().int().nonnegative(),
    fim_s: z.number().int().nonnegative(),
    tipo: z.enum(["silencio", "espera"]).optional(),
  })
  .strict()

/** Contrato do lote (SOURCE_README.md, "Dicionário dos metadados") — estrito: campo desconhecido = versão nova não homologada. */
export const diagnosticCallSchemaFor = (corpus: string) => z
  .object({
    schema_version: z.literal(DIAGNOSTIC_CALLS_DATASET.schemaVersion),
    dataset_id: z.literal(corpus),
    sintetico: z.literal(true),
    interacao_id_externo: z.string().min(1),
    operador_id_externo: z.string().min(1),
    operador_nome: z.string().min(1),
    grupo_id_externo: z.string().min(1),
    grupo_nome: z.string().min(1),
    cliente_id_externo: z.string().min(1),
    cliente_nome_ficticio: z.string().min(1),
    canal: z.string().min(1),
    idioma: z.literal("pt-BR"),
    inicio_em: isoWithOffset,
    fim_em: isoWithOffset,
    assunto: z.string().regex(/^[a-z][a-z0-9_]*$/, "código de assunto em snake_case"),
    assunto_origem: z.literal("cadastro_da_interacao"),
    assuntos_secundarios: z.array(z.string().min(1)),
    duracao_s: z.number().int().positive(),
    tempo_fala_s: z.number().int().nonnegative(),
    tempo_silencio_s: z.number().int().nonnegative(),
    tempo_espera_s: z.number().int().nonnegative(),
    tempo_pos_atendimento_s: z.number().int().nonnegative(),
    tempo_atendimento_total_s: z.number().int().nonnegative(),
    rechamada: z.boolean(),
    interacao_anterior_id_externo: z.string().min(1).nullable(),
    caso_id_externo: z.string().min(1),
    transferencia: z.boolean(),
    tipo_transferencia: z.string().min(1).nullable(),
    contestacao: z.boolean(),
    cancelamento: z.boolean(),
    nota_ura: z.number().int().min(0).max(10).nullable(),
    escala_nota_ura: z.literal("0-10"),
    detrator: z.boolean().nullable(),
    status_desfecho: z.enum(["concluido", "orientacao_concluida", "pendente"]),
    protocolo_registro: z.string().min(1),
    transcricao: z.string().min(1),
    segmentos: z.array(segmentSchema).min(1),
  })
  .strict()

export const diagnosticCallSchema = diagnosticCallSchemaFor(DIAGNOSTIC_CALLS_DATASET.corpus)
export type DiagnosticCall = z.infer<typeof diagnosticCallSchema>

export class DiagnosticCallsDatasetError extends Error {}

export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Faz o parse do JSONL e valida o lote INTEIRO como contrato (não linha a linha "no melhor
 * esforço"): ids únicos, 90 chamadas, 30 por operador conhecido, `fim_em = inicio_em + duracao_s`,
 * `duracao_s = fala + silêncio + espera`, transcrição com uma linha por segmento, papéis coerentes
 * e vínculos de rechamada apontando para chamada do mesmo lote/cliente/operador. Qualquer desvio
 * recusa o lote com a lista de problemas.
 */
export function parseDiagnosticCalls(jsonl: string, expected: { sha256?: string | null; corpus?: string } = {}): DiagnosticCall[] {
  const corpus = expected.corpus ?? DIAGNOSTIC_CALLS_DATASET.corpus
  const schema = diagnosticCallSchemaFor(corpus)
  if (expected.sha256 !== undefined && expected.sha256 !== null) {
    const actual = sha256Of(jsonl)
    if (actual !== expected.sha256) throw new DiagnosticCallsDatasetError(`Corpus ${corpus} com SHA-256 diferente do homologado (esperado ${expected.sha256}, lido ${actual}). Um corpus novo precisa ser revisado e ter o hash atualizado em diagnostic-calls.ts.`)
  }
  const lines = jsonl.split("\n").filter((line) => line.trim().length > 0)
  const calls: DiagnosticCall[] = []
  const problems: string[] = []
  lines.forEach((line, index) => {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (error) {
      problems.push(`linha ${index + 1}: JSON inválido (${error instanceof Error ? error.message : String(error)})`)
      return
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      problems.push(`linha ${index + 1}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`).join("; ")}`)
      return
    }
    calls.push(parsed.data)
  })
  if (problems.length === 0) problems.push(...validateDataset(calls))
  if (problems.length > 0) throw new DiagnosticCallsDatasetError(`Corpus ${corpus} recusado:\n  - ${problems.slice(0, 20).join("\n  - ")}${problems.length > 20 ? `\n  … e mais ${problems.length - 20}` : ""}`)
  return calls
}

const TRANSCRIPT_LINE = /^\[(\d{2}:\d{2})–(\d{2}:\d{2})\] (OPERADOR|CLIENTE|SUPORTE|EVENTO): /
const SEGMENT_ROLE_LABEL: Record<DiagnosticCall["segmentos"][number]["papel"], string> = { operador: "OPERADOR", cliente: "CLIENTE", suporte: "SUPORTE", evento: "EVENTO" }

function validateDataset(calls: DiagnosticCall[]): string[] {
  const problems: string[] = []
  const byId = new Map<string, DiagnosticCall>()
  for (const call of calls) {
    if (byId.has(call.interacao_id_externo)) problems.push(`${call.interacao_id_externo}: id repetido no lote`)
    byId.set(call.interacao_id_externo, call)
  }
  if (calls.length !== DIAGNOSTIC_CALLS_DATASET.expectedCalls) problems.push(`lote com ${calls.length} chamadas (esperado ${DIAGNOSTIC_CALLS_DATASET.expectedCalls})`)
  const perOperator = new Map<string, number>()
  for (const call of calls) {
    perOperator.set(call.operador_id_externo, (perOperator.get(call.operador_id_externo) ?? 0) + 1)
    const operator = DIAGNOSTIC_CALL_OPERATORS[call.operador_id_externo]
    if (!operator) problems.push(`${call.interacao_id_externo}: operador ${call.operador_id_externo} não mapeado para a massa`)
    else if (operator.name !== call.operador_nome) problems.push(`${call.interacao_id_externo}: operador ${call.operador_id_externo} veio como "${call.operador_nome}" (esperado "${operator.name}")`)
    if (!DIAGNOSTIC_CALL_CHANNELS[call.canal]) problems.push(`${call.interacao_id_externo}: canal "${call.canal}" sem mapeamento`)
    const started = Date.parse(call.inicio_em)
    const ended = Date.parse(call.fim_em)
    if (Number.isNaN(started) || Number.isNaN(ended)) problems.push(`${call.interacao_id_externo}: datas inválidas`)
    else if (ended - started !== call.duracao_s * 1000) problems.push(`${call.interacao_id_externo}: fim_em − inicio_em ≠ duracao_s`)
    if (call.duracao_s !== call.tempo_fala_s + call.tempo_silencio_s + call.tempo_espera_s) problems.push(`${call.interacao_id_externo}: duracao_s ≠ fala + silêncio + espera`)
    if (call.tempo_atendimento_total_s !== call.duracao_s + call.tempo_pos_atendimento_s) problems.push(`${call.interacao_id_externo}: tempo_atendimento_total_s ≠ duracao_s + pós-atendimento`)
    if ((call.detrator === null) !== (call.nota_ura === null)) problems.push(`${call.interacao_id_externo}: detrator e nota_ura precisam ser ambos nulos ou ambos preenchidos`)
    if (call.nota_ura !== null && call.detrator !== (call.nota_ura <= 6)) problems.push(`${call.interacao_id_externo}: detrator incoerente com a regra do lote (nota ≤ 6)`)
    if (call.transferencia !== (call.tipo_transferencia !== null)) problems.push(`${call.interacao_id_externo}: transferencia incoerente com tipo_transferencia`)
    if (call.rechamada !== (call.interacao_anterior_id_externo !== null)) problems.push(`${call.interacao_id_externo}: rechamada incoerente com interacao_anterior_id_externo`)
    if (call.interacao_anterior_id_externo !== null) {
      const previous = byId.get(call.interacao_anterior_id_externo)
      if (!previous) problems.push(`${call.interacao_id_externo}: rechamada aponta para ${call.interacao_anterior_id_externo}, ausente do lote`)
      else {
        if (previous.operador_id_externo !== call.operador_id_externo || previous.cliente_id_externo !== call.cliente_id_externo || previous.caso_id_externo !== call.caso_id_externo) problems.push(`${call.interacao_id_externo}: rechamada com operador/cliente/caso diferente da chamada anterior`)
        if (Date.parse(previous.inicio_em) >= started) problems.push(`${call.interacao_id_externo}: rechamada anterior à chamada original`)
      }
    }
    // Transcrição integral × segmentos: mesma quantidade, mesma ordem, mesmo papel, intervalos contínuos.
    const lines = call.transcricao.split("\n")
    if (lines.length !== call.segmentos.length) problems.push(`${call.interacao_id_externo}: transcrição com ${lines.length} linha(s) e ${call.segmentos.length} segmento(s)`)
    else {
      let cursor = 0
      call.segmentos.forEach((segment, index) => {
        const line = lines[index]!
        const match = TRANSCRIPT_LINE.exec(line)
        if (!match) problems.push(`${call.interacao_id_externo}: linha ${index + 1} da transcrição sem marcação [mm:ss–mm:ss] PAPEL:`)
        else if (match[3] !== SEGMENT_ROLE_LABEL[segment.papel]) problems.push(`${call.interacao_id_externo}: linha ${index + 1} com papel ${match[3]} ≠ segmento ${segment.papel}`)
        else if (!line.endsWith(segment.texto)) problems.push(`${call.interacao_id_externo}: linha ${index + 1} da transcrição não termina com o texto do segmento`)
        if (segment.inicio_s !== cursor) problems.push(`${call.interacao_id_externo}: segmento ${segment.segmento_id} começa em ${segment.inicio_s}s (esperado ${cursor}s)`)
        if (segment.fim_s <= segment.inicio_s) problems.push(`${call.interacao_id_externo}: segmento ${segment.segmento_id} com intervalo vazio`)
        if ((segment.papel === "evento") !== (segment.tipo !== undefined)) problems.push(`${call.interacao_id_externo}: segmento ${segment.segmento_id} — só eventos têm tipo`)
        cursor = segment.fim_s
      })
      if (cursor !== call.duracao_s) problems.push(`${call.interacao_id_externo}: segmentos terminam em ${cursor}s, duração ${call.duracao_s}s`)
    }
  }
  for (const [operator, count] of perOperator) {
    if (count !== DIAGNOSTIC_CALLS_DATASET.expectedCallsPerOperator) problems.push(`operador ${operator} com ${count} chamadas (esperado ${DIAGNOSTIC_CALLS_DATASET.expectedCallsPerOperator})`)
  }
  for (const operator of Object.keys(DIAGNOSTIC_CALL_OPERATORS)) {
    if (!perOperator.has(operator)) problems.push(`operador ${operator} sem chamadas no lote`)
  }
  return problems
}

/** Lê o lote homologado do repositório (SHA-256 conferido). */
export async function loadDiagnosticCalls(directory = DIAGNOSTIC_CALLS_DIRECTORY): Promise<DiagnosticCall[]> {
  const text = await readFile(join(directory, DIAGNOSTIC_CALLS_DATASET.file), "utf8")
  return parseDiagnosticCalls(text, { sha256: DIAGNOSTIC_CALLS_DATASET.sha256 })
}

/** Uma chamada do lote resolvida contra a estrutura demo — pronta para as tabelas reais. */
export type DiagnosticCallRow = {
  id: string
  operatorId: string
  operatorKey: string
  /** `interactions.external_id` = chave natural `DEMO-<dataset>:<interacao_id_externo>` (única por organização). */
  externalId: string
  sourceExternalId: string
  /** `interactions.reason` — o código de assunto da fonte, literal. */
  reason: string
  channel: string
  /** Posição no calendário pelo layout V2 (diagnostic-calls-schedule.ts); a data declarada pela fonte fica em `sourceStartedAt`. */
  startedAt: string
  endedAt: string
  localDate: string
  sourceStartedAt: string
  durationSeconds: number
  /** `transcripts.content` — a transcrição integral da fonte, byte a byte. */
  transcript: string
  flags: Record<string, boolean | number>
}

export function diagnosticCallExternalId(sourceExternalId: string): string {
  return `DEMO-${DIAGNOSTIC_CALLS_LOT}:${sourceExternalId}`
}

export function diagnosticCallId(sourceExternalId: string): string {
  return demoId(`interaction:${DIAGNOSTIC_CALLS_LOT}:${sourceExternalId}`)
}

/**
 * Flags estruturadas da fonte → flags do catálogo do canal. Booleanos explícitos entram como
 * estão (true E false são fatos cadastrados no lote); `detrator`/`nota_ura` só quando houve nota;
 * `tempo_silencio` = medida da fonte em segundos. Nada derivado da transcrição.
 */
export function diagnosticCallFlags(call: DiagnosticCall): Record<string, boolean | number> {
  const flags: Record<string, boolean | number> = {
    rechamada: call.rechamada,
    transferencia: call.transferencia,
    contestacao: call.contestacao,
    cancelamento: call.cancelamento,
    tempo_silencio: call.tempo_silencio_s,
  }
  if (call.nota_ura !== null) flags.nota_ura = call.nota_ura
  if (call.detrator !== null) flags.detrator = call.detrator
  return flags
}

/**
 * Resolve cada chamada contra a estrutura demo (id canônico + nome conferido) e aplica o layout temporal
 * V2 sem sobrepor as chamadas que a pessoa já tem (`existingIntervalsOf`). Falha alto se a pessoa não bater.
 */
export function mapDiagnosticCalls(calls: readonly DiagnosticCall[], structure: DemoStructure, existingIntervalsOf: (person: DemoPerson) => readonly PlacedInterval[] = () => []): DiagnosticCallRow[] {
  const byOperator = new Map<string, DiagnosticCall[]>()
  for (const call of calls) byOperator.set(call.operador_id_externo, [...(byOperator.get(call.operador_id_externo) ?? []), call])
  const rows: DiagnosticCallRow[] = []
  for (const [externalOperator, operatorCalls] of byOperator) {
    const operator = DIAGNOSTIC_CALL_OPERATORS[externalOperator]!
    const person = structure.byKey.get(operator.operatorKey)
    if (!person) throw new DiagnosticCallsDatasetError(`Operador canônico ${operator.operatorKey} não existe na estrutura demo`)
    if (person.name !== operator.name || person.role !== "OPERATOR") throw new DiagnosticCallsDatasetError(`${operator.operatorKey} é "${person.name}" (${person.role}); o lote espera "${operator.name}" (OPERATOR)`)
    const placed = new Map(scheduleDiagnosticCalls(person, operatorCalls, existingIntervalsOf(person)).map((item) => [item.sourceExternalId, item]))
    for (const call of operatorCalls) {
      const schedule = placed.get(call.interacao_id_externo)!
      rows.push({
        id: diagnosticCallId(call.interacao_id_externo),
        operatorId: person.id,
        operatorKey: person.key,
        externalId: diagnosticCallExternalId(call.interacao_id_externo),
        sourceExternalId: call.interacao_id_externo,
        reason: call.assunto,
        channel: DIAGNOSTIC_CALL_CHANNELS[call.canal]!,
        startedAt: schedule.startedAt,
        endedAt: schedule.endedAt,
        localDate: schedule.localDate,
        sourceStartedAt: call.inicio_em,
        durationSeconds: call.duracao_s,
        transcript: call.transcricao,
        flags: diagnosticCallFlags(call),
      })
    }
  }
  // Ordem estável: a do arquivo.
  const order = new Map(calls.map((call, index) => [call.interacao_id_externo, index]))
  return rows.sort((a, b) => order.get(a.sourceExternalId)! - order.get(b.sourceExternalId)!)
}

export { DIAGNOSTIC_CALLS_TEMPORAL_LAYOUT }

export type DiagnosticCallsConflict = { externalId: string; existingInteractionId: string; expectedInteractionId: string }
export class DiagnosticCallsConflictError extends Error {
  constructor(readonly conflicts: DiagnosticCallsConflict[]) {
    super(`Chave natural já usada por outra interação (nada foi sobrescrito): ${conflicts.map((conflict) => `${conflict.externalId} → ${conflict.existingInteractionId}`).join(", ")}`)
  }
}

export type DiagnosticCallsPersistReport = { read: number; inserted: number; updated: number; transcripts: number; flagRows: number }

/**
 * Persiste as chamadas pelas tabelas reais (interactions/transcripts/interaction_flags) — upsert por
 * id determinístico; transcrição por (interação, versão 1) sem `confidence` (não houve ASR: o
 * lote é escrito, não transcrito); flags substituídas por interação. Uma `external_id` ocupada por
 * outra interação aborta ANTES de escrever. Nunca passa por `/ingestion` (gatilhos/matrículas).
 */
export async function persistDiagnosticCalls(client: pg.PoolClient, rows: readonly DiagnosticCallRow[], flagIds: Map<string, string>): Promise<DiagnosticCallsPersistReport> {
  if (rows.length === 0) return { read: 0, inserted: 0, updated: 0, transcripts: 0, flagRows: 0 }
  const existing = await client.query<{ id: string; external_id: string }>(`select id, external_id from interactions where organization_id = $1 and (external_id = any($2::text[]) or id = any($3::uuid[]))`, [DEMO_ORGANIZATION_ID, rows.map((row) => row.externalId), rows.map((row) => row.id)])
  const byExternal = new Map(existing.rows.map((row) => [row.external_id, row.id]))
  const byId = new Map(existing.rows.map((row) => [row.id, row.external_id]))
  const conflicts: DiagnosticCallsConflict[] = []
  for (const row of rows) {
    const idByExternal = byExternal.get(row.externalId)
    if (idByExternal !== undefined && idByExternal !== row.id) conflicts.push({ externalId: row.externalId, existingInteractionId: idByExternal, expectedInteractionId: row.id })
    const externalById = byId.get(row.id)
    if (externalById !== undefined && externalById !== row.externalId) conflicts.push({ externalId: row.externalId, existingInteractionId: row.id, expectedInteractionId: row.id })
  }
  if (conflicts.length > 0) throw new DiagnosticCallsConflictError(conflicts)
  const updated = rows.filter((row) => byId.has(row.id)).length

  const flagRows = rows.flatMap((row) =>
    Object.entries(row.flags).map(([name, value]) => {
      const channelFlagId = flagIds.get(name)
      if (!channelFlagId) throw new DiagnosticCallsDatasetError(`Flag "${name}" não está no catálogo do canal ${DEMO_CHANNEL}`)
      return { id: demoId(`flag:${DIAGNOSTIC_CALLS_LOT}:${row.sourceExternalId}:${name}`), interactionId: row.id, channelFlagId, receivedAt: row.endedAt, valueBoolean: typeof value === "boolean" ? value : null, valueNumeric: typeof value === "number" ? value : null }
    }),
  )
  await client.query("begin")
  try {
    await client.query(
      `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id)
       select id, $1, operator_id, reason, channel, started_at::timestamptz, ended_at::timestamptz, external_id
       from unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) as t(id, operator_id, reason, channel, started_at, ended_at, external_id)
       on conflict (id) do update set operator_id = excluded.operator_id, reason = excluded.reason, channel = excluded.channel, started_at = excluded.started_at, ended_at = excluded.ended_at, external_id = excluded.external_id`,
      [DEMO_ORGANIZATION_ID, rows.map((r) => r.id), rows.map((r) => r.operatorId), rows.map((r) => r.reason), rows.map((r) => r.channel), rows.map((r) => r.startedAt), rows.map((r) => r.endedAt), rows.map((r) => r.externalId)],
    )
    await client.query(
      `insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence)
       select id, $1, interaction_id, 1, content, 'pt-BR', null
       from unnest($2::uuid[], $3::uuid[], $4::text[]) as t(id, interaction_id, content)
       on conflict (interaction_id, version) do update set content = excluded.content, confidence = excluded.confidence`,
      [DEMO_ORGANIZATION_ID, rows.map((r) => demoId(`transcript:${DIAGNOSTIC_CALLS_LOT}:${r.sourceExternalId}`)), rows.map((r) => r.id), rows.map((r) => r.transcript)],
    )
    await client.query(`delete from interaction_flags where interaction_id = any($1::uuid[])`, [rows.map((r) => r.id)])
    await client.query(
      `insert into interaction_flags (id, organization_id, interaction_id, channel_flag_id, value_boolean, value_numeric, received_at)
       select id, $1, interaction_id, channel_flag_id, value_boolean, value_numeric, received_at::timestamptz
       from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::boolean[], $6::numeric[], $7::text[]) as t(id, interaction_id, channel_flag_id, value_boolean, value_numeric, received_at)`,
      [DEMO_ORGANIZATION_ID, flagRows.map((r) => r.id), flagRows.map((r) => r.interactionId), flagRows.map((r) => r.channelFlagId), flagRows.map((r) => r.valueBoolean), flagRows.map((r) => r.valueNumeric), flagRows.map((r) => r.receivedAt)],
    )
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  }
  return { read: rows.length, inserted: rows.length - updated, updated, transcripts: rows.length, flagRows: flagRows.length }
}

export type DiagnosticCallsDbReport = {
  interactions: number
  transcripts: number
  flagRows: number
  byOperator: { name: string; interactions: number; transcripts: number; flagRows: number }[]
  bySubject: { subject: string; interactions: number; operators: number }[]
}

/** Contado NO BANCO, pelos ids do lote — nunca números do arquivo. */
export async function reportDiagnosticCalls(client: pg.PoolClient, rows: readonly DiagnosticCallRow[]): Promise<DiagnosticCallsDbReport> {
  const ids = rows.map((row) => row.id)
  const totals = await client.query<{ interactions: string; transcripts: string; flag_rows: string }>(
    `select count(distinct i.id)::text interactions, count(distinct t.interaction_id)::text transcripts, count(f.id)::text flag_rows
     from interactions i left join transcripts t on t.interaction_id = i.id left join interaction_flags f on f.interaction_id = i.id where i.id = any($1::uuid[])`,
    [ids],
  )
  const byOperator = await client.query<{ name: string; interactions: string; transcripts: string; flag_rows: string }>(
    `select p.name, count(distinct i.id)::text interactions, count(distinct t.interaction_id)::text transcripts, count(f.id)::text flag_rows
     from interactions i join people p on p.id = i.operator_id left join transcripts t on t.interaction_id = i.id left join interaction_flags f on f.interaction_id = i.id
     where i.id = any($1::uuid[]) group by p.name order by p.name`,
    [ids],
  )
  const bySubject = await client.query<{ subject: string; interactions: string; operators: string }>(
    `select reason subject, count(*)::text interactions, count(distinct operator_id)::text operators from interactions where id = any($1::uuid[]) group by reason order by count(*) desc, reason`,
    [ids],
  )
  const row = totals.rows[0]!
  return {
    interactions: Number(row.interactions),
    transcripts: Number(row.transcripts),
    flagRows: Number(row.flag_rows),
    byOperator: byOperator.rows.map((r) => ({ name: r.name, interactions: Number(r.interactions), transcripts: Number(r.transcripts), flagRows: Number(r.flag_rows) })),
    bySubject: bySubject.rows.map((r) => ({ subject: r.subject, interactions: Number(r.interactions), operators: Number(r.operators) })),
  }
}
