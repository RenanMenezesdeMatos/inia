import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { RunStage, RunStatus } from "../domain/run-status.js"
import { createDataHubContext } from "./data-hub-context.js"
import { recoverInterruptedRuns } from "./run-service.js"

/**
 * Recuperação de cargas interrompidas com duas rodadas juntas (dois processos — ex.: a trava da tarefa periódica perdida no
 * meio da rodada). A gravação confere de novo a posse vencida (compare-and-swap) e conta pelo `rowCount`: a rodada que leu
 * antes nunca devolve à fila (nem falha) uma carga que, entre a leitura e a gravação, voltou a ter dono.
 *
 * O banco fake é uma tabela só, compartilhada pelos dois processos, que avalia a condição `where` EXATAMENTE como o SQL a
 * escreve (predicado desconhecido = erro): sem o compare-and-swap na consulta, a segunda rodada gravaria.
 */
type RunRow = { id: string; status: RunStatus; claimedUntil: Date | null; stages: RunStage[]; errorCode: string | null }

const NOW = new Date("2026-10-18T12:00:00.000Z")
const minutes = (value: number) => new Date(NOW.getTime() + value * 60_000)

function predicateHolds(predicate: string, row: RunRow, params: unknown[]): boolean {
  if (predicate === "id = $1") return row.id === params[0]
  if (predicate === "claimed_until is not null") return row.claimedUntil !== null
  const anyStatus = /^status = any\(\$(\d+)::text\[\]\)$/.exec(predicate)
  if (anyStatus) return (params[Number(anyStatus[1]) - 1] as readonly string[]).includes(row.status)
  const claimedBefore = /^claimed_until < \$(\d+)$/.exec(predicate)
  // `null < x` no SQL é nulo — não passa.
  if (claimedBefore) return row.claimedUntil !== null && row.claimedUntil.getTime() < (params[Number(claimedBefore[1]) - 1] as Date).getTime()
  throw new Error(`predicado não suportado pelo banco fake: ${predicate}`)
}

function sharedTable(rows: RunRow[]) {
  /** Um "processo": `afterRead` segura a rodada depois da leitura das cargas vencidas, antes de qualquer gravação. */
  function processDatabase(afterRead?: () => Promise<void>): Database {
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim()
      const [head, where = ""] = text.split(" where ")
      const hit = rows.filter((row) => where.split(" and ").every((predicate) => predicateHolds(predicate, row, params)))
      if (head!.startsWith("select id, stages from data_ingestion_runs")) {
        const snapshot = hit.map((row) => ({ id: row.id, stages: structuredClone(row.stages) }))
        await afterRead?.()
        return { rows: snapshot, rowCount: snapshot.length }
      }
      if (head!.startsWith("update data_ingestion_runs set ")) {
        for (const row of hit) {
          row.status = /set status = '(\w+)'/.exec(head!)![1] as RunStatus
          if (head!.includes("claimed_until = null")) row.claimedUntil = null
          row.stages = JSON.parse(params[2] as string) as RunStage[]
          row.errorCode = /error_code = '(\w+)'/.exec(head!)?.[1] ?? row.errorCode
        }
        return { rows: [], rowCount: hit.length }
      }
      throw new Error(`consulta não esperada pelo banco fake: ${text}`)
    })
    return { query, connect: vi.fn() } as unknown as Database
  }
  return { processDatabase }
}

function processContext(db: Database) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { ctx: createDataHubContext(db, { logger }), logger }
}

/** Trava a rodada logo depois da leitura; `read` resolve quando ela leu, `release()` a deixa gravar. */
function pauseAfterRead() {
  let readDone!: () => void
  let release!: () => void
  const read = new Promise<void>((resolve) => (readDone = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  return { read, release, afterRead: async () => { readDone(); await gate } }
}

/** `previousFalls`: quantas quedas do processo a carga já sofreu. O limite conta a marca nas etapas (`canResumeInterruptedRun`), não `attempts`. */
const interruptedRun = (id: string, previousFalls: number): RunRow => ({
  id,
  status: "FETCHING",
  claimedUntil: minutes(-10),
  stages: [
    ...Array.from({ length: previousFalls }, () => ({ stage: "FETCHING" as const, startedAt: minutes(-40).toISOString(), finishedAt: minutes(-30).toISOString(), detail: null, interrupted: true })),
    { stage: "FETCHING", startedAt: minutes(-20).toISOString(), finishedAt: null, detail: null },
  ],
  errorCode: null,
})

describe("recoverInterruptedRuns — duas recuperações juntas", () => {
  it("a segunda, com a leitura antiga, não devolve à fila a carga que a primeira recuperou e outro worker já reivindicou", async () => {
    const run = interruptedRun("run-1", 0)
    const table = sharedTable([run])
    const pause = pauseAfterRead()
    const late = processContext(table.processDatabase(pause.afterRead))
    const early = processContext(table.processDatabase())

    const second = recoverInterruptedRuns(late.ctx, NOW)
    await pause.read
    expect(await recoverInterruptedRuns(early.ctx, NOW)).toEqual({ requeued: 1, failed: 0 })
    expect(run).toMatchObject({ status: "QUEUED", claimedUntil: null })

    // Outro worker reivindica a carga (posse de 15 min) e começa a executá-la.
    run.claimedUntil = minutes(15)
    run.status = "CONNECTING"
    const stagesOfTheNewOwner = structuredClone(run.stages)

    pause.release()
    expect(await second).toEqual({ requeued: 0, failed: 0 })
    expect(run).toMatchObject({ status: "CONNECTING", claimedUntil: minutes(15), stages: stagesOfTheNewOwner })
    expect(late.logger.warn).not.toHaveBeenCalled()
  })

  it("esgotadas as tentativas, só falha a carga que continua com a posse vencida — nunca a que renovou a posse entre a leitura e a gravação", async () => {
    const dead = interruptedRun("run-dead", 2)
    const alive = interruptedRun("run-alive", 2)
    const table = sharedTable([dead, alive])
    const pause = pauseAfterRead()
    const recovery = processContext(table.processDatabase(pause.afterRead))

    const result = recoverInterruptedRuns(recovery.ctx, NOW)
    await pause.read
    // A carga viva avança (cada etapa/página renova a posse) depois que a recuperação já a leu como vencida.
    alive.claimedUntil = minutes(15)

    pause.release()
    expect(await result).toEqual({ requeued: 0, failed: 1 })
    expect(dead).toMatchObject({ status: "FAILED", claimedUntil: null, errorCode: "DATA_INTERNAL_ERROR" })
    expect(alive).toMatchObject({ status: "FETCHING", claimedUntil: minutes(15), errorCode: null })
    expect(recovery.logger.warn).toHaveBeenCalledWith({ requeued: 0, failed: 1 }, "data-hub interrupted runs recovered")
  })
})
