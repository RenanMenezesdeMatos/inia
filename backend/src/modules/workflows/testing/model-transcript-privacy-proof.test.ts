/**
 * PROVA contra o banco de TESTE real — máscara de dados pessoais na transcrição que vai para a IA (R-31). Fixture apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run model-transcript-privacy-proof
 *
 * Prova: todos os caminhos que levam a transcrição a um modelo — o enrollment/agentes (loadLatestTranscriptForModel), o motor de
 * feedback (análise da chamada) e as ferramentas de investigação — recebem o MESMO texto mascarado; e a conferência final das
 * citações (feedback confiável) relê exatamente esse texto, então a citação do modelo continua literal. O banco guarda o original.
 */
import { createHash } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadInteractionForAnalysis } from "../../feedback-engine/infrastructure/postgres-engine-loaders.js"
import { loadTranscripts } from "../../investigation/application/tools/interaction-tools.js"
import { createPostgresMonitoringContextLoader } from "../../reliable-feedback/infrastructure/postgres-feedback-context-loaders.js"
import { loadLatestTranscript, loadLatestTranscriptForModel } from "../application/transcript.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const RAW = [
  "[00:00–00:06] OPERADOR: Olá, aqui é a Mariana, do atendimento.",
  "[00:10–00:20] CLIENTE: Meu CPF é 348.123.456-09 e o telefone (11) 98765-4321.",
  "[03:00–03:05] OPERADOR: O protocolo deste atendimento é 202610200031.",
].join("\n")
let pool: pg.Pool
const db = () => pool as unknown as Database

describe.skipIf(!ENABLED)("Transcrição mascarada para a IA — prova Postgres", () => {
  let personId: string
  let interactionId: string

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    const team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at, id limit 1", [ORG])).rows[0]!.id
    personId = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, active) values ($1,'Mariana Prova Máscara','OPERATOR',$2,true) returning id", [ORG, team])).rows[0]!.id
    interactionId = (await pool.query<{ id: string }>(
      "insert into interactions (organization_id, operator_id, external_id, reason, started_at, ended_at, channel) values ($1,$2,$3,'Segunda via',now() - interval '1 hour', now() - interval '55 minutes','VOICE') returning id",
      [ORG, personId, `PROVA-MASCARA-${personId.slice(0, 8)}`],
    )).rows[0]!.id
    await pool.query("insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)", [ORG, interactionId, RAW])
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from transcripts where interaction_id = $1", [interactionId])
    await pool.query("delete from interactions where id = $1", [interactionId])
    await pool.query("delete from people where id = $1", [personId])
    await pool.end()
  })

  it("o banco guarda o original; todo caminho para a IA recebe o mesmo texto mascarado", async () => {
    expect((await loadLatestTranscript(db(), interactionId))!.content).toBe(RAW)
    const forModel = (await loadLatestTranscriptForModel(db(), interactionId))!.content
    expect(forModel).toContain("Meu CPF é [CPF] e o telefone [TELEFONE].")
    expect(forModel).toContain("O protocolo deste atendimento é [PROTOCOLO].")
    expect(forModel).not.toMatch(/348\.123\.456-09|98765-4321|202610200031/)

    // Motor de feedback (análise da chamada): mesmo texto; a chave das análises guardadas é deste texto, não do original.
    const engine = await loadInteractionForAnalysis(pool, ORG, interactionId)
    expect(engine!.transcript!.content).toBe(forModel)
    expect(engine!.transcript!.checksum).toBe(createHash("sha256").update(forModel).digest("hex").slice(0, 16))
    expect(engine!.transcript!.checksum).not.toBe(createHash("sha256").update(RAW).digest("hex").slice(0, 16))

    // Ferramentas de investigação (sujeito e pares).
    const tools = await loadTranscripts({ db: pool, organizationId: ORG } as unknown as Parameters<typeof loadTranscripts>[0], [interactionId], [personId])
    expect(tools[0]!.content).toBe(forModel)
  })

  it("a conferência final das citações relê o MESMO texto: a citação mascarada que o modelo devolve continua literal", async () => {
    const context = await createPostgresMonitoringContextLoader(db())(ORG, interactionId, personId)
    expect(context!.transcript).toBe((await loadLatestTranscriptForModel(db(), interactionId))!.content)
    expect(context!.transcript).toContain("O protocolo deste atendimento é [PROTOCOLO].")
  })
})
