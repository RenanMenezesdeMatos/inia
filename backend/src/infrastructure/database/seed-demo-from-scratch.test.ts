import { describe, expect, it } from "vitest"
import { seedDemoFromScratch } from "./seed-demo-from-scratch.js"
import { runDemoSeed } from "./run-demo-seed.js"
import type pg from "pg"

/**
 * Integração real (Postgres): liga com DEMO_SEED_CHECK=1 (o mesmo que `npm run db:seed:demo:check`
 * faz). Cria um banco descartável, migra, roda o seed duas vezes e derruba o banco — nunca toca
 * inia/inia_test. Sem a variável, só a política (produção recusada) roda, sem banco.
 */
const enabled = process.env.DEMO_SEED_CHECK === "1"
const adminUrl = process.env.POSTGRES_ADMIN_URL ?? "postgresql://localhost:5432/postgres"

describe("seed de demonstração — do zero num banco recém-migrado", () => {
  it("produção é recusada pelo runner ANTES de tocar o banco (sem catch-e-ignora)", async () => {
    const client = { query: () => Promise.reject(new Error("não deveria consultar")) } as unknown as pg.PoolClient
    await expect(runDemoSeed(client, "production", () => {})).rejects.toThrow(/NODE_ENV=production/)
  })

  it.skipIf(!enabled)(
    "bootstrap do zero (2×) num banco descartável: migrations até HEAD, 27 capitais, catálogo de feriados com proveniência, massa completa, seed legado carrega só pessoas existentes, nenhum fechamento oficial no mês corrente, idempotente (zero duplicata)",
    async () => {
      const result = await seedDemoFromScratch(adminUrl, () => {})
      expect(result.migrationsApplied).toBeGreaterThan(60)
      // Reference data pelo bootstrap (ninguém precisa lembrar de rodar db:seed:reference à parte).
      expect(result.counts.capitals).toBe(27)
      expect(result.counts.holidays).toBeGreaterThan(300)
      expect(result.counts.holidaysWithVerification).toBe(result.counts.holidays)
      expect(result.bootstrap.first.reference.holidays.inserted).toBe(result.counts.holidays)
      expect(result.bootstrap.second.migrationsApplied).toHaveLength(0)
      expect(result.bootstrap.second.reference.holidays.inserted).toBe(0)
      expect(result.bootstrap.second.reference.holidays.updated).toBe(0)
      // Exceções de calendário das fixtures (Central + Supervisor) presentes e não duplicadas.
      expect(result.counts.scheduleExceptions).toBe(2)
      // Indicador de volume da massa (Atendimentos: SUM/COUNT/diário/evidência/contribuição zero) + medições
      // diárias + as duas classificações das fixtures (0029 falta injustificada vigente; 0030 superada por evidência).
      expect(result.counts.volumeIndicators).toBe(1)
      expect(result.counts.volumeMeasurements).toBeGreaterThan(100_000)
      expect(result.counts.classifications).toBe(2)
      // FALTA INJUSTIFICADA só com a massa oficial: Atendimentos (contribuição zero) 5 dias conhecidos = 4 medições + 1 zero lógico;
      // TMA (sem amostra) 4 amostras, nenhum zero; Atestado depois → 4/4 e a zero some; nenhuma linha criada nem apagada; 0030 trabalhou.
      const proof = result.absenceProof
      expect(proof.unjustified).toMatchObject({ eligibleDays: 5, unjustifiedAbsenceDays: 1 })
      expect(proof.unjustified.atendimentos).toMatchObject({ sampleCount: 5, daysWithData: 5, expectedDays: 5, policy: "ZERO_CONTRIBUTION", zeroContributionDays: 1 })
      expect(proof.unjustified.tma).toMatchObject({ sampleCount: 4, daysWithData: 4, policy: "NO_SAMPLE", zeroContributionDays: 0 })
      expect(proof.unjustified.rawVolumeRows).toBeGreaterThan(0)
      expect(proof.afterAtestado).toMatchObject({ eligibleDays: 4, historyLength: 2, rawVolumeRows: proof.unjustified.rawVolumeRows })
      expect(proof.afterAtestado.atendimentos).toMatchObject({ sampleCount: 4, daysWithData: 4, expectedDays: 4, zeroContributionDays: 0 })
      expect(proof.afterAtestado.atendimentos.value).toBe(proof.unjustified.atendimentos.value)
      expect(proof.lateEvidence).toMatchObject({ unjustifiedAbsenceDays: 0, history: [{ classification: "UNJUSTIFIED_ABSENCE", supersededReason: "CONTRADICTED_BY_WORK_EVIDENCE" }] })
      expect(proof.lateEvidence.workedObservedDays).toBeGreaterThanOrEqual(4)
      // Seed legado 001: só as pessoas legadas que as MIGRATIONS criam existem num banco limpo
      // (2 das 11 → 36 linhas de jul/ago); as outras 9 são puladas pelo `join people` em vez de
      // estourar a FK. Nunca as 264 linhas do arquivo inteiro, nunca setembro (mês corrente).
      expect(result.first.sqlFiles.map((file) => file.name)).toEqual(["001_operator_performance.sql", "002_data_hub.sql"])
      expect(result.first.sqlFiles[0]!.rowsAffected).toBeGreaterThan(0)
      expect(result.first.sqlFiles[0]!.rowsAffected).toBeLessThanOrEqual(36)
      expect(result.counts.people).toBeGreaterThanOrEqual(2109)
      expect(result.counts.measurements).toBeGreaterThan(100_000)
      expect(result.counts.officialRowsCurrentMonth).toBe(0)
      expect(result.counts.closedPeriods).toHaveLength(6)
      // Segunda rodada: nada novo (idempotente) — o relatório da massa continua consistente.
      expect(result.second.sqlFiles[0]!.rowsAffected).toBe(0)
    },
    600_000,
  )
})
