/**
 * Carga pontual das transcrições reais em docs/CHAMADAS - *.rtf.
 * Só roda em macOS (usa o `textutil` do sistema para converter RTF -> texto).
 * Não é chamado pela aplicação — é um script de uso único, rode via:
 *   cd backend && npx tsx scripts/dev/seed-call-history.ts
 */
import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../src/infrastructure/database/pool.js"
import { runWorkflowTick } from "../../src/modules/workflows/application/engine.js"

const organizationId = "00000000-0000-4000-8000-000000000001"
const docsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../docs")

const OPERATOR_NAME_MAP: Record<string, string> = {
  "ANA LIMA": "Ana Lima",
  "CAMILA PEREIRA": "Camila Pereira",
  "DENISY FEITOZA": "Denisy Feitoza",
  "ICARO ELIAS": "Icaro Elias",
  "JULIANA PRADO": "Juliana Prado",
  "KAROLINE WOKYSBLY": "Karoline Wokysbly",
  "LUZIA INGRID": "Luzia Ingrid da Silva Nobre",
  "PAMELA ALBUQUERQUE": "Pamella Albuquerque",
  "LUANA BRENDA": "Luana Brenda",
  "GUSTAVO SANTOS": "Gustavo Santos",
  "SAMUEL AVELINO": "Samuel Avelino",
}

type TranscriptTurn = { Operador?: string; Cliente?: string }
type CallArrayFormat = { id_chamada: number; motivo: string; transcricao: TranscriptTurn[] }
type CallObjectFormat = { id: string; duracao?: string; motivo: string; contexto?: string; transcricao: TranscriptTurn[] }

type NormalizedCall = {
  externalId: string
  reason: string
  transcriptContent: string
  durationSeconds: number | null
}

// Mulberry32 - PRNG determinístico simples, sem dependência externa.
function seededRandom(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0
  return hash
}

const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g")

function rtfToJsonText(rtfPath: string): string {
  const raw = execFileSync("textutil", ["-convert", "txt", "-stdout", rtfPath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  return raw.replace(LINE_SEPARATORS, " ").trim()
}

// Alguns arquivos têm mais de um objeto JSON colado em sequência (conteúdo
// duplicado); pega só o primeiro valor válido e ignora o resto.
function parseFirstJsonValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const match = error instanceof Error ? error.message.match(/position (\d+)/) : null
    if (!match) throw error
    return JSON.parse(text.slice(0, Number(match[1])))
  }
}

function parseDuration(duracao: string | undefined): number | null {
  if (!duracao) return null
  const parts = duracao.split(":").map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

function flattenTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => {
      const [speaker, text] = turn.Operador !== undefined ? ["Operador", turn.Operador] : ["Cliente", turn.Cliente ?? ""]
      return `${speaker}: ${text.replace(/^\[\d{2}:\d{2}\]\s*/, "")}`
    })
    .join(" ")
}

function normalizeCalls(fileKey: string, parsed: unknown): NormalizedCall[] {
  const externalPrefix = fileKey.replace(/\s+/g, "-")
  if (Array.isArray(parsed)) {
    return (parsed as CallArrayFormat[]).map((call) => ({
      externalId: `${externalPrefix}-${call.id_chamada}`,
      reason: call.motivo,
      transcriptContent: flattenTranscript(call.transcricao),
      durationSeconds: null,
    }))
  }
  const calls = (parsed as { chamadas: CallObjectFormat[] }).chamadas
  return calls.map((call) => ({
    externalId: `${externalPrefix}-${call.id}`,
    reason: call.motivo,
    transcriptContent: flattenTranscript(call.transcricao),
    durationSeconds: parseDuration(call.duracao),
  }))
}

async function main() {
  const files = readdirSync(docsDir).filter((file) => file.startsWith("CHAMADAS - ") && file.endsWith(".rtf"))
  if (files.length === 0) throw new Error(`Nenhum arquivo CHAMADAS - *.rtf encontrado em ${docsDir}`)

  const flagRows = await pool.query<{ id: string; flag_name: string }>(
    `select id, flag_name from channel_flags where organization_id = $1 and channel = 'VOICE'`,
    [organizationId],
  )
  const flagIdByName = new Map(flagRows.rows.map((row) => [row.flag_name, row.id]))

  const workflowRows = await pool.query<{
    id: string
    active_version_id: string
    channel_flag_id: string
    scope_type: string
    team_id: string | null
  }>(
    `select id, active_version_id, (trigger_config ->> 'channelFlagId') channel_flag_id, scope_type, team_id
     from workflows
     where organization_id = $1 and active and active_version_id is not null`,
    [organizationId],
  )

  let totalCalls = 0
  let totalFirings = 0

  for (const file of files) {
    const fileKey = file.replace(/^CHAMADAS - /, "").replace(/\.rtf$/, "")
    const operatorName = OPERATOR_NAME_MAP[fileKey]
    if (!operatorName) {
      console.warn(`Sem mapeamento de operador para o arquivo "${file}" — pulando.`)
      continue
    }

    const personRow = await pool.query<{ id: string; team_id: string | null }>(
      `select id, team_id from people where organization_id = $1 and name = $2`,
      [organizationId, operatorName],
    )
    const operator = personRow.rows[0]
    if (!operator) {
      console.warn(`Operador "${operatorName}" não encontrado no banco — pulando arquivo "${file}".`)
      continue
    }

    const jsonText = rtfToJsonText(join(docsDir, file))
    const parsed = parseFirstJsonValue(jsonText)
    const calls = normalizeCalls(fileKey, parsed)
    console.log(`${operatorName}: ${calls.length} chamadas encontradas em "${file}"`)

    for (const [index, call] of calls.entries()) {
      totalCalls++
      const rng = seededRandom(hashSeed(`${call.externalId}`))
      const daysAgo = Math.floor(rng() * 20)
      const hour = 9 + Math.floor(rng() * 9)
      const minute = Math.floor(rng() * 60)
      const startedAt = new Date()
      startedAt.setDate(startedAt.getDate() - daysAgo)
      startedAt.setHours(hour, minute, 0, 0)
      const durationSeconds = call.durationSeconds ?? Math.round(120 + rng() * 420)
      const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000)

      const notaUra = 1 + Math.floor(rng() * 10)
      const tdna = Math.round(rng() * 100)
      const tempoSilencio = Math.round(rng() * 90)
      const rechamada = rng() < 0.25

      const client = await pool.connect()
      try {
        await client.query("begin")
        const interaction = await client.query<{ id: string }>(
          `insert into interactions (organization_id, operator_id, reason, channel, started_at, ended_at, external_id)
           values ($1,$2,$3,'VOICE',$4,$5,$6)
           on conflict (organization_id, external_id) do update set reason = excluded.reason
           returning id`,
          [organizationId, operator.id, call.reason, startedAt.toISOString(), endedAt.toISOString(), call.externalId],
        )
        const interactionId = interaction.rows[0]!.id

        await client.query(
          `insert into transcripts (organization_id, interaction_id, version, content, language)
           values ($1,$2,1,$3,'pt-BR')
           on conflict (interaction_id, version) do update set content = excluded.content`,
          [organizationId, interactionId, call.transcriptContent],
        )

        const flagValues: [string, boolean | null, number | null][] = [
          ["nota_ura", null, notaUra],
          ["tdna", null, tdna],
          ["tempo_silencio", null, tempoSilencio],
          ["rechamada", rechamada, null],
        ]
        for (const [flagName, valueBoolean, valueNumeric] of flagValues) {
          const flagId = flagIdByName.get(flagName)
          if (!flagId) continue
          await client.query(
            `insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean, value_numeric)
             values ($1,$2,$3,$4,$5)
             on conflict (interaction_id, channel_flag_id) do update set value_boolean = excluded.value_boolean, value_numeric = excluded.value_numeric`,
            [organizationId, interactionId, flagId, valueBoolean, valueNumeric],
          )
        }

        for (const workflow of workflowRows.rows) {
          if (workflow.scope_type === "TEAM" && workflow.team_id !== operator.team_id) continue
          const [flagName] = [...flagIdByName.entries()].find(([, id]) => id === workflow.channel_flag_id) ?? []
          const values: Record<string, boolean | number> = { nota_ura: notaUra, tdna, tempo_silencio: tempoSilencio, rechamada }
          if (!flagName) continue
          const actual = values[flagName]
          if (actual === undefined) continue

          const existingEnrollment = await client.query<{ id: string }>(
            `select id from workflow_enrollments where workflow_id = $1 and interaction_id = $2`,
            [workflow.id, interactionId],
          )
          if (existingEnrollment.rows[0]) continue

          const versionResult = await client.query<{ graph: { nodes: { id: string; type: string }[] } }>(
            `select graph from workflow_versions where id = $1`,
            [workflow.active_version_id],
          )
          const triggerNode = versionResult.rows[0]?.graph.nodes.find((node) => node.type === "trigger")
          if (!triggerNode) continue

          await client.query(
            `insert into workflow_enrollments (organization_id, workflow_id, version_id, interaction_id, current_node_id, matched_flag_name, matched_value_boolean, matched_value_numeric)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              organizationId,
              workflow.id,
              workflow.active_version_id,
              interactionId,
              triggerNode.id,
              flagName,
              typeof actual === "boolean" ? actual : null,
              typeof actual === "number" ? actual : null,
            ],
          )
          totalFirings++
        }

        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
      void index
    }
  }

  console.log(`\n${totalCalls} chamadas processadas, ${totalFirings} matrícula(s) em workflow registrada(s).`)
  console.log("Rodando o motor de workflow até todas as jornadas assentarem (ativo/aguardando -> concluído/falho):")

  for (let iteration = 1; iteration <= 50; iteration++) {
    const { processed } = await runWorkflowTick(pool)
    if (processed === 0) break
    console.log(`  tick ${iteration}: ${processed} matrícula(s) avançada(s)`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  const summary = await pool.query<{ status: string; count: string }>(
    `select status, count(*) count from workflow_enrollments where organization_id = $1 group by status`,
    [organizationId],
  )
  console.log("\nStatus final das matrículas:", summary.rows.map((row) => `${row.status}=${row.count}`).join(", "))

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
